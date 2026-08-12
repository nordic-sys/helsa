//go:build smoke

// The Home Assistant publisher against a REAL MQTT broker.
//
// ⚠️ A discovery message that Home Assistant does not like fails SILENTLY: the
// entity simply never appears, and nothing in either system says why. Unit tests
// can check the shape of the JSON, but only a broker can show that the messages
// are published at all, on the topics claimed, with the retain flags claimed.
//
// It needs a broker, so it SKIPS unless HELSA_MQTT_URL is set:
//
//	cd deploy && make mqtt-up
//	cd backend && HELSA_MQTT_URL=mqtt://127.0.0.1:1883 make smoke
//	cd deploy && make mqtt-down
package smoke

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"sync"
	"testing"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/hass"
)

// recorder keeps the last payload seen on every topic, the way a retained-message
// broker would hand it to a subscriber that connected later.
type recorder struct {
	mu       sync.Mutex
	last     map[string]string
	retained map[string]bool
}

func newRecorder() *recorder {
	return &recorder{last: map[string]string{}, retained: map[string]bool{}}
}

func (r *recorder) handle(_ mqtt.Client, m mqtt.Message) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.last[m.Topic()] = string(m.Payload())
	r.retained[m.Topic()] = m.Retained()
}

func (r *recorder) get(topic string) (string, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	v, ok := r.last[topic]
	return v, ok
}

func (r *recorder) wasRetained(topic string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.retained[topic]
}

// await waits for a topic to carry a payload the predicate accepts. Publishing is
// asynchronous on both sides, so nothing here can be asserted immediately.
func (r *recorder) await(t *testing.T, topic string, ok func(string) bool) string {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if v, seen := r.get(topic); seen && ok(v) {
			return v
		}
		time.Sleep(200 * time.Millisecond)
	}
	v, seen := r.get(topic)
	t.Fatalf("timed out waiting for %s (seen=%v, last payload=%q)", topic, seen, v)
	return ""
}

