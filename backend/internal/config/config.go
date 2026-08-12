// Package config reads the 12-factor, env-based configuration.
//
// Deliberately dependency-free (plain os.Getenv instead of viper/envconfig):
// with this few fields it stays readable, and the defaults point at the running
// local dev infrastructure (the deploy/ docker-compose) — see ../../deploy/.env.
package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	HTTPAddr string // API listen address, e.g. ":8080"

	DatabaseURL   string // pgx connection string
	RedisAddr     string // host:port
	RedisPassword string
	RabbitMQURL   string // amqp://...

	IngestQueue string // name of the queue the API publishes to and the worker consumes

	// Auth
	JWTSecret       string        // HMAC secret for the session JWT
	AccessTokenTTL  time.Duration // short lifetime
	RefreshTokenTTL time.Duration
	AppleAudiences  []string // accepted audiences (native bundleID + web serviceID)
	AppleIssuer     string   // https://appleid.apple.com
	AuthDevMode     bool     // if true, /auth/apple accepts the "dev:<apple_sub>" token without JWKS (local smoke)

	// Home Assistant over MQTT — OFF unless MQTTURL is set.
	MQTT MQTT
}

// MQTT configures the Home Assistant publisher (internal/hass).
//
// ⚠️ The feature is OFF by default, and the switch is the broker URL being empty.
// A boolean "enabled" flag next to a URL only adds a way to disagree with itself:
// enabled with no URL, or a URL that does nothing. One field, one meaning.
type MQTT struct {
	URL             string        // mqtt://user:pass@host:1883 — empty means the publisher does not start
	ClientID        string        // MQTT client identifier
	Prefix          string        // topic root for Helsa's own topics, e.g. "helsa"
	DiscoveryPrefix string        // Home Assistant's discovery root, e.g. "homeassistant"
	Interval        time.Duration // how often the daily summaries are republished
	FreshnessPeriod time.Duration // how often the sync-freshness heartbeat is published
	ExpireAfter     time.Duration // the heartbeat's expire_after — how long HA waits before calling it unavailable
	UserID          string        // pin the published user; empty means "the only user, if there is exactly one"
}

// Enabled reports whether the Home Assistant publisher should start at all.
func (m MQTT) Enabled() bool { return m.URL != "" }

// Load reads from the environment; the local dev defaults point at the ports
// published by the deploy/ compose stack.
func Load() (*Config, error) {
	c := &Config{
		HTTPAddr:        env("HELSA_HTTP_ADDR", ":8080"),
		DatabaseURL:     env("HELSA_DATABASE_URL", "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable"),
		RedisAddr:       env("HELSA_REDIS_ADDR", "localhost:6380"),
		RedisPassword:   env("HELSA_REDIS_PASSWORD", "helsa_local_dev"),
		RabbitMQURL:     env("HELSA_RABBITMQ_URL", "amqp://helsa:helsa_local_dev@localhost:5672/"),
		IngestQueue:     env("HELSA_INGEST_QUEUE", "helsa.ingest"),
		JWTSecret:       env("HELSA_JWT_SECRET", "dev-only-insecure-secret-change-me"),
		AccessTokenTTL:  envDuration("HELSA_ACCESS_TTL", 15*time.Minute),
		RefreshTokenTTL: envDuration("HELSA_REFRESH_TTL", 30*24*time.Hour),
		AppleAudiences:  envList("HELSA_APPLE_AUDIENCES", []string{"com.nordic-sys.Helsa"}),
		AppleIssuer:     env("HELSA_APPLE_ISSUER", "https://appleid.apple.com"),
		AuthDevMode:     envBool("HELSA_AUTH_DEV_MODE", false),
		MQTT: MQTT{
			URL:             env("HELSA_MQTT_URL", ""),
			ClientID:        env("HELSA_MQTT_CLIENT_ID", "helsa"),
			Prefix:          env("HELSA_MQTT_PREFIX", "helsa"),
			DiscoveryPrefix: env("HELSA_MQTT_DISCOVERY_PREFIX", "homeassistant"),
			Interval:        envDuration("HELSA_MQTT_PUBLISH_INTERVAL", 6*time.Hour),
			FreshnessPeriod: envDuration("HELSA_MQTT_FRESHNESS_INTERVAL", 15*time.Minute),
			// 90 minutes: six missed 15-minute heartbeats. Long enough that a reboot or a
			// broker restart does not raise an alarm, short enough that a genuinely dead
			// host is noticed the same morning.
			ExpireAfter: envDuration("HELSA_MQTT_EXPIRE_AFTER", 90*time.Minute),
			UserID:      env("HELSA_MQTT_USER_ID", ""),
		},
	}
	if c.JWTSecret == "" {
		return nil, fmt.Errorf("HELSA_JWT_SECRET is required")
	}
	return c, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envBool(key string, def bool) bool {
	if v := os.Getenv(key); v != "" {
		b, err := strconv.ParseBool(v)
		if err == nil {
			return b
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		d, err := time.ParseDuration(v)
		if err == nil {
			return d
		}
	}
	return def
}

func envList(key string, def []string) []string {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	var out []string
	start := 0
	for i := 0; i <= len(v); i++ {
		if i == len(v) || v[i] == ',' {
			if i > start {
				out = append(out, v[start:i])
			}
			start = i + 1
		}
	}
	return out
}
