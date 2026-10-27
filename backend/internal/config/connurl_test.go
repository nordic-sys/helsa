package config

import (
	"errors"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	amqp "github.com/rabbitmq/amqp091-go"
)

// The passwords the documentation's `openssl rand -base64 36` produces: `/`, `+`
// and `=`. The second one starts with digits before its slash — the case that
// does not fail to parse, but parses into the wrong host.
const (
	b64Pass      = "q8/Zk+3vR1x9/TbE+uWm7nA2pL0sYc4dHf6gJe5iKo=="
	b64DigitPass = "123/Zk+3vR1x9TbE+uWm7nA2pL0sYc4dHf6gJe5iKo="
)

func TestNormalizeRepairsABase64PasswordInAPostgresURL(t *testing.T) {
	for _, pass := range []string{b64Pass, b64DigitPass} {
		raw := "postgres://helsa:" + pass + "@timescaledb:5432/helsa?sslmode=disable"
		got := NormalizeConnURL(raw)

		u, err := url.Parse(got)
		if err != nil {
			t.Fatalf("%q still does not parse: %v", got, err)
		}
		if u.Hostname() != "timescaledb" || u.Port() != "5432" || u.Path != "/helsa" {
			t.Fatalf("the repaired URL points elsewhere: host=%q port=%q path=%q", u.Hostname(), u.Port(), u.Path)
		}
		if p, _ := u.User.Password(); p != pass || u.User.Username() != "helsa" {
			t.Fatalf("credentials changed: %q / %q", u.User.Username(), p)
		}
		if u.Query().Get("sslmode") != "disable" {
			t.Fatalf("query lost: %q", u.RawQuery)
		}

		// And the client that actually reads it agrees.
		cfg, err := pgxpool.ParseConfig(got)
		if err != nil {
			t.Fatalf("pgx refuses the repaired URL: %v", err)
		}
		if cfg.ConnConfig.Password != pass || cfg.ConnConfig.Host != "timescaledb" || cfg.ConnConfig.Database != "helsa" {
			t.Fatalf("pgx reads host=%q db=%q password ok=%v", cfg.ConnConfig.Host, cfg.ConnConfig.Database, cfg.ConnConfig.Password == pass)
		}
	}
}

func TestNormalizeRepairsABase64PasswordInAnAMQPURL(t *testing.T) {
	for _, pass := range []string{b64Pass, b64DigitPass} {
		raw := "amqp://helsa:" + pass + "@rabbitmq:5672/"
		got := NormalizeConnURL(raw)

		uri, err := amqp.ParseURI(got)
		if err != nil {
			t.Fatalf("the AMQP client still refuses %q: %v", got, err)
		}
		if uri.Host != "rabbitmq" || uri.Port != 5672 || uri.Username != "helsa" || uri.Password != pass || uri.Vhost != "/" {
			t.Fatalf("parsed into host=%q port=%d user=%q vhost=%q password ok=%v",
				uri.Host, uri.Port, uri.Username, uri.Vhost, uri.Password == pass)
		}
	}
}

// A password containing `@` is split at the LAST `@` — a host never has one.
func TestNormalizeHandlesAnAtSignInThePassword(t *testing.T) {
	got := NormalizeConnURL("amqp://helsa:a@b/c@rabbitmq:5672/")
	uri, err := amqp.ParseURI(got)
	if err != nil || uri.Password != "a@b/c" || uri.Host != "rabbitmq" {
		t.Fatalf("got %q → %+v, %v", got, uri, err)
	}
}

func TestNormalizeLeavesValidURLsAlone(t *testing.T) {
	for _, raw := range []string{
		// The dev defaults.
		"postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable",
		"amqp://helsa:helsa_local_dev@localhost:5672/",
		// Hex passwords, the other advice.
		"amqp://helsa:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08@rabbitmq:5672/",
		// `+` and `=` are legal in a userinfo as they are.
		"postgres://helsa:ab+cd=@timescaledb:5432/helsa?sslmode=disable",
		// Already percent-encoded by hand: must not be encoded a second time.
		"amqp://helsa:q8%2FZk+3vR1x9%2FTbE@rabbitmq:5672/",
		// No credentials, no scheme, nothing at all.
		"mqtt://192.168.1.10:1883",
		"localhost:6380",
		"",
	} {
		if got := NormalizeConnURL(raw); got != raw {
			t.Errorf("a valid URL was rewritten:\n  in:  %q\n  out: %q", raw, got)
		}
	}
}

