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

// The timing and workout rules E2E. What is worth proving here, and cannot be
// proved by a unit test, is the SQL underneath them: that a night's first start
// and last end survive the "start minus 12 hours" grouping, and that a workout's
// average heart rate is resolved from samples the client could only tag with an
// HKWorkout.uuid.
func TestTimingAndWorkoutInsightsFromSeededHistory(t *testing.T) {
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
	dayAt := func(daysAgo int, minutes float64) time.Time {
		return today.AddDate(0, 0, -daysAgo).Add(time.Duration(minutes) * time.Minute)
	}

	// 28 nights, every one exactly 8 hours long, but the free nights (those
	// STARTING on a Friday or a Saturday) begin two hours later. The length is
	// perfectly steady, so only a rule that looks at the timing can see anything
	// at all.
	var sleeps []api.SleepSegmentIn
	for d := 28; d >= 1; d-- {
		startMin := 23 * 60.0
		if wd := today.AddDate(0, 0, -d).Weekday(); wd == time.Friday || wd == time.Saturday {
			startMin += 120
		}
		start := dayAt(d, startMin)
		sleeps = append(sleeps, api.SleepSegmentIn{
			SourceUuid: fmt.Sprintf("%s-tim-sl-%d", sub, d),
			StartedAt:  start.UTC(),
			EndedAt:    start.Add(8 * time.Hour).UTC(),
			Stage:      api.SleepSegmentInStage("asleepCore"),
		})
	}

	// Workouts. The strength sessions carry the training load; the runs carry the
	// pace, 8 km in 40 minutes now against 8 km in 44 minutes a month ago, at a
	// heart rate one beat apart.
	var workouts []api.WorkoutIn
	var samples []api.SampleIn
	addWorkout := func(daysAgo int, activity string, mins float64, distance, hr *float32) {
		uuid := fmt.Sprintf("%s-tim-wo-%s-%d", sub, activity, daysAgo)
		start := dayAt(daysAgo, 17*60)
		end := start.Add(time.Duration(mins) * time.Minute)
		workouts = append(workouts, api.WorkoutIn{
			SourceUuid: uuid, ActivityType: activity,
			StartedAt: start.UTC(), EndedAt: &end, TotalDistanceM: distance,
		})
		if hr == nil {
			return
		}
		// The heart rate is a SAMPLE tagged with the workout's HealthKit uuid —
		// the client has no other handle on it. The worker resolves the link.
		unit := "count/min"
		samples = append(samples, api.SampleIn{
			SourceUuid: uuid + "-hr", DataType: "heartRate", Ts: start.Add(time.Minute).UTC(),
			Value: hr, Unit: &unit, WorkoutSourceUuid: &uuid,
		})
	}

	// Three quiet weeks of two strength sessions, then four in the last week.
	for _, d := range []int{28, 27, 21, 20, 14, 13} {
		addWorkout(d, "traditionalStrengthTraining", 45, nil, nil)
	}
	for _, d := range []int{7, 5, 3, 2} {
		addWorkout(d, "traditionalStrengthTraining", 60, nil, nil)
	}
	dist, recentHR, prevHR := float32(8000), float32(150), float32(149)
	for _, d := range []int{27, 24, 17, 10, 3} {
		addWorkout(d, "running", 40, &dist, &recentHR)
	}
	for _, d := range []int{55, 52, 45, 38, 31} {
		addWorkout(d, "running", 44, &dist, &prevHR)
	}

	tzc := tz
	if st := c.do(t, http.MethodPost, "/v1/ingest", token, api.IngestBatch{
		TimeZone: &tzc, Workouts: &workouts, Samples: &samples, SleepSegments: &sleeps,
	}, nil); st != http.StatusAccepted {
		t.Fatalf("ingest status=%d (expected 202)", st)
	}

	want := []string{"sleep-midpoint-weekend", "training-load-jump", "efficiency-trend-running"}
	var got []api.Insight
	ids := map[string]api.Insight{}
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		got = nil
		if st := c.do(t, http.MethodGet, "/v1/insights", token, nil, &got); st != http.StatusOK {
			t.Fatalf("insights status=%d", st)
		}
		ids = map[string]api.Insight{}
		for _, ins := range got {
			if ins.Id == nil {
				t.Fatal("insight without an identifier")
			}
			ids[strings.SplitN(*ins.Id, ":", 2)[0]] = ins
		}
		if len(ids) >= len(want) {
			break
		}
		time.Sleep(400 * time.Millisecond)
	}
	for _, w := range want {
		if _, ok := ids[w]; !ok {
			t.Fatalf("missing insight: %s (we got: %v)", w, keysOf(ids))
		}
	}

	// The weekend shift is two hours, and it has to come back as two hours: if the
	// night grouping cut a 01:00 bedtime off at midnight, this is where it shows.
	jetlag := ids["sleep-midpoint-weekend"]
	if jetlag.Title == nil || !strings.Contains(*jetlag.Title, "120 perccel később") {
		t.Errorf("unexpected social jetlag title: %s", deref(jetlag.Title))
	}
	// An unvarying 8-hour night is not irregular, however late it starts.
	if _, ok := ids["sleep-regularity"]; ok {
		t.Errorf("a steady 8-hour night was reported as irregular: %s", deref(ids["sleep-regularity"].Title))
	}
	// The efficiency rule only speaks when the heart rate came back from the
	// sample→workout resolution; without that it stays silent, so this assertion
	// is really a test of the join.
	eff := ids["efficiency-trend-running"]
	if eff.Detail == nil || !strings.Contains(*eff.Detail, "150.0 bpm") {
		t.Errorf("the efficiency explanation does not cite the resolved heart rate: %s", deref(eff.Detail))
	}
	// And the load figure must keep saying what it is not.
	load := ids["training-load-jump"]
	if load.Detail == nil || !strings.Contains(*load.Detail, "nem sérülés-előrejelzés") {
		t.Errorf("the training load explanation dropped its qualifier: %s", deref(load.Detail))
	}

	t.Logf("✓ timing/workout insights E2E: %d observations (%v)", len(got), keysOf(ids))
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
