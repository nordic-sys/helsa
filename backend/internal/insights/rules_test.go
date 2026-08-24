package insights

import (
	"math"
	"strings"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

var (
	today = time.Date(2026, 8, 11, 0, 0, 0, 0, time.UTC)
	now   = time.Date(2026, 8, 11, 9, 30, 0, 0, time.UTC)
)

// seriesFrom builds a daily series: the values start on the day counted back
// `startDaysAgo`, one point per day.
func seriesFrom(startDaysAgo int, values ...float64) Series {
	s := Series{}
	for i, v := range values {
		s = append(s, Point{Day: today.AddDate(0, 0, -startDaysAgo+i), Value: v})
	}
	return s
}

func repeat(v float64, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = v
	}
	return out
}

// alternate gives a non-constant but stable baseline (standard deviation > 0).
func alternate(base, jitter float64, n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		if i%2 == 0 {
			out[i] = base + jitter
		} else {
			out[i] = base - jitter
		}
	}
	return out
}

func idsOf(t *testing.T, in Input) []string {
	t.Helper()
	var ids []string
	for _, ins := range Evaluate(in, now) {
		if ins.Id == nil {
			t.Fatal("insight without an identifier")
		}
		ids = append(ids, *ins.Id)
	}
	return ids
}

func hasPrefix(ids []string, prefix string) bool {
	for _, id := range ids {
		if strings.HasPrefix(id, prefix) {
			return true
		}
	}
	return false
}

// --- the most important test: from little data we must say NOTHING ---

func TestNoDataProducesNoInsights(t *testing.T) {
	got := Evaluate(Input{Today: today, Daily: map[string]Series{}}, now)
	if len(got) != 0 {
		t.Errorf("empty input produced %d insights: %+v", len(got), got)
	}
	if got == nil {
		t.Error("the wire needs an empty array, not null")
	}
}

func TestShortHistoryProducesNoAnomaly(t *testing.T) {
	// 10 days of baseline (< MinBaselineDays) + 3 days standing well out.
	vals := append(alternate(55, 1, 10), 75, 76, 77)
	in := Input{Today: today, Daily: map[string]Series{"restingHeartRate": seriesFrom(13, vals...)}}
	if ids := idsOf(t, in); hasPrefix(ids, "resting-hr-elevated") {
		t.Errorf("we reported an anomaly from 10 days of history: %v", ids)
	}
}

// The boundary is exactly MinBaselineDays: one below it we stay silent, on it we speak.
func TestBaselineThresholdIsExact(t *testing.T) {
	spike := []float64{75, 76, 77}

	// The series ALWAYS ends on yesterday, so the start is its own length — that way
	// the baseline window [today-31, today-3) and the 3 recent days line up exactly.
	justUnder := append(alternate(55, 1, MinBaselineDays-1), spike...)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(len(justUnder), justUnder...),
	}}
	if hasPrefix(idsOf(t, in), "resting-hr-elevated") {
		t.Error("MinBaselineDays-1 days must not produce an anomaly")
	}

	enough := append(alternate(55, 1, MinBaselineDays), spike...)
	in = Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(len(enough), enough...),
	}}
	if !hasPrefix(idsOf(t, in), "resting-hr-elevated") {
		t.Error("MinBaselineDays of history + 3 outlying days: expected an anomaly")
	}
}

// Constant data: zero standard deviation. Without this, the tiniest difference
// would be infinitely many sigmas.
func TestConstantDataNeverTriggersAnomaly(t *testing.T) {
	vals := append(repeat(55, 28), 55.4, 55.4, 55.4)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(31, vals...),
	}}
	if ids := idsOf(t, in); hasPrefix(ids, "resting-hr-elevated") {
		t.Errorf("we reported an anomaly from a constant baseline: %v", ids)
	}
}

// Statistically an outlier, humanly insignificant: 1.5 sigma of a narrow series is
// under 1 bpm, and that should not be served as news.
func TestTinyDeviationIsSuppressedByAbsoluteThreshold(t *testing.T) {
	vals := append(alternate(55, 0.2, 28), 55.6, 55.6, 55.6)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(31, vals...),
	}}
	if ids := idsOf(t, in); hasPrefix(ids, "resting-hr-elevated") {
		t.Errorf("we made an insight out of a 0.6 bpm difference: %v", ids)
	}
}

// A single spike is noise — only 3 consecutive days count.
func TestSingleSpikeIsNotAnAnomaly(t *testing.T) {
	vals := append(alternate(55, 1, 28), 54, 56, 78)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(31, vals...),
	}}
	if ids := idsOf(t, in); hasPrefix(ids, "resting-hr-elevated") {
		t.Errorf("we reported an anomaly from a single spike: %v", ids)
	}
}

// Missing days: there are 28 days of baseline, but only 2 of the last 3 are measured.
func TestMissingRecentDaysBlockTheAnomaly(t *testing.T) {
	s := seriesFrom(31, append(alternate(55, 1, 28), 75, 76, 77)...)
	// The day before yesterday drops out (you did not have the watch on).
	filtered := Series{}
	for _, p := range s {
		if p.Day.Equal(today.AddDate(0, 0, -2)) {
			continue
		}
		filtered = append(filtered, p)
	}
	in := Input{Today: today, Daily: map[string]Series{"restingHeartRate": filtered}}
	if ids := idsOf(t, in); hasPrefix(ids, "resting-hr-elevated") {
		t.Errorf("we reported an anomaly from incomplete recent days: %v", ids)
	}
}

