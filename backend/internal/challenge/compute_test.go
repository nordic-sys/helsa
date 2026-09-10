package challenge

import (
	"fmt"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// A September day at noon — the running month of every case below, so that "the
// month so far" and "the whole month" are visibly different things.
func sept(day int) time.Time {
	return time.Date(2026, 9, day, 12, 0, 0, 0, time.UTC)
}

// septDays turns a list of daily step counts into the input series, starting on
// the 1st. A negative value means NO MEASUREMENT for that day — such a day is
// left out of the list entirely, exactly as the real reader leaves it out.
func septDays(values ...float64) []DayTotal {
	out := []DayTotal{}
	for i, v := range values {
		if v < 0 {
			continue
		}
		out = append(out, DayTotal{Day: fmt.Sprintf("2026-09-%02d", i+1), Steps: v})
	}
	return out
}

func computeSept(t *testing.T, now time.Time, thresholds []int, values ...float64) api.ChallengeResponse {
	t.Helper()
	m, err := ParseMonth("2026-09")
	if err != nil {
		t.Fatalf("parse month: %v", err)
	}
	return Compute(Input{
		Month:      m,
		Thresholds: NewThresholds(thresholds),
		Source:     api.ChallengeResponseThresholdsSourceDefault,
		Daily:      septDays(values...),
		Now:        now,
		Loc:        time.UTC,
	})
}

// docs/25 K13: the card showed the step count CLIPPED to the goal, so somebody
// who had walked 200 000 against a 100 000 goal was told 100 000. The real
// figure is the real figure; it is the percentage that stops at 100.
func TestStepsAreNeverClippedToTheGoal(t *testing.T) {
	got := computeSept(t, sept(10), []int{100_000}, 200_000)

	if got.Steps == nil || *got.Steps != 200_000 {
		t.Fatalf("steps = %v, want 200000 — the measured figure, not the goal", got.Steps)
	}
	if got.Percent == nil || *got.Percent != 100 {
		t.Errorf("percent = %v, want 100 (done, not 200%%)", got.Percent)
	}
	if !got.Complete {
		t.Error("complete = false on twice the goal")
	}
	// Stated separately, because the clamped percentage would otherwise conceal
	// that the goal was met twice over.
	if got.OvershootSteps == nil || *got.OvershootSteps != 100_000 {
		t.Errorf("overshoot = %v, want 100000", got.OvershootSteps)
	}
	if got.RemainingSteps == nil || *got.RemainingSteps != 0 {
		t.Errorf("remaining = %v, want 0", got.RemainingSteps)
	}
	if got.NextThreshold != nil {
		t.Errorf("next threshold = %v, want none — every milestone is done", *got.NextThreshold)
	}
}

// A missing measurement is not a zero, and here it is the whole month that is
// missing: on the first morning of a month, before the first sync, the response
// must not confidently report that not a step has been taken.
func TestNoMeasurementIsNotAZeroMonth(t *testing.T) {
	got := computeSept(t, sept(3), DefaultThresholds)

	if got.Steps != nil {
		t.Errorf("steps = %v, want absent", *got.Steps)
	}
	if got.StepsPerDay != nil {
		t.Errorf("steps per day = %v, want absent", *got.StepsPerDay)
	}
	if got.Percent != nil {
		t.Errorf("percent = %v, want absent — a 0 would read as a measured zero", *got.Percent)
	}
	if got.Complete {
		t.Error("complete = true without a single measurement")
	}
	if got.RemainingSteps != nil || got.OvershootSteps != nil || got.StepsToNextThreshold != nil {
		t.Error("a step figure was derived from a month we know nothing about")
	}
	for _, m := range got.Thresholds {
		if m.Reached {
			t.Errorf("milestone %d counted as reached without data", m.Steps)
		}
	}
	if got.MeasuredDays != 0 {
		t.Errorf("measured days = %d, want 0", got.MeasuredDays)
	}
	// The first milestone is still named: that is a fact about the row, not a
	// claim about the month.
	if got.NextThreshold == nil || *got.NextThreshold != 20_000 {
		t.Errorf("next threshold = %v, want 20000", got.NextThreshold)
	}
}

func TestMilestonesReachedAtTheThreshold(t *testing.T) {
	// 20 000 exactly: at the threshold counts as reached.
	got := computeSept(t, sept(10), []int{20_000, 35_000}, 20_000)

	want := []bool{true, false}
	for i, m := range got.Thresholds {
		if m.Reached != want[i] {
			t.Errorf("milestone %d reached = %v, want %v", m.Steps, m.Reached, want[i])
		}
	}
	if got.NextThreshold == nil || *got.NextThreshold != 35_000 {
		t.Fatalf("next threshold = %v, want 35000", got.NextThreshold)
	}
	if got.StepsToNextThreshold == nil || *got.StepsToNextThreshold != 15_000 {
		t.Errorf("steps to next = %v, want 15000", got.StepsToNextThreshold)
	}
}

// The average is the total over the days that HAPPENED, not over the days that
// carried a measurement. A month with a gap in it really did produce fewer steps
// per day; `measured_days` is what says how much of the month is missing.
func TestStepsPerDayUsesTheDaysThatHappened(t *testing.T) {
	// The 1st to the 9th are behind us on the 10th; three of them are gaps.
	got := computeSept(t, sept(10), []int{200_000},
		9_000, -1, -1, -1, 9_000, 9_000, 9_000, 9_000, 9_000, 9_000)

	if got.DaysElapsed != 9 {
		t.Fatalf("days elapsed = %d, want 9 — today is counted in days_remaining", got.DaysElapsed)
	}
	if got.DaysRemaining != 21 || got.DaysElapsed+got.DaysRemaining != got.DaysInMonth {
		t.Errorf("elapsed %d + remaining %d != %d", got.DaysElapsed, got.DaysRemaining, got.DaysInMonth)
	}
	if got.Steps == nil || *got.Steps != 63_000 {
		t.Fatalf("steps = %v, want 63000", got.Steps)
	}
	if got.StepsPerDay == nil || *got.StepsPerDay != 7_000 {
		t.Errorf("steps per day = %v, want 7000 (63000 / 9)", got.StepsPerDay)
	}
	if got.MeasuredDays != 7 {
		t.Errorf("measured days = %d, want 7", got.MeasuredDays)
	}
	// Today is laid out too, gap or not; a day that has not happened is not.
	if len(got.Days) != 10 {
		t.Errorf("days laid out = %d, want 10", len(got.Days))
	}
	if got.Days[1].Steps != nil {
		t.Error("a day with no measurement was given a step count")
	}
}

// A day beyond today is left OUT rather than sent empty: an empty cell for a day
// that has not happened reads as a day missed.
func TestTheMonthIsLaidOutOnlyAsFarAsToday(t *testing.T) {
	cases := []struct {
		name string
		now  time.Time
		days int
	}{
		{"mid month", sept(10), 10},
		{"first day", sept(1), 1},
		{"month closed", time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC), 30},
		{"month not begun", time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC), 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := computeSept(t, c.now, DefaultThresholds)
			if len(got.Days) != c.days {
				t.Errorf("days laid out = %d, want %d", len(got.Days), c.days)
			}
		})
	}
}

