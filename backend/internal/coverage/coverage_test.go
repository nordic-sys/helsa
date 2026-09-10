package coverage

import (
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
)

// What is tested here is the ROW BUILDER, not the SQL: the three queries hand
// their findings to `build`, and every claim the report makes is decided there.

func rowFor(rows []api.CoverageType, dataType string) *api.CoverageType {
	for i := range rows {
		if rows[i].DataType != nil && *rows[i].DataType == dataType {
			return &rows[i]
		}
	}
	return nil
}

func stateOf(t *testing.T, r *api.CoverageType) string {
	t.Helper()
	if r == nil || r.State == nil {
		t.Fatal("the row has no state")
	}
	return string(*r.State)
}

// The whole catalog is reported, always. A completeness report that only listed
// the types that happen to work would be unable to answer the question it exists
// for: which whole areas are empty.
func TestEveryCatalogTypeGetsARow(t *testing.T) {
	rows := build(map[string]*observation{}, day(2026, 6, 1))
	if len(rows) != metrics.Len() {
		t.Fatalf("rows = %d, expected the whole catalog (%d)", len(rows), metrics.Len())
	}
	for _, name := range metrics.Ordered() {
		if rowFor(rows, name) == nil {
			t.Errorf("%s is missing from the report", name)
		}
	}
	if rows[0].DataType == nil || *rows[0].DataType != metrics.Ordered()[0] {
		t.Error("the rows do not follow the catalog order")
	}
}

// ⛔ THE most important test in this package: a missing measurement is never a
// zero. "0 days measured" claims we looked at every day of the year and found
// nothing; an absent field says we have nothing to report. In a health app those
// are different sentences, and only one of them is alarming.
func TestNothingArrivedMeansAbsentFieldsNotZeroes(t *testing.T) {
	rows := build(map[string]*observation{}, day(2026, 6, 1))
	r := rowFor(rows, "bodyMass")

	if got := stateOf(t, r); got != stateNeverArrived {
		t.Errorf("state = %q, expected %q", got, stateNeverArrived)
	}
	if r.MeasuredDays != nil {
		t.Errorf("measured_days = %d — a metric that brought nothing must not report a count", *r.MeasuredDays)
	}
	if r.SampleCount != nil {
		t.Errorf("sample_count = %d — same rule", *r.SampleCount)
	}
	if r.LastDay != nil {
		t.Error("last_day was filled in for a type that has never arrived")
	}
	if r.Sources != nil {
		t.Error("sources was filled in for a type that has never arrived")
	}
	if r.Gap != nil {
		t.Error("a metric with no data cannot have a broken rhythm")
	}
}

// The three states, and the one distinction the server can genuinely make that a
// plain "is there data in the window" cannot: a metric that stopped BEFORE the
// window has a date the user recognises; one that never got here has nothing to say.
func TestTheThreeStates(t *testing.T) {
	lastDay := day(2026, 6, 30)
	obs := map[string]*observation{
		"stepCount": {
			days:        dailyFrom(lastDay, 30),
			samples:     900,
			everLastDay: lastDay,
		},
		"bodyMass": {
			// Nothing in the window, but it used to arrive.
			everLastDay: day(2025, 11, 3),
		},
	}
	rows := build(obs, lastDay)

	if got := stateOf(t, rowFor(rows, "stepCount")); got != stateMeasured {
		t.Errorf("stepCount state = %q, expected %q", got, stateMeasured)
	}

	weight := rowFor(rows, "bodyMass")
	if got := stateOf(t, weight); got != stateOutsideWindow {
		t.Errorf("bodyMass state = %q, expected %q", got, stateOutsideWindow)
	}
	if weight.LastDay == nil || !weight.LastDay.Equal(day(2025, 11, 3)) {
		t.Error("an outside-window row must still carry the day it last arrived")
	}
	if weight.MeasuredDays != nil {
		t.Error("an outside-window row must not report measured days inside the window")
	}

	if got := stateOf(t, rowFor(rows, "vo2Max")); got != stateNeverArrived {
		t.Errorf("vo2Max state = %q, expected %q", got, stateNeverArrived)
	}
}

// `last_day` on a measured row is the last day INSIDE the window, not the
// all-time one — otherwise a row would report a count for one period and a date
// from another, and the two would silently disagree.
func TestAMeasuredRowReportsTheWindowsOwnLastDay(t *testing.T) {
	lastDay := day(2026, 6, 30)
	obs := map[string]*observation{
		"heartRate": {
			days:        []time.Time{day(2026, 6, 10), day(2026, 6, 12)},
			samples:     42,
			everLastDay: day(2026, 6, 12),
		},
	}
	r := rowFor(build(obs, lastDay), "heartRate")
	if r.LastDay == nil || !r.LastDay.Equal(day(2026, 6, 12)) {
		t.Errorf("last_day = %v, expected 2026-06-12", r.LastDay)
	}
	if r.MeasuredDays == nil || *r.MeasuredDays != 2 {
		t.Errorf("measured_days = %v, expected 2", r.MeasuredDays)
	}
	if r.SampleCount == nil || *r.SampleCount != 42 {
		t.Errorf("sample_count = %v, expected 42", r.SampleCount)
	}
}

