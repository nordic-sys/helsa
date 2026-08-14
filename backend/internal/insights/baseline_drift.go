// Rule 8: **baseline drift** — the slow shift nobody notices.
//
// # What this asks that no other rule asks
//
// The engine already has two ways of noticing that a number moved, and both are
// short-sighted on purpose:
//
//   - deviationRule (anomaly) compares the last 3 days against the last month. It
//     sees a cold, a hangover, a bad week — and it is BLIND to a slow shift,
//     because the 28-day baseline drifts along with the person. A resting heart
//     rate that climbs 2 bpm a month never once stands 1.5 sigmas above its own
//     trailing average.
//   - trendRule compares two consecutive weeks. Same blindness, on a shorter
//     leash still.
//
// A baseline that has moved 6 bpm since the spring is invisible to both, and it
// is the one a person would actually want to know about — it is the shape a
// change in fitness, in weight, in sleep, in season or in a developing illness
// has. So this rule compares the personal baseline of a RECENT window (the last
// 28 days) against an OLDER one (days 90–120 back), with a gap of two months
// between them, and speaks only when the shift is both **statistically real** and
// **humanly meaningful**.
//
// # Why the gap between the windows
//
// The two windows do not touch: the recent one ends today, the older one ended 90
// days ago. If they were adjacent this would be a slower weekly trend, and it
// would pick up the ordinary month-to-month wobble. Two months apart, what
// survives is the drift.
//
// # It says what it saw, and stops
//
// A drifting baseline has many ordinary causes, and the sentence names them: age,
// training, weight, season, a different watch. It is not a finding about health,
// and the caveat is part of the text, not decoration the UI may drop.
//
// ⚠️ This rule reaches four months back, further than any other — which is why
// LookbackDays is a `max` over the rules' own constants, and why neededMetrics
// has to name every series it reads. A rule starved of the days it asks for
// produces exactly the same output as a rule with nothing to say.

package insights

