//go:build smoke

// The E2E smoke test against the RUNNING local infrastructure (deploy/:
// TimescaleDB/Redis/RabbitMQ).
// Run it with: `make smoke`  or  `HELSA_AUTH_DEV_MODE=true go test -tags smoke ./test/smoke -v`.
//
// It checks the whole critical path: device token → POST /v1/ingest (queue) → the
// worker processes it → GET /v1/summary (timezone-aware) returns the aggregate.
package smoke

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

func TestSmoke(t *testing.T) {
	// --- 1) Session ---
	e := newEnv(t)
	c, token, appleSub := e.client, e.token, e.appleSub
	t.Logf("✓ session: device token obtained (sub=%s)", appleSub)

	// --- 2) POST + GET /v1/devices (registration, heartbeat, upsert) ---
	const tz = "Europe/Budapest"
	tzDev := tz
	var dev api.Device
	if st := c.do(t, http.MethodPost, "/v1/devices", token, api.Device{
		Platform: "ios", Model: ptr("iPhone17,1"), Name: ptr("Bob iPhone"), TimeZone: &tzDev,
	}, &dev); st != http.StatusOK {
		t.Fatalf("POST devices status=%d", st)
	}
	if dev.Id == nil || dev.LastSeenAt == nil || dev.Model == nil || *dev.Model != "iPhone17,1" {
		t.Fatalf("unexpected device: %+v", dev)
	}
	firstSeen := *dev.LastSeenAt

	// The same (platform, model) WITHOUT an id → the same row, a fresher last_seen_at.
	var again api.Device
	if st := c.do(t, http.MethodPost, "/v1/devices", token, api.Device{
		Platform: "ios", Model: ptr("iPhone17,1"),
	}, &again); st != http.StatusOK {
		t.Fatalf("POST devices (heartbeat) status=%d", st)
	}
	if again.Id == nil || *again.Id != *dev.Id {
		t.Fatalf("the heartbeat created a new device: %+v vs %+v", again.Id, dev.Id)
	}
	if again.Name == nil || *again.Name != "Bob iPhone" {
		t.Fatalf("the heartbeat overwrote the name: %+v", again)
	}
	if again.LastSeenAt.Before(firstSeen) {
		t.Fatalf("last_seen_at moved backwards: %v → %v", firstSeen, *again.LastSeenAt)
	}
	var devs []api.Device
	if st := c.do(t, http.MethodGet, "/v1/devices", token, nil, &devs); st != http.StatusOK {
		t.Fatalf("GET devices status=%d", st)
	}
	if len(devs) != 1 {
		t.Fatalf("unexpected device list (did it not upsert?): %+v", devs)
	}
	t.Logf("✓ devices: registration + heartbeat upsert OK (id=%s, last_seen=%s)", dev.Id, again.LastSeenAt.Format(time.RFC3339))

	// --- 3) PUT + GET /v1/settings ---
	locale := api.SettingsLocale("hu")
	unit := api.SettingsUnitSystem("metric")
	var setPut api.Settings
	if st := c.do(t, http.MethodPut, "/v1/settings", token, api.Settings{
		TimeZone: &tzDev, Locale: &locale, UnitSystem: &unit,
		NotifPrefs: &api.NotifPrefs{Insights: ptr(true)},
	}, &setPut); st != http.StatusOK {
		t.Fatalf("PUT settings status=%d", st)
	}
	if setPut.TimeZone == nil || *setPut.TimeZone != tz || setPut.Locale == nil || *setPut.Locale != "hu" {
		t.Fatalf("unexpected settings: %+v", setPut)
	}
	// The partial patch must not zero out the other switches (default:
	// sync_errors=true).
	if setPut.NotifPrefs == nil || setPut.NotifPrefs.Insights == nil || !*setPut.NotifPrefs.Insights ||
		setPut.NotifPrefs.SyncErrors == nil || !*setPut.NotifPrefs.SyncErrors {
		t.Fatalf("the notif_prefs merge is wrong: %+v", setPut.NotifPrefs)
	}
	var setGet api.Settings
	if st := c.do(t, http.MethodGet, "/v1/settings", token, nil, &setGet); st != http.StatusOK {
		t.Fatalf("GET settings status=%d", st)
	}
	if setGet.TimeZone == nil || *setGet.TimeZone != tz || setGet.UnitSystem == nil || *setGet.UnitSystem != "metric" {
		t.Fatalf("unexpected GET settings: %+v", setGet)
	}
	// An invalid tz → 400 (the daily bucketing depends on it); the existing setting
	// stays.
	if st := c.do(t, http.MethodPut, "/v1/settings", token, api.Settings{TimeZone: ptr("Nowhere/Neverland")}, nil); st != http.StatusBadRequest {
		t.Fatalf("invalid tz status=%d (expected 400)", st)
	}
	t.Logf("✓ settings: PUT+GET OK (tz=%s, locale=hu), invalid tz gives 400", tz)

	// --- 4) Ingest (a batch onto the queue) ---
	now := time.Now().UTC()
	steps := []float32{100, 200, 700} // sum = 1000
	const wantSteps = float32(1000)
	hrs := []float32{60, 80} // average = 70
	const wantHRAvg = float32(70)

	// The two workouts stretch out the two cases of 2A.7:
	//   wk-1 — the workout AND its samples in the same chunk (the worker's ordering
	//          resolves it),
	//   wk-2 — its samples come NOW, the workout only in the next chunk (the backfill
	//          resolves it).
	wkSrc := appleSub + "-wk-1"
	wkSrc2 := appleSub + "-wk-2"

	var samples []api.SampleIn
	for i, v := range steps {
		samples = append(samples, sample(appleSub, "stepCount", "count", now.Add(-time.Duration(i)*time.Minute), v, i))
	}
	for i, v := range hrs {
		s := sample(appleSub, "heartRate", "count/min", now.Add(-time.Duration(i)*time.Minute), v, 100+i)
		s.WorkoutSourceUuid = &wkSrc
		samples = append(samples, s)
	}
	for i, v := range hrs {
		s := sample(appleSub, "heartRate", "count/min", now.Add(-time.Duration(10+i)*time.Minute), v, 200+i)
		s.WorkoutSourceUuid = &wkSrc2 // the workout does not exist yet → an orphaned sample
		samples = append(samples, s)
	}

	// Workout + sleep + activity summary in the same batch (for the read endpoints).
	loc, _ := time.LoadLocation(tz)
	bpToday := openapi_types.Date{Time: time.Now().In(loc)} // today, in the user's tz
	wkEnd := now
	wkStart := now.Add(-45 * time.Minute)
	energy, dist := float32(320), float32(5000)

	// wk-1's GPS route. The four points deliberately stretch out the rules:
	//   - points 2 and 3 share an IDENTICAL TIMESTAMP (standing still, CLLocation
	//     stamps can land on top of each other) → only the seq tie-breaker makes their
	//     order stable,
	//   - point 3 has an altitude of 0 (sea level) and a speed of 0 (a full stop) →
	//     REAL measurements that must come back, not as "no data",
	//   - point 4 has no altitude/speed/accuracy → these must come back as absent
	//     fields.
	// The timestamp is truncated to milliseconds: Postgres timestamptz is
	// microsecond-precision while time.Now() is nanosecond-precision — without this
	// the stamp read back would never compare equal.
	rts := wkStart.Truncate(time.Millisecond)
	wkRoute := []api.RoutePoint{
		{Ts: rts, Lat: 47.4979, Lon: 19.0402, AltitudeM: ptr(float32(102.5)), SpeedMps: ptr(float32(2.8)), AccuracyM: ptr(float32(4.5))},
		{Ts: rts.Add(time.Minute), Lat: 47.4985, Lon: 19.0410, AltitudeM: ptr(float32(104)), SpeedMps: ptr(float32(3.1)), AccuracyM: ptr(float32(5))},
		{Ts: rts.Add(time.Minute), Lat: 47.4990, Lon: 19.0421, AltitudeM: ptr(float32(0)), SpeedMps: ptr(float32(0)), AccuracyM: ptr(float32(6))},
		{Ts: rts.Add(2 * time.Minute), Lat: 47.4999, Lon: 19.0433},
	}
	workouts := []api.WorkoutIn{{
		SourceUuid: wkSrc, ActivityType: "running", StartedAt: wkStart, EndedAt: &wkEnd,
		TotalEnergyKcal: &energy, TotalDistanceM: &dist, Route: &wkRoute,
	}}
	sleepStage := api.SleepSegmentInStage("asleepCore")
	sleeps := []api.SleepSegmentIn{{
		SourceUuid: appleSub + "-sl-1", StartedAt: now.Add(-8 * time.Hour), EndedAt: now.Add(-7 * time.Hour), Stage: sleepStage,
	}}
	ae, aeg, em, eg, sh, sg := float32(450), float32(500), float32(28), float32(30), float32(9), float32(12)
	activities := []api.ActivitySummary{{
		Day: &bpToday, ActiveEnergy: &ae, ActiveEnergyGoal: &aeg,
		ExerciseMinutes: &em, ExerciseGoal: &eg, StandHours: &sh, StandGoal: &sg,
	}}

	tzc := tz
	status := c.do(t, http.MethodPost, "/v1/ingest", token, api.IngestBatch{
		DeviceId: dev.Id, TimeZone: &tzc, Samples: &samples, Workouts: &workouts,
		SleepSegments: &sleeps, ActivitySummaries: &activities,
	}, nil)
	if status != http.StatusAccepted {
		t.Fatalf("ingest status=%d (expected 202)", status)
	}
	t.Logf("✓ ingest: %d samples + 1 workout + 1 sleep + 1 activity accepted (202)", len(samples))

	// --- 5) Summary (polled, because the worker processes asynchronously) ---
	deadline := time.Now().Add(20 * time.Second)
	var got float32
	for time.Now().Before(deadline) {
		var resp api.SummaryResponse
		status = c.do(t, http.MethodGet, "/v1/summary?range=day&metrics=stepCount,heartRate&tz="+tz, token, nil, &resp)
		if status == http.StatusOK && resp.Metrics != nil {
			if ms, ok := (*resp.Metrics)["stepCount"]; ok && ms.Total != nil && *ms.Total >= wantSteps {
				got = *ms.Total
				// check the heartRate average
				if hr, ok := (*resp.Metrics)["heartRate"]; ok && hr.Total != nil {
					if *hr.Total != wantHRAvg {
						t.Fatalf("heartRate average=%v (expected %v)", *hr.Total, wantHRAvg)
					}
				} else {
					t.Fatalf("the heartRate series is missing: %+v", resp.Metrics)
				}
				break
			}
		}
		time.Sleep(300 * time.Millisecond)
	}
	if got != wantSteps {
		t.Fatalf("summary stepCount total=%v (expected %v) — did the worker process it?", got, wantSteps)
	}
	t.Logf("✓ summary: stepCount total=%v, heartRate avg=%v (tz=%s) — E2E OK", got, wantHRAvg, tz)

	// The summary already proves the worker committed the whole batch → the remaining
	// read endpoints can be checked synchronously (there is no cache on them).

	// --- 6) GET /v1/activity ---
	var acts []api.ActivitySummary
	if st := c.do(t, http.MethodGet, "/v1/activity?tz="+tz, token, nil, &acts); st != http.StatusOK {
		t.Fatalf("activity status=%d", st)
	}
	if len(acts) != 1 || acts[0].ActiveEnergy == nil || *acts[0].ActiveEnergy != 450 || acts[0].StandGoal == nil || *acts[0].StandGoal != 12 {
		t.Fatalf("unexpected activity: %+v", acts)
	}
	t.Logf("✓ activity: %d day(s), Move=%v goal=%v", len(acts), *acts[0].ActiveEnergy, *acts[0].ActiveEnergyGoal)

	// --- 7) GET /v1/workouts + /{id} ---
	var page api.WorkoutPage
	if st := c.do(t, http.MethodGet, "/v1/workouts?limit=10", token, nil, &page); st != http.StatusOK {
		t.Fatalf("workouts status=%d", st)
	}
	if page.Items == nil || len(*page.Items) != 1 {
		t.Fatalf("unexpected workout list: %+v", page)
	}
	wk := (*page.Items)[0]
	if wk.Id == nil || wk.ActivityType == nil || *wk.ActivityType != "running" || wk.SourceUuid == nil || *wk.SourceUuid != wkSrc {
		t.Fatalf("unexpected workout: %+v", wk)
	}
	// 2A.7 — the HR samples that arrived in the same chunk are wired up (otherwise
	// this would be null).
	if wk.AvgHeartRate == nil || *wk.AvgHeartRate != wantHRAvg || wk.MaxHeartRate == nil || *wk.MaxHeartRate != 80 {
		t.Fatalf("wk-1 heart rate is not wired up (source_uuid → workouts.id): avg=%v max=%v", wk.AvgHeartRate, wk.MaxHeartRate)
	}
	var one api.Workout
	if st := c.do(t, http.MethodGet, "/v1/workouts/"+wk.Id.String(), token, nil, &one); st != http.StatusOK {
		t.Fatalf("workout/{id} status=%d", st)
	}
	if one.Id == nil || *one.Id != *wk.Id {
		t.Fatalf("workout/{id} mismatch: %+v", one)
	}
	t.Logf("✓ workouts: %d workout(s) (keyset), /{id} OK (activity=%s, avg HR=%v)", len(*page.Items), *wk.ActivityType, *wk.AvgHeartRate)

	// --- 7b) GET /v1/workouts/{id}/route — the route, through the ingest path ---
	var route api.WorkoutRoute
	if st := c.do(t, http.MethodGet, "/v1/workouts/"+wk.Id.String()+"/route", token, nil, &route); st != http.StatusOK {
		t.Fatalf("route status=%d", st)
	}
	if len(route.Points) != len(wkRoute) {
		t.Fatalf("the route has %d points (expected %d): %+v", len(route.Points), len(wkRoute), route.Points)
	}
	// Increasing by time — that is what the contract promises.
	for i := 1; i < len(route.Points); i++ {
		if route.Points[i].Ts.Before(route.Points[i-1].Ts) {
			t.Fatalf("the route is not increasing by time at point %d: %v < %v",
				i, route.Points[i].Ts, route.Points[i-1].Ts)
		}
	}
	if !route.Points[0].Ts.Equal(wkRoute[0].Ts) {
		t.Fatalf("the first point's stamp drifted: %v vs %v", route.Points[0].Ts, wkRoute[0].Ts)
	}
	if route.Points[0].Lat != wkRoute[0].Lat || route.Points[0].Lon != wkRoute[0].Lon {
		t.Fatalf("the coordinate is corrupted: %+v vs %+v", route.Points[0], wkRoute[0])
	}
	// The pair sharing a timestamp comes back in the SEND order (the seq tie-breaker).
	if route.Points[1].Lon != wkRoute[1].Lon || route.Points[2].Lon != wkRoute[2].Lon {
		t.Fatalf("the order of the points sharing a stamp got swapped: %v, %v",
			route.Points[1].Lon, route.Points[2].Lon)
	}
	// A 0 altitude (sea level) and a 0 speed (a full stop) are REAL measurements.
	if route.Points[2].AltitudeM == nil || *route.Points[2].AltitudeM != 0 {
		t.Fatalf("the 0 altitude turned into a missing measurement: %v", route.Points[2].AltitudeM)
	}
	if route.Points[2].SpeedMps == nil || *route.Points[2].SpeedMps != 0 {
		t.Fatalf("the 0 speed turned into a missing measurement: %v", route.Points[2].SpeedMps)
	}
	// A missing measurement, on the other hand, stays missing — it does not come back
	// as a zero.
	last := route.Points[3]
	if last.AltitudeM != nil || last.SpeedMps != nil || last.AccuracyM != nil {
		t.Fatalf("the missing measurements turned into values: %+v", last)
	}
	// The route of a non-existent workout is a 404 — that is the difference from an
	// "empty route".
	if st := c.do(t, http.MethodGet, "/v1/workouts/"+uuid.NewString()+"/route", token, nil, nil); st != http.StatusNotFound {
		t.Fatalf("route of an unknown workout status=%d (expected 404)", st)
	}
	t.Logf("✓ route: %d points in time order, 0 altitude/speed survived, missing measurements stay missing, unknown id gives 404",
		len(route.Points))

	// --- 8) GET /v1/sleep ---
	var segs []api.SleepSegment
	if st := c.do(t, http.MethodGet, "/v1/sleep?tz="+tz, token, nil, &segs); st != http.StatusOK {
		t.Fatalf("sleep status=%d", st)
	}
	if len(segs) != 1 || segs[0].Stage == nil || *segs[0].Stage != "asleepCore" {
		t.Fatalf("unexpected sleep: %+v", segs)
	}
	t.Logf("✓ sleep: %d segment(s) (stage=%s)", len(segs), *segs[0].Stage)

	// --- 9) PUT + GET /v1/goals ---
	gm := api.GoalUpdateMetric("stepCount")
	var put api.Goal
	if st := c.do(t, http.MethodPut, "/v1/goals", token, api.GoalUpdate{Metric: gm, TargetValue: 12000}, &put); st != http.StatusOK {
		t.Fatalf("PUT goals status=%d", st)
	}
	if put.TargetValue == nil || *put.TargetValue != 12000 || put.Unit == nil || *put.Unit != "count" {
		t.Fatalf("unexpected PUT goals: %+v", put)
	}
	var goals []api.Goal
	if st := c.do(t, http.MethodGet, "/v1/goals", token, nil, &goals); st != http.StatusOK {
		t.Fatalf("GET goals status=%d", st)
	}
	found := false
	for _, g := range goals {
		if g.Metric != nil && *g.Metric == "stepCount" && g.TargetValue != nil && *g.TargetValue == 12000 {
			found = true
		}
	}
	if !found {
		t.Fatalf("goals does not contain stepCount=12000: %+v", goals)
	}
	t.Logf("✓ goals: PUT+GET OK (stepCount target=12000, unit=count)")

	// --- 10) 2A.7 backfill: wiring a LATE-arriving workout to its already stored samples ---
	//
	// wk-2's samples came in chunk 4), the workout itself only now — the worker's
	// LinkSamplesToWorkouts step wires them up retroactively. This second ingest is
	// also the device's "sign of life" (device_id → last_seen_at).
	//
	// The same batch sends wk-1 a SECOND time, with a byte-identical route: the ingest
	// is idempotent, so the points must not duplicate. wk-2, on the other hand, has no
	// route — as an indoor/routeless workout, querying it gives an empty list, not a
	// 404.
	wk2End := now.Add(-8 * time.Minute)
	wk2Start := now.Add(-15 * time.Minute)
	workouts2 := []api.WorkoutIn{
		{SourceUuid: wkSrc2, ActivityType: "walking", StartedAt: wk2Start, EndedAt: &wk2End},
		{SourceUuid: wkSrc, ActivityType: "running", StartedAt: wkStart, EndedAt: &wkEnd,
			TotalEnergyKcal: &energy, TotalDistanceM: &dist, Route: &wkRoute},
	}
	if st := c.do(t, http.MethodPost, "/v1/ingest", token, api.IngestBatch{
		DeviceId: dev.Id, TimeZone: &tzc, Workouts: &workouts2,
	}, nil); st != http.StatusAccepted {
		t.Fatalf("ingest (wk-2) status=%d (expected 202)", st)
	}

	deadline = time.Now().Add(20 * time.Second)
	var wk2 *api.Workout
	for time.Now().Before(deadline) {
		var p2 api.WorkoutPage
		if st := c.do(t, http.MethodGet, "/v1/workouts?limit=10", token, nil, &p2); st == http.StatusOK && p2.Items != nil {
			for i := range *p2.Items {
				it := (*p2.Items)[i]
				if it.SourceUuid != nil && *it.SourceUuid == wkSrc2 && it.AvgHeartRate != nil {
					wk2 = &it
					break
				}
			}
		}
		if wk2 != nil {
			break
		}
		time.Sleep(300 * time.Millisecond)
	}
	if wk2 == nil {
		t.Fatalf("wk-2: the late-arriving workout did not wire up the earlier samples (backfill)")
	}
	if *wk2.AvgHeartRate != wantHRAvg || wk2.MaxHeartRate == nil || *wk2.MaxHeartRate != 80 {
		t.Fatalf("unexpected wk-2 heart rate: avg=%v max=%v", *wk2.AvgHeartRate, wk2.MaxHeartRate)
	}
	t.Logf("✓ 2A.7 backfill: wk-2's samples wired up retroactively (avg HR=%v)", *wk2.AvgHeartRate)

	// --- 10b) Route idempotency + the empty route ---
	//
	// The worker writes the batch in ONE transaction, so if wk-2's backfill above is
	// visible, then so is the route of wk-1 that arrived with it on its second
	// submission. No separate polling is needed.
	var again2 api.WorkoutRoute
	if st := c.do(t, http.MethodGet, "/v1/workouts/"+wk.Id.String()+"/route", token, nil, &again2); st != http.StatusOK {
		t.Fatalf("route (after the 2nd submission) status=%d", st)
	}
	if len(again2.Points) != len(wkRoute) {
		t.Fatalf("the route of the twice-submitted workout grew to %d points (expected %d) — not idempotent",
			len(again2.Points), len(wkRoute))
	}
	for i := range again2.Points {
		if !again2.Points[i].Ts.Equal(route.Points[i].Ts) || again2.Points[i].Lon != route.Points[i].Lon {
			t.Fatalf("point %d changed after the resend: %+v vs %+v",
				i, again2.Points[i], route.Points[i])
		}
	}
	// The routeless workout: an empty list with a 200. That is a full answer — the
	// workout exists, it simply has no route (an indoor workout, or one recorded
	// before route support).
	var empty api.WorkoutRoute
	if st := c.do(t, http.MethodGet, "/v1/workouts/"+wk2.Id.String()+"/route", token, nil, &empty); st != http.StatusOK {
		t.Fatalf("routeless workout route status=%d (expected 200, not 404)", st)
	}
	if len(empty.Points) != 0 {
		t.Fatalf("the routeless workout ended up with %d points: %+v", len(empty.Points), empty.Points)
	}
	t.Logf("✓ route idempotency: the twice-submitted workout's route stayed at %d points; the routeless workout gives an empty list (200)",
		len(again2.Points))

	// The ingest updated the device's last_seen_at (the source of the sync-freshness
	// alert).
	var devs2 []api.Device
	if st := c.do(t, http.MethodGet, "/v1/devices", token, nil, &devs2); st != http.StatusOK || len(devs2) != 1 {
		t.Fatalf("GET devices status=%d list=%+v", st, devs2)
	}
	if devs2[0].LastSeenAt == nil || !devs2[0].LastSeenAt.After(*again.LastSeenAt) {
		t.Fatalf("the ingest did not update last_seen_at: %v → %v", again.LastSeenAt, devs2[0].LastSeenAt)
	}
	t.Logf("✓ devices: the ingest heartbeat updated last_seen_at (%s)", devs2[0].LastSeenAt.Format(time.RFC3339))

	// --- 11) GET /v1/samples — keyset pagination over the raw samples ---
	var p1 api.SamplePage
	if st := c.do(t, http.MethodGet, "/v1/samples?data_type=stepCount&limit=2", token, nil, &p1); st != http.StatusOK {
		t.Fatalf("samples status=%d", st)
	}
	if p1.Items == nil || len(*p1.Items) != 2 || p1.NextCursor == nil {
		t.Fatalf("unexpected first page of samples: %+v", p1)
	}
	if (*p1.Items)[0].Unit == nil || *(*p1.Items)[0].Unit != "count" {
		t.Fatalf("unexpected sample unit: %+v", (*p1.Items)[0])
	}
	var p2s api.SamplePage
	if st := c.do(t, http.MethodGet, "/v1/samples?data_type=stepCount&limit=2&cursor="+*p1.NextCursor, token, nil, &p2s); st != http.StatusOK {
		t.Fatalf("samples page 2 status=%d", st)
	}
	if p2s.Items == nil || len(*p2s.Items) != 1 || p2s.NextCursor != nil {
		t.Fatalf("unexpected second page of samples (3 samples, 2+1): %+v", p2s)
	}
	// The two pages must not overlap — that is the whole point of keyset pagination.
	if (*p2s.Items)[0].Ts.Equal(*(*p1.Items)[1].Ts) {
		t.Fatalf("pagination repeated the last row: %v", (*p2s.Items)[0].Ts)
	}
	if st := c.do(t, http.MethodGet, "/v1/samples", token, nil, nil); st != http.StatusBadRequest {
		t.Fatalf("samples without data_type status=%d (expected 400)", st)
	}
	t.Logf("✓ samples: keyset pagination 2+1 samples, missing data_type gives 400")

	// --- 12) POST /v1/export — synchronous CSV and JSON ---
	csvBody, ct, st12 := c.raw(t, http.MethodPost, "/v1/export", token, api.ExportRequest{
		Format: "csv", Metrics: &[]string{"stepCount"},
	})
	if st12 != http.StatusOK {
		t.Fatalf("export csv status=%d", st12)
	}
	if !strings.HasPrefix(ct, "text/csv") {
		t.Fatalf("export csv content-type=%q", ct)
	}
	lines := strings.Split(strings.TrimSpace(string(csvBody)), "\n")
	if len(lines) != 4 || lines[0] != "ts,data_type,value,unit,source_device" {
		t.Fatalf("unexpected export csv (header + 3 samples): %q", lines)
	}
	jsonBody, ct, st12 := c.raw(t, http.MethodPost, "/v1/export", token, api.ExportRequest{Format: "json"})
	if st12 != http.StatusOK || !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("export json status=%d content-type=%q", st12, ct)
	}
	var exp struct {
		Meta struct {
			TZ string `json:"tz"`
		} `json:"meta"`
		Samples  []map[string]any `json:"samples"`
		Workouts []map[string]any `json:"workouts"`
		Sleep    []map[string]any `json:"sleep_segments"`
	}
	must(t, json.Unmarshal(jsonBody, &exp), "export json parse")
	if exp.Meta.TZ != tz || len(exp.Samples) != 7 || len(exp.Workouts) != 2 || len(exp.Sleep) != 1 {
		t.Fatalf("unexpected export json: tz=%s samples=%d workouts=%d sleep=%d",
			exp.Meta.TZ, len(exp.Samples), len(exp.Workouts), len(exp.Sleep))
	}
	// pdf is in the contract but not implemented → 501, not 400.
	if _, _, st := c.raw(t, http.MethodPost, "/v1/export", token, api.ExportRequest{Format: "pdf"}); st != http.StatusNotImplemented {
		t.Fatalf("export pdf status=%d (expected 501)", st)
	}
	// There is no export job: the endpoint honestly answers 404.
	if st := c.do(t, http.MethodGet, "/v1/export/"+uuid.NewString(), token, nil, nil); st != http.StatusNotFound {
		t.Fatalf("export/{id} status=%d (expected 404)", st)
	}
	t.Logf("✓ export: CSV %d rows, JSON %d samples + %d workouts + %d sleep, pdf 501, /{id} 404",
		len(lines)-1, len(exp.Samples), len(exp.Workouts), len(exp.Sleep))

	// --- 13) GET /v1/insights — from little data it says NOTHING ---
	//
	// This smoke user has existed for a few minutes: there is no 14-day baseline, no
	// two complete weeks, no 14 paired days. The correct answer is therefore the EMPTY
	// list — anything showing up here would be an invented insight.
	var ins []api.Insight
	if st := c.do(t, http.MethodGet, "/v1/insights", token, nil, &ins); st != http.StatusOK {
		t.Fatalf("insights status=%d", st)
	}
	if len(ins) != 0 {
		t.Fatalf("a fresh user produced %d insights (from little data we say nothing): %+v", len(ins), ins)
	}
	t.Logf("✓ insights: an empty list from fresh data (the rules' data minimums are not met)")

	// --- 14) Push: token storage + preferences ---
	//
	// Sending is an open decision (docs/19); the only question here is whether the
	// token can be stored, and whether repeated registration updates (rather than
	// multiplies).
	pushTok := "apns-" + appleSub
	plat := api.PushRegisterPlatform("ios")
	for i := 0; i < 2; i++ {
		if st := c.do(t, http.MethodPost, "/v1/push/register", token, api.PushRegister{
			Token: pushTok, Platform: plat, DeviceId: dev.Id,
		}, nil); st != http.StatusNoContent {
			t.Fatalf("push/register (no. %d) status=%d (expected 204)", i+1, st)
		}
	}
	if st := c.do(t, http.MethodPost, "/v1/push/register", token, api.PushRegister{Platform: plat}, nil); st != http.StatusBadRequest {
		t.Fatalf("register without a token status=%d (expected 400)", st)
	}
	var prefs api.NotifPrefs
	if st := c.do(t, http.MethodPut, "/v1/push/prefs", token, api.NotifPrefs{GoalNudges: ptr(true)}, &prefs); st != http.StatusOK {
		t.Fatalf("push/prefs status=%d", st)
	}
	// The partial patch must not zero out the insights=true set in step 3).
	if prefs.GoalNudges == nil || !*prefs.GoalNudges || prefs.Insights == nil || !*prefs.Insights {
		t.Fatalf("the push/prefs merge is wrong: %+v", prefs)
	}
	t.Logf("✓ push: token upsert 2× → 204, missing token gives 400, prefs merge OK")

	// --- 15) Badges: an idempotent upsert that never deletes ---
	//
	// It stretches out three things, each of which would mean data loss if it broke:
	//   a) the same badge sent twice does not duplicate,
	//   b) on conflict earned_at STAYS (the date earned is not the date of the sync),
	//      while value/thresholds are updated (late-arriving HealthKit data),
	//   c) sending a different badge does NOT remove from the list the ones not sent
	//      this time — this is the reinstalled-phone case.
	earned := now.Add(-72 * time.Hour).Truncate(time.Millisecond)
	monthID := "month:complete:2026-08"
	recordID := "record:best-month"
	period, aUnit := "2026-08", "count"

	var afterFirst []api.Achievement
	if st := c.do(t, http.MethodPost, "/v1/achievements", token, []api.AchievementInput{
		{
			Id: monthID, Kind: "month", Code: "complete", Period: &period,
			Value: ptr(float32(312000)), Unit: &aUnit,
			Thresholds: &[]int{5000, 8000, 10000}, EarnedAt: earned,
		},
	}, &afterFirst); st != http.StatusOK {
		t.Fatalf("POST achievements status=%d", st)
	}
	if len(afterFirst) != 1 || afterFirst[0].Id != monthID {
		t.Fatalf("unexpected first achievements upsert: %+v", afterFirst)
	}
	if afterFirst[0].Thresholds == nil || len(*afterFirst[0].Thresholds) != 3 || (*afterFirst[0].Thresholds)[2] != 10000 {
		t.Fatalf("the thresholds snapshot was lost: %+v", afterFirst[0].Thresholds)
	}

	// The same id, with a LATER earned_at and a higher value: the value is updated,
	// the date earned does not move.
	var afterSecond []api.Achievement
	if st := c.do(t, http.MethodPost, "/v1/achievements", token, []api.AchievementInput{
		{
			Id: monthID, Kind: "month", Code: "complete", Period: &period,
			Value: ptr(float32(318500)), Unit: &aUnit,
			Thresholds: &[]int{5000, 8000, 12000}, EarnedAt: now,
		},
	}, &afterSecond); st != http.StatusOK {
		t.Fatalf("POST achievements (no. 2) status=%d", st)
	}
	if len(afterSecond) != 1 {
		t.Fatalf("the repeated upsert duplicated: %+v", afterSecond)
	}
	if !afterSecond[0].EarnedAt.Equal(afterFirst[0].EarnedAt) {
		t.Fatalf("earned_at was overwritten: %v → %v", afterFirst[0].EarnedAt, afterSecond[0].EarnedAt)
	}
	if afterSecond[0].Value == nil || *afterSecond[0].Value != 318500 {
		t.Fatalf("the late data did not update value: %+v", afterSecond[0].Value)
	}
	if afterSecond[0].Thresholds == nil || (*afterSecond[0].Thresholds)[2] != 12000 {
		t.Fatalf("the thresholds snapshot was not updated: %+v", afterSecond[0].Thresholds)
	}

	// A different badge, WITHOUT sending the old one — the list has to grow, not be
	// replaced.
	var afterThird []api.Achievement
	if st := c.do(t, http.MethodPost, "/v1/achievements", token, []api.AchievementInput{
		{Id: recordID, Kind: "record", Code: "best-month", Value: ptr(float32(318500)), EarnedAt: now},
	}, &afterThird); st != http.StatusOK {
		t.Fatalf("POST achievements (no. 3) status=%d", st)
	}
	if len(afterThird) != 2 {
		t.Fatalf("the POST replaced the list with the submitted set (%d badges): %+v", len(afterThird), afterThird)
	}
	// Descending by earned_at: the record just earned in front, the month earned 3
	// days ago behind it.
	if afterThird[0].Id != recordID || afterThird[1].Id != monthID {
		t.Fatalf("the order is not descending by earned_at: %+v", afterThird)
	}
	// A badge with no thresholds comes back WITHOUT them (not as an empty array).
	if afterThird[0].Thresholds != nil {
		t.Fatalf("the record badge ended up with thresholds: %+v", afterThird[0].Thresholds)
	}

	var achGet []api.Achievement
	if st := c.do(t, http.MethodGet, "/v1/achievements", token, nil, &achGet); st != http.StatusOK {
		t.Fatalf("GET achievements status=%d", st)
	}
	if len(achGet) != 2 || achGet[0].Id != recordID {
		t.Fatalf("unexpected GET achievements: %+v", achGet)
	}
	// An empty batch: a valid no-op, not a deletion.
	var achEmpty []api.Achievement
	if st := c.do(t, http.MethodPost, "/v1/achievements", token, []api.AchievementInput{}, &achEmpty); st != http.StatusOK || len(achEmpty) != 2 {
		t.Fatalf("empty POST status=%d list=%+v (the list must not change)", st, achEmpty)
	}
	// An unknown kind → 400: we do not store a badge that no client can draw.
	if st := c.do(t, http.MethodPost, "/v1/achievements", token, []api.AchievementInput{
		{Id: "badge:x", Kind: "badge", Code: "x", EarnedAt: now},
	}, nil); st != http.StatusBadRequest {
		t.Fatalf("unknown kind status=%d (expected 400)", st)
	}
	t.Logf("✓ achievements: idempotent upsert (earned_at %s stays), value/thresholds updated, the list GREW to %d badges",
		afterSecond[0].EarnedAt.Format(time.RFC3339), len(achGet))
}