func TestSustainedElevationIsReported(t *testing.T) {
	vals := append(alternate(55, 1, 28), 62, 63, 64)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(31, vals...),
	}}
	got := Evaluate(in, now)
	var found bool
	for _, ins := range got {
		if !strings.HasPrefix(*ins.Id, "resting-hr-elevated") {
			continue
		}
		found = true
		if *ins.Kind != "anomaly" || *ins.Severity != "notice" {
			t.Errorf("kind=%s severity=%s", *ins.Kind, *ins.Severity)
		}
		if *ins.Metric != "restingHeartRate" {
			t.Errorf("metric = %s", *ins.Metric)
		}
		// The text must say what we are basing this on — that is the whole point of
		// explainability.
		if !strings.Contains(*ins.Detail, "átlaga") || !strings.Contains(*ins.Detail, "szórás") {
			t.Errorf("the explanation does not cite the underlying figures: %s", *ins.Detail)
		}
		// And it must not assert a diagnosis.
		if !strings.Contains(*ins.Detail, "nem diagnózis") {
			t.Errorf("the qualifying wording is missing: %s", *ins.Detail)
		}
		if ins.GeneratedAt == nil || !ins.GeneratedAt.Equal(now.UTC()) {
			t.Errorf("generated_at = %v", ins.GeneratedAt)
		}
	}
	if !found {
		t.Fatalf("expected a sustained elevation, got: %+v", got)
	}
}

// The downward direction (HRV) works the same way, but only downwards.
func TestDownwardRuleTriggersOnlyDownwards(t *testing.T) {
	low := append(alternate(60, 3, 28), 40, 39, 41)
	in := Input{Today: today, Daily: map[string]Series{"hrv": seriesFrom(31, low...)}}
	if !hasPrefix(idsOf(t, in), "hrv-depressed") {
		t.Error("expected an insight for sustained low HRV")
	}

	high := append(alternate(60, 3, 28), 85, 86, 84)
	in = Input{Today: today, Daily: map[string]Series{"hrv": seriesFrom(31, high...)}}
	if hasPrefix(idsOf(t, in), "hrv-depressed") {
		t.Error("HIGH HRV must not be a 'depressed' insight")
	}
}

// --- weekly trend ---

func TestWeeklyTrendNeedsBothWeeks(t *testing.T) {
	// 7 complete days for the current week, but only 4 for the previous one → silence.
	s := Series{}
	for i := 14; i > 7; i-- {
		if i > 11 {
			continue // 4 days are left out of the previous week
		}
		s = append(s, Point{Day: today.AddDate(0, 0, -i), Value: 4000})
	}
	for i := 7; i > 0; i-- {
		s = append(s, Point{Day: today.AddDate(0, 0, -i), Value: 9000})
	}
	in := Input{Today: today, Daily: map[string]Series{"stepCount": s}}
	if ids := idsOf(t, in); hasPrefix(ids, "steps-weekly-trend") {
		t.Errorf("we reported a trend from an incomplete previous week: %v", ids)
	}
}

func TestWeeklyTrendReportsRealChange(t *testing.T) {
	vals := append(repeat(4000, 7), repeat(9000, 7)...)
	in := Input{Today: today, Daily: map[string]Series{"stepCount": seriesFrom(14, vals...)}}
	got := Evaluate(in, now)
	var found bool
	for _, ins := range got {
		if strings.HasPrefix(*ins.Id, "steps-weekly-trend") {
			found = true
			if *ins.Kind != "trend" || *ins.Severity != "info" {
				t.Errorf("kind=%s severity=%s", *ins.Kind, *ins.Severity)
			}
			if !strings.Contains(*ins.Title, "%") {
				t.Errorf("the title does not state the size of the change: %s", *ins.Title)
			}
			// The explanation must say how many days we computed from.
			if !strings.Contains(*ins.Detail, "napból") {
				t.Errorf("the explanation does not state the number of days: %s", *ins.Detail)
			}
		}
	}
	if !found {
		t.Fatalf("expected a weekly trend, got: %+v", got)
	}
}

// A fluctuation under 10% is not news.
func TestSmallWeeklyChangeIsIgnored(t *testing.T) {
	vals := append(repeat(8000, 7), repeat(8400, 7)...) // +5%
	in := Input{Today: today, Daily: map[string]Series{"stepCount": seriesFrom(14, vals...)}}
	if ids := idsOf(t, in); hasPrefix(ids, "steps-weekly-trend") {
		t.Errorf("we reported a trend from a 5%% change: %v", ids)
	}
}

// A relative threshold alone is not enough: 100 → 130 steps is +30%, and meaningless.
func TestRelativeChangeAlsoNeedsAbsoluteSize(t *testing.T) {
	vals := append(repeat(100, 7), repeat(130, 7)...)
	in := Input{Today: today, Daily: map[string]Series{"stepCount": seriesFrom(14, vals...)}}
	if ids := idsOf(t, in); hasPrefix(ids, "steps-weekly-trend") {
		t.Errorf("we reported a trend from a 30-step difference: %v", ids)
	}
}