import (
	"fmt"
	"math"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

const (
	// The recent window: the last 28 days, today excluded (a partial day is not a
	// low day).
	DriftRecentDays = 28
	// The older window is [today-DriftOlderWindowStartDays,
	// today-DriftOlderWindowEndDays) — days 90 to 120 back, so 30 days of history
	// from a quarter of a year ago.
	DriftOlderWindowStartDays = 120
	DriftOlderWindowEndDays   = 90

	// The distance between what the two windows describe, in days: the middle of
	// the older window to the middle of the recent one. This is the span the
	// sentence talks about, and it is derived rather than written out, so that
	// moving a window cannot leave the text claiming a length the arithmetic no
	// longer has.
	DriftSpanDays = (DriftOlderWindowStartDays+DriftOlderWindowEndDays)/2 - DriftRecentDays/2

	// The empty stretch between the two windows, in days — the recent window's
	// start back to the older window's end. Derived, because the sentence names it
	// in months and a literal there would go on claiming a gap that a moved window
	// no longer leaves.
	DriftGapDays = DriftOlderWindowEndDays - DriftRecentDays

	// t-statistic of the difference between the two window means (Welch, unequal
	// variances).
	//
	// 2.5 rather than the customary 1.96: with ~28 and ~30 days this is roughly a
	// 1-in-70 coincidence, and the extra margin is deliberate. Two windows a
	// quarter of a year apart differ for a hundred reasons that are not drift — a
	// change of device, a different sleep tracker, a summer — and a rule that
	// spoke at every 5% result would speak most months.
	DriftTStatistic = 2.5
)

// baselineDriftRule is one metric's drift.
//
// Each metric gets its own identifier
// (`baseline-drift-restingHeartRate:2026-08-11`), so the stem is `baseline-drift`
// and the match in the registry is by prefix — the same shape `efficiency-trend`
// has.
type baselineDriftRule struct {
	// metric is both the name that goes out with the insight AND, for every rule
	// but the sleep one, the `data_type` its series is read under — see
	// TestEveryDriftMetricIsActuallyRead, which holds the two together.
	metric string
	// series picks the series out of the input (a daily metric, or sleep).
	series func(Input) Series
	// unit is the unit of a LEVEL, as fmtVal understands it.
	unit string
	// instrumentalUnit is the unit of a DIFFERENCE, in Hungarian's instrumental
	// case.
	//
	// ⚠️ Hungarian assimilates the suffix to the final consonant and harmonises
	// its vowel: "bpm-mel", but "ms-mal" and "kg-mal". There is no rule that
	// derives this from the unit string, and there is no reason to invent one for
	// four units — so each rule states its own, exactly as deviationRule.label
	// carries its own article.
	//
	// Empty means the difference is spoken by fmtDelta instead, which already
	// knows how to say a number of hours ("1 óra 30 perccel").
	instrumentalUnit string
	// label is the subject phrase as a WHOLE, article included — see
	// deviationRule.label.
	label string
	// minAbsDelta is the smallest shift worth a sentence, in the metric's own
	// unit. Beside the statistical gate, never instead of it: with 28 days on each
	// side, a 0.4 bpm difference can be significant and is still nothing anyone
	// would want to be told.
	minAbsDelta float64
	// minDaysPerWindow: measured days required in EACH window.
	//
	// It is per-rule because the metrics are not measured the same way. A resting
	// heart rate arrives every night the watch is worn, so 14 days out of 28 means
	// the watch was mostly on; a body weight arrives when someone steps on a
	// scale, which is a deliberate act, and asking for 14 weigh-ins a month would
	// silence the rule for everyone who weighs themselves weekly.
	minDaysPerWindow int
}

var baselineDriftRules = []baselineDriftRule{
	{
		metric:           "restingHeartRate",
		series:           func(in Input) Series { return in.Daily["restingHeartRate"] },
		unit:             "bpm",
		instrumentalUnit: "bpm-mel",
		label:            "A nyugalmi pulzusod",
		minAbsDelta:      3, // bpm — below this it is within the year's ordinary wobble
		minDaysPerWindow: 14,
	},
	{
		metric:           "hrv",
		series:           func(in Input) Series { return in.Daily["hrv"] },
		unit:             "ms",
		instrumentalUnit: "ms-mal",
		label:            "A pulzusvariabilitásod (HRV)",
		minAbsDelta:      5, // ms
		minDaysPerWindow: 14,
	},
	{
		metric:           "respiratoryRate",
		series:           func(in Input) Series { return in.Daily["respiratoryRate"] },
		unit:             "légvétel/perc",
		instrumentalUnit: "légvétel/perccel",
		label:            "A légzésszámod",
		minAbsDelta:      1, // breaths per minute
		minDaysPerWindow: 14,
	},
	{
		metric:           "bodyMass",
		series:           func(in Input) Series { return in.Daily["bodyMass"] },
		unit:             "kg",
		instrumentalUnit: "kg-mal",
		label:            "A testtömeged",
		minAbsDelta:      2, // kg — a scale's day-to-day swing is a kilogram on its own
		// A weigh-in is a deliberate act, not a passive measurement: eight in a
		// month is a habit, and demanding fourteen would silence the rule for
		// anyone weighing weekly.
		minDaysPerWindow: 8,
	},
	{
		metric:           "sleepDuration",
		series:           func(in Input) Series { return in.SleepHours },
		unit:             "óra",
		instrumentalUnit: "", // fmtDelta already speaks hours and minutes
		label:            "Az alvásidőd",
		minAbsDelta:      0.5, // hours
		minDaysPerWindow: 14,
	},
}

func (r baselineDriftRule) eval(in Input, now time.Time) *Result {
	s := r.series(in)
	if len(s) == 0 {
		return nil
	}

	// Today is left out of the recent window, as everywhere else: a day still
	// being recorded is not a low day.
	recentEnd := in.Today
	recentStart := recentEnd.AddDate(0, 0, -DriftRecentDays)
	olderEnd := in.Today.AddDate(0, 0, -DriftOlderWindowEndDays)
	olderStart := in.Today.AddDate(0, 0, -DriftOlderWindowStartDays)

	recent := s.between(recentStart, recentEnd).values()
	older := s.between(olderStart, olderEnd).values()
	if len(recent) < r.minDaysPerWindow || len(older) < r.minDaysPerWindow {
		// Not enough history on one side or the other. This is the rule that stays
		// silent the longest of all of them — four months of wearing something is a
		// real requirement, and it is the honest one: there is no such thing as a
		// three-month drift measured over six weeks.
		return nil
	}

	recentMean, olderMean := mean(recent), mean(older)
	recentSD := stdDev(recent, recentMean)
	olderSD := stdDev(older, olderMean)

	// Welch's standard error: the two windows have different lengths and, after a
	// change in habits, different spreads too — pooling their variances would
	// assume away exactly the thing that changed.
	standardError := math.Sqrt(recentSD*recentSD/float64(len(recent)) +
		olderSD*olderSD/float64(len(older)))
	if standardError < MinStdDev {
		// Both windows perfectly constant. That is not a body, it is a placeholder —
		// and every difference would come out as infinitely many sigmas.
		return nil
	}

	delta := recentMean - olderMean
	t := math.Abs(delta) / standardError
	if t < DriftTStatistic {
		return nil // the two windows are not far enough apart to call it a shift
	}
	if math.Abs(delta) < r.minAbsDelta {
		return nil // statistically real, humanly nothing — the same defence as everywhere
	}

	// Both directions are reported. A resting heart rate sliding DOWN over a
	// quarter is the same kind of fact as one sliding up, and a rule that only ever
	// spoke about the unwelcome direction would be an alarm wearing a statistic's
	// clothes.
	word := "feljebb csúszott"
	if delta < 0 {
		word = "lejjebb csúszott"
	}
	title := fmt.Sprintf("%s alapvonala nagyjából %d hónap alatt %s %s",
		r.label, DriftSpanDays/30, r.deltaText(math.Abs(delta)), word)
	detail := fmt.Sprintf(
		"Az elmúlt %d nap átlaga %s (%d mért napból), a %d–%d nappal ezelőtti időszaké %s "+
			"(%d mért napból) — a különbség %s. Ez nem a napi ingadozás és nem a heti trend: "+
			"%d hónapnyi szünettel elválasztott időszakok saját átlagát méri össze. "+
			"Ez nem diagnózis — az alapvonal életkorral, edzettséggel, testtömeggel, évszakkal "+
			"és akár másik órával is elmozdul.",
		DriftRecentDays, fmtVal(recentMean, r.unit), len(recent),
		DriftOlderWindowEndDays, DriftOlderWindowStartDays, fmtVal(olderMean, r.unit), len(older),
		fmtVal(math.Abs(delta), r.unit), DriftGapDays/30)

	// `trend`, and `info`: it IS a change over time, but a slow one that has
	// already happened. Dressing a four-month shift as a `notice` would put it on
	// the screen with the urgency of something happening this morning, which it is
	// not.
	return insight("baseline-drift-"+r.metric, in.Today, api.Trend, r.metric, title, detail,
		api.Info, now,
		map[string]float64{"recent": recentMean, "older": olderMean, "drift": delta, "t": t})
}

// deltaText renders the shift as a Hungarian instrumental phrase ("6.0 bpm-mel",
// "1 óra 30 perccel").
func (r baselineDriftRule) deltaText(v float64) string {
	if r.instrumentalUnit == "" {
		return fmtDelta(v, r.unit)
	}
	return fmt.Sprintf("%.1f %s", v, r.instrumentalUnit)
}