// With every milestone deleted there is nothing to scale to — and we say so
// rather than inventing a goal.
func TestNoMilestonesMeansNoGoalAndNoStreak(t *testing.T) {
	got := computeSept(t, sept(10), nil, 50_000)

	if got.Goal != nil {
		t.Errorf("goal = %v, want absent", *got.Goal)
	}
	if got.Percent != nil {
		t.Errorf("percent = %v, want absent", *got.Percent)
	}
	// The measured total still stands: the steps were taken whether or not there
	// is a milestone to hold them against.
	if got.Steps == nil || *got.Steps != 50_000 {
		t.Errorf("steps = %v, want 50000", got.Steps)
	}
	if got.Streak.DailyGoal != nil {
		t.Errorf("daily goal = %v, want absent", *got.Streak.DailyGoal)
	}
	if got.Streak.Length != 0 {
		t.Errorf("streak length = %d, want 0 — nothing to measure a day against", got.Streak.Length)
	}
}

// The response always names what the server could not see, whatever the numbers
// say: a streak that is quietly a lower bound is worse than none, because the
// reader takes it for the figure on their phone and concludes it broke.
func TestTheStreakAlwaysNamesItsMissingInputs(t *testing.T) {
	got := computeSept(t, sept(10), DefaultThresholds, 20_000, 20_000)

	want := map[string]bool{"illness_days": true, "chosen_rest_days": true}
	if len(got.Streak.MissingInputs) != len(want) {
		t.Fatalf("missing inputs = %v, want %v", got.Streak.MissingInputs, want)
	}
	for _, in := range got.Streak.MissingInputs {
		if !want[in] {
			t.Errorf("unexpected missing input %q", in)
		}
	}
}
