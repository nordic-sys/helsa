// Package insights produces rule-based, explainable observations from your own
// data (docs/20 B7, docs/22 §2.2). **There is no LLM in here**, and none is
// needed: what we would expect "from AI" — "your resting heart rate is rising",
// "you are walking more than last week" — is a rolling average, a z-score and a
// correlation. That is more accurate, cheaper, and it does not hallucinate.
//
// # The most important rule: from little data we say NOTHING
//
// Every rule has a stated data minimum (see the constants), and until that is
// met the rule SILENTLY stays out. An invented insight is worse than an empty
// list: the user reads an empty list correctly ("there is not enough data yet"),
// whereas a false statement they will believe.
//
// Two further defences against false alarms:
//   - **Constant data**: if the standard deviation is zero (or negligible) there
//     is no z-score — a 0.1 bpm difference would look like infinitely many sigmas.
//   - **Absolute threshold**: BESIDE the relative (z-score / percentage)
//     condition, an absolute minimum is also required. Two sigmas of a very even
//     sleeper may be 4 minutes; that is true statistically, and worthless
//     humanly.
package insights

import (
	"fmt"
	"math"
	"sort"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

// --- data minimums (the rules' thresholds in one place, so they can be held to account) ---

const (
	// Deviation rule (anomaly): the baseline is a BaselineDays-long window starting
	// BaselineSkipDays before today. The recent days are left out of the baseline,
	// otherwise the very rise under examination would pull itself up.
	BaselineDays     = 28
	BaselineSkipDays = 3
	// This many days within the baseline window MUST have data (out of the 28).
	MinBaselineDays = 14
	// This many consecutive recent days have to stand out — a single spike is noise.
	AnomalyStreakDays = 3
	// z-score threshold: 1.5 sigma. Not 2, because the joint probability of 3
	// consecutive days is already small, and 2 sigma would practically never be met
	// three times in a row.
	ZThreshold = 1.5
	// Below this, the standard deviation counts as constant → no z-score.
	MinStdDev = 1e-9

	// Weekly trend: comparing two consecutive 7-day windows.
	TrendWindowDays = 7
	// This many days must have data in BOTH weeks; without it, an incomplete week
	// would look like a "plunge" when in fact you simply did not have the watch on.
	MinDaysPerTrendWindow = 5
	// At least this much relative change, otherwise it is not news.
	MinRelativeChange = 0.10

	// Correlation: this many PAIRED days are required (both series have data).
	MinCorrelationPairs = 14
	// The absolute minimum for the Pearson coefficient.
	MinAbsCorrelation = 0.5
	// The length of the correlation window.
	CorrelationDays = 60
)

// Point is one day (00:00 taken in the user's timezone) and the value belonging
// to it.
type Point struct {
	Day   time.Time
	Value float64
}

// Series holds daily values in increasing date order. A MISSING day is simply
// not in it — it is not a zero. Confusing the two ("you did not have the watch
// on" vs "you did not take a step") is the most common silent bug in rules like
// these.
type Series []Point

// Input is what the rules are fed: daily series per metric, plus the sleep hours.
type Input struct {
	// Today is 00:00 of today, taken in the user's timezone.
	Today time.Time
	// Daily: data_type → daily series (summed or averaged according to the metric's
	// aggregation — see internal/metrics).
	Daily map[string]Series
	// SleepHours: actual sleep per night in hours (the sum of the `asleep*`
	// segments), booked against the day the NIGHT started on.
	SleepHours Series
}

// Evaluate runs every rule. The result is in deterministic order, and an empty
// list is perfectly fine — it means there is nothing to say.
func Evaluate(in Input, now time.Time) []api.Insight {
	out := []api.Insight{}
	for _, r := range deviationRules {
		if ins := r.eval(in, now); ins != nil {
			out = append(out, *ins)
		}
	}
	for _, r := range trendRules {
		if ins := r.eval(in, now); ins != nil {
			out = append(out, *ins)
		}
	}
	if ins := stepsSleepCorrelation(in, now); ins != nil {
		out = append(out, *ins)
	}
	sort.Slice(out, func(i, j int) bool { return *out[i].Id < *out[j].Id })
	return out
}

// --- Rule 1: sustained deviation from the usual (anomaly) ---

type direction int

const (
	up direction = iota
	down
)

type deviationRule struct {
	metric string
	// series picks the series out of the input (a metric, or sleep).
	series func(Input) Series
	dir    direction
	// minAbsDelta: the minimum DIFFERENCE between the recent average and the
	// baseline average, in the metric's own unit. On a very even series the z-score
	// on its own is misleading.
	minAbsDelta float64
	unit        string
	// label is the subject phrase that goes into the sentence, as a WHOLE — the
	// definite article included.
	//
	// ⚠️ The insight text is USER-FACING product copy, and it is Hungarian. The
	// article cannot be wired into the format string, because Hungarian picks
	// "a" or "az" by the sound the following word starts with ("a pulzusod", but
	// "az alvásidőd"). Whoever localises this should keep the same shape: the
	// label owns the whole noun phrase, not just the noun.
	label    string
	idPrefix string
}

var deviationRules = []deviationRule{
	{
		metric:      "restingHeartRate",
		series:      func(in Input) Series { return in.Daily["restingHeartRate"] },
		dir:         up,
		minAbsDelta: 2, // bpm — a smaller difference than this is measurement noise
		unit:        "bpm",
		label:       "A nyugalmi pulzusod",
		idPrefix:    "resting-hr-elevated",
	},
	{
		metric:      "hrv",
		series:      func(in Input) Series { return in.Daily["hrv"] },
		dir:         down,
		minAbsDelta: 5, // ms
		unit:        "ms",
		label:       "A pulzusvariabilitásod (HRV)",
		idPrefix:    "hrv-depressed",
	},
	{
		metric:      "sleepDuration",
		series:      func(in Input) Series { return in.SleepHours },
		dir:         down,
		minAbsDelta: 0.5, // hours
		unit:        "óra",
		label:       "Az alvásidőd",
		idPrefix:    "sleep-short",
	},
}

func (r deviationRule) eval(in Input, now time.Time) *api.Insight {
	s := r.series(in)
	if len(s) == 0 {
		return nil
	}

	// baseline: [today-(skip+days), today-skip)
	baseEnd := in.Today.AddDate(0, 0, -BaselineSkipDays)
	baseStart := baseEnd.AddDate(0, 0, -BaselineDays)
	base := s.between(baseStart, baseEnd).values()
	if len(base) < MinBaselineDays {
		return nil // not enough history to know what "usual" even is
	}
	m := mean(base)
	sd := stdDev(base, m)
	if sd < MinStdDev {
		return nil // constant data: every difference would be infinitely many sigmas
	}

	// recent days: the last AnomalyStreakDays days, up to and including today.
	// Today may be partial, which for the `up` direction is conservative (it shows
	// less), but for `down` it would raise a false alarm — so today is left out.
	recentEnd := in.Today
	recentStart := recentEnd.AddDate(0, 0, -AnomalyStreakDays)
	recent := s.between(recentStart, recentEnd)
	if len(recent) < AnomalyStreakDays {
		return nil // days are missing: we do not have 3 consecutive observations
	}

	for _, p := range recent {
		z := (p.Value - m) / sd
		if r.dir == down {
			z = -z
		}
		if z < ZThreshold {
			return nil
		}
	}
	rm := mean(recent.values())
	delta := rm - m
	if r.dir == down {
		delta = -delta
	}
	if delta < r.minAbsDelta {
		return nil // statistically true, humanly insignificant
	}

	word := "fölött"
	if r.dir == down {
		word = "alatt"
	}
	title := fmt.Sprintf("%s %d napja a szokásos %s", r.label, AnomalyStreakDays, word)
	detail := fmt.Sprintf(
		"Az elmúlt %d nap átlaga %s, a korábbi %d nap átlaga %s (szórás %s). "+
			"Ez nem diagnózis — a nyugalmi pulzus és a HRV alvástól, alkoholtól, stressztől és "+
			"betegségtől is elmozdul.",
		AnomalyStreakDays, fmtVal(rm, r.unit), len(base), fmtVal(m, r.unit), fmtVal(sd, r.unit))

	return insight(r.idPrefix, in.Today, api.Anomaly, r.metric, title, detail, api.Notice, now)
}

// --- Rule 2: weekly trend ---

type trendRule struct {
	metric string
	series func(Input) Series
	unit   string
	// label including its article — see deviationRule.label.
	label    string
	idPrefix string
	// minAbsDelta: an absolute minimum between the weekly AVERAGES (beside the percentage).
	minAbsDelta float64
}

var trendRules = []trendRule{
	{
		metric:      "stepCount",
		series:      func(in Input) Series { return in.Daily["stepCount"] },
		unit:        "lépés",
		label:       "A napi lépésszámod",
		idPrefix:    "steps-weekly-trend",
		minAbsDelta: 500,
	},
	{
		metric:      "sleepDuration",
		series:      func(in Input) Series { return in.SleepHours },
		unit:        "óra",
		label:       "Az éjszakai alvásod",
		idPrefix:    "sleep-weekly-trend",
		minAbsDelta: 0.5,
	},
}

func (r trendRule) eval(in Input, now time.Time) *api.Insight {
	s := r.series(in)
	if len(s) == 0 {
		return nil
	}
	// Today (partial) is left out: otherwise a dashboard opened in the morning
	// would report a "plunge" every single day.
	thisEnd := in.Today
	thisStart := thisEnd.AddDate(0, 0, -TrendWindowDays)
	prevStart := thisStart.AddDate(0, 0, -TrendWindowDays)

	cur := s.between(thisStart, thisEnd).values()
	prev := s.between(prevStart, thisStart).values()
	if len(cur) < MinDaysPerTrendWindow || len(prev) < MinDaysPerTrendWindow {
		return nil // an incomplete week: the difference would measure missing data, not behaviour
	}

	cm, pm := mean(cur), mean(prev)
	if pm == 0 {
		return nil
	}
	rel := (cm - pm) / pm
	if math.Abs(rel) < MinRelativeChange || math.Abs(cm-pm) < r.minAbsDelta {
		return nil
	}

	word, arrow := "több", "nőtt"
	if rel < 0 {
		word, arrow = "kevesebb", "csökkent"
	}
	title := fmt.Sprintf("%s %.0f%%-kal %s, mint az előző héten", r.label, math.Abs(rel)*100, word)
	detail := fmt.Sprintf(
		"Az elmúlt %d nap átlaga %s (%d napból), az azt megelőző hété %s (%d napból) — %s. "+
			"Csak azok a napok számítanak, amelyekre van adat.",
		TrendWindowDays, fmtVal(cm, r.unit), len(cur), fmtVal(pm, r.unit), len(prev), arrow)

	return insight(r.idPrefix, in.Today, api.Trend, r.metric, title, detail, api.Info, now)
}

// --- Rule 3: step count ↔ sleep correlation ---

// stepsSleepCorrelation looks at whether the daily step count and the length of
// THAT NIGHT'S sleep move together. It words itself cautiously on purpose: this
// is CO-OCCURRENCE, not cause and effect — a day off can bring both more steps
// and more sleep.
func stepsSleepCorrelation(in Input, now time.Time) *api.Insight {
	steps := in.Daily["stepCount"]
	sleep := in.SleepHours
	if len(steps) == 0 || len(sleep) == 0 {
		return nil
	}
	start := in.Today.AddDate(0, 0, -CorrelationDays)
	x, y := pair(steps.between(start, in.Today), sleep.between(start, in.Today))
	if len(x) < MinCorrelationPairs {
		return nil
	}
	r, ok := pearson(x, y)
	if !ok || math.Abs(r) < MinAbsCorrelation {
		return nil
	}

	rel := "hosszabb"
	if r < 0 {
		rel = "rövidebb"
	}
	title := fmt.Sprintf("A mozgalmasabb napokat %s alvás követi", rel)
	detail := fmt.Sprintf(
		"A napi lépésszám és az aznap éjjeli alvás hossza %d napon %+.2f korrelációt mutat. "+
			"Ez EGYÜTTJÁRÁS, nem ok-okozat: egy szabadnap egyszerre hozhat több lépést és több alvást.",
		len(x), r)

	return insight("steps-sleep-correlation", in.Today, api.Correlation, "stepCount", title, detail, api.Info, now)
}

// --- Series operations ---

// between narrows to the half-open [from, to) day window.
func (s Series) between(from, to time.Time) Series {
	out := Series{}
	for _, p := range s {
		if !p.Day.Before(from) && p.Day.Before(to) {
			out = append(out, p)
		}
	}
	return out
}

func (s Series) values() []float64 {
	out := make([]float64, 0, len(s))
	for _, p := range s {
		out = append(out, p.Value)
	}
	return out
}

// pair returns the days for which BOTH series hold a value. Missing days are not
// filled in with zeros or interpolation — that would be invented data.
func pair(a, b Series) ([]float64, []float64) {
	idx := map[int64]float64{}
	for _, p := range b {
		idx[p.Day.Unix()] = p.Value
	}
	var x, y []float64
	for _, p := range a {
		if v, ok := idx[p.Day.Unix()]; ok {
			x = append(x, p.Value)
			y = append(y, v)
		}
	}
	return x, y
}

// --- statistics ---

func mean(vals []float64) float64 {
	if len(vals) == 0 {
		return 0
	}
	var sum float64
	for _, v := range vals {
		sum += v
	}
	return sum / float64(len(vals))
}

// stdDev is the SAMPLE standard deviation (n-1). The baseline is a sample of the
// usual behaviour, not the whole population; on a small sample n-1 gives a
// meaningfully more cautious threshold.
func stdDev(vals []float64, m float64) float64 {
	if len(vals) < 2 {
		return 0
	}
	var ss float64
	for _, v := range vals {
		d := v - m
		ss += d * d
	}
	return math.Sqrt(ss / float64(len(vals)-1))
}

// pearson is the correlation coefficient; the second return value is false if
// either series is constant (in which case the correlation is undefined, not
// zero).
func pearson(x, y []float64) (float64, bool) {
	if len(x) != len(y) || len(x) < 2 {
		return 0, false
	}
	mx, my := mean(x), mean(y)
	var sxy, sxx, syy float64
	for i := range x {
		dx, dy := x[i]-mx, y[i]-my
		sxy += dx * dy
		sxx += dx * dx
		syy += dy * dy
	}
	if sxx < MinStdDev || syy < MinStdDev {
		return 0, false
	}
	return sxy / math.Sqrt(sxx*syy), true
}

// --- formatting ---
//
// ⚠️ The output is USER-FACING text and stays Hungarian, so the unit strings are
// switch keys here, not display labels — changing one means changing the rule
// definitions above with it.

func fmtVal(v float64, unit string) string {
	switch {
	case unit == "lépés":
		return fmt.Sprintf("%.0f lépés", v)
	case unit == "óra":
		h := int(v)
		m := int(math.Round((v - float64(h)) * 60))
		if m == 60 {
			h, m = h+1, 0
		}
		return fmt.Sprintf("%d óra %02d perc", h, m)
	default:
		return fmt.Sprintf("%.1f %s", v, unit)
	}
}

func insight(idPrefix string, today time.Time, kind api.InsightKind, metric, title, detail string,
	sev api.InsightSeverity, now time.Time) *api.Insight {
	// The identifier is made of the rule and the day: the same statement on the same
	// day always gets the same id, so the client can deduplicate it or mark it as
	// dismissed.
	id := idPrefix + ":" + today.Format("2006-01-02")
	gen := now.UTC()
	return &api.Insight{
		Id: &id, Kind: &kind, Metric: &metric,
		Title: &title, Detail: &detail, Severity: &sev, GeneratedAt: &gen,
	}
}
