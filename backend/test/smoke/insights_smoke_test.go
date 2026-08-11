//go:build smoke

// The E2E of the rule-based insights: the observations have to be born out of
// SYNTHETIC history uploaded through the real ingest path. The unit tests guard the
// mathematics of the rules; this one guards that the database-side daily bucketing,
// the timezone handling and the night grouping of sleep are correct too — none of
// which is visible except against a live Timescale.
package smoke

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

func TestInsightsFromSeededHistory(t *testing.T) {
	e := newEnv(t)
	c, token, sub := e.client, e.token, e.appleSub

	const tz = "Europe/Budapest"
	loc, err := time.LoadLocation(tz)
	must(t, err, "tz")
	tzp := tz
	if st := c.do(t, http.MethodPut, "/v1/settings", token, api.Settings{TimeZone: &tzp}, nil); st != http.StatusOK {
		t.Fatalf("settings status=%d", st)
	}

	now := time.Now().In(loc)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	// dayAt: a given hour of the day `daysAgo` days before today, in the user's tz.
	dayAt := func(daysAgo, hour int) time.Time {
		return today.AddDate(0, 0, -daysAgo).Add(time.Duration(hour) * time.Hour)
	}

	var samples []api.SampleIn
	seq := 0
	add := func(dataType, unit string, ts time.Time, v float32) {
		seq++
		val := v
		samples = append(samples, api.SampleIn{
			SourceUuid: fmt.Sprintf("%s-ins-%d", sub, seq),
			DataType:   dataType,
			Ts:         ts.UTC(),
			Value:      &val,
			Unit:       &unit,
		})
	}

	// Resting heart rate: 32 days of stable, slightly fluctuating history (this is the
	// baseline), then 3 consecutive, sustainedly higher days. Today is deliberately
	// empty — the rule leaves it out anyway.
	for d := 35; d >= 4; d-- {
		v := float32(55)
		if d%2 == 0 {
			v = 56
		}
		add("restingHeartRate", "count/min", dayAt(d, 8), v)
	}
	for _, d := range []int{3, 2, 1} {
		add("restingHeartRate", "count/min", dayAt(d, 8), 63)
	}

	// Step count: 20 days. The last week is much higher than the previous one → a
	// weekly trend.
	stepsFor := func(d int) float32 {
		switch {
		case d <= 7:
			return 9000
		case d <= 14:
			return 4000
		default:
			return 6000
		}
	}
	for d := 20; d >= 1; d-- {
		add("stepCount", "count", dayAt(d, 12), stepsFor(d))
	}

	// Sleep: every night starts at 23:00 and its length moves together with THAT DAY's
	// step count → the correlation rule will have something to find. 20 nights >
	// MinCorrelationPairs.
	var sleeps []api.SleepSegmentIn
	for d := 20; d >= 1; d-- {
		hours := 5 + float64(stepsFor(d))/4500
		start := dayAt(d, 23)
		sleeps = append(sleeps, api.SleepSegmentIn{
			SourceUuid: fmt.Sprintf("%s-ins-sl-%d", sub, d),
			StartedAt:  start.UTC(),
			EndedAt:    start.Add(time.Duration(hours * float64(time.Hour))).UTC(),
			Stage:      api.SleepSegmentInStage("asleepCore"),
		})
	}

	tzc := tz
	if st := c.do(t, http.MethodPost, "/v1/ingest", token, api.IngestBatch{
		TimeZone: &tzc, Samples: &samples, SleepSegments: &sleeps,
	}, nil); st != http.StatusAccepted {
		t.Fatalf("ingest status=%d (expected 202)", st)
	}

	// The worker runs asynchronously: poll until the insights show up.
	var got []api.Insight
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		got = nil
		if st := c.do(t, http.MethodGet, "/v1/insights", token, nil, &got); st != http.StatusOK {
			t.Fatalf("insights status=%d", st)
		}
		if len(got) >= 3 {
			break
		}
		time.Sleep(400 * time.Millisecond)
	}

	ids := map[string]api.Insight{}
	for _, ins := range got {
		if ins.Id == nil {
			t.Fatal("insight without an identifier")
		}
		ids[strings.SplitN(*ins.Id, ":", 2)[0]] = ins
	}
	for _, want := range []string{"resting-hr-elevated", "steps-weekly-trend", "steps-sleep-correlation"} {
		if _, ok := ids[want]; !ok {
			t.Fatalf("missing insight: %s (we got: %v)", want, keysOf(ids))
		}
	}

	// The resting heart rate rose by ~7 bpm — the explanation must cite the real
	// averages.
	hr := ids["resting-hr-elevated"]
	if hr.Detail == nil || !strings.Contains(*hr.Detail, "63.0 bpm") {
		t.Errorf("the HR explanation does not state the recent average: %s", deref(hr.Detail))
	}
	if hr.Severity == nil || *hr.Severity != "notice" {
		t.Errorf("HR severity = %v", hr.Severity)
	}
	// The insight text is user-facing product copy and stays Hungarian; the label
	// carries the definite article, which Hungarian picks by the following sound
	// ("A nyugalmi pulzusod", but "Az éjszakai alvásod").
	if hr.Title == nil || !strings.HasPrefix(*hr.Title, "A nyugalmi pulzusod") {
		t.Errorf("HR title = %s", deref(hr.Title))
	}
	// The weekly trend is +125% (4000 → 9000).
	trend := ids["steps-weekly-trend"]
	if trend.Title == nil || !strings.Contains(*trend.Title, "125%") {
		t.Errorf("unexpected trend title: %s", deref(trend.Title))
	}
	t.Logf("✓ insights E2E: %d observations from the real ingest path (%v)", len(got), keysOf(ids))
	for _, ins := range got {
		t.Logf("   • [%s] %s — %s", *ins.Kind, *ins.Title, *ins.Detail)
	}
}

func deref(s *string) string {
	if s == nil {
		return "<nil>"
	}
	return *s
}

func keysOf(m map[string]api.Insight) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
