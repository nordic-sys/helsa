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

// The inputs the phone has and this server may not. They are reported with
// every streak, because a number that is quietly a lower bound is worse than no
// number: the reader would take it for the same figure their phone shows and
// conclude the streak had broken.
//
// `illness_days` come from the daily journal, which stays on the device
// (ADR-0007, App Store rule 5.1.3(ii)) — always missing. `chosen_rest_days` are
// a setting the phone uploads to /v1/settings from build 1.0 (7) on; until it
// has, they are missing too (see missingInputs).
const (
	inputIllnessDays    = "illness_days"
	inputChosenRestDays = "chosen_rest_days"
)

// missingInputs lists what this evaluation could not see. A fresh slice every
// time: the response owns it.
func missingInputs(restDaysKnown bool) []string {
	if restDaysKnown {
		return []string{inputIllnessDays}
	}
	return []string{inputIllnessDays, inputChosenRestDays}
}

// Chosen rest days — the allowance, ported from `RestDayRules`.
//
// Two in any rolling seven days, because a week with two rest days in it is a
// training week, not a loophole. A third one in the same seven days is not
// silently dropped: it becomes restOverBudget and BREAKS the streak, and the
// response says which day and why. ⚠️ The numbers are the phone's; a change on
// one side is carried to the other, or the two streaks disagree about the same
// person.
const (
	chosenPerWindow  = 2
	chosenWindowDays = 7
)

// dayState is what one day did to the streak — the subset of Swift's
// `StreakDayState` the server can observe. The one it cannot is
// `rest(.illness)`, which needs the journal (see missingInputs).
type dayState int

