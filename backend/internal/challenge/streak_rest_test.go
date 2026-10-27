package challenge

import (
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// The chosen rest days, ported from the phone (`RestDayTests.swift`). The cases
// are the phone's own, day for day, with the illness cases left out: the journal
// never reaches the server, so there is nothing here to port them against.
//
// The setting is August 2026 and a daily goal of 6 000, as on the phone.

const restGoal = 6_000

func aug(day int) time.Time { return time.Date(2026, 8, day, 0, 0, 0, 0, time.UTC) }

// restStreak evaluates August `from`…`today`. steps maps a day of the month to
// its count (an absent day carried no measurement), chosen lists the marked rest
// days.
func restStreak(steps map[int]float64, chosen []int, today, from int) (api.ChallengeStreak, []dayState) {
	byDay := map[string]float64{}
	for d, v := range steps {
		byDay[DayKey(aug(d), time.UTC)] = v
	}
	rest := map[string]bool{}
	for _, d := range chosen {
		rest[DayKey(aug(d), time.UTC)] = true
	}
	_, states := dayStates(byDay, rest, restGoal, aug(from), aug(today), time.UTC)
	return evaluateStreak(byDay, rest, restGoal, aug(from), aug(today), time.UTC), states
}

// walked: days lo…hi, comfortably over the goal.
func walked(lo, hi int) map[int]float64 {
	out := map[int]float64{}
	for d := lo; d <= hi; d++ {
		out[d] = 9_000
	}
	return out
}

// stateOn reads one day's state; states start at `from`.
func stateOn(states []dayState, from, day int) dayState { return states[day-from] }

func TestAChosenRestDayKeepsTheStreak(t *testing.T) {
	steps := walked(1, 10)
	steps[5] = 900
	s, states := restStreak(steps, []int{5}, 10, 1)

	if stateOn(states, 1, 5) != restChosen {
		t.Errorf("the 5th = %v, want a credited rest day", stateOn(states, 1, 5))
	}
	if s.Length != 10 || s.ActiveDays != 9 || s.ChosenRestDays != 1 {
		t.Errorf("length/active/rest = %d/%d/%d, want 10/9/1 — the rest day is neutral, not walked",
			s.Length, s.ActiveDays, s.ChosenRestDays)
	}
	if s.BrokenBy == nil || s.BrokenBy.Reason != api.StartOfHistory {
		t.Errorf("broken_by = %+v, want start_of_history", s.BrokenBy)
	}
	if len(s.RestDays) != 1 || !s.RestDays[0].Equal(aug(5)) {
		t.Errorf("rest days in the run = %v, want [2026-08-05]", s.RestDays)
	}
}

// Marked as a rest day, then walked anyway. That is a walked day; anything else
// would let a pre-emptive mark quietly hoard the weekly allowance.
func TestReachingTheGoalWinsOverAMarking(t *testing.T) {
	s, states := restStreak(walked(1, 10), []int{3, 4, 5, 6}, 10, 1)

	if stateOn(states, 1, 3) != met || stateOn(states, 1, 6) != met {
		t.Error("a marked day that reached the goal was not counted as walked")
	}
	if s.ChosenRestDays != 0 || s.ActiveDays != 10 {
		t.Errorf("rest/active = %d/%d, want 0/10", s.ChosenRestDays, s.ActiveDays)
	}
}

func TestTwoChosenRestDaysAWeekAreCreditedTheThirdIsNot(t *testing.T) {
	steps := walked(1, 14)
	for _, d := range []int{5, 6, 7} {
		steps[d] = 300
	}
	s, states := restStreak(steps, []int{5, 6, 7}, 14, 1)

	if stateOn(states, 1, 5) != restChosen || stateOn(states, 1, 6) != restChosen {
		t.Error("the first two rest days of the week were not credited")
	}
	if stateOn(states, 1, 7) != restOverBudget {
		t.Errorf("the 7th = %v, want over budget — the allowance was spent", stateOn(states, 1, 7))
	}
	if s.Length != 7 { // 8…14
		t.Errorf("length = %d, want 7", s.Length)
	}
	if s.BrokenBy == nil || s.BrokenBy.Reason != api.RestOverBudget ||
		s.BrokenBy.Day == nil || !s.BrokenBy.Day.Equal(aug(7)) {
		t.Errorf("broken_by = %+v, want rest_over_budget on the 7th", s.BrokenBy)
	}
}

func TestTheWeeklyAllowanceRolls(t *testing.T) {
	steps := walked(1, 20)
	for _, d := range []int{2, 3, 12, 13} {
		steps[d] = 300
	}
	s, states := restStreak(steps, []int{2, 3, 12, 13}, 20, 1)

	for _, d := range []int{2, 3, 12, 13} {
		if stateOn(states, 1, d) != restChosen {
			t.Errorf("the %d. = %v, want a credited rest day — a different week, a fresh allowance",
				d, stateOn(states, 1, d))
		}
	}
	if s.Length != 20 || s.ChosenRestDays != 4 {
		t.Errorf("length/rest = %d/%d, want 20/4", s.Length, s.ChosenRestDays)
	}
	// Newest first, as the phone lists them.
	if len(s.RestDays) != 4 || !s.RestDays[0].Equal(aug(13)) || !s.RestDays[3].Equal(aug(2)) {
		t.Errorf("rest days = %v, want 13, 12, 3, 2", s.RestDays)
	}
}

// Four rest days after a missed day. Without this rule the page would announce a
// four-day streak built on no movement at all.
func TestARunMadeOnlyOfRestDaysIsNotAStreak(t *testing.T) {
	steps := walked(1, 10)
	steps[5] = 1_000
	steps[6], steps[7] = 500, 500
	s, _ := restStreak(steps, []int{6, 7}, 7, 1)

	if s.Length != 0 || s.ChosenRestDays != 0 || len(s.RestDays) != 0 {
		t.Errorf("length/rest = %d/%d %v, want no streak", s.Length, s.ChosenRestDays, s.RestDays)
	}
	if s.BrokenBy != nil {
		t.Errorf("broken_by = %+v on a window with no live streak", s.BrokenBy)
	}
	// The longest run still remembers the walked days before it.
	if s.Longest != 4 {
		t.Errorf("longest = %d, want 4 (1…4)", s.Longest)
	}
}

func TestConsecutiveRestDaysInsideTheAllowance(t *testing.T) {
	steps := walked(1, 10)
	steps[8], steps[9] = 100, 100
	s, states := restStreak(steps, []int{8, 9}, 10, 1)

	if s.Length != 10 || s.ChosenRestDays != 2 || stateOn(states, 1, 10) != met {
		t.Errorf("length/rest = %d/%d, today = %v", s.Length, s.ChosenRestDays, stateOn(states, 1, 10))
	}
}

func TestARestDayAtTheStartOfTheWindowIsCredited(t *testing.T) {
	steps := walked(1, 10)
	steps[1] = 100
	s, states := restStreak(steps, []int{1}, 10, 1)

	if stateOn(states, 1, 1) != restChosen || s.Length != 10 {
		t.Errorf("state/length = %v/%d, want a credited rest day and 10", stateOn(states, 1, 1), s.Length)
	}
	// The run reaches the edge of what we know; nothing older is claimed.
	if s.BrokenBy == nil || s.BrokenBy.Reason != api.StartOfHistory {
		t.Errorf("broken_by = %+v, want start_of_history", s.BrokenBy)
	}
}

// Today (the 10th) is open, the 9th is a marked rest day — the run is 1…9 and
// holds, and it still needs its walked days.
func TestARestDayAsTheLastDayBeforeToday(t *testing.T) {
	steps := walked(1, 9)
	steps[9] = 100
	s, states := restStreak(steps, []int{9}, 10, 1)

	if stateOn(states, 1, 9) != restChosen || stateOn(states, 1, 10) != openToday {
		t.Errorf("9th/10th = %v/%v", stateOn(states, 1, 9), stateOn(states, 1, 10))
	}
	if s.Length != 9 || s.ActiveDays != 8 {
		t.Errorf("length/active = %d/%d, want 9/8", s.Length, s.ActiveDays)
	}
	if len(s.RestDays) == 0 || !s.RestDays[0].Equal(aug(9)) {
		t.Errorf("rest days = %v, want the 9th first", s.RestDays)
	}
}

// A rest day marked for TODAY carries the day, the same as on the phone: the
// chosen check comes before the "today is open" one.
func TestTodayMarkedAsRestJoinsTheRun(t *testing.T) {
	steps := walked(1, 9)
	steps[10] = 200
	s, states := restStreak(steps, []int{10}, 10, 1)

	if stateOn(states, 1, 10) != restChosen {
		t.Errorf("today = %v, want a credited rest day", stateOn(states, 1, 10))
	}
	if s.Length != 10 || s.ChosenRestDays != 1 {
		t.Errorf("length/rest = %d/%d, want 10/1", s.Length, s.ChosenRestDays)
	}
}

// A marked day with no measurement at all is still a rest day: the marking is
// the user's statement, and it does not need a step count to stand on.
func TestARestDayNeedsNoMeasurement(t *testing.T) {
	steps := walked(1, 10)
	delete(steps, 5)
	s, states := restStreak(steps, []int{5}, 10, 1)

	if stateOn(states, 1, 5) != restChosen || s.Length != 10 {
		t.Errorf("state/length = %v/%d, want a credited rest day and 10", stateOn(states, 1, 5), s.Length)
	}
}

// The window starts 90 days back; a rest day credited before it does not spend
// the allowance of the first week inside it — the phone evaluates from the same
// explicit start and knows nothing older either.
func TestRestDaysBeforeTheWindowSpendNothing(t *testing.T) {
	steps := walked(5, 14)
	steps[5], steps[6] = 100, 100
	s, states := restStreak(steps, []int{2, 3, 5, 6}, 14, 5)

	if stateOn(states, 5, 5) != restChosen || stateOn(states, 5, 6) != restChosen {
		t.Error("days marked before the window spent the allowance of the first week inside it")
	}
	if s.Length != 10 {
		t.Errorf("length = %d, want 10", s.Length)
	}
}
