package summary

import (
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
)

// The metric catalog's tests live in the internal/metrics package — what is here
// belongs to the summary read path: building the buckets and computing the total.

func f64(v float64) *float64 { return &v }

func seriesOf(buckets []bkt) *api.MetricSeries { return &api.MetricSeries{Buckets: &buckets} }

// Percentage metrics go out as 0…100 on the wire (docs/23 §3.0.1). The conversion
// has to happen while building the buckets, ONCE — the total derives from them, and
// Redis already stores the converted response.
func TestMakeBucketScalesPercentValues(t *testing.T) {
	ts := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)

	b := makeBucket("bodyFatPercentage", metrics.Avg, ts, nil, f64(0.19238333), f64(0.19), f64(0.195))
	if b.Avg == nil || !close32(*b.Avg, 19.238333) {
		t.Errorf("avg = %v, expected ~19.238", b.Avg)
	}
	if b.Min == nil || !close32(*b.Min, 19.0) {
		t.Errorf("min = %v, expected 19.0", b.Min)
	}
	if b.Max == nil || !close32(*b.Max, 19.5) {
		t.Errorf("max = %v, expected 19.5", b.Max)
	}

	// There is no summed percentage in the catalog, but the sum branch must not be
	// left unconverted either.
	b = makeBucket("oxygenSaturation", metrics.Sum, ts, f64(0.97), nil, nil, nil)
	if b.V == nil || !close32(*b.V, 97) {
		t.Errorf("v = %v, expected 97", b.V)
	}
}

func TestMakeBucketLeavesNonPercentMetricsAlone(t *testing.T) {
	ts := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)

	b := makeBucket("stepCount", metrics.Sum, ts, f64(8412), nil, nil, nil)
	if b.V == nil || !close32(*b.V, 8412) {
		t.Errorf("v = %v, expected 8412", b.V)
	}
	if b.Avg != nil || b.Min != nil || b.Max != nil {
		t.Error("a sum bucket must not fill in the avg/min/max fields")
	}

	b = makeBucket("heartRate", metrics.Avg, ts, nil, f64(62.5), f64(48), f64(154))
	if b.Avg == nil || !close32(*b.Avg, 62.5) {
		t.Errorf("avg = %v, expected 62.5", b.Avg)
	}
	if b.V != nil {
		t.Error("an avg bucket must not fill in the v field")
	}
}

// A NULL aggregate (no data in the bucket) must stay an absent field, not a 0 —
// "zero steps" and "no measurement" are not the same thing.
func TestMakeBucketKeepsNullsAbsent(t *testing.T) {
	b := makeBucket("stepCount", metrics.Sum, time.Now(), nil, nil, nil, nil)
	if b.V != nil {
		t.Errorf("NULL sum → %v, but the field should be absent", *b.V)
	}
	if b.T == nil {
		t.Error("a bucket's timestamp may never be missing")
	}
}

// The total is computed from the ALREADY scaled buckets — it must not be converted
// a second time.
func TestSetTotalUsesAlreadyScaledBuckets(t *testing.T) {
	ts := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	buckets := []bkt{
		makeBucket("bodyFatPercentage", metrics.Avg, ts, nil, f64(0.19), nil, nil),
		makeBucket("bodyFatPercentage", metrics.Avg, ts.AddDate(0, 0, 1), nil, f64(0.21), nil, nil),
	}
	ms := seriesOf(buckets)
	setTotal(ms, metrics.Avg)
	if ms.Total == nil || !close32(*ms.Total, 20) {
		t.Errorf("total = %v, expected 20 (the average of 19 and 21)", ms.Total)
	}
}

func TestSetTotalSumsCumulativeBuckets(t *testing.T) {
	ts := time.Date(2026, 8, 10, 0, 0, 0, 0, time.UTC)
	buckets := []bkt{
		makeBucket("stepCount", metrics.Sum, ts, f64(4000), nil, nil, nil),
		makeBucket("stepCount", metrics.Sum, ts.AddDate(0, 0, 1), f64(6000), nil, nil, nil),
		// A day without data: it must not spoil the sum, nor count towards the average.
		makeBucket("stepCount", metrics.Sum, ts.AddDate(0, 0, 2), nil, nil, nil, nil),
	}
	ms := seriesOf(buckets)
	setTotal(ms, metrics.Sum)
	if ms.Total == nil || !close32(*ms.Total, 10000) {
		t.Errorf("total = %v, expected 10000", ms.Total)
	}
}