func TestRedactURLWorksOnAnUnparseableURL(t *testing.T) {
	raw := "amqp://helsa:" + b64Pass + "@rabbitmq:5672/"
	got := RedactURL(raw)
	if strings.Contains(got, "Zk+3vR1x9") {
		t.Fatalf("password survived: %q", got)
	}
	if got != "amqp://helsa:xxxxx@rabbitmq:5672/" {
		t.Fatalf("got %q", got)
	}
}

// The incident, reproduced: the raw URL handed straight to the AMQP client, whose
// error quoted it whole. After RedactURLError, no piece of the password is left.
func TestRedactURLErrorScrubsTheAMQPParseError(t *testing.T) {
	raw := "amqp://helsa:" + b64Pass + "@rabbitmq:5672/"
	_, err := amqp.ParseURI(raw)
	if err == nil {
		t.Fatal("expected the raw URL to be refused — the premise of this test")
	}
	if !strings.Contains(err.Error(), b64Pass) {
		t.Fatalf("expected the client to echo the password (it did on 2026-10-27); got %q", err)
	}
	assertNoPasswordPiece(t, RedactURLError(err, raw).Error(), b64Pass)
}

// pgx redacts its own connection string, but its "invalid port" detail quotes the
// password up to the first slash. That fragment must go too.
func TestRedactScrubsThePgxPortFragment(t *testing.T) {
	cfg := &Config{DatabaseURL: "postgres://helsa:" + b64Pass + "@timescaledb:5432/helsa"}
	_, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err == nil {
		t.Fatal("expected the raw URL to be refused — the premise of this test")
	}
	assertNoPasswordPiece(t, Redact(err, cfg.Secrets()...).Error(), b64Pass)
}

func TestRedactCoversEverySecretInTheConfig(t *testing.T) {
	cfg := &Config{
		DatabaseURL:   "postgres://helsa:pg-" + b64Pass + "@timescaledb:5432/helsa",
		RabbitMQURL:   "amqp://helsa:mq%2Fsecret-value@rabbitmq:5672/",
		RedisPassword: "redis-secret-value",
		JWTSecret:     "jwt-secret-value",
	}
	msg := "pg-" + b64Pass + " | mq%2Fsecret-value | mq/secret-value | redis-secret-value | jwt-secret-value"
	got := Redact(errors.New(msg), cfg.Secrets()...).Error()
	for _, leak := range []string{"Zk+3vR1x9", "secret-value", "mq%2F"} {
		if strings.Contains(got, leak) {
			t.Errorf("%q survived in %q", leak, got)
		}
	}
}

func TestRedactLeavesACleanErrorUntouched(t *testing.T) {
	orig := errors.New("dial tcp 172.18.0.3:5672: connect: connection refused")
	if got := Redact(orig, "helsa_local_dev"); got != orig {
		t.Fatalf("an error with no secret in it was replaced: %v", got)
	}
	if Redact(nil, "x") != nil {
		t.Fatal("nil must stay nil")
	}
}

func TestLoadNormalizesTheConnectionURLs(t *testing.T) {
	t.Setenv("HELSA_DATABASE_URL", "postgres://helsa:"+b64Pass+"@timescaledb:5432/helsa?sslmode=disable")
	t.Setenv("HELSA_RABBITMQ_URL", "amqp://helsa:"+b64Pass+"@rabbitmq:5672/")
	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := amqp.ParseURI(c.RabbitMQURL); err != nil {
		t.Errorf("RabbitMQ URL not repaired: %v", err)
	}
	if _, err := pgxpool.ParseConfig(c.DatabaseURL); err != nil {
		t.Errorf("database URL not repaired: %v", err)
	}
}

func assertNoPasswordPiece(t *testing.T, msg, pass string) {
	t.Helper()
	for _, piece := range append([]string{pass}, strings.FieldsFunc(pass, isURLDelimiter)...) {
		if len(piece) >= 4 && strings.Contains(msg, piece) {
			t.Fatalf("a piece of the password (%q) survived in: %s", piece, msg)
		}
	}
}