const (
	// met reached the daily goal. This is the only state that makes a streak a
	// streak.
	met dayState = iota
	// restChosen is a chosen rest day inside the weekly allowance: neutral, it
	// neither extends the streak nor breaks it — but it does carry it.
	restChosen
	// restOverBudget was marked as a rest day after the allowance was spent. It
	// breaks the streak, and says so.
	restOverBudget
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

// carriesStreak mirrors `StreakDayState.carriesStreak`.
func (s dayState) carriesStreak() bool { return s == met || s == restChosen }

// evaluateStreak walks the window forwards and finds the current run — a port
// of `DailyStreakRules.evaluate` (states → summarise), minus the illness days.
//
// restDays nil means the phone has not uploaded its rest days: every day is then
// judged on steps alone, and the response lists `chosen_rest_days` as missing.
func evaluateStreak(byDay map[string]float64, restDays map[string]bool, goal int,
	from, today time.Time, loc *time.Location) api.ChallengeStreak {

	// The window can never end before it starts; the walk below stops on today's
	// key, and a `from` past it would never reach one.
	if from.After(today) {
		from = today
	}
	out := api.ChallengeStreak{
		WindowFrom:    openapi_types.Date{Time: from},
		WindowTo:      openapi_types.Date{Time: today},
		MissingInputs: missingInputs(restDays != nil),
		RestDays:      []openapi_types.Date{},
	}
	if goal <= 0 {
		// No milestone means no goal, so there is nothing a day can be measured
		// against. We claim no streak rather than an empty one against a goal of 0,
		// which every day would trivially meet.
		return out
	}
	g := goal
	out.DailyGoal = &g

	days, states := dayStates(byDay, restDays, goal, from, today, loc)

	// --- summarise (Swift: `DailyStreakRules.summarise`) ---
	// The trailing open day is skipped: it is not part of the run yet, and it must
	// not end it either.
	i := len(states) - 1
	if i >= 0 && states[i] == openToday {
		i--
	}
	length, active := 0, 0
	var rest []openapi_types.Date
	for i >= 0 && states[i].carriesStreak() {
		length++
		if states[i] == met {
			active++
		} else {
			// Walking backwards, so this list is newest first — the order the phone
			// lists `restDaysInStreak` in.
			rest = append(rest, openapi_types.Date{Time: days[i]})
		}
		i--
	}
	// Why the run does not reach further back. `startOfHistory` when the window
	// simply ends there — we know nothing older, so we claim nothing about it.
	reason := api.ChallengeStreakBreak{Reason: api.StartOfHistory}
	if i >= 0 {
		d := openapi_types.Date{Time: days[i]}
		switch states[i] {
		case noData:
			reason = api.ChallengeStreakBreak{Reason: api.NoData, Day: &d}
		case restOverBudget:
			reason = api.ChallengeStreakBreak{Reason: api.RestOverBudget, Day: &d}
		default:
			reason = api.ChallengeStreakBreak{Reason: api.Missed, Day: &d}
		}
	}

	// ⚠️ A run made only of rest days is not a streak. Five rest days in a row
	// would otherwise come out as a five-day streak — a number about movement,
	// standing on no movement at all. This is the second cap on rest days, and the
	// one that keeps them honest: a rest day can only protect a streak that
	// already exists.
	if active == 0 {
		length, rest = 0, nil
	} else {
		out.BrokenBy = &reason
	}

	out.Length = length
	out.ActiveDays = active
	out.ChosenRestDays = len(rest)
	if rest != nil {
		out.RestDays = rest
	}
	out.Longest = longestRun(states)
	return out
}

// dayStates is the state of every day of the window, CHRONOLOGICALLY (Swift:
// `DailyStreakRules.states`).
//
// ⚠️ The direction matters. The rest-day allowance is a rolling window, so it
// has to be spent forwards in time — evaluating backwards from today would credit
// the latest rest days of a week and reject the earliest, which is the opposite
// of how the week was lived, and it would make the same history read differently
// on two different days.
//
// The order of the checks is the priority order, and it is the phone's:
//  1. Reaching the goal wins over everything — a day walked to the goal is not
//     spent out of the rest allowance.
//  2. (On the phone: an illness day, which never consumes the allowance.)
//  3. A chosen rest day, inside the allowance or over it.
//  4. Today is open, never missed.
//  5. A day with no measurement, and only what is left is a missed day.
func dayStates(byDay map[string]float64, restDays map[string]bool, goal int,
	from, today time.Time, loc *time.Location) ([]time.Time, []dayState) {

	// ⚠️ The days are stepped through by their KEY, not by comparing instants. A
	// zone whose clocks move at midnight has days whose 00:00 does not exist, and
	// `time.Date` quietly hands back 01:00 for them — enough to make an equality
	// test against "today" fail on exactly one day a year.
	todayKey := DayKey(today, loc)
	days := make([]time.Time, 0, LookbackDays+1)
	states := make([]dayState, 0, LookbackDays+1)
	// Indices (into days) of the rest days credited so far. The days are
	// consecutive calendar days, so "within the last seven days" is "index within
	// the last seven positions" — no instant arithmetic across a clock change.
	var credited []int
	for day := from; ; day = day.AddDate(0, 0, 1) {
		key := DayKey(day, loc)
		steps, measured := byDay[key]
		idx := len(days)
		switch {
		case measured && steps >= float64(goal):
			states = append(states, met)
		case restDays[key]:
			used := 0
			for _, c := range credited {
				if c > idx-chosenWindowDays {
					used++
				}
			}
			if used < chosenPerWindow {
				credited = append(credited, idx)
				states = append(states, restChosen)
			} else {
				states = append(states, restOverBudget)
			}
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
	return days, states
}

// longestRun is the longest run in the window, under the same rules
// (Swift: `DailyStreakRules.longestRun`): it needs a walked day in it — or a
// fortnight of rest would come out as a personal best — and the trailing open day
// neither extends nor breaks it.
func longestRun(states []dayState) int {
	best, run, walked := 0, 0, 0
	for _, s := range states {
		switch {
		case s.carriesStreak():
			run++
			if s == met {
				walked++
			}
			if walked > 0 {
				best = max(best, run)
			}
		case s == openToday:
			// not yet a day either way
		default:
			run, walked = 0, 0
		}
	}
	return best
}
