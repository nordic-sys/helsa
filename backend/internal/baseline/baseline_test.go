package baseline

import (
	"math"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"

	// The tests name their timezone, and the anchor rule reads day boundaries in it.
	// A machine with no system zone database would otherwise fail to load
	// "Europe/Budapest" and take the suite with it, for a reason that has nothing to
	// do with the arithmetic.
	_ "time/tzdata"
)

// The counterpart of the app's TrendBaselineTests. What these hold is mostly the
// SILENCE: a band drawn from too little data, or from data that never varied,
// would be a decoration every reader would take for a reference range. Most of
// what follows is about refusing to draw one.
//
// The vectors are the same numbers the Swift tests use, deliberately — if one side
// moves a threshold, the other side's suite is where it shows up.

// The generated bucket is an anonymous struct. An ALIAS (=) makes it nameable
// without making it a different type, the same trick summary.go plays with bkt.
type bucket = struct {
	Avg *float32 `json:"avg,omitempty"`
	Max *float32 `json:"max,omitempty"`
	Min *float32 `json:"min,omitempty"`
	T   *string  `json:"t,omitempty"`
	V   *float32 `json:"v,omitempty"`
}

func ramp(n int) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = float64(i)
	}
	return out
}

// --- When there may be no band at all -----------------------------------------

func TestABandNeedsFourteenMeasuredDays(t *testing.T) {
	// Thirteen is not enough, and the fourteenth is what turns it on. The exact edge
	// matters: this is the number that separates "your usual" from arithmetic about a
	// fortnight of noise.
	if b := Make(ramp(13)); b != nil {
		t.Errorf("13 days produced a band (mean %v) — the minimum is %d", b.Mean, MinReferenceDays)
	}
	b := Make(ramp(14))
	if b == nil {
		t.Fatal("14 measured days must produce a band")
	}
	if b.DayCount != 14 {
		t.Errorf("day count = %d, expected 14", b.DayCount)
	}
}

func TestASeriesThatNeverVariedGetsNoBand(t *testing.T) {
	// ⚠️ A zero-width band is not a band. Every single day would fall outside it, and
	// the standing would flip to well above / well below on a rounding error.
	flat := make([]float64, 30)
	for i := range flat {
		flat[i] = 60
	}
	if b := Make(flat); b != nil {
		t.Errorf("a constant series produced a band: %+v", *b)
	}
}

func TestNoValuesNoBand(t *testing.T) {
	if b := Make(nil); b != nil {
		t.Errorf("an empty series produced a band: %+v", *b)
	}
}

// --- The arithmetic ------------------------------------------------------------

func TestTheBandIsTheMeanAndTheSampleDeviation(t *testing.T) {
	// 0…19: mean 9.5, sample SD (n-1) = 5.9160797…  The same vector the Swift test
	// pins, so a change to either side's divisor fails here too.
	b := Make(ramp(20))
	if b == nil {
		t.Fatal("20 measured days must produce a band")
	}
	for _, c := range []struct {
		name string
		got  float64
		want float64
	}{
		{"mean", b.Mean, 9.5},
		{"sd", b.SD, 5.91608},
		{"low", b.Low(), 9.5 - 5.91608},
		{"high", b.High(), 9.5 + 5.91608},
	} {
		if math.Abs(c.got-c.want) > 1e-4 {
			t.Errorf("%s = %v, expected %v", c.name, c.got, c.want)
		}
	}
}

// The population divisor (n) instead of the sample one (n-1) would give 5.7663
// here — close enough to look right and wrong everywhere.
func TestTheDeviationIsNotThePopulationOne(t *testing.T) {
	b := Make(ramp(20))
	if b == nil {
		t.Fatal("expected a band")
	}
	if math.Abs(b.SD-5.76628) < 1e-4 {
		t.Error("sd was computed with the population divisor (n); the band needs the sample one (n-1)")
	}
}

// --- Where a period stands ------------------------------------------------------

func TestTheFiveLevelsSitWhereTheThresholdsSayTheyDo(t *testing.T) {
	b := Baseline{Mean: 100, SD: 10, DayCount: 30}
	for _, c := range []struct {
		value float64
		want  api.MetricBaselineStanding
	}{
		{100, Typical},
		{104, Typical},
		{96, Typical},
		// The near cut is inclusive on the way out: exactly ±0.5 sigma is already
		// above/below. The band's own edges (±1 sigma) are deliberately NOT cut points —
		// a middle level that narrow would flicker on noise alone.
		{105, Above},
		{95, Below},
		{110, Above},
		{90, Below},
		{115, WellAbove},
		{85, WellBelow},
	} {
		if got := b.Standing(c.value); got != c.want {
			t.Errorf("%v → %q, expected %q (z = %.2f)", c.value, got, c.want, b.ZScore(c.value))
		}
	}
}

// --- The reference window --------------------------------------------------------

