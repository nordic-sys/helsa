package challenge

import (
	"testing"
	"time"

	// The month boundary is a statement about the user's calendar, and one of the
	// cases below is exactly the Budapest/UTC disagreement. A machine with no
	// system zone database would otherwise fail to load "Europe/Budapest" and take
	// the case with it, for a reason that has nothing to do with the rule.
	_ "time/tzdata"
)

func budapest(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation("Europe/Budapest")
	if err != nil {
		t.Fatalf("Europe/Budapest: %v", err)
	}
	return loc
}

// The cleanup runs at construction, because the milestones arrive by three
// routes and only one of them is ours.
func TestNewThresholdsTidiesTheRowUp(t *testing.T) {
	cases := []struct {
		name string
		in   []int
		want []int
	}{
		{"sorted and deduplicated", []int{35_000, 20_000, 35_000}, []int{20_000, 35_000}},
		// A 0-step milestone would look accomplished at the start of the month, and a
		// negative one is not a strict goal but a typo.
		{"non-positive dropped", []int{0, -5, 20_000}, []int{20_000}},
		{"already tidy", []int{1, 2, 3}, []int{1, 2, 3}},
		// An empty row is respected, not silently replaced with the default: the user
		// deleting every milestone is a statement, not an absence.
		{"empty stays empty", []int{0}, []int{}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := NewThresholds(c.in).Values
			if len(got) != len(c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Fatalf("got %v, want %v", got, c.want)
				}
			}
		})
	}
}

func TestThresholdsGoalIsTheLargest(t *testing.T) {
	if goal, ok := NewThresholds([]int{20_000, 200_000, 70_000}).Goal(); !ok || goal != 200_000 {
		t.Errorf("goal = %d, %v; want 200000, true", goal, ok)
	}
	// No milestone means no goal — not a goal of zero, which every month would meet.
	if goal, ok := NewThresholds(nil).Goal(); ok || goal != 0 {
		t.Errorf("goal = %d, %v; want 0, false", goal, ok)
	}
}

func TestParseThresholds(t *testing.T) {
	got, err := ParseThresholds(" 70000, 20000 ,35000, ")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	want := []int{20_000, 35_000, 70_000}
	for i := range want {
		if got.Values[i] != want[i] {
			t.Fatalf("got %v, want %v", got.Values, want)
		}
	}
	// Not lenient about a non-number: dropping it silently would answer with a
	// milestone row the caller never asked for, and they could not tell.
	if _, err := ParseThresholds("20000,twenty"); err == nil {
		t.Error("a non-numeric milestone was accepted")
	}
}

func TestMonthDayCountComesFromTheCalendar(t *testing.T) {
	cases := []struct {
		period string
		days   int
	}{
		{"2026-02", 28},
		{"2024-02", 29}, // leap year
		{"2100-02", 28}, // a century that is not a leap year
		{"2026-09", 30},
		{"2026-12", 31},
	}
	for _, c := range cases {
		t.Run(c.period, func(t *testing.T) {
			m, err := ParseMonth(c.period)
			if err != nil {
				t.Fatalf("parse: %v", err)
			}
			if m.DayCount != c.days {
				t.Errorf("day count = %d, want %d", m.DayCount, c.days)
			}
			if m.Period() != c.period {
				t.Errorf("period = %q, want %q", m.Period(), c.period)
			}
		})
	}
	if _, err := ParseMonth("2026-13"); err == nil {
		t.Error("month 13 was accepted")
	}
	if _, err := ParseMonth("august"); err == nil {
		t.Error("a non-period was accepted")
	}
}

// A month is a span in the user's calendar, not an instant.
func TestMonthContainingReadsTheUsersCalendar(t *testing.T) {
	loc := budapest(t)
	instant := time.Date(2026, 8, 31, 22, 30, 0, 0, time.UTC)

	if got := MonthContaining(instant, time.UTC).Period(); got != "2026-08" {
		t.Errorf("in UTC = %q, want 2026-08", got)
	}
	// The same instant is already September in Budapest, so a new challenge runs
	// there — not the last day of the August one.
	if got := MonthContaining(instant, loc).Period(); got != "2026-09" {
		t.Errorf("in Budapest = %q, want 2026-09", got)
	}
}

func TestDaysRemainingCountsToday(t *testing.T) {
	sep, _ := ParseMonth("2026-09")
	cases := []struct {
		name string
		now  time.Time
		want int
	}{
		{"first of the month", time.Date(2026, 9, 1, 8, 0, 0, 0, time.UTC), 30},
		{"mid month", time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC), 21},
		// On the last day the honest answer is 1 — today — not 0: there are still
		// steps to be taken today.
		{"last day", time.Date(2026, 9, 30, 23, 0, 0, 0, time.UTC), 1},
		{"month closed", time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), 0},
		{"month not begun", time.Date(2026, 8, 20, 0, 0, 0, 0, time.UTC), 30},
		{"year not begun", time.Date(2025, 12, 31, 0, 0, 0, 0, time.UTC), 30},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := sep.DaysRemaining(c.now, time.UTC); got != c.want {
				t.Errorf("days remaining = %d, want %d", got, c.want)
			}
		})
	}
}

// The daily goal derives from the monthly one. Deliberately not a second
// setting: a daily goal that cannot reach the monthly one would let the same
// screen say "on track" and "behind" at once.
func TestDailyGoalDerivesFromTheMonthlyOne(t *testing.T) {
	sep, _ := ParseMonth("2026-09") // 30 days
	feb, _ := ParseMonth("2026-02") // 28 days

	if got, ok := dailyGoal(NewThresholds([]int{200_000}), sep); !ok || got != 6_667 {
		t.Errorf("daily goal = %d, %v; want 6667, true", got, ok)
	}
	// The shorter month asks for more per day for the same monthly total.
	if got, ok := dailyGoal(NewThresholds([]int{200_000}), feb); !ok || got != 7_143 {
		t.Errorf("daily goal = %d, %v; want 7143, true", got, ok)
	}
	// A goal smaller than the month still asks for at least one step a day —
	// otherwise a goal of 0 would be met by lying in bed.
	if got, ok := dailyGoal(NewThresholds([]int{10}), sep); !ok || got != 1 {
		t.Errorf("daily goal = %d, %v; want 1, true", got, ok)
	}
	// No milestone means no goal, so there is nothing a day could be measured
	// against and no streak is claimed.
	if _, ok := dailyGoal(NewThresholds(nil), sep); ok {
		t.Error("a daily goal was derived from an empty milestone row")
	}
}
