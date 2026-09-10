// Package challenge computes the monthly step challenge (GET /v1/challenge):
// the month's total against the user's own milestones, plus the daily streak.
//
// # The app is the specification
//
// The same challenge already exists on the phone
// (HelsaKit/Sources/HelsaKit/Challenge/), and it is the side the user sees. This
// package deliberately mirrors it decision for decision — `ChallengeMonth`,
// `ChallengeThresholds`, `MonthlyChallengeProgress`, `MonthStepCalendar` and
// `DailyStreakRules` all have a counterpart here, with the same rounding, the
// same edge cases and the same refusals. A server that computes the same thing
// differently is worse than a server that does not compute it: two numbers for
// one month, and no way to tell which is the body's.
//
// What is NOT ported: the drawing (`ChallengePath`, `ChallengeTrail`,
// `MarkerPlacement`). The web does not need a hand-drawn trail, it needs the
// numbers behind it.
//
// # Where the formula cannot be matched, it says so
//
// Two of the streak's inputs exist only on the phone, and no amount of care here
// will conjure them:
//
//   - the illness days, derived from the daily journal — which never leaves the
//     device (ADR-0007, and App Store rule 5.1.3(ii): health information may not
//     be stored in iCloud);
//   - the rest days the user chose — a local setting in the App Group defaults,
//     with no HealthKit type that could carry it and no `/settings` field for it.
//
// Both make a day NEUTRAL on the phone: it neither extends the streak nor breaks
// it. Here such a day is a plain missed day, so the server's streak can be
// shorter than the phone's and never longer. That is stated in the response
// (`missing_inputs`) rather than papered over — see streak.go.
package challenge

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

// DefaultThresholds is the factory milestone row (`ChallengeThresholds.defaultValues`).
// It is only a starting point: the user rewrites it in Settings at any time, and
// the rewritten row lives on the phone.
var DefaultThresholds = []int{20_000, 35_000, 70_000, 100_000, 150_000, 200_000}

// Thresholds are the milestones of the challenge: increasing, unique, positive
// step counts.
//
// The cleanup happens at construction, exactly as `ChallengeThresholds.init`
// does it, because the values arrive by three different routes here as well (the
// query parameter, a badge's snapshot, the default) and only one of them is
// under our control. A zero or negative milestone is not a strict goal but a
// typo — a 0-step milestone would look accomplished at the start of the month.
//
// It MAY be empty: if the user deleted every milestone we do not silently
// substitute the default, we report that there is nothing to accomplish.
type Thresholds struct {
	Values []int
}

func NewThresholds(raw []int) Thresholds {
	seen := make(map[int]bool, len(raw))
	out := make([]int, 0, len(raw))
	for _, v := range raw {
		if v <= 0 || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	sort.Ints(out)
	return Thresholds{Values: out}
}

// Goal is the target of the challenge: the LARGEST milestone. The second return
// is false when there is no milestone at all, and then there is nothing to scale
// to — not a goal of zero.
func (t Thresholds) Goal() (int, bool) {
	if len(t.Values) == 0 {
		return 0, false
	}
	return t.Values[len(t.Values)-1], true
}

// ParseThresholds reads the `thresholds` query parameter
// (`20000,35000,70000`). It is lenient about spacing and about a trailing comma
// for the same reason `ChallengeThresholds.parse` is lenient about "20 000" and
// "20.000": the number arrives as text a human typed somewhere.
//
// It is NOT lenient about a non-number: silently dropping "twenty thousand"
// would answer with a milestone row the caller never asked for, and the caller
// would have no way to notice.
func ParseThresholds(raw string) (Thresholds, error) {
	fields := strings.Split(raw, ",")
	out := make([]int, 0, len(fields))
	for _, f := range fields {
		f = strings.TrimSpace(f)
		if f == "" {
			continue
		}
		v, err := strconv.Atoi(f)
		if err != nil {
			return Thresholds{}, fmt.Errorf("not a step count: %q", f)
		}
		out = append(out, v)
	}
	return NewThresholds(out), nil
}

// Month is a calendar month — the cycle of the challenge, which resets at the
// month boundary.
//
// ⚠️ A month is a span in the user's calendar, not an instant: 2026-08-31 22:30
// UTC is already September in Budapest, so a new challenge runs there. Every
// method that needs a "now" therefore takes the location with it.
type Month struct {
	Year  int
	Month time.Month
	// DayCount is 28/29/30/31 — the leap year included. It is derived from the
	// calendar rather than a table, the same choice `ChallengeMonth.dayCount`
	// makes.
	DayCount int
}

func newMonth(year int, month time.Month) Month {
	// The zeroth day of the next month is the last day of this one; its day
	// number is the length of the month, leap years and all.
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC)
	return Month{Year: year, Month: month, DayCount: last.Day()}
}

