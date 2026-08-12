package hass

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/config"
)

// ⚠️ The rule that has to survive the trip out of the system: a missing
// measurement is missing, never zero. Home Assistant reads the literal payload
// `None` as `unknown` for a numeric sensor; a `0` would tell an automation "you
// walked nothing today" one minute past midnight.
func TestStateValueMissingIsNotZero(t *testing.T) {
	if got := stateValue(nil, 0); got != "None" {
		t.Errorf("missing value rendered as %q, want None", got)
	}
	if got := stateValue(f(0), 0); got != "0" {
		t.Errorf("a measured zero rendered as %q, want 0", got)
	}
	if got := stateValue(f(7.26), 1); got != "7.3" {
		t.Errorf("got %q, want 7.3", got)
	}
	if got := stateValue(f(12345.6), 0); got != "12346" {
		t.Errorf("got %q, want 12346", got)
	}
}

// Whoever does not run MQTT must get nothing: no connection attempt, no error, no
// process held up. The switch is the URL being empty.
func TestPublisherIsOffByDefault(t *testing.T) {
	cfg := config.MQTT{Prefix: "helsa", DiscoveryPrefix: "homeassistant"}
	if cfg.Enabled() {
		t.Fatal("an empty broker URL must mean disabled")
	}

	p := New(nil, slog.New(slog.DiscardHandler), cfg)
	done := make(chan error, 1)
	go func() { done <- p.Run(context.Background()) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("a disabled publisher must return cleanly, got %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("a disabled publisher blocked instead of returning immediately")
	}
	if p.client != nil {
		t.Error("a disabled publisher must not build an MQTT client")
	}
}

// A broker URL that is not a URL is a configuration mistake worth reporting; a
// broker that is merely down is not, and must not be confused with it.
func TestRunRejectsAnUnusableBrokerURL(t *testing.T) {
	p := New(nil, slog.New(slog.DiscardHandler), config.MQTT{URL: "mqtt://", ClientID: "helsa"})
	if err := p.Run(context.Background()); err == nil {
		t.Fatal("a broker URL with no host must be reported, not silently ignored")
	}
}

func TestRedactBrokerHidesThePassword(t *testing.T) {
	got := redactBroker("mqtt://helsa:s3cr3t@mqtt.lan:1883")
	if got != "mqtt://helsa@mqtt.lan:1883" {
		t.Errorf("redactBroker = %q; the password must never reach a log line", got)
	}
}