// Today (a partial day) must not go into the current week: otherwise we would
// report a "plunge" every morning.
func TestTodayIsExcludedFromWindows(t *testing.T) {
	vals := append(repeat(8000, 14), 200) // the last point is TODAY, a half-done day
	in := Input{Today: today, Daily: map[string]Series{"stepCount": seriesFrom(14, vals...)}}
	if ids := idsOf(t, in); hasPrefix(ids, "steps-weekly-trend") {
		t.Errorf("today's partial day triggered a trend: %v", ids)
	}
}

// --- sleep ---

func TestSleepSeriesFeedsBothSleepRules(t *testing.T) {
	// Sustained shorter sleep: 28 days of ~7.5 hours, then 3 days of 5 hours.
	base := alternate(7.5, 0.4, 28)
	in := Input{Today: today, SleepHours: seriesFrom(31, append(base, 5.0, 5.1, 4.9)...)}
	ids := idsOf(t, in)
	if !hasPrefix(ids, "sleep-short") {
		t.Errorf("expected an insight for sustained short sleep: %v", ids)
	}
	// The hour formatting must be human, not 5.083333.
	for _, ins := range Evaluate(in, now) {
		if strings.HasPrefix(*ins.Id, "sleep-short") && !strings.Contains(*ins.Detail, "óra") {
			t.Errorf("the sleep explanation is not in hours/minutes form: %s", *ins.Detail)
		}
	}
}

// --- correlation ---

func TestCorrelationNeedsEnoughPairedDays(t *testing.T) {
	// 10 days of perfect co-movement — too few for MinCorrelationPairs.
	steps, sleep := Series{}, Series{}
	for i := 10; i > 0; i-- {
		d := today.AddDate(0, 0, -i)
		steps = append(steps, Point{Day: d, Value: float64(i) * 1000})
		sleep = append(sleep, Point{Day: d, Value: float64(i) * 0.5})
	}
	in := Input{Today: today, Daily: map[string]Series{"stepCount": steps}, SleepHours: sleep}
	if ids := idsOf(t, in); hasPrefix(ids, "steps-sleep-correlation") {
		t.Errorf("we reported a correlation from 10 days: %v", ids)
	}
}

// Only the days for which BOTH series hold data are paired — a missing day is not
// filled in with a zero, because that would be invented data.
func TestCorrelationPairsOnlyOverlappingDays(t *testing.T) {
	steps, sleep := Series{}, Series{}
	for i := 30; i > 0; i-- {
		d := today.AddDate(0, 0, -i)
		steps = append(steps, Point{Day: d, Value: float64(i) * 300})
		if i%3 == 0 { // two thirds of the sleep data is missing → 10 pairs remain
			sleep = append(sleep, Point{Day: d, Value: float64(i) * 0.2})
		}
	}
	x, y := pair(steps, sleep)
	if len(x) != 10 || len(y) != 10 {
		t.Fatalf("pairs = %d/%d, expected 10", len(x), len(y))
	}
	in := Input{Today: today, Daily: map[string]Series{"stepCount": steps}, SleepHours: sleep}
	if hasPrefix(idsOf(t, in), "steps-sleep-correlation") {
		t.Error("we reported a correlation from 10 pairs")
	}
}

func TestStrongCorrelationIsReportedWithACaveat(t *testing.T) {
	steps, sleep := Series{}, Series{}
	for i := 20; i > 0; i-- {
		d := today.AddDate(0, 0, -i)
		v := float64(i%5)*1500 + 4000
		steps = append(steps, Point{Day: d, Value: v})
		sleep = append(sleep, Point{Day: d, Value: 6 + v/10000})
	}
	in := Input{Today: today, Daily: map[string]Series{"stepCount": steps}, SleepHours: sleep}
	var found bool
	for _, ins := range Evaluate(in, now) {
		if strings.HasPrefix(*ins.Id, "steps-sleep-correlation") {
			found = true
			if *ins.Kind != "correlation" {
				t.Errorf("kind = %s", *ins.Kind)
			}
			if !strings.Contains(*ins.Detail, "nem ok-okozat") {
				t.Errorf("the causation disclaimer is missing: %s", *ins.Detail)
			}
		}
	}
	if !found {
		t.Error("expected an insight for a strong correlation")
	}
}

// --- the wording of the new rule families ---
//
// The vectors pin the DECISIONS (see vectors_test.go); what is tested here is
// what the Go side alone owns: the Hungarian sentence. Two properties matter —
// it must state the numbers it is based on, and it must not overreach.

// nightsWithStart builds `count` nights ending yesterday, each `durMin` long,
// starting at the minute-of-day the callback returns.
func nightsWithStart(count int, durMin float64, startMin func(time.Weekday) float64) []SleepNight {
	out := []SleepNight{}
	for i := count; i > 0; i-- {
		d := today.AddDate(0, 0, -i)
		start := d.Add(time.Duration(startMin(d.Weekday())) * time.Minute)
		out = append(out, SleepNight{
			Day: d, Start: start, End: start.Add(time.Duration(durMin) * time.Minute),
		})
	}
	return out
}

