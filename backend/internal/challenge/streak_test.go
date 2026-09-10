package challenge

import (
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// streakOf evaluates a window that ENDS TODAY: the values are one day each,
// oldest first, and the last one is today. A negative value means the day
// carried no measurement at all — such a day is absent from the series, never a
// zero.
func streakOf(goal int, values ...float64) api.ChallengeStreak {
	loc := time.UTC
	today := time.Date(2026, 9, 10, 0, 0, 0, 0, loc)
	from := today.AddDate(0, 0, -(len(values) - 1))
	byDay := map[string]float64{}
	for i, v := range values {
		if v < 0 {
			continue
		}
		byDay[DayKey(from.AddDate(0, 0, i), loc)] = v
	}
	return evaluateStreak(byDay, goal, from, today, loc)
}

const noMeasurement = -1

// The vectors. Each row is a window of days ending today, against a goal of
// 10 000 steps.
func TestStreakVectors(t *testing.T) {
	const goal = 10_000

	cases := []struct {
		name    string
		days    []float64
		length  int
		longest int
		broken  api.ChallengeStreakBreakReason
		// brokenDay is the 0-based index into days; -1 means no day is named.
		brokenDay int
	}{
		{
			// Today is not over. A streak that read as broken every morning until the
			// walk would be worse than useless, so today neither counts nor breaks.
			name:   "today is open, the run behind it stands",
			days:   []float64{12_000, 11_000, 10_500, 400},
			length: 3, longest: 3, broken: api.StartOfHistory, brokenDay: -1,
		},
		{
			name:   "today already reached the goal and joins the run",
			days:   []float64{12_000, 11_000, 10_500, 12_000},
			length: 4, longest: 4, broken: api.StartOfHistory, brokenDay: -1,
		},
		{
			// Exactly at the goal counts as reached.
			name:   "exactly at the goal counts",
			days:   []float64{10_000, 10_000},
			length: 2, longest: 2, broken: api.StartOfHistory, brokenDay: -1,
		},
		{
			name:   "a day under the goal breaks it, and is named",
			days:   []float64{12_000, 5_000, 11_000, 12_000, 900},
			length: 2, longest: 2, broken: api.Missed, brokenDay: 1,
		},
		{
			// Not the same answer as "missed": a day we know nothing about is not a
			// failure of the user, and reporting it as one is the same lie as treating a
			// missing measurement as a zero.
			name:   "a day with no measurement breaks it, for a different reason",
			days:   []float64{12_000, noMeasurement, 11_000, 12_000, 900},
			length: 2, longest: 2, broken: api.NoData, brokenDay: 1,
		},
		{
			name:   "no run at all",
			days:   []float64{5_000, 4_000, 900},
			length: 0, longest: 0, brokenDay: -1,
		},
		{
			// The current run is short, but the window remembers a longer one.
			name:   "the longest run of the window is kept",
			days:   []float64{12_000, 12_000, 12_000, 5_000, 11_000, 900},
			length: 1, longest: 3, broken: api.Missed, brokenDay: 3,
		},
		{
			// The window simply ends there — we know nothing older, so we claim nothing
			// about it.
			name:   "the run reaches the start of the window",
			days:   []float64{12_000, 12_000, 900},
			length: 2, longest: 2, broken: api.StartOfHistory, brokenDay: -1,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := streakOf(goal, c.days...)
			if got.Length != c.length {
				t.Errorf("length = %d, want %d", got.Length, c.length)
			}
			if got.Longest != c.longest {
				t.Errorf("longest = %d, want %d", got.Longest, c.longest)
			}
			// Every day of a run is a walked day here: the days that could differ are
			// exactly the neutral ones, and those need an input the server does not have.
			if got.ActiveDays != got.Length {
				t.Errorf("active days = %d, length = %d — they cannot differ on the server",
					got.ActiveDays, got.Length)
			}
			if c.length == 0 {
				if got.BrokenBy != nil {
					t.Errorf("broken_by = %+v on a window with no run", *got.BrokenBy)
				}
				return
			}
			if got.BrokenBy == nil {
				t.Fatalf("broken_by is missing on a run of %d days", got.Length)
			}
			if got.BrokenBy.Reason != c.broken {
				t.Errorf("reason = %q, want %q", got.BrokenBy.Reason, c.broken)
			}
			if c.brokenDay < 0 {
				if got.BrokenBy.Day != nil {
					t.Errorf("a day was named for %q", c.broken)
				}
				return
			}
			wantDay := time.Date(2026, 9, 10, 0, 0, 0, 0, time.UTC).
				AddDate(0, 0, c.brokenDay-(len(c.days)-1))
			if got.BrokenBy.Day == nil || !got.BrokenBy.Day.Equal(wantDay) {
				t.Errorf("broken on %v, want %v", got.BrokenBy.Day, wantDay.Format("2006-01-02"))
			}
		})
	}
}

func TestStreakWithoutAGoalClaimsNothing(t *testing.T) {
	got := streakOf(0, 12_000, 12_000, 12_000)

	if got.DailyGoal != nil {
		t.Errorf("daily goal = %v, want absent", *got.DailyGoal)
	}
	// A goal of 0 would be met by lying in bed, so no streak is claimed at all.
	if got.Length != 0 || got.Longest != 0 || got.BrokenBy != nil {
		t.Errorf("a streak was claimed against no goal: %+v", got)
	}
	// The caveat still travels: the reader has to know what is missing whether or
	// not there is a number.
	if len(got.MissingInputs) == 0 {
		t.Error("missing inputs were dropped when there was no goal")
	}
}

func TestStreakWindowIsReported(t *testing.T) {
	got := streakOf(10_000, 12_000, 12_000, 12_000)

	if got.WindowTo.Format("2006-01-02") != "2026-09-10" {
		t.Errorf("window ends %v, want today", got.WindowTo)
	}
	if got.WindowFrom.Format("2006-01-02") != "2026-09-08" {
		t.Errorf("window starts %v, want 2026-09-08", got.WindowFrom)
	}
}