// --- helpers ---

type apiClient struct {
	base string
	hc   *http.Client
}

func (c *apiClient) do(t *testing.T, method, path, token string, body, out any) int {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		must(t, err, "marshal body")
		rdr = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	must(t, err, "new request")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.hc.Do(req)
	must(t, err, "do request")
	defer resp.Body.Close()
	if out != nil && resp.StatusCode < 300 {
		raw, _ := io.ReadAll(resp.Body)
		if len(raw) > 0 {
			must(t, json.Unmarshal(raw, out), "decode response")
		}
	}
	return resp.StatusCode
}

// raw returns the unparsed response (body, content-type, status) — the export is
// not JSON.
func (c *apiClient) raw(t *testing.T, method, path, token string, body any) ([]byte, string, int) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		must(t, err, "marshal body")
		rdr = bytes.NewReader(buf)
	}
	req, err := http.NewRequest(method, c.base+path, rdr)
	must(t, err, "new request")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := c.hc.Do(req)
	must(t, err, "do request")
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	return raw, resp.Header.Get("Content-Type"), resp.StatusCode
}

func sample(sub, dataType, unit string, ts time.Time, value float32, seq int) api.SampleIn {
	v := value
	return api.SampleIn{
		SourceUuid: fmt.Sprintf("%s-%s-%d", sub, dataType, seq),
		// data_type is a deliberately open string (docs/23 §1) — since the closed enum
		// was retired there is no api.SampleInDataType type.
		DataType: dataType,
		Ts:       ts,
		Value:    &v,
		Unit:     &unit,
	}
}

func setIfEmpty(key, val string) {
	if os.Getenv(key) == "" {
		_ = os.Setenv(key, val)
	}
}

func must(t *testing.T, err error, ctx string) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: %v", ctx, err)
	}
}

func ptr[T any](v T) *T { return &v }