// balancedSwing: bedtimes that swing `spread` minutes around 22:30 while the
// free nights (Friday, Saturday) average exactly what the work nights do — so
// only the SCATTER is left for a rule to find.
func balancedSwing(spread float64) func(time.Weekday) float64 {
	return func(wd time.Weekday) float64 {
		switch wd {
		case time.Sunday:
			return 1350
		case time.Monday, time.Wednesday, time.Friday:
			return 1350 - spread
		default:
			return 1350 + spread
		}
	}
}

func findInsight(t *testing.T, in Input, prefix string) api.Insight {
	t.Helper()
	for _, ins := range Evaluate(in, now) {
		if strings.HasPrefix(*ins.Id, prefix) {
			return ins
		}
	}
	t.Fatalf("no insight with the prefix %q; we got: %v", prefix, idsOf(t, in))
	return api.Insight{}
}

func TestSleepRegularityWordsTheScatterAndTheMidpoint(t *testing.T) {
	// A bedtime swinging 90 minutes around 22:30 (so the midpoint of an unvarying
	// 8-hour night averages 02:30), balanced across the weekdays so that the
	// weekend rules have nothing to say about the same nights.
	swing := balancedSwing(90)
	in := Input{Today: today, SleepNights: nightsWithStart(28, 480, swing)}
	ins := findInsight(t, in, "sleep-regularity")

	if *ins.Kind != api.Pattern {
		t.Errorf("kind = %s — a property of a window is not a trend", *ins.Kind)
	}
	// The scatter is the finding, so it has to be in the title.
	if !strings.Contains(*ins.Title, "perc") {
		t.Errorf("the title does not state the scatter: %s", *ins.Title)
	}
	// The midpoint belongs in the explanation as a CLOCK reading: "1590 perc"
	// would be arithmetically true and unreadable.
	if !strings.Contains(*ins.Detail, "02:30") {
		t.Errorf("the explanation does not state the midpoint as a clock time: %s", *ins.Detail)
	}
	if !strings.Contains(*ins.Detail, "nem diagnózis") {
		t.Errorf("the qualifying wording is missing: %s", *ins.Detail)
	}

	// The same nights, a third of the swing: nothing to report.
	quiet := Input{Today: today, SleepNights: nightsWithStart(28, 480, balancedSwing(30))}
	if hasPrefix(idsOf(t, quiet), "sleep-regularity") {
		t.Error("a 30-minute swing was reported as irregular")
	}
}

// Hungarian puts the measure of a comparison in the instrumental case. Getting
// this wrong ("120 perc később" instead of "120 perccel később") is the kind of
// thing only a native reader notices, so it is pinned.
func TestWeekendRulesUseTheInstrumentalCase(t *testing.T) {
	jetlag := func(wd time.Weekday) float64 {
		if wd == time.Friday || wd == time.Saturday {
			return 1380 + 120
		}
		return 1380
	}
	in := Input{Today: today, SleepNights: nightsWithStart(28, 480, jetlag)}
	ins := findInsight(t, in, "sleep-midpoint-weekend")
	if !strings.Contains(*ins.Title, "perccel később van") {
		t.Errorf("the title is not grammatical Hungarian: %s", *ins.Title)
	}
	// Both averages are clock readings, and the count is of NIGHTS, not days.
	if !strings.Contains(*ins.Detail, "mért éjszakából") {
		t.Errorf("the explanation counts days rather than nights: %s", *ins.Detail)
	}

	steps := Series{}
	for i := 28; i > 0; i-- {
		d := today.AddDate(0, 0, -i)
		v := 11000.0
		if d.Weekday() == time.Saturday || d.Weekday() == time.Sunday {
			v = 6000
		}
		steps = append(steps, Point{Day: d, Value: v})
	}
	stepsIn := Input{Today: today, Daily: map[string]Series{"stepCount": steps}}
	ins = findInsight(t, stepsIn, "steps-weekend")
	if !strings.Contains(*ins.Title, "lépéssel kevesebb") {
		t.Errorf("the title is not grammatical Hungarian: %s", *ins.Title)
	}
	if !strings.Contains(*ins.Detail, "nem nulla") {
		t.Errorf("the explanation does not say that a missing day is left out: %s", *ins.Detail)
	}
}

// Whole hours: "2 óra 0 perccel hosszabb" is not a sentence anyone says.
func TestWholeHourDifferenceReadsNaturally(t *testing.T) {
	if got := fmtDelta(2, "óra"); got != "2 órával" {
		t.Errorf("fmtDelta(2, óra) = %q", got)
	}
	if got := fmtDelta(1.5, "óra"); got != "1 óra 30 perccel" {
		t.Errorf("fmtDelta(1.5, óra) = %q", got)
	}
	if got := fmtDelta(0.7, "óra"); got != "42 perccel" {
		t.Errorf("fmtDelta(0.7, óra) = %q", got)
	}
	// A clock reading past midnight wraps: 1590 minutes is 02:30, not 26:30.
	if got := fmtVal(1590, "óraidő"); got != "02:30" {
		t.Errorf("fmtVal(1590, óraidő) = %q", got)
	}
}

