//go:build smoke

package smoke

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/deletion"
	"github.com/nordic-sys/helsa/backend/internal/hass"
	"github.com/nordic-sys/helsa/backend/internal/queue"
)

// The household's broker-side promises (docs/36 §4.4, §4.6/4), against a REAL
// broker: what a member switched off, or what a deleted member left, is gone from
// the broker — even across a restart of the publisher (Codex S6, S12).
//
// Needs a broker, so it SKIPS unless HELSA_MQTT_URL is set (see mqtt_smoke_test.go).

// memberStepsTopic is where a non-legacy member's step count is retained.
func memberStepsTopic(prefix string, p *person) string {
	return prefix + "/" + strings.ReplaceAll(p.sub, "-", "_") + "_" + strings.ReplaceAll(p.userID.String(), "-", "")[:8] + "/daily/steps"
}

// startPublisher runs a publisher as the worker does, under a prefix of the test's
// own, pinned to a user that does not exist — so every member gets the household
// topic names, not the single-user ones. stop waits for it to say goodbye.
func startPublisher(t *testing.T, e *env, broker, prefix, client string) (pub *hass.Publisher, stop func()) {
	t.Helper()
	pub = hass.New(e.store.DB, slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelWarn})), config.MQTT{
		URL: broker, ClientID: prefix + "-" + client, Prefix: prefix, DiscoveryPrefix: prefix + "-ha",
		// One round only (the one at start-up): a later round would clear a member who
		// is no longer a target on its own, and hide whether the step under test did.
		Interval: time.Hour, FreshnessPeriod: time.Hour, ExpireAfter: 90 * time.Minute,
		UserID: uuid.NewString(),
	})
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- pub.Run(ctx) }()
	stopped := false
	stop = func() {
		if stopped {
			return
		}
		stopped = true
		cancel()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("publisher %s exited with %v", client, err)
			}
		case <-time.After(15 * time.Second):
			t.Errorf("publisher %s did not stop", client)
		}
	}
	t.Cleanup(stop)
	return pub, stop
}

// subscribe records everything under the prefix; the cleanup empties what it saw.
func subscribe(t *testing.T, broker, prefix, client string) (*recorder, mqtt.Client) {
	t.Helper()
	rec := newRecorder()
	c := mqtt.NewClient(mqtt.NewClientOptions().AddBroker(broker).SetClientID(prefix + "-" + client).SetCleanSession(true))
	if tok := c.Connect(); !tok.WaitTimeout(15*time.Second) || tok.Error() != nil {
		t.Fatalf("connect to %s: %v", broker, tok.Error())
	}
	for _, f := range []string{prefix + "/#", prefix + "-ha/#"} {
		if tok := c.Subscribe(f, 1, rec.handle); !tok.WaitTimeout(10*time.Second) || tok.Error() != nil {
			t.Fatalf("subscribe %s: %v", f, tok.Error())
		}
	}
	return rec, c
}

// retainedNow asks a NEW subscriber what the broker still holds for a topic — what
// Home Assistant would get on its next start. "" = nothing retained.
func retainedNow(t *testing.T, broker, topic string) string {
	t.Helper()
	got := make(chan string, 1)
	c := mqtt.NewClient(mqtt.NewClientOptions().AddBroker(broker).SetClientID("late-" + uuid.NewString()[:8]).SetCleanSession(true))
	if tok := c.Connect(); !tok.WaitTimeout(15*time.Second) || tok.Error() != nil {
		t.Fatalf("connect: %v", tok.Error())
	}
	defer c.Disconnect(100)
	c.Subscribe(topic, 1, func(_ mqtt.Client, m mqtt.Message) {
		select {
		case got <- string(m.Payload()):
		default:
		}
	}).WaitTimeout(10 * time.Second)
	select {
	case v := <-got:
		return v
	case <-time.After(1500 * time.Millisecond):
		return ""
	}
}

func setPublish(t *testing.T, e *env, p *person, on bool) {
	t.Helper()
	_, err := e.store.DB.Exec(context.Background(), `UPDATE users SET ha_publish = $2 WHERE id = $1`, p.userID, on)
	must(t, err, "ha_publish")
}

// A member switches publishing off while the publisher is down. The new process
// has no memory of having published them, and must clear their topics anyway.
// (Mutation-checked: with the sweep skipped, the retained step count stays.)
func TestAnOptOutIsClearedEvenAcrossARestart(t *testing.T) {
	broker := os.Getenv("HELSA_MQTT_URL")
	if broker == "" {
		t.Skip("HELSA_MQTT_URL is not set — no broker to test against (cd ../deploy && make mqtt-up)")
	}
	e := newEnv(t)
	prefix := fmt.Sprintf("helsa-smoke-optout-%d", time.Now().UnixNano())
	a := addPerson(t, e, "a", "Europe/Budapest", 412347, 61.37, 451.5, 1234.5, 47.1111)
	a.upload(t, e.client, map[string]bool{})
	waitForSteps(t, e, a)
	setPublish(t, e, a, true)

	rec, sub := subscribe(t, broker, prefix, "sub")
	t.Cleanup(func() { sub.Disconnect(100) })
	t.Cleanup(func() { clearRetained(t, sub, rec) })
	topic := memberStepsTopic(prefix, a)

	_, stopFirst := startPublisher(t, e, broker, prefix, "pub1")
	rec.await(t, topic, func(v string) bool { return v != "" })
	stopFirst()

	setPublish(t, e, a, false)
	startPublisher(t, e, broker, prefix, "pub2")
	rec.await(t, topic, func(v string) bool { return v == "" })
	if v := retainedNow(t, broker, topic); v != "" {
		t.Errorf("after the opt-out and a restart the broker still holds %s = %q", topic, v)
	}
}

