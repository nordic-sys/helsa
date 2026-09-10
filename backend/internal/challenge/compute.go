package challenge

import (
	"time"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// Input is everything the computation needs. No I/O and no clock of its own —
// the same split `MonthlyChallengeProgress` keeps on the phone, so every
// decision that could be wrong is reachable from a test.
type Input struct {
	Month      Month
	Thresholds Thresholds
	// Source records WHERE the milestones came from. It travels with them because
	// "your milestones" and "our guess at your milestones" are different
	// statements, and the reader is entitled to know which one they are looking at.
	Source api.ChallengeResponseThresholdsSource
	// Daily holds the days that carried a measurement, over the month AND over the
	// streak's lookback window. Days with no measurement are absent, never zero.
	Daily []DayTotal
	Now   time.Time
	Loc   *time.Location
}

// Compute assembles the response.
func Compute(in Input) api.ChallengeResponse {
	byDay := make(map[string]float64, len(in.Daily))
	for _, d := range in.Daily {
		// Several rows for the same day are added up rather than letting the last one
		// win — the same choice `MonthStepCalendar.make` makes one level down.
		byDay[d.Day] += d.Steps
	}

	m := in.Month
	daysRemaining := m.DaysRemaining(in.Now, in.Loc)
	first := m.FirstDay(in.Loc)

	days := make([]api.ChallengeDay, 0, m.DayCount)
	total, measured := 0.0, 0
	for i := 0; i < m.lastDayShown(in.Now, in.Loc); i++ {
		day := first.AddDate(0, 0, i)
		entry := api.ChallengeDay{Day: openapi_types.Date{Time: day}}
		if steps, ok := byDay[DayKey(day, in.Loc)]; ok {
			entry.Steps = f32(steps)
			total += steps
			measured++
		}
		days = append(days, entry)
	}

	out := api.ChallengeResponse{
		Month:            m.Period(),
		Tz:               in.Loc.String(),
		DaysInMonth:      m.DayCount,
		DaysElapsed:      max(m.DayCount-daysRemaining, 0),
		DaysRemaining:    daysRemaining,
		MeasuredDays:     measured,
		Days:             days,
		Thresholds:       make([]api.ChallengeMilestone, 0, len(in.Thresholds.Values)),
		ThresholdsSource: in.Source,
	}

	// ⚠️ Without a single measured day the month's numbers stay ABSENT, they do not
	// go out as zeros. "I took 0 steps this month" and "no data has reached me" are
	// two different statements, and on the first morning of a month the second one
	// is the true and unalarming one.
	hasData := measured > 0
	if hasData {
		out.Steps = f32(total)
		if out.DaysElapsed > 0 {
			// The denominator is the days that HAPPENED, not the days that carried a
			// measurement: a month with a three-day gap in it really did produce fewer
			// steps per day, and this number sits directly under a total with the same
			// property. `measured_days` is what says how much of the month is missing.
			out.StepsPerDay = f32(total / float64(out.DaysElapsed))
		}
	}

	goal, hasGoal := in.Thresholds.Goal()
	// effective is the progress CLAMPED to the goal: someone who walked 400 000 on
	// a 200 000 challenge is done, not at 200%. The lower clamp guards against a
	// negative arriving from anywhere.
	//
	// ⚠️ It is used for the percentage and the milestones ONLY. `steps` above is
	// the figure as measured — the phone's card showed this clamped number for a
	// while and told somebody who had walked 200 000 that they had walked 100 000
	// (docs/25 K13).
	effective := max(total, 0)
	if hasGoal {
		effective = min(effective, float64(goal))
		g := goal
		out.Goal = &g
	}
	if hasData && hasGoal && goal > 0 {
		out.Percent = f32(effective / float64(goal) * 100)
		out.Complete = effective >= float64(goal)
		out.RemainingSteps = f32(max(float64(goal)-effective, 0))
		// Stated separately, because the clamped percentage on its own would conceal
		// that the goal was met twice over.
		out.OvershootSteps = f32(max(total-float64(goal), 0))
	}

	for _, t := range in.Thresholds.Values {
		// Exactly at the threshold counts as reached. In the absence of data nothing
		// counts: we do not know whether the month has even started.
		reached := hasData && effective >= float64(t)
		out.Thresholds = append(out.Thresholds, api.ChallengeMilestone{Steps: t, Reached: reached})
		if !reached && out.NextThreshold == nil {
			next := t
			out.NextThreshold = &next
			if hasData {
				out.StepsToNextThreshold = f32(max(float64(t)-effective, 0))
			}
		}
	}

	today := startOfDay(in.Now, in.Loc)
	goalPerDay, hasDailyGoal := dailyGoal(in.Thresholds, m)
	if !hasDailyGoal {
		goalPerDay = 0
	}
	out.Streak = evaluateStreak(byDay, goalPerDay, today.AddDate(0, 0, -(LookbackDays-1)), today, in.Loc)
	return out
}

func startOfDay(t time.Time, loc *time.Location) time.Time {
	local := t.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, loc)
}

func f32(v float64) *float32 {
	f := float32(v)
	return &f
}