// The training-load rule is the one most likely to be misread as medicine, so
// its disclaimers are part of the contract, not decoration.
func TestTrainingLoadSaysItIsNotAnInjuryForecast(t *testing.T) {
	var ws []Workout
	addWorkout := func(daysAgo int, mins float64) {
		ws = append(ws, Workout{
			Day:          today.AddDate(0, 0, -daysAgo),
			ActivityType: "traditionalStrengthTraining",
			Duration:     time.Duration(mins) * time.Minute,
		})
	}
	for _, d := range []int{28, 27, 21, 20, 14, 13} {
		addWorkout(d, 45)
	}
	for _, d := range []int{7, 5, 3, 1} {
		addWorkout(d, 60)
	}
	in := Input{Today: today, Workouts: ws}
	ins := findInsight(t, in, "training-load-jump")

	if *ins.Severity != api.Info {
		t.Errorf("severity = %s — a training figure dressed as a warning invites a medical reading", *ins.Severity)
	}
	for _, want := range []string{"nem sérülés-előrejelzés", "NEM orvosi állítás", "perc"} {
		if !strings.Contains(*ins.Detail, want) {
			t.Errorf("the explanation is missing %q: %s", want, *ins.Detail)
		}
	}
}

// The efficiency rule's whole claim rests on the heart rate being comparable;
// if it is not, the correct output is nothing at all.
func TestEfficiencyNeedsAComparableHeartRate(t *testing.T) {
	build := func(recentMins, recentHR float64) Input {
		var ws []Workout
		run := func(daysAgo int, mins, hr float64) {
			dist := 8000.0
			ws = append(ws, Workout{
				Day: today.AddDate(0, 0, -daysAgo), ActivityType: "running",
				Duration:  time.Duration(mins * float64(time.Minute)),
				DistanceM: &dist, AvgHeartRate: &hr,
			})
		}
		for _, d := range []int{55, 52, 45, 38, 31} {
			run(d, 44, 149)
		}
		for _, d := range []int{27, 24, 17, 10, 3} {
			run(d, recentMins, recentHR)
		}
		return Input{Today: today, Workouts: ws}
	}

	ins := findInsight(t, build(40, 150), "efficiency-trend-running")
	if !strings.Contains(*ins.Title, "ugyanazon a pulzuson") {
		t.Errorf("the title does not say the comparison is at a like heart rate: %s", *ins.Title)
	}
	// km/h, because "200.0 m/min" is not how anyone thinks about their pace.
	if !strings.Contains(*ins.Detail, "km/h") {
		t.Errorf("the explanation does not state the pace in km/h: %s", *ins.Detail)
	}

	if hasPrefix(idsOf(t, build(40, 158)), "efficiency-trend") {
		t.Error("we called it an efficiency gain although the heart rate rose by 9 bpm with it")
	}
}

// A strength session has no pace. Reading its zero distance as a slow one would
// invent the very data this package refuses to invent.
func TestEfficiencyIgnoresSessionsWithoutDistanceOrHeartRate(t *testing.T) {
	var ws []Workout
	for _, d := range []int{55, 52, 45, 38, 31, 27, 24, 17, 10, 3} {
		ws = append(ws, Workout{
			Day: today.AddDate(0, 0, -d), ActivityType: "running",
			Duration: 40 * time.Minute,
		})
	}
	in := Input{Today: today, Workouts: ws}
	if hasPrefix(idsOf(t, in), "efficiency-trend") {
		t.Error("we produced an efficiency insight from workouts with no distance and no heart rate")
	}
}

// --- baseline drift, sleep debt, social jetlag ---
//
// The decisions are pinned by the shared vectors; what these cover is what the Go
// side alone owns — the Hungarian sentence — plus the one thing no vector can
// see: whether the server actually READS the days and metrics these rules need.

// driftSeries builds four months of a daily metric: `older` until 90 days ago and
// `recent` from then on, with a ±2 wobble so that neither window is constant.
func driftSeries(older, recent float64) Series {
	s := Series{}
	for n := 120; n >= 1; n-- {
		v := recent
		if n > 90 {
			v = older
		}
		if n%2 == 0 {
			v += 2
		} else {
			v -= 2
		}
		s = append(s, Point{Day: today.AddDate(0, 0, -n), Value: v})
	}
	return s
}