// A type the catalog does not know still gets a row. `data_type` is an open
// string on purpose, and a metric from a newer iOS release dropping out of a
// COMPLETENESS report is the exact bug this feature exists to prevent.
func TestAnUnknownTypeIsReportedAndFlagged(t *testing.T) {
	lastDay := day(2026, 6, 30)
	obs := map[string]*observation{
		"someFutureAppleMetric": {days: []time.Time{lastDay}, samples: 1, everLastDay: lastDay},
	}
	rows := build(obs, lastDay)
	if len(rows) != metrics.Len()+1 {
		t.Fatalf("rows = %d, expected the catalog plus one", len(rows))
	}

	r := rowFor(rows, "someFutureAppleMetric")
	if r == nil {
		t.Fatal("the unknown type is missing from the report")
	}
	if r.InCatalog == nil || *r.InCatalog {
		t.Error("the unknown type was not flagged as outside the catalog")
	}
	if r.Group == nil || *r.Group != api.CoverageTypeGroup(metrics.GroupOther) {
		t.Errorf("unknown type group = %v, expected other", r.Group)
	}
	// …and it goes AFTER the catalog, so the known list keeps its order.
	if rows[len(rows)-1].DataType == nil || *rows[len(rows)-1].DataType != "someFutureAppleMetric" {
		t.Error("the unknown type was not appended after the catalog")
	}

	known := rowFor(rows, "stepCount")
	if known.InCatalog == nil || !*known.InCatalog {
		t.Error("a catalog type was not flagged as being in the catalog")
	}
}

// The gap rides along with the row it belongs to, and only a metric that has data
// can have a broken rhythm.
func TestABrokenRhythmReachesTheRow(t *testing.T) {
	lastArrival := day(2026, 6, 1)
	obs := map[string]*observation{
		"restingHeartRate": {
			days:        dailyFrom(lastArrival, 40),
			samples:     40,
			everLastDay: lastArrival,
		},
	}
	r := rowFor(build(obs, lastArrival.AddDate(0, 0, 10)), "restingHeartRate")
	if r.Gap == nil {
		t.Fatal("a daily metric silent for ten days produced no observation")
	}
	if r.Gap.SilentDays == nil || *r.Gap.SilentDays != 10 {
		t.Errorf("silent_days = %v, expected 10", r.Gap.SilentDays)
	}
	if r.Gap.TypicalIntervalDays == nil || *r.Gap.TypicalIntervalDays != 1 {
		t.Errorf("typical_interval_days = %v, expected 1", r.Gap.TypicalIntervalDays)
	}
	if r.Gap.ObservedIntervals == nil || *r.Gap.ObservedIntervals != 39 {
		t.Errorf("observed_intervals = %v, expected 39", r.Gap.ObservedIntervals)
	}
}

// Most metrics have no rhythm to break, and about those we say nothing at all.
func TestAMetricThatArrivesNormallyHasNoGap(t *testing.T) {
	lastDay := day(2026, 6, 30)
	obs := map[string]*observation{
		"stepCount": {days: dailyFrom(lastDay, 60), samples: 600, everLastDay: lastDay},
	}
	if r := rowFor(build(obs, lastDay), "stepCount"); r.Gap != nil {
		t.Error("a metric that arrived today was reported as silent")
	}
}

// Biggest contributor first, and the tie-break is stable — two equally busy
// sources must not swap places between two reloads of the same page.
func TestSourcesAreOrderedByContribution(t *testing.T) {
	n := func(v int) *int { return &v }
	s := func(v string) *string { return &v }
	sources := []api.CoverageSource{
		{BundleId: s("com.example.scale"), SampleCount: n(4)},
		{BundleId: s("com.nordic-sys.Helsa"), SampleCount: n(90)},
		{BundleId: s("com.example.a"), SampleCount: n(4)},
	}
	sortSources(sources)

	if *sources[0].BundleId != "com.nordic-sys.Helsa" {
		t.Errorf("first source = %q, expected the biggest contributor", *sources[0].BundleId)
	}
	if *sources[1].BundleId != "com.example.a" || *sources[2].BundleId != "com.example.scale" {
		t.Error("the tie was not broken by bundle identifier")
	}
}

// A source that arrived without a bundle identifier or without a device kind stays
// in the list. An absence there means "the client did not say", and dropping the
// row would turn that into a claim that the samples had no source at all.
func TestASourceWithoutABundleIdIsStillASource(t *testing.T) {
	n := func(v int) *int { return &v }
	s := func(v string) *string { return &v }
	sources := []api.CoverageSource{
		{SampleCount: n(7)},
		{BundleId: s("com.nordic-sys.Helsa"), SampleCount: n(3)},
	}
	sortSources(sources)
	if sources[0].BundleId != nil {
		t.Error("the nameless source lost its place despite writing the most samples")
	}
}