func TestTheReferenceWindowIsSixtyDaysEndingOnTheAnchor(t *testing.T) {
	loc := mustLoad(t, "Europe/Budapest")
	anchor := time.Date(2026, 8, 27, 14, 0, 0, 0, loc)

	from, to := ReferenceWindow(anchor, loc)
	if got := to.Format("2006-01-02"); got != "2026-08-27" {
		t.Errorf("to = %s, expected 2026-08-27", got)
	}
	// 60 days INCLUSIVE of the anchor day — the same span the phone asks for.
	if got := from.Format("2006-01-02"); got != "2026-06-29" {
		t.Errorf("from = %s, expected 2026-06-29", got)
	}
	if days := int(to.Sub(from).Hours()/24) + 1; days != ReferenceDays {
		t.Errorf("the window is %d days, expected %d", days, ReferenceDays)
	}
}

func TestTheReferenceWindowDoesNotMoveDuringTheDay(t *testing.T) {
	// It feeds a query, and a window that changed every second would miss the summary
	// cache on every request.
	loc := mustLoad(t, "Europe/Budapest")
	morning := time.Date(2026, 8, 27, 6, 0, 0, 0, loc)
	evening := time.Date(2026, 8, 27, 23, 0, 0, 0, loc)

	a1, a2 := ReferenceWindow(morning, loc)
	b1, b2 := ReferenceWindow(evening, loc)
	if !a1.Equal(b1) || !a2.Equal(b2) {
		t.Errorf("morning %s…%s, evening %s…%s — the window must snap to the day", a1, a2, b1, b2)
	}
}

// ⚠️ The heart of it: the window ends where the PERIOD ends, not where today is.
// Browsing back to a month in 2024 and being told it was "above your usual" would
// otherwise mean "above what is usual for you NOW" — a comparison across two years
// wearing the words of one.
func TestTheAnchorIsTheEndOfThePeriodBeingLookedAt(t *testing.T) {
	loc := mustLoad(t, "Europe/Budapest")
	now := time.Date(2026, 8, 27, 9, 30, 0, 0, loc)

	// A month browsed back to in 2024: the exclusive end is the 1st of April.
	past := time.Date(2024, 4, 1, 0, 0, 0, 0, loc)
	if got := Anchor(past, now, loc).Format("2006-01-02"); got != "2024-03-31" {
		t.Errorf("anchor = %s, expected 2024-03-31 (the last day of the period)", got)
	}
	from, _ := ReferenceWindow(Anchor(past, now, loc), loc)
	if got := from.Format("2006-01-02"); got != "2024-02-01" {
		t.Errorf("reference start = %s, expected 2024-02-01", got)
	}
}

func TestAPeriodThatHasNotFinishedIsAnchoredToToday(t *testing.T) {
	// The running week reaches into tomorrow; there is nothing to measure there, and a
	// reference window ending in the future would simply be short of a day.
	loc := mustLoad(t, "Europe/Budapest")
	now := time.Date(2026, 8, 27, 9, 30, 0, 0, loc)
	end := time.Date(2026, 8, 28, 0, 0, 0, 0, loc) // exclusive end = tomorrow

	if got := Anchor(end, now, loc).Format("2006-01-02"); got != "2026-08-27" {
		t.Errorf("anchor = %s, expected today (2026-08-27)", got)
	}
}

// --- Reading the days out of a series ---------------------------------------------

func TestDailyValuesSkipTheUnmeasuredDaysAndKeepTheMeasuredZero(t *testing.T) {
	// ⚠️ The distinction this whole file rests on. A bucket with no value is a day we
	// know nothing about; a bucket carrying 0 is a day that was measured and came out
	// at zero. Reading the first as the second drags the mean down with days the
	// phone spent in a drawer.
	series := api.MetricSeries{Buckets: &[]bucket{
		{V: f32(8000)},
		{},          // no measurement
		{V: f32(0)}, // a measured zero
		{Avg: f32(62.5)},
	}}

	got := DailyValues(series)
	want := []float64{8000, 0, 62.5}
	if len(got) != len(want) {
		t.Fatalf("got %v, expected %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("[%d] = %v, expected %v", i, got[i], want[i])
		}
	}
}

func TestMissingDaysDoNotCountTowardsTheMinimum(t *testing.T) {
	// ⚠️ Twenty buckets, seven of them empty. Counting the BUCKETS would say 20 and
	// draw a band on thirteen days of data.
	buckets := make([]bucket, 20)
	for i := 0; i < 13; i++ {
		buckets[i].V = f32(float64(i))
	}
	values := DailyValues(api.MetricSeries{Buckets: &buckets})
	if len(values) != 13 {
		t.Fatalf("%d measured days, expected 13", len(values))
	}
	if b := Make(values); b != nil {
		t.Error("a band was drawn on 13 measured days out of 20 buckets")
	}
}

// --- The assembled response --------------------------------------------------------

