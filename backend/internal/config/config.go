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
}

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