func TestBaselineDriftNamesBothWindowsAndRefusesADiagnosis(t *testing.T) {
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": driftSeries(55, 61),
	}}
	ins := findInsight(t, in, "baseline-drift-restingHeartRate")

	if *ins.Kind != api.Trend || *ins.Severity != api.Info {
		t.Errorf("kind=%s severity=%s — a shift that finished weeks ago is not this morning's news",
			*ins.Kind, *ins.Severity)
	}
	// Hungarian wants the instrumental case on the size of a difference, and it
	// assimilates the suffix to the unit: "6.0 bpm-mel", never "6.0 bpm".
	if !strings.Contains(*ins.Title, "bpm-mel") {
		t.Errorf("the title is not grammatical Hungarian: %s", *ins.Title)
	}
	// The span is derived from the windows; a literal would go on claiming a
	// length the arithmetic no longer has.
	if !strings.Contains(*ins.Title, "3 hónap") {
		t.Errorf("the title does not state the span the two windows are apart: %s", *ins.Title)
	}
	for _, want := range []string{"mért napból", "90–120 nappal ezelőtti", "nem diagnózis"} {
		if !strings.Contains(*ins.Detail, want) {
			t.Errorf("the explanation is missing %q: %s", want, *ins.Detail)
		}
	}

	// Both directions are reported: a resting heart rate sliding down over a
	// quarter is the same kind of fact as one sliding up.
	down := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": driftSeries(61, 55),
	}}
	if !strings.Contains(*findInsight(t, down, "baseline-drift").Title, "lejjebb csúszott") {
		t.Error("a downward drift was not reported as one")
	}
}

// The trap this rule is built on: neither of the short-window rules can see a
// slow shift, because their own baselines drift along with the person.
func TestBaselineDriftSeesWhatTheAnomalyRuleCannot(t *testing.T) {
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": driftSeries(55, 61),
	}}
	ids := idsOf(t, in)
	if hasPrefix(ids, "resting-hr-elevated") {
		t.Errorf("the anomaly rule fired on a slow drift, which it cannot measure: %v", ids)
	}
	if !hasPrefix(ids, "baseline-drift-restingHeartRate") {
		t.Errorf("nobody reported a 6 bpm shift over a quarter of a year: %v", ids)
	}
}

// ⚠️ The failure this guards against is silent on both sides: a rule reading
// `in.Daily["respiratoryRate"]` while the service never selects that data_type
// returns nil exactly as a rule with nothing to say does. The phone would then
// show five drifts and the dashboard three, for the same body.
func TestEveryDriftMetricIsActuallyRead(t *testing.T) {
	for _, r := range baselineDriftRules {
		if r.metric == "sleepDuration" {
			continue // fed by the sleep read path, which is not a `neededMetrics` entry
		}
		// Fed under the rule's own `metric` name: if the series function reads some
		// other key, nothing fires and the loop below is checking the wrong string.
		in := Input{Today: today, Daily: map[string]Series{r.metric: driftSeries(50, 60)}}
		if !hasPrefix(idsOf(t, in), "baseline-drift-"+r.metric) {
			t.Errorf("%s: the rule does not read in.Daily[%q]", r.metric, r.metric)
			continue
		}
		var read bool
		for _, m := range neededMetrics {
			read = read || m == r.metric
		}
		if !read {
			t.Errorf("the service never reads %q, so its drift can never fire on the server",
				r.metric)
		}
	}
}

// The read window has to reach as far back as the hungriest rule asks. A rule
// starved of its days looks exactly like a rule with nothing to say.
func TestLookbackCoversTheLongestWindow(t *testing.T) {
	for _, want := range []int{DriftOlderWindowStartDays, SleepDebtHistoryDays,
		SocialJetlagWindowDays, CorrelationDays} {
		if LookbackDays < want {
			t.Errorf("LookbackDays = %d, but a rule reaches back %d days", LookbackDays, want)
		}
	}
}

// sleepNights builds a series of nights ending yesterday, `hours` long each.
func debtSeries(baseline, fortnight float64) Series {
	s := Series{}
	for n := SleepDebtHistoryDays; n >= 1; n-- {
		v := baseline
		if n <= SleepDebtWindowDays {
			v = fortnight
		} else if n%2 == 0 {
			v += 0.1
		} else {
			v -= 0.1
		}
		s = append(s, Point{Day: today.AddDate(0, 0, -n), Value: v})
	}
	return s
}

func TestSleepDebtSaysWhatItIsMeasuredAgainst(t *testing.T) {
	in := Input{Today: today, SleepHours: debtSeries(7.5, 6.6)}
	ins := findInsight(t, in, "sleep-debt")

	if *ins.Kind != api.Pattern || *ins.Severity != api.Info {
		t.Errorf("kind=%s severity=%s — a fortnight's balance is a property of one window",
			*ins.Kind, *ins.Severity)
	}
	// The whole point is that "usual" is the person's own, not a round number
	// everyone is measured against.
	for _, want := range []string{"mediánja", "nem egy általános 8 órás ajánlás",
		"se nullának, se szokásosnak", "nem orvosi értékelés"} {
		if !strings.Contains(*ins.Detail, want) {
			t.Errorf("the explanation is missing %q: %s", want, *ins.Detail)
		}
	}
	// Hours, in the instrumental case, not "12.6 óra".
	if !strings.Contains(*ins.Title, "perccel") && !strings.Contains(*ins.Title, "órával") &&
		!strings.Contains(*ins.Title, "óra") {
		t.Errorf("the title does not state the shortfall in hours: %s", *ins.Title)
	}
}

