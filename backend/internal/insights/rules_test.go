package insights

import (
	"math"
	"strings"
	"testing"
	"time"
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
