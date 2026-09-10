package challenge

import (
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// LookbackDays is how far back the streak is read — three months, the same
// window `DailyStreakRules.lookbackDays` uses.
//
// Deliberately NOT "the current month": a streak that restarted every first of
// the month would be an artefact of the calendar, not of the person. It is also
// about as far back as a rest day can still be marked honestly, which is why the
// phone stops there too.
const LookbackDays = 90

// The inputs the phone has and this server does not. They are reported with
// every streak, because a number that is quietly a lower bound is worse than no
// number: the reader would take it for the same figure their phone shows and
// conclude the streak had broken.
//
// `illness_days` come from the daily journal, which stays on the device
// (ADR-0007, App Store rule 5.1.3(ii)); `chosen_rest_days` are a local setting
// with no HealthKit type to carry them (see the note in RestDay.swift, which
// weighs and rejects all three storage routes). Both make a day neutral there
// and a missed day here.
var missingStreakInputs = []string{"illness_days", "chosen_rest_days"}

// dayState is what one day did to the streak — the subset of Swift's
// `StreakDayState` the server can actually observe. The two it cannot are
// `rest` and `restOverBudget`, and both need an input listed in
// missingStreakInputs.
type dayState int

const (
	// met reached the daily goal. On the server this is the ONLY state that
	// carries a streak.
	met dayState = iota
	// missed was measured, and below the goal. This breaks it.
	missed
	// noData had no measurement at all. This breaks it too — but for a different
	// reason, and the response has to say which: "you missed that day" and "we
	// know nothing about that day" are not the same sentence, and the second is
	// not a failure of the user.
	noData
	// openToday is today, not yet at the goal. Neither counted nor held against:
	// the day is not over, and a streak that read as broken every morning until
	// the walk would be worse than useless.
	openToday
)

// evaluateStreak walks the window forwards and finds the current run.
//
// The order of the checks is the priority order, and it is the phone's:
// reaching the goal wins over everything, then (on the phone) illness and a
// chosen rest day, then today is open, then a day with no measurement, and only
// what is left is a missed day.
func evaluateStreak(byDay map[string]float64, goal int, from, today time.Time,
	loc *time.Location) api.ChallengeStreak {

	// The window can never end before it starts; the walk below stops on today's
	// key, and a `from` past it would never reach one.
	if from.After(today) {
		from = today
	}
	out := api.ChallengeStreak{
		WindowFrom:    openapi_types.Date{Time: from},
		WindowTo:      openapi_types.Date{Time: today},
		MissingInputs: missingStreakInputs,
	}
	if goal <= 0 {
		// No milestone means no goal, so there is nothing a day can be measured
		// against. We claim no streak rather than an empty one against a goal of 0,
		// which every day would trivially meet.
		return out
	}
	g := goal
	out.DailyGoal = &g

	// ⚠️ The days are stepped through by their KEY, not by comparing instants. A
	// zone whose clocks move at midnight has days whose 00:00 does not exist, and
	// `time.Date` quietly hands back 01:00 for them — enough to make an equality
	// test against "today" fail on exactly one day a year.
	todayKey := DayKey(today, loc)
	days := make([]time.Time, 0, LookbackDays+1)
	states := make([]dayState, 0, LookbackDays+1)
	for day := from; ; day = day.AddDate(0, 0, 1) {
		key := DayKey(day, loc)
		steps, measured := byDay[key]
		switch {
		case measured && steps >= float64(goal):
			states = append(states, met)
		case key == todayKey:
			states = append(states, openToday)
		case !measured:
			states = append(states, noData)
		default:
			states = append(states, missed)
		}
		days = append(days, day)
		if key == todayKey {
			break
		}
	}

	// The trailing open day is skipped: it is not part of the run yet, and it must
	// not end it either.
	i := len(states) - 1
	if i >= 0 && states[i] == openToday {
		i--
	}
	length := 0
	for i >= 0 && states[i] == met {
		length++
		i--
	}
	if length > 0 {
		// Why the run does not reach further back. `startOfHistory` when the window
		// simply ends there — we know nothing older, so we claim nothing about it.
		reason := api.ChallengeStreakBreak{Reason: api.StartOfHistory}
		if i >= 0 {
			d := openapi_types.Date{Time: days[i]}
			reason = api.ChallengeStreakBreak{Reason: api.Missed, Day: &d}
			if states[i] == noData {
				reason.Reason = api.NoData
			}
		}
		out.BrokenBy = &reason
	}

	out.Length = length
	// On the server every day of a run is a walked day, because the days that
	// could differ are the neutral ones and those need an input we do not have.
	// The phone's "a run made only of neutral days is not a streak" rule therefore
	// costs nothing here — but it is the same number, computed the same way.
	out.ActiveDays = length
	out.Longest = longestRun(states)
	return out
}

// longestRun is the longest run in the window, under the same rule: it needs a
// walked day in it, and the trailing open day neither extends nor breaks it.
func longestRun(states []dayState) int {
	best, run := 0, 0
	for _, s := range states {
		switch s {
		case met:
			run++
			best = max(best, run)
		case openToday:
			// not yet a day either way
		case missed, noData:
			run = 0
		}
	}
	return best
}