// The horoscope trap: counting only the nights below the median would report a
// debt for everyone, for ever, because half of anyone's nights are below their own
// middle. The sum is signed, so a long night pays a short one back.
func TestSleepDebtIsSignedNotASumOfShortNights(t *testing.T) {
	s := debtSeries(7.5, 7.5)
	// The fortnight alternates 2 hours either side of the usual: seven nights are
	// short by 2 hours each — 14 hours of "debt" by the naive sum — and seven are
	// long by the same.
	for i := range s {
		n := int(today.Sub(s[i].Day).Hours() / 24)
		if n <= SleepDebtWindowDays {
			if n%2 == 0 {
				s[i].Value = 9.5
			} else {
				s[i].Value = 5.5
			}
		}
	}
	if ids := idsOf(t, Input{Today: today, SleepHours: s}); hasPrefix(ids, "sleep-debt") {
		t.Errorf("a fortnight that netted out to the usual was reported as a debt: %v", ids)
	}
}

// jetlagNights builds eight weeks of nights: work nights asleep 23:00–07:00, free
// nights (Friday, Saturday) the same length but `shift` minutes later.
func jetlagNights(shift float64) []SleepNight {
	out := []SleepNight{}
	for n := SocialJetlagWindowDays; n >= 1; n-- {
		d := today.AddDate(0, 0, -n)
		start := d.Add(23 * time.Hour)
		if freeNight(d.Weekday()) {
			start = start.Add(time.Duration(shift) * time.Minute)
		}
		out = append(out, SleepNight{Day: d, Start: start, End: start.Add(8 * time.Hour)})
	}
	return out
}

func TestSocialJetlagWordsTheHabitAndItsTimeZones(t *testing.T) {
	in := Input{Today: today, SleepNights: jetlagNights(120)}
	ins := findInsight(t, in, "social-jetlag")

	if *ins.Kind != api.Pattern || *ins.Severity != api.Info {
		t.Errorf("kind=%s severity=%s — a standing habit is not a change from window to window",
			*ins.Kind, *ins.Severity)
	}
	if !strings.Contains(*ins.Title, "Szociális jetlag") {
		t.Errorf("the title does not name what it found: %s", *ins.Title)
	}
	for _, want := range []string{"időzónányi", "hétben érte el a fél órát", "nem orvosi értékelés"} {
		if !strings.Contains(*ins.Detail, want) {
			t.Errorf("the explanation is missing %q: %s", want, *ins.Detail)
		}
	}

	// One-sided: a weekend that starts EARLIER than the working week is an unusual
	// life, not a jetlag, and borrowing the term for it would misname it.
	early := Input{Today: today, SleepNights: jetlagNights(-120)}
	if hasPrefix(idsOf(t, early), "social-jetlag") {
		t.Error("an earlier weekend was reported as social jetlag")
	}
}

// At an hour, the ported sleep-midpoint-weekend rule already says this about the
// same nights. The 90-minute floor is what keeps the second card from being the
// first one's echo.
func TestSocialJetlagWaitsLongerThanItsNeighbour(t *testing.T) {
	in := Input{Today: today, SleepNights: jetlagNights(75)}
	ids := idsOf(t, in)
	if !hasPrefix(ids, "sleep-midpoint-weekend") {
		t.Errorf("the pooled weekend rule should speak at 75 minutes: %v", ids)
	}
	if hasPrefix(ids, "social-jetlag") {
		t.Errorf("social-jetlag spoke below its own 90-minute floor: %v", ids)
	}
}

// --- statistical kernels ---

func TestPearsonRejectsConstantSeries(t *testing.T) {
	if _, ok := pearson([]float64{1, 1, 1, 1}, []float64{2, 3, 4, 5}); ok {
		t.Error("correlation is undefined for a constant series")
	}
	if _, ok := pearson([]float64{1, 2}, []float64{1}); ok {
		t.Error("series of different lengths must not be correlated")
	}
	r, ok := pearson([]float64{1, 2, 3, 4}, []float64{2, 4, 6, 8})
	if !ok || math.Abs(r-1) > 1e-9 {
		t.Errorf("perfect co-movement r = %v (ok=%v), expected 1", r, ok)
	}
	r, _ = pearson([]float64{1, 2, 3, 4}, []float64{8, 6, 4, 2})
	if math.Abs(r+1) > 1e-9 {
		t.Errorf("perfect opposite movement r = %v, expected -1", r)
	}
}

// The median is what "your usual" is measured with, precisely because a handful
// of odd days must not move it — a mean would let a fortnight of illness redefine
// the standard the illness itself is being judged against.
func TestMedianIgnoresAHandfulOfOddDays(t *testing.T) {
	steady := []float64{7.4, 7.5, 7.5, 7.6, 7.5}
	ill := []float64{7.4, 7.5, 7.5, 7.6, 7.5, 3.0, 3.0}
	if got := median(steady); got != 7.5 {
		t.Errorf("median = %v, expected 7.5", got)
	}
	if got := median(ill); got != 7.5 {
		t.Errorf("two three-hour nights moved the median to %v", got)
	}
	// An even count averages the two middle values.
	if got := median([]float64{1, 2, 3, 4}); got != 2.5 {
		t.Errorf("median of an even count = %v, expected 2.5", got)
	}
	// And it must not reorder the caller's slice: that is a window of the input
	// series, and the next rule reads it by day.
	vals := []float64{3, 1, 2}
	_ = median(vals)
	if vals[0] != 3 || vals[1] != 1 || vals[2] != 2 {
		t.Errorf("median sorted the caller's slice: %v", vals)
	}
	if median(nil) != 0 {
		t.Error("the median of nothing is 0, like the mean of nothing")
	}
}