func TestBuildReportsTheBandAndTheStanding(t *testing.T) {
	loc := mustLoad(t, "Europe/Budapest")
	// A reference of 100 ± 10 (twenty days, 90…109 → mean 99.5, sd 5.916) and a period
	// sitting well under it.
	ref := summaryOf("stepCount", "sum", "count", offsetRamp(20, 90))
	period := summaryOf("stepCount", "sum", "count", []float64{80, 82, 84})

	resp := build("week", "Europe/Budapest", Windows{
		From:          time.Date(2026, 8, 21, 0, 0, 0, 0, loc),
		To:            time.Date(2026, 8, 27, 0, 0, 0, 0, loc),
		ReferenceFrom: time.Date(2026, 6, 29, 0, 0, 0, 0, loc),
		ReferenceTo:   time.Date(2026, 8, 27, 0, 0, 0, 0, loc),
	}, ref, period)

	if resp.ReferenceDays == nil || *resp.ReferenceDays != ReferenceDays {
		t.Errorf("reference_days = %v, expected %d", resp.ReferenceDays, ReferenceDays)
	}
	if resp.MinDays == nil || *resp.MinDays != MinReferenceDays {
		t.Errorf("min_days = %v, expected %d", resp.MinDays, MinReferenceDays)
	}
	mb := (*resp.Metrics)["stepCount"]
	if mb.Mean == nil || math.Abs(float64(*mb.Mean)-99.5) > 1e-3 {
		t.Fatalf("mean = %v, expected 99.5", mb.Mean)
	}
	if mb.DayCount == nil || *mb.DayCount != 20 {
		t.Errorf("day_count = %v, expected 20", mb.DayCount)
	}
	if mb.Unit == nil || *mb.Unit != "count" {
		t.Errorf("unit = %v, expected count — it travels with the band, as on /summary", mb.Unit)
	}
	if mb.Agg == nil || *mb.Agg != "sum" {
		t.Errorf("agg = %v, expected sum", mb.Agg)
	}
	// The period's average day (82), not its total (246): a summed week and a summed
	// month could not be compared with each other at all, while their average days can.
	if mb.PeriodValue == nil || math.Abs(float64(*mb.PeriodValue)-82) > 1e-3 {
		t.Fatalf("period_value = %v, expected 82", mb.PeriodValue)
	}
	if mb.Standing == nil || *mb.Standing != WellBelow {
		t.Errorf("standing = %v, expected wellBelow (z = %.2f)", mb.Standing, (82.0-99.5)/5.91608)
	}
}

func TestBuildSaysNothingWhenThereIsNotEnoughYet(t *testing.T) {
	// ⚠️ Below the minimum there is no band — not a wider one, not a guess. The metric
	// still gets an entry, carrying the one number a reader can act on: how many days
	// there are so far.
	ref := summaryOf("hrv", "avg", "ms", offsetRamp(9, 40))
	period := summaryOf("hrv", "avg", "ms", []float64{44, 46})

	resp := build("week", "UTC", Windows{}, ref, period)
	mb := (*resp.Metrics)["hrv"]
	if mb.Mean != nil || mb.Sd != nil || mb.Low != nil || mb.High != nil {
		t.Errorf("a band was reported on 9 days: %+v", mb)
	}
	if mb.Standing != nil {
		t.Errorf("standing = %q without a band — there is no weaker claim to fall back on", *mb.Standing)
	}
	if mb.DayCount == nil || *mb.DayCount != 9 {
		t.Errorf("day_count = %v, expected 9", mb.DayCount)
	}
	// The period's own average is still a fact, and still worth sending.
	if mb.PeriodValue == nil || math.Abs(float64(*mb.PeriodValue)-45) > 1e-3 {
		t.Errorf("period_value = %v, expected 45", mb.PeriodValue)
	}
}

func TestAPeriodWithNoMeasurementHasNoStanding(t *testing.T) {
	// ⚠️ The loudest lie available here would be calling an unmeasured week "typical".
	ref := summaryOf("stepCount", "sum", "count", offsetRamp(20, 90))
	period := summaryOf("stepCount", "sum", "count", nil)

	resp := build("week", "UTC", Windows{}, ref, period)
	mb := (*resp.Metrics)["stepCount"]
	if mb.Mean == nil {
		t.Fatal("the band itself should be there — the reference has 20 days")
	}
	if mb.PeriodValue != nil {
		t.Errorf("period_value = %v, but the period holds no measurement", *mb.PeriodValue)
	}
	if mb.Standing != nil {
		t.Errorf("standing = %q for an unmeasured period", *mb.Standing)
	}
}

// --- helpers ---------------------------------------------------------------------

func mustLoad(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("tz %s: %v", name, err)
	}
	return loc
}

func offsetRamp(n int, from float64) []float64 {
	out := make([]float64, n)
	for i := range out {
		out[i] = from + float64(i)
	}
	return out
}

// summaryOf is a /summary response with one metric, one bucket per value — the
// shape the two windows arrive in.
func summaryOf(name, agg, unit string, values []float64) api.SummaryResponse {
	buckets := make([]bucket, len(values))
	for i, v := range values {
		if agg == "sum" {
			buckets[i].V = f32(v)
		} else {
			buckets[i].Avg = f32(v)
		}
	}
	a := api.MetricSeriesAgg(agg)
	series := map[string]api.MetricSeries{
		name: {Agg: &a, Unit: &unit, Buckets: &buckets},
	}
	return api.SummaryResponse{Metrics: &series}
}