// The deletion job's two outward stages: the member's dead-lettered batches leave
// the queue, their retained topics leave the broker — and the other member's of
// both stay (docs/36 §4.6, C21; S12). The DLQ part runs without a broker too.
func TestDeletionClearsTheQueueAndTheBroker(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	a := addPerson(t, e, "a", "Europe/Budapest", 412347, 61.37, 451.5, 1234.5, 47.1111)
	b := addPerson(t, e, "b", "America/Chicago", 523459, 87.29, 612.75, 2345.5, 46.2222)
	for _, p := range []*person{a, b} {
		p.upload(t, e.client, map[string]bool{})
		waitForSteps(t, e, p)
	}

	// A queue of the test's own, with two stuck batches of each member.
	name := "helsa.ingest.delsmoke." + uuid.NewString()[:8]
	q, err := queue.Open(e.cfg.RabbitMQURL, name)
	must(t, err, "queue")
	q.UseSharedLock(e.store.Redis)
	conn, err := amqp.Dial(e.cfg.RabbitMQURL)
	must(t, err, "amqp")
	ch, err := conn.Channel()
	must(t, err, "channel")
	t.Cleanup(func() {
		_, _ = ch.QueueDelete(name, false, false, false)
		_, _ = ch.QueueDelete(name+".dlq", false, false, false)
		_ = conn.Close()
		_ = q.Close()
	})
	for _, p := range []*person{a, b, a, b} {
		body := fmt.Sprintf(`{"user_id":%q,"batch":{"marker":%q}}`, p.userID, p.sub)
		must(t, ch.PublishWithContext(ctx, "", name+".dlq", false, false, amqp.Publishing{
			ContentType: "application/json", DeliveryMode: amqp.Persistent, Body: []byte(body),
		}), "dead-letter")
	}
	depth := func() int {
		qi, err := ch.QueueDeclarePassive(name+".dlq", true, false, false, false, nil)
		must(t, err, "depth")
		return qi.Messages
	}
	for i := 0; i < 50 && depth() != 4; i++ {
		time.Sleep(50 * time.Millisecond)
	}

	r := &deletion.Runner{Pool: openAs(t, ctx, e.cfg, "HELSA_SMOKE_WORKER_DATABASE_URL", "helsa_worker").DB,
		Redis: e.store.Redis, Queue: q, Log: slog.New(slog.NewTextHandler(os.Stdout, nil))}

	broker := os.Getenv("HELSA_MQTT_URL")
	var prefix string
	if broker != "" {
		prefix = fmt.Sprintf("helsa-smoke-del-%d", time.Now().UnixNano())
		setPublish(t, e, a, true)
		setPublish(t, e, b, true)
		rec, sub := subscribe(t, broker, prefix, "sub")
		t.Cleanup(func() { sub.Disconnect(100) })
		t.Cleanup(func() { clearRetained(t, sub, rec) })
		pub, _ := startPublisher(t, e, broker, prefix, "pub")
		rec.await(t, memberStepsTopic(prefix, a), func(v string) bool { return v != "" })
		rec.await(t, memberStepsTopic(prefix, b), func(v string) bool { return v != "" })
		r.MQTT = pub.ForgetUser
	} else {
		t.Log("HELSA_MQTT_URL is not set: the broker stage is not checked, only the queue")
	}

	_, err = e.store.DB.Exec(ctx, `INSERT INTO deletion_jobs (user_id, handle) VALUES ($1, $2)`, a.userID, a.sub)
	must(t, err, "job")
	for {
		worked, err := r.RunOne(ctx)
		must(t, err, "run")
		if !worked {
			break
		}
	}

	// The queue: a's two are gone, b's two are there, unchanged.
	if n := depth(); n != 2 {
		t.Errorf("the dead-letter queue holds %d after the deletion, want b's 2", n)
	}
	for i := 0; i < 2; i++ {
		d, ok, err := ch.Get(name+".dlq", true)
		if err != nil || !ok {
			t.Fatalf("get: %v %v", ok, err)
		}
		if !strings.Contains(string(d.Body), b.sub) {
			t.Errorf("a batch left in the dead-letter queue is not b's: %s", d.Body)
		}
	}

	if broker == "" {
		return
	}
	if v := retainedNow(t, broker, memberStepsTopic(prefix, a)); v != "" {
		t.Errorf("the deleted member's step count is still retained: %q", v)
	}
	if v := retainedNow(t, broker, memberStepsTopic(prefix, b)); v == "" {
		t.Error("the other member's step count was cleared by somebody else's deletion")
	}
}