// MonthContaining is the month the given instant falls into, read in loc.
func MonthContaining(t time.Time, loc *time.Location) Month {
	local := t.In(loc)
	return newMonth(local.Year(), local.Month())
}

// ParseMonth reads the `YYYY-MM` form — the same period key the badges use
// (`Achievement.period`). The length of the month is computed, not parsed: it is
// a calendar fact, not data anybody should be sending us.
func ParseMonth(period string) (Month, error) {
	t, err := time.Parse("2006-01", period)
	if err != nil {
		return Month{}, fmt.Errorf("month must be YYYY-MM: %q", period)
	}
	return newMonth(t.Year(), t.Month()), nil
}

// Period is the `YYYY-MM` key.
func (m Month) Period() string { return fmt.Sprintf("%04d-%02d", m.Year, int(m.Month)) }

// FirstDay is local midnight on the 1st.
func (m Month) FirstDay(loc *time.Location) time.Time {
	return time.Date(m.Year, m.Month, 1, 0, 0, 0, 0, loc)
}

// EndExclusive is local midnight on the 1st of the NEXT month — the open end of
// the month's window.
func (m Month) EndExclusive(loc *time.Location) time.Time {
	return m.FirstDay(loc).AddDate(0, 1, 0)
}

// DaysRemaining is how many days of the month are left, TODAY INCLUDED.
//
// Today counts because the user can still take steps today: on the last day of
// the month the honest answer is 1 day (today), not 0. After the month it is 0,
// before it the whole month.
func (m Month) DaysRemaining(now time.Time, loc *time.Location) int {
	local := now.In(loc)
	if local.Year() != m.Year || local.Month() != m.Month {
		if beforeMonth(local, m) {
			return m.DayCount
		}
		return 0
	}
	if r := m.DayCount - local.Day() + 1; r > 0 {
		return r
	}
	return 0
}

// lastDayShown is the last day of the month worth laying out: today for the
// running month, the whole month for a closed one, and nothing at all for a
// month that has not started.
//
// A day beyond today is left OUT rather than drawn empty — an empty cell for a
// day that has not happened reads as a day missed. Same rule as
// `MonthStepCalendar.make(upTo:)`.
func (m Month) lastDayShown(now time.Time, loc *time.Location) int {
	local := now.In(loc)
	if local.Year() == m.Year && local.Month() == m.Month {
		return min(local.Day(), m.DayCount)
	}
	if beforeMonth(local, m) {
		return 0
	}
	return m.DayCount
}

func beforeMonth(local time.Time, m Month) bool {
	if local.Year() != m.Year {
		return local.Year() < m.Year
	}
	return local.Month() < m.Month
}

// DayTotal is ONE day's measured step count.
//
// ⚠️ A day with no measurement is simply NOT IN THE LIST. There is no nil steps
// here and least of all a 0 — the same structural rule `DailyStepTotal` and
// `MonthStepDay` follow, and it is the one that keeps a day the phone spent in a
// drawer from entering the evaluation as a failure.
type DayTotal struct {
	// Day is the local day key, `YYYY-MM-DD`. A key rather than a time.Time on
	// purpose: an instant read back in another zone can land on the neighbouring
	// day, and the day the user meant would quietly move.
	Day   string
	Steps float64
}

// DayKey is the day key of an instant, read in loc.
func DayKey(t time.Time, loc *time.Location) string { return t.In(loc).Format("2006-01-02") }

// dailyGoal derives the daily step goal from the MONTHLY one, as
// `DailyStreakRules.dailyGoal` does.
//
// ⚠️ Deliberately not a second setting. The user already stated what the month
// should add up to; asking for a daily number as well would be a second thing to
// keep in sync, and the two can contradict each other — a daily goal that cannot
// reach the monthly one is a screen saying "on track" and "behind" at the same
// time. The pace that finishes the month IS the daily goal.
//
// false when there is no goal: then there is nothing a day could be measured
// against, and no streak is claimed.
func dailyGoal(t Thresholds, m Month) (int, bool) {
	goal, ok := t.Goal()
	if !ok || m.DayCount <= 0 {
		return 0, false
	}
	return max(int(math.Round(float64(goal)/float64(m.DayCount))), 1), true
}