func TestHomeAssistantMQTTPublisher(t *testing.T) {
	broker := os.Getenv("HELSA_MQTT_URL")
	if broker == "" {
		t.Skip("HELSA_MQTT_URL is not set — no broker to test against (cd ../deploy && make mqtt-up)")
	}

	e := newEnv(t)

	// A prefix of its own per run. Two smoke runs, or a smoke run next to a real
	// publisher, must not read each other's topics — and the retained messages would
	// otherwise outlive the test on the broker.
	prefix := fmt.Sprintf("helsa-smoke-%d", time.Now().UnixNano())
	discoveryPrefix := prefix + "-ha"

	// --- 1) A subscriber standing in for Home Assistant ---
	rec := newRecorder()
	sub := mqtt.NewClient(mqtt.NewClientOptions().
		AddBroker(broker).
		SetClientID(prefix + "-sub").
		SetCleanSession(true))
	if tok := sub.Connect(); !tok.WaitTimeout(15*time.Second) || tok.Error() != nil {
		t.Fatalf("cannot connect to the broker at %s: %v", broker, tok.Error())
	}
	t.Cleanup(func() { sub.Disconnect(250) })
	for _, filter := range []string{prefix + "/#", discoveryPrefix + "/#"} {
		if tok := sub.Subscribe(filter, 1, rec.handle); !tok.WaitTimeout(10*time.Second) || tok.Error() != nil {
			t.Fatalf("subscribe %s: %v", filter, tok.Error())
		}
	}

	// Registered here on purpose. Cleanups run last-registered-first, so this one
	// runs AFTER the publisher has stopped and said its retained goodbye — otherwise
	// that goodbye would be the litter left behind.
	t.Cleanup(func() { clearRetained(t, sub, rec) })

	// --- 2) Data to publish, through the real ingest path ---
	seedForMQTT(t, e)

	// --- 3) The publisher, exactly as the worker runs it ---
	ctx, cancel := context.WithCancel(context.Background())
	cfg := config.MQTT{
		URL:             broker,
		ClientID:        prefix + "-pub",
		Prefix:          prefix,
		DiscoveryPrefix: discoveryPrefix,
		Interval:        2 * time.Second,
		FreshnessPeriod: 2 * time.Second,
		ExpireAfter:     90 * time.Minute,
		// Pinned: the smoke database holds a user per run, and the publisher refuses
		// to guess whose health data goes on a broker.
		UserID: e.userID.String(),
	}
	pub := hass.New(e.store.DB, slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelWarn})), cfg)
	done := make(chan error, 1)
	go func() { done <- pub.Run(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("publisher exited with %v", err)
			}
		case <-time.After(15 * time.Second):
			t.Error("the publisher did not stop when its context was cancelled")
		}
	})

	// --- 4) Availability ---
	rec.await(t, prefix+"/status", func(v string) bool { return v == "online" })
	t.Logf("✓ availability: %s/status = online", prefix)

	// --- 5) Discovery: the entities Home Assistant would build ---
	wantEntities := []struct {
		object, stateTopic string
	}{
		{"helsa_steps", prefix + "/daily/steps"},
		{"helsa_active_energy", prefix + "/daily/active_energy"},
		{"helsa_sleep_hours", prefix + "/daily/sleep_hours"},
		{"helsa_resting_heart_rate", prefix + "/daily/resting_heart_rate"},
		{"helsa_rings_closed", prefix + "/daily/rings_closed"},
		{"helsa_sync_freshness", prefix + "/sync/freshness_hours"},
	}
	for _, w := range wantEntities {
		topic := discoveryPrefix + "/sensor/" + w.object + "/config"
		raw := rec.await(t, topic, func(v string) bool { return v != "" })

		var cfgMsg map[string]any
		if err := json.Unmarshal([]byte(raw), &cfgMsg); err != nil {
			t.Fatalf("%s: the discovery payload is not valid JSON: %v", topic, err)
		}
		for _, key := range []string{"name", "unique_id", "state_topic", "device"} {
			if _, ok := cfgMsg[key]; !ok {
				t.Errorf("%s: no %q in the discovery payload — Home Assistant would ignore it in silence", topic, key)
			}
		}
		if cfgMsg["state_topic"] != w.stateTopic {
			t.Errorf("%s: state_topic = %v, want %v", topic, cfgMsg["state_topic"], w.stateTopic)
		}
	}
	t.Logf("✓ discovery: %d entities announced under %s/sensor/", len(wantEntities), discoveryPrefix)

	// --- 6) The values themselves ---
	steps := rec.await(t, prefix+"/daily/steps", func(v string) bool { return v == "1000" })
	if steps != "1000" {
		t.Fatalf("steps = %q, want 1000", steps)
	}
	rec.await(t, prefix+"/daily/active_energy", func(v string) bool { return v == "450" })
	rec.await(t, prefix+"/daily/resting_heart_rate", func(v string) bool { return v == "55" })
	// One hour asleep between the two-hour in-bed window: time asleep, not time in
	// bed — and one hour even though two sources describe it, because the overlap
	// counts once.
	rec.await(t, prefix+"/daily/sleep_hours", func(v string) bool { return v == "1.0" })
	// Two of the three rings reached their goal (energy 450/500 did not).
	rec.await(t, prefix+"/daily/rings_closed", func(v string) bool { return v == "2" })
	t.Logf("✓ daily summary: steps=1000, active_energy=450, rhr=55, sleep=1.0h, rings=2")

	// --- 7) The alert: freshness, and what the attributes say ---
	fresh := rec.await(t, prefix+"/sync/freshness_hours", func(v string) bool { return v != "" })
	hours, err := strconv.ParseFloat(fresh, 64)
	if err != nil {
		t.Fatalf("freshness = %q, which is not a number Home Assistant could use: %v", fresh, err)
	}
	if hours < 0 {
		t.Fatalf("freshness = %v: a negative age never crosses a threshold and silently disables the alert", hours)
	}
	attrs := rec.await(t, prefix+"/sync/attributes", func(v string) bool { return v != "" })
	var attrMap map[string]any
	if err := json.Unmarshal([]byte(attrs), &attrMap); err != nil {
		t.Fatalf("the attributes payload is not valid JSON: %v", err)
	}
	for _, key := range []string{"newest_data", "future_skew_s", "source"} {
		if _, ok := attrMap[key]; !ok {
			t.Errorf("no %q among the freshness attributes", key)
		}
	}
	t.Logf("✓ freshness: %v h, attributes %s", hours, attrs)

	// --- 8) What a LATE subscriber gets: the retain flags, checked the only way they can be ---
	//
	// ⚠️ Not from the messages above. MQTT delivers a retained message with the
	// retain flag CLEARED to a client that was already subscribed when it was
	// published; the flag is only set for a delivery caused by a NEW subscription.
	// Asserting on the first subscriber would therefore have proved nothing.
	//
	// So this is Home Assistant restarting: a fresh client subscribes and sees what
	// the broker has kept. The discovery documents must be there — that is what
	// makes the entities reappear — and the freshness state must NOT be, because a
	// replayed state resurrects an expired sensor with a stale value.
	late := newRecorder()
	lateSub := mqtt.NewClient(mqtt.NewClientOptions().
		AddBroker(broker).
		SetClientID(prefix + "-late").
		SetCleanSession(true))
	if tok := lateSub.Connect(); !tok.WaitTimeout(15*time.Second) || tok.Error() != nil {
		t.Fatalf("the late subscriber cannot connect: %v", tok.Error())
	}
	t.Cleanup(func() { lateSub.Disconnect(250) })
	for _, filter := range []string{prefix + "/#", discoveryPrefix + "/#"} {
		if tok := lateSub.Subscribe(filter, 1, late.handle); !tok.WaitTimeout(10*time.Second) || tok.Error() != nil {
			t.Fatalf("the late subscriber cannot subscribe to %s: %v", filter, tok.Error())
		}
	}
	for _, w := range wantEntities {
		topic := discoveryPrefix + "/sensor/" + w.object + "/config"
		late.await(t, topic, func(v string) bool { return v != "" })
		if !late.wasRetained(topic) {
			t.Errorf("%s: not delivered as retained — the entity would vanish on a Home Assistant restart", topic)
		}
	}
	late.await(t, prefix+"/status", func(v string) bool { return v == "online" })
	if !late.wasRetained(prefix + "/status") {
		t.Error("the availability topic must be retained, otherwise a late subscriber sees no availability at all")
	}
	// Half a second is generous for a local broker replaying its retained set.
	time.Sleep(500 * time.Millisecond)
	if v, seen := late.get(prefix + "/sync/freshness_hours"); seen {
		t.Errorf("the freshness state was replayed to a new subscriber (%q): it must not be retained", v)
	}
	t.Logf("✓ retention: discovery + availability survive a restart, the freshness state deliberately does not")

	// --- 9) Home Assistant restarts: the birth message must bring the entities back ---
	//
	// Retained discovery covers the ordinary case, but if somebody has cleared the
	// retained messages, only this makes the entities reappear — and their absence
	// is exactly the kind of failure nothing reports.
	topic := discoveryPrefix + "/sensor/helsa_steps/config"
	if tok := sub.Publish(topic, 1, true, ""); !tok.WaitTimeout(10*time.Second) || tok.Error() != nil {
		t.Fatalf("clearing the retained discovery message: %v", tok.Error())
	}
	rec.await(t, topic, func(v string) bool { return v == "" })

	if tok := sub.Publish(discoveryPrefix+"/status", 1, false, "online"); !tok.WaitTimeout(10*time.Second) || tok.Error() != nil {
		t.Fatalf("publishing the birth message: %v", tok.Error())
	}
	rec.await(t, topic, func(v string) bool { return v != "" })
	t.Logf("✓ birth message: discovery republished after a Home Assistant restart")

}