func TestWindowRanges(t *testing.T) {
	loc := time.UTC
	for _, c := range []struct {
		rng     string
		bucket  string
		spanDay int
	}{
		{"day", "1 hour", 1},
		{"week", "1 day", 7},
		{"month", "1 day", 30},
		{"", "1 day", 7}, // an unknown range → the weekly default, not an error
	} {
		bucket, start, end := window(Request{Range: c.rng, TZ: "UTC"}, loc)
		if bucket != c.bucket {
			t.Errorf("%q: bucket = %q, expected %q", c.rng, bucket, c.bucket)
		}
		if got := int(end.Sub(start).Hours() / 24); got != c.spanDay {
			t.Errorf("%q: window = %d days, expected %d", c.rng, got, c.spanDay)
		}
	}
}

// from/to override range, and the `to` day IS inside the window (a half-open end).
func TestWindowHonoursExplicitFromTo(t *testing.T) {
	from := time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 8, 3, 0, 0, 0, 0, time.UTC)
	_, start, end := window(Request{Range: "week", TZ: "UTC", From: &from, To: &to}, time.UTC)
	if !start.Equal(from) {
		t.Errorf("start = %v, expected %v", start, from)
	}
	if want := to.AddDate(0, 0, 1); !end.Equal(want) {
		t.Errorf("end = %v, expected %v (the `to` day is included)", end, want)
	}
}

func close32(got float32, want float64) bool {
	d := float64(got) - want
	if d < 0 {
		d = -d
	}
	return d < 1e-3
}

// "0 steps" and "no data" are two different statements. If the server returns zero
// in the absence of a measurement, the client cannot tell them apart — and in a
// health app one of them is alarming while the other is perfectly normal.
func TestTotalIsAbsentWhenNothingWasMeasured(t *testing.T) {
	ts := time.Date(2026, 8, 11, 0, 0, 0, 0, time.UTC)

	// An empty window: the buckets are there, but none of them holds a value.
	empty := []bkt{
		makeBucket("stepCount", metrics.Sum, ts, nil, nil, nil, nil),
		makeBucket("stepCount", metrics.Sum, ts.Add(time.Hour), nil, nil, nil, nil),
	}
	ms := seriesOf(empty)
	setTotal(ms, metrics.Sum)
	if ms.Total != nil {
		t.Errorf("without a measurement total = %v, but the field should be absent", *ms.Total)
	}

	// A genuine zero, on the other hand, is a REAL zero: if the measurement happened
	// and came out as 0, that has to be shown.
	real := []bkt{makeBucket("stepCount", metrics.Sum, ts, f64(0), nil, nil, nil)}
	ms = seriesOf(real)
	setTotal(ms, metrics.Sum)
	if ms.Total == nil || *ms.Total != 0 {
		t.Errorf("a measured zero total = %v, expected 0", ms.Total)
	}
}

// The "requested but data-less metric" branch used to write an explicit zero into
// the total, cancelling out setTotal's missing-total logic. The meaning of total
// has to be the same on both paths — otherwise one branch quietly asserts something
// else.
func TestRequestedMetricWithNoRowsHasNoTotalEither(t *testing.T) {
	out := map[string]api.MetricSeries{}
	req := Request{Metrics: []string{"stepCount", "dietaryEnergyConsumed"}}
	fillMissingSeries(out, req)

	for _, name := range req.Metrics {
		ms, ok := out[name]
		if !ok {
			t.Fatalf("%s: the series is missing", name)
		}
		if ms.Total != nil {
			t.Errorf("%s: total = %v, but without data the field should be absent", name, *ms.Total)
		}
		if ms.Unit == nil || *ms.Unit == "" {
			t.Errorf("%s: the unit is required even without data", name)
		}
	}
}