func TestStdDevIsSampleBased(t *testing.T) {
	// 2, 4, 4, 4, 5, 5, 7, 9 → population std dev 2, sample std dev ~2.138
	vals := []float64{2, 4, 4, 4, 5, 5, 7, 9}
	got := stdDev(vals, mean(vals))
	if math.Abs(got-2.13809) > 1e-4 {
		t.Errorf("stdDev = %v, expected ~2.138 (an n-1 divisor)", got)
	}
	if stdDev([]float64{5}, 5) != 0 {
		t.Error("a one-element sample has no standard deviation")
	}
}

func TestSeriesBetweenIsHalfOpen(t *testing.T) {
	s := seriesFrom(5, 1, 2, 3, 4, 5)
	got := s.between(today.AddDate(0, 0, -5), today.AddDate(0, 0, -3))
	if len(got) != 2 || got[0].Value != 1 || got[1].Value != 2 {
		t.Errorf("between = %+v, expected the first two points", got)
	}
}

func TestFormatValuesAreHuman(t *testing.T) {
	if got := fmtVal(7.5, "óra"); got != "7 óra 30 perc" {
		t.Errorf("fmtVal(7.5, óra) = %q", got)
	}
	// Rounding: 7.999 hours must not become "7 óra 60 perc".
	if got := fmtVal(7.999, "óra"); got != "8 óra 00 perc" {
		t.Errorf("fmtVal(7.999, óra) = %q", got)
	}
	if got := fmtVal(8412.4, "lépés"); got != "8412 lépés" {
		t.Errorf("fmtVal(8412.4, lépés) = %q", got)
	}
	if got := fmtVal(56.25, "bpm"); got != "56.2 bpm" && got != "56.3 bpm" {
		t.Errorf("fmtVal(56.25, bpm) = %q", got)
	}
}

// The identifier is made of the rule + the day: the same statement on the same day
// gets the same id, so the client can deduplicate it.
func TestInsightIDsAreStableWithinADay(t *testing.T) {
	vals := append(alternate(55, 1, 28), 62, 63, 64)
	in := Input{Today: today, Daily: map[string]Series{"restingHeartRate": seriesFrom(31, vals...)}}
	first := idsOf(t, in)
	second := idsOf(t, in)
	if len(first) == 0 {
		t.Fatal("no insight was produced")
	}
	for i := range first {
		if first[i] != second[i] {
			t.Errorf("the identifier is not stable: %s vs %s", first[i], second[i])
		}
		if !strings.HasSuffix(first[i], today.Format("2006-01-02")) {
			t.Errorf("the identifier does not contain the day: %s", first[i])
		}
	}
}

// TestTheWireCarriesDataNotJustASentence is the guard on the decision behind this
// endpoint: **the server sends data, and the sentence is only a fallback.**
//
// Before it, an insight went out as a finished Hungarian sentence and nothing else,
// which made this server the one part of the system that could speak a single
// language — and made a client's own language wrong the moment it fetched anything.
// A regression here would not fail any other test: the sentence would still be
// there, still correct, still Hungarian.
func TestTheWireCarriesDataNotJustASentence(t *testing.T) {
	raised := append(alternate(55, 1, MinBaselineDays), 75, 76, 77)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(len(raised), raised...),
	}}
	got := Evaluate(in, now)
	if len(got) == 0 {
		t.Fatal("the fixture was supposed to fire a rule")
	}
	for _, ins := range got {
		if ins.Rule == nil || *ins.Rule == "" {
			t.Errorf("%v: no rule on the wire — a client cannot key its own wording on anything",
				ins.Id)
			continue
		}
		// The rule is the stem of the id, and that is not decoration: the id carries the
		// day, so a client that keyed on it would need a new case every morning.
		if want := *ins.Rule + ":" + today.Format("2006-01-02"); *ins.Id != want {
			t.Errorf("id = %q, expected %q — the rule must be the stem of the id", *ins.Id, want)
		}
		if ins.Values == nil || len(*ins.Values) == 0 {
			t.Errorf("%s: no values on the wire — the sentence would be the only content", *ins.Rule)
		}
	}
}

// TestTheWireValuesAreACopy guards a sharp edge of the change above: `Result.Values`
// is handed to the vector suite, and the same map going out on the wire would give
// two owners to one map — which is how a test starts editing production data.
func TestTheWireValuesAreACopy(t *testing.T) {
	raised := append(alternate(55, 1, MinBaselineDays), 75, 76, 77)
	in := Input{Today: today, Daily: map[string]Series{
		"restingHeartRate": seriesFrom(len(raised), raised...),
	}}
	res := EvaluateDetailed(in, now)
	if len(res) == 0 {
		t.Fatal("the fixture was supposed to fire a rule")
	}
	first := res[0]
	for k := range first.Values {
		first.Values[k] = -1
		if (*first.Insight.Values)[k] == -1 {
			t.Fatalf("%s: the wire map and the vector map are the same map", k)
		}
		break
	}
}