// seedForMQTT puts one day's worth of data in, through POST /v1/ingest — the same
// road a phone takes. Publishing numbers that never went through the ingest would
// prove nothing about the publisher.
func seedForMQTT(t *testing.T, e *env) {
	t.Helper()
	const tz = "Europe/Budapest"
	c, token, appleSub := e.client, e.token, e.appleSub

	tzDev := tz
	var dev api.Device
	if st := c.do(t, http.MethodPost, "/v1/devices", token, api.Device{
		Platform: "ios", Model: ptr("iPhone17,1"), Name: ptr("MQTT smoke iPhone"), TimeZone: &tzDev,
	}, &dev); st != http.StatusOK {
		t.Fatalf("POST devices status=%d", st)
	}

	loc, err := time.LoadLocation(tz)
	must(t, err, "loading the timezone")
	now := time.Now().In(loc)
	// Noon, so that "today" is the same calendar day in the user's timezone whenever
	// the test happens to run. Near midnight a sample stamped `now` and a day cut in
	// a different zone would land on different days.
	noon := time.Date(now.Year(), now.Month(), now.Day(), 12, 0, 0, 0, loc)
	if noon.After(now) {
		noon = now
	}

	var samples []api.SampleIn
	for i, v := range []float32{100, 200, 700} { // 1000 steps
		samples = append(samples, sample(appleSub, "stepCount", "count", noon.Add(-time.Duration(i)*time.Minute).UTC(), v, 900+i))
	}
	samples = append(samples, sample(appleSub, "activeEnergy", "kcal", noon.UTC(), 450, 950))
	samples = append(samples, sample(appleSub, "restingHeartRate", "count/min", noon.UTC(), 55, 960))

	// Two hours in bed, one of them asleep: the published figure must be the hour
	// asleep, not the two hours lying there — and not the two and a half a naive
	// sum would make of it, because a second source describes the same hour of
	// sleep in its own words (half deep, half core).
	inBed := api.SleepSegmentInStage("inBed")
	core := api.SleepSegmentInStage("asleepCore")
	deep := api.SleepSegmentInStage("asleepDeep")
	sleeps := []api.SleepSegmentIn{
		{SourceUuid: appleSub + "-mqtt-sl-bed", StartedAt: noon.Add(-8 * time.Hour).UTC(), EndedAt: noon.Add(-6 * time.Hour).UTC(), Stage: inBed},
		{SourceUuid: appleSub + "-mqtt-sl-core", StartedAt: noon.Add(-7 * time.Hour).UTC(), EndedAt: noon.Add(-6 * time.Hour).UTC(), Stage: core},
		{SourceUuid: appleSub + "-mqtt-sl-watch-1", StartedAt: noon.Add(-7 * time.Hour).UTC(), EndedAt: noon.Add(-390 * time.Minute).UTC(), Stage: deep},
		{SourceUuid: appleSub + "-mqtt-sl-watch-2", StartedAt: noon.Add(-390 * time.Minute).UTC(), EndedAt: noon.Add(-6 * time.Hour).UTC(), Stage: core},
	}

	// Exercise and stand reach their goal, move does not → two rings closed.
	today := openapi_types.Date{Time: now}
	ae, aeg, em, eg, sh, sg := float32(450), float32(500), float32(30), float32(30), float32(12), float32(12)
	activities := []api.ActivitySummary{{
		Day: &today, ActiveEnergy: &ae, ActiveEnergyGoal: &aeg,
		ExerciseMinutes: &em, ExerciseGoal: &eg, StandHours: &sh, StandGoal: &sg,
	}}

	tzc := tz
	if st := c.do(t, http.MethodPost, "/v1/ingest", token, api.IngestBatch{
		DeviceId: dev.Id, TimeZone: &tzc, Samples: &samples,
		SleepSegments: &sleeps, ActivitySummaries: &activities,
	}, nil); st != http.StatusAccepted {
		t.Fatalf("ingest status=%d (expected 202)", st)
	}

	// The worker writes asynchronously; the publisher must not be started against a
	// half-written day.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		var resp api.SummaryResponse
		st := c.do(t, http.MethodGet, "/v1/summary?range=day&metrics=stepCount&tz="+tz, token, nil, &resp)
		if st == http.StatusOK && resp.Metrics != nil {
			if ms, ok := (*resp.Metrics)["stepCount"]; ok && ms.Total != nil && *ms.Total >= 1000 {
				t.Logf("✓ seeded: 1000 steps, 450 kcal, rhr 55, 1h asleep, 2 rings")
				return
			}
		}
		time.Sleep(300 * time.Millisecond)
	}
	t.Fatal("the ingested data did not appear within the deadline")
}

// clearRetained empties every topic the run touched.
//
// Retained messages outlive the process that sent them, and a broker slowly
// filling with dead `helsa-smoke-*` trees is litter the next person has to work
// out. Every topic goes, not only the ones seen with the retain flag set: MQTT
// clears that flag on delivery to an already-subscribed client, so the recorder
// cannot tell which is which — and an empty publish to a topic that was never
// retained costs nothing.
func clearRetained(t *testing.T, c mqtt.Client, rec *recorder) {
	t.Helper()
	rec.mu.Lock()
	topics := make([]string, 0, len(rec.last))
	for topic := range rec.last {
		topics = append(topics, topic)
	}
	rec.mu.Unlock()

	for _, topic := range topics {
		if tok := c.Publish(topic, 1, true, ""); !tok.WaitTimeout(5 * time.Second) {
			t.Logf("could not clear the retained message on %s", topic)
		}
	}
}
