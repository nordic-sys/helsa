// Sleep TIMING rules. The rules in rules.go all ask "how much?"; these ask
// "when?", which is a different question with different failure modes.
//
// Two families live here:
//
//   - **Regularity** — how much the middle of the night scatters. Seven hours a
//     night is seven hours a night whether it starts at 22:30 or at 01:30, so
//     the duration series cannot see this at all; it needs SleepNight.
//   - **Free days vs work days** — sleep and movement at the weekend against the
//     weekdays ("social jetlag"). A daily average hides it by construction: it
//     averages exactly the difference we are looking for.
//
// Neither says anything about health. They describe a pattern in your own
// numbers, and the wording stays at that.

package insights

import (
	"fmt"
	"math"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

const (
	// The window both families look at: 4 whole weeks. Shorter would put too few
	// weekend days in it (see MinFreeDays), longer would blur a habit that has
	// since changed.
	SleepPatternWindowDays = 28

	// Regularity: this many MEASURED nights are needed out of the 28. Half the
	// window, the same proportion the deviation rule asks of its baseline — the
	// scatter of a fortnight of nights is a habit, the scatter of four is a week
	// that happened to be odd.
	MinRegularityNights = 14
	// The midpoint scatter (standard deviation, in minutes) above which the
	// timing counts as irregular. One hour, because a ±60-minute swing is what
	// separates "some evenings run late" from "there is no bedtime here" — and
	// because below that the statement would be true and useless, the same trap
	// the absolute thresholds in rules.go guard against.
	MinMidpointSDMinutes = 60

	// Free days vs work days. In a 28-day window there are 8 free nights and 20
	// work nights (see freeNight), or 8 free days and 20 workdays for steps.
	// Requiring half of each keeps a single measured weekend from standing in for
	// the pattern, while still tolerating the days the watch was off.
	MinFreeDays = 4
	MinWorkDays = 10

	// Social jetlag: the smallest midpoint shift worth a sentence, in minutes.
	// An hour again, for the same reason: waking up 20 minutes later on a Sunday
	// is not a finding.
	MinSocialJetlagMinutes = 60
	// Weekend sleep LENGTH: an hour, and 10% on top — the same
	// relative-plus-absolute pairing the weekly trend uses.
	MinWeekendSleepDeltaHours = 1.0
	// Weekend STEPS: 1500 steps and 15%. Slightly above the weekly trend's 500,
	// because this compares different KINDS of day rather than the same kind a
	// week apart, and everyone's weekend differs somewhat.
	MinWeekendStepsDelta    = 1500
	MinWeekendStepsRelative = 0.15
	MinWeekendSleepRelative = 0.10
)

// --- Rule 4: sleep regularity ---

// midpointMinutes is the middle of the night, in minutes counted from the key
// day's local midnight. Falling asleep at 23:20 and waking at 06:40 gives 1620
// (03:00 the next morning).
//
// The night's key day already resolves the wrap-around that would otherwise make
// this circular data: a night beginning at 23:50 and one beginning at 00:10 are
// keyed to the SAME day, so their midpoints come out 20 minutes apart rather
// than 23 hours and 40 minutes apart. That is why no circular statistics are
// needed here — and why the key day must not be changed lightly.
func (n SleepNight) midpointMinutes() float64 {
	mid := n.Start.Add(n.End.Sub(n.Start) / 2)
	return mid.Sub(n.Day).Minutes()
}

// nightsBetween narrows to the half-open [from, to) window by key day.
func nightsBetween(nights []SleepNight, from, to time.Time) []SleepNight {
	out := make([]SleepNight, 0, len(nights))
	for _, n := range nights {
		if !n.Day.Before(from) && n.Day.Before(to) {
			out = append(out, n)
		}
	}
	return out
}

// midpointSeries turns the nights into a daily series of midpoints, so the
// weekend rules can treat "when you sleep" exactly like any other daily value.
func midpointSeries(nights []SleepNight) Series {
	out := make(Series, 0, len(nights))
	for _, n := range nights {
		out = append(out, Point{Day: n.Day, Value: n.midpointMinutes()})
	}
	return out
}

// sleepRegularity reports when the middle of the night scatters widely — that
// is, when bedtime and wake-up are all over the place. It is deliberately
// one-sided: a steady sleeper gets silence, not praise, because "your sleep is
// regular" is not information they can act on.
func sleepRegularity(in Input, now time.Time) *Result {
	nights := nightsBetween(in.SleepNights, in.Today.AddDate(0, 0, -SleepPatternWindowDays), in.Today)
	if len(nights) < MinRegularityNights {
		return nil // too few measured nights to call anything a habit
	}
	mids := midpointSeries(nights).values()
	m := mean(mids)
	sd := stdDev(mids, m)
	if sd < MinMidpointSDMinutes {
		return nil
	}

	title := fmt.Sprintf("Az alvásod ideje szabálytalan: az alvásközép szórása %s", fmtVal(sd, "perc"))
	detail := fmt.Sprintf(
		"Az elmúlt %d nap %d mért éjszakáján az alvás közepe átlagosan %s körül volt, %s szórással. "+
			"Itt nem a hossz számít, hanem hogy mennyire ugyanakkor fekszel le és kelsz fel. "+
			"Ez a saját adataidon végzett számolás, nem diagnózis.",
		SleepPatternWindowDays, len(nights), fmtVal(m, "óraidő"), fmtVal(sd, "perc"))

	return insight("sleep-regularity", in.Today, api.Pattern, "sleepDuration", title, detail, api.Info, now,
		map[string]float64{"midpoint": m, "midpointSd": sd, "nights": float64(len(nights))})
}

// --- Rule 5: free days vs work days ---

// weekendRule compares the same measurement on free days and on work days. What
// counts as a free day differs between sleep and movement, which is exactly why
// freeDay is a field and not a constant — see the two rules below.
type weekendRule struct {
	metric string
	series func(Input) Series
	// freeDay: is this day a free one? For a NIGHT this is the day the night
	// started on, for a daily total it is the day itself.
	freeDay func(time.Weekday) bool
	// unit of the two averages, deltaUnit of the difference between them. They
	// differ for the midpoint rule: the level is a clock reading, the difference
	// is a number of minutes.
	unit      string
	deltaUnit string
	// label is the subject phrase as a WHOLE, article included — see
	// deviationRule.label for why Hungarian forces that shape.
	label string
	// moreWord/lessWord end the title. "több"/"kevesebb" for a quantity,
	// "később van"/"korábban van" for a point in time; getting this wrong
	// produces grammatical nonsense, so each rule states its own pair.
	moreWord string
	lessWord string
	// countWord names what the day counts count: nights for a sleep rule, days
	// for a daily total. "8 mért napból" would be wrong about nights, which are
	// the thing actually measured there.
	countWord string
	idPrefix  string
	// minAbsDelta in the metric's own unit, minRelative as a fraction. A relative
	// threshold of 0 turns the check off — a percentage of a clock reading means
	// nothing ("10% later than 02:00" is not a sentence).
	minAbsDelta float64
	minRelative float64
	kind        api.InsightKind
}

// A free NIGHT is one that starts on a Friday or a Saturday: those are the
// nights you may sleep in after. The night before a Monday is a work night even
// though it starts on Sunday — which is the whole point of social jetlag, and
// the reason this cannot simply be "Saturday and Sunday".
func freeNight(d time.Weekday) bool { return d == time.Friday || d == time.Saturday }

// A free DAY, for anything measured over the day itself (steps), is Saturday and
// Sunday.
func freeDay(d time.Weekday) bool { return d == time.Saturday || d == time.Sunday }

var weekendRules = []weekendRule{
	{
		metric:      "sleepDuration",
		series:      func(in Input) Series { return midpointSeries(in.SleepNights) },
		freeDay:     freeNight,
		unit:        "óraidő",
		deltaUnit:   "perc",
		label:       "Az alvásod közepe",
		moreWord:    "később van",
		lessWord:    "korábban van",
		countWord:   "mért éjszakából",
		idPrefix:    "sleep-midpoint-weekend",
		minAbsDelta: MinSocialJetlagMinutes,
		minRelative: 0, // a clock reading has no meaningful percentage
		kind:        api.Pattern,
	},
	{
		metric:      "sleepDuration",
		series:      func(in Input) Series { return in.SleepHours },
		freeDay:     freeNight,
		unit:        "óra",
		deltaUnit:   "óra",
		label:       "Az alvásod hossza",
		moreWord:    "hosszabb",
		lessWord:    "rövidebb",
		countWord:   "mért éjszakából",
		idPrefix:    "sleep-weekend-duration",
		minAbsDelta: MinWeekendSleepDeltaHours,
		minRelative: MinWeekendSleepRelative,
		kind:        api.Pattern,
	},
	{
		metric:      "stepCount",
		series:      func(in Input) Series { return in.Daily["stepCount"] },
		freeDay:     freeDay,
		unit:        "lépés",
		deltaUnit:   "lépés",
		label:       "A napi lépésszámod",
		moreWord:    "több",
		lessWord:    "kevesebb",
		countWord:   "mért napból",
		idPrefix:    "steps-weekend",
		minAbsDelta: MinWeekendStepsDelta,
		minRelative: MinWeekendStepsRelative,
		kind:        api.Pattern,
	},
}

func (r weekendRule) eval(in Input, now time.Time) *Result {
	s := r.series(in).between(in.Today.AddDate(0, 0, -SleepPatternWindowDays), in.Today)
	var free, work []float64
	for _, p := range s {
		if r.freeDay(p.Day.Weekday()) {
			free = append(free, p.Value)
		} else {
			work = append(work, p.Value)
		}
	}
	if len(free) < MinFreeDays || len(work) < MinWorkDays {
		return nil // one weekend is an anecdote, not a pattern
	}

	fm, wm := mean(free), mean(work)
	delta := fm - wm
	if math.Abs(delta) < r.minAbsDelta {
		return nil
	}
	// The relative check, where it applies, is measured against the WORKDAY
	// average: that is the baseline the weekend departs from.
	if r.minRelative > 0 {
		if wm == 0 || math.Abs(delta/wm) < r.minRelative {
			return nil
		}
	}

	word := r.moreWord
	if delta < 0 {
		word = r.lessWord
	}
	title := fmt.Sprintf("%s hétvégén %s %s, mint hétköznap",
		r.label, fmtDelta(math.Abs(delta), r.deltaUnit), word)
	detail := fmt.Sprintf(
		"Az elmúlt %d napban a hétvégi átlag %s (%d %s), a hétköznapi %s (%d %s). "+
			"Csak a mért napok számítanak; a hiányzó nap kimarad, nem nulla.",
		SleepPatternWindowDays,
		fmtVal(fm, r.unit), len(free), r.countWord,
		fmtVal(wm, r.unit), len(work), r.countWord)

	return insight(r.idPrefix, in.Today, r.kind, r.metric, title, detail, api.Info, now,
		map[string]float64{"free": fm, "work": wm, "delta": delta})
}
