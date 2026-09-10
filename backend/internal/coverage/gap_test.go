package coverage

import (
	"testing"
	"time"
)

// The gap rules are the app's (`Coverage/MetricGap.swift`), and these tests are
// where that claim is kept honest. Every threshold below is a number that also
// exists in Swift; if one of them moves on only one side, the two devices start
// telling the user different things about the same data.

func day(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// dailyFrom builds n consecutive days ending on `last`.
func dailyFrom(last time.Time, n int) []time.Time {
	out := make([]time.Time, 0, n)
	for i := n - 1; i >= 0; i-- {
		out = append(out, last.AddDate(0, 0, -i))
	}
	return out
}

func TestMedian(t *testing.T) {
	if got := median([]float64{3, 1, 2}); got != 2 {
		t.Errorf("odd count median = %v, expected 2", got)
	}
	if got := median([]float64{4, 1, 2, 3}); got != 2.5 {
		t.Errorf("even count median = %v, expected 2.5", got)
	}
	if got := median(nil); got != 0 {
		t.Errorf("empty median = %v, expected 0", got)
	}
}

// The median and not the mean, and this is the case that decides it: a holiday in
// the middle of an otherwise daily series. The mean interval here is 1.7 days,
// which would push the silence threshold from 3 days out to 6 — and the series
// would have to fall silent for most of a week before anybody was told.
func TestOneHolidayDoesNotMakeADailySeriesLookSparse(t *testing.T) {
	days := append(dailyFrom(day(2026, 3, 1), 15), day(2026, 3, 15), day(2026, 3, 16),
		day(2026, 3, 17), day(2026, 3, 18), day(2026, 3, 19))

	cad, ok := cadenceOf(days)
	if !ok {
		t.Fatal("no cadence from 20 arrivals")
	}
	if cad.typicalIntervalDays != 1 {
		t.Errorf("typical interval = %v, expected 1 (the median of mostly-1-day steps)", cad.typicalIntervalDays)
	}
	if got := cad.silenceThresholdDays(); got != 3 {
		t.Errorf("silence threshold = %d, expected 3 (the floor, since 1×3 = 3)", got)
	}
}

// A metric measured many times a day still ARRIVES on one day. Without collapsing
// duplicates every interval would be 0, the median would be 0, and the cadence
// would be rejected — a heart rate sampled every five minutes would be the one
// metric that could never produce an observation.
func TestSeveralSamplesADayAreStillOneArrival(t *testing.T) {
	var days []time.Time
	for _, d := range dailyFrom(day(2026, 5, 20), 20) {
		days = append(days, d, d, d)
	}
	cad, ok := cadenceOf(days)
	if !ok {
		t.Fatal("no cadence — the duplicate days were not collapsed")
	}
	if cad.typicalIntervalDays != 1 {
		t.Errorf("typical interval = %v, expected 1", cad.typicalIntervalDays)
	}
	if cad.observedIntervals != 19 {
		t.Errorf("observed intervals = %d, expected 19", cad.observedIntervals)
	}
}

// From little data we say nothing, and the quiet answer is the correct one.
func TestNoRhythmIsClaimedFromTooFewArrivals(t *testing.T) {
	// Six arrivals = five intervals, one short of the floor.
	if _, ok := cadenceOf(dailyFrom(day(2026, 5, 20), 6)); ok {
		t.Error("a rhythm was claimed from five intervals")
	}
	// Seven daily arrivals clear the interval floor but span only six days: that
	// describes a week, not a habit.
	if _, ok := cadenceOf(dailyFrom(day(2026, 5, 20), 7)); ok {
		t.Error("a rhythm was claimed from a single week of history")
	}
	if _, ok := cadenceOf(nil); ok {
		t.Error("a rhythm was claimed from no data at all")
	}
}

// Rarer than monthly: the window cannot hold enough intervals for the median to
// mean anything, so nothing is said.
func TestACadenceCoarserThanMonthlyIsNotJudged(t *testing.T) {
	var days []time.Time
	for i := range 8 {
		days = append(days, day(2024, 1, 1).AddDate(0, 0, i*40))
	}
	if _, ok := cadenceOf(days); ok {
		t.Error("a 40-day cadence was judged")
	}
}

func TestADailyMetricGoesQuietAfterThreeDays(t *testing.T) {
	last := day(2026, 6, 1)
	days := dailyFrom(last, 30)

	if _, ok := gapOf(days, last.AddDate(0, 0, 2)); ok {
		t.Error("two silent days produced an observation — a daily metric skips a day all the time")
	}
	g, ok := gapOf(days, last.AddDate(0, 0, 3))
	if !ok {
		t.Fatal("three silent days produced no observation")
	}
	if g.silentDays != 3 {
		t.Errorf("silent days = %d, expected 3", g.silentDays)
	}
}

// Three missed occasions, not one. A weekly metric may be a fortnight late
// without anybody being told.
func TestAWeeklyMetricNeedsThreeMissedWeeks(t *testing.T) {
	var days []time.Time
	for i := range 10 {
		days = append(days, day(2026, 1, 5).AddDate(0, 0, i*7))
	}
	last := days[len(days)-1]

	if _, ok := gapOf(days, last.AddDate(0, 0, 14)); ok {
		t.Error("a fortnight of silence produced an observation for a weekly metric")
	}
	g, ok := gapOf(days, last.AddDate(0, 0, 21))
	if !ok {
		t.Fatal("three missed weeks produced no observation")
	}
	if g.cadence.typicalIntervalDays != 7 {
		t.Errorf("typical interval = %v, expected 7", g.cadence.typicalIntervalDays)
	}
	if got := g.cadence.silenceThresholdDays(); got != 21 {
		t.Errorf("silence threshold = %d, expected 21", got)
	}
}

// Above ninety days the metric is not silent, it is discontinued — and asking
// again is nagging, not a question. The row still carries its last day, so
// nothing is hidden by this.
func TestAnAbandonedMetricStopsProducingObservations(t *testing.T) {
	last := day(2026, 1, 1)
	days := dailyFrom(last, 30)

	if _, ok := gapOf(days, last.AddDate(0, 0, 90)); !ok {
		t.Error("ninety days is still within the reporting range")
	}
	if _, ok := gapOf(days, last.AddDate(0, 0, 91)); ok {
		t.Error("an observation was produced after ninety-one silent days")
	}
}

// The trailing silence is what is being MEASURED, not one of the intervals it is
// measured against. If it were fed back into the cadence, every long gap would
// partly justify itself — and the longer it grew, the quieter the report would get.
func TestTheTrailingSilenceDoesNotWidenTheCadence(t *testing.T) {
	last := day(2026, 4, 1)
	days := dailyFrom(last, 30)

	g, ok := gapOf(days, last.AddDate(0, 0, 20))
	if !ok {
		t.Fatal("no observation after twenty silent days")
	}
	if g.cadence.typicalIntervalDays != 1 {
		t.Errorf("typical interval = %v — the silence leaked into the cadence", g.cadence.typicalIntervalDays)
	}
	if g.cadence.observedIntervals != 29 {
		t.Errorf("observed intervals = %d, expected 29", g.cadence.observedIntervals)
	}
}

// Rounded up: at a 2.5-day median the threshold is 8 days, not 7.5. Nobody can be
// told they are half a day overdue for anything.
func TestTheSilenceThresholdRoundsUp(t *testing.T) {
	c := cadence{typicalIntervalDays: 2.5}
	if got := c.silenceThresholdDays(); got != 8 {
		t.Errorf("threshold = %d, expected 8", got)
	}
	// …and the floor wins for anything that arrives more often than daily.
	c = cadence{typicalIntervalDays: 0.5}
	if got := c.silenceThresholdDays(); got != 3 {
		t.Errorf("threshold = %d, expected the 3-day floor", got)
	}
}

// The days come out of a `::date` cast, i.e. midnight UTC stand-ins for a local
// day. Anything that arrives with a time on it must land on the same day anyway —
// otherwise a metric would appear to arrive twice on one day, or an interval
// would come out as 0.96 of a day and round wrong.
func TestTimestampsAreReducedToTheirCalendarDay(t *testing.T) {
	base := day(2026, 7, 4)
	noisy := []time.Time{
		base.Add(6 * time.Hour),
		base.Add(23 * time.Hour),
		base.AddDate(0, 0, 1).Add(30 * time.Minute),
	}
	got := distinctSortedDays(noisy)
	if len(got) != 2 {
		t.Fatalf("distinct days = %d, expected 2", len(got))
	}
	if !got[0].Equal(base) || !got[1].Equal(base.AddDate(0, 0, 1)) {
		t.Errorf("days = %v, expected %v and the next day", got, base)
	}
}
