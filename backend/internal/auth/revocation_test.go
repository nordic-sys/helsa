package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/config"
)

// The documentation told operators for months that a compromised device could be logged
// out on its own. It could not: the token was checked for signature and expiry and
// nothing else, so a year-long device token outlived any attempt to stop it, and the
// only real lever — rotating the signing secret — logged out every device at once.
//
// These tests are the claim, written down.

// fakeDenyList is a map with a switch for breaking.
type fakeDenyList struct {
	keys   map[string]bool
	broken bool
}

func newFake() *fakeDenyList { return &fakeDenyList{keys: map[string]bool{}} }

func (f *fakeDenyList) Get(_ context.Context, key string) *redis.StringCmd {
	if f.broken {
		return redis.NewStringResult("", errors.New("connection refused"))
	}
	if f.keys[key] {
		return redis.NewStringResult("1", nil)
	}
	return redis.NewStringResult("", redis.Nil)
}

func (f *fakeDenyList) Set(_ context.Context, key string, _ any, ttl time.Duration) *redis.StatusCmd {
	if f.broken {
		return redis.NewStatusResult("", errors.New("connection refused"))
	}
	if ttl <= 0 {
		return redis.NewStatusResult("", errors.New("a deny-list entry without a TTL would never expire"))
	}
	f.keys[key] = true
	return redis.NewStatusResult("OK", nil)
}

func serviceWithFake(t *testing.T) (*Service, *fakeDenyList) {
	t.Helper()
	fake := newFake()
	return &Service{
		cfg:  &config.Config{JWTSecret: "test-secret-for-revocation", AccessTokenTTL: time.Hour},
		deny: fake,
	}, fake
}

func mint(t *testing.T, s *Service, life time.Duration) (string, uuid.UUID) {
	t.Helper()
	id := uuid.New()
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   id.String(),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(life)),
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		t.Fatalf("mint: %v", err)
	}
	return tok, id
}

func TestARevokedTokenStopsWorking(t *testing.T) {
	svc, _ := serviceWithFake(t)
	tok, id := mint(t, svc, time.Hour)

	got, err := svc.VerifyAccess(context.Background(), tok)
	if err != nil || got != id {
		t.Fatalf("before revocation the token must work: %v %v", got, err)
	}
	if _, err := svc.Revoke(context.Background(), tok); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if _, err := svc.VerifyAccess(context.Background(), tok); !errors.Is(err, ErrRevoked) {
		t.Fatalf("after revocation want ErrRevoked, got %v", err)
	}
}

func TestRevokingOneDeviceLeavesTheOthersAlone(t *testing.T) {
	// The whole point. Rotating the signing secret already stopped everything; what was
	// missing was stopping ONE thing.
	svc, _ := serviceWithFake(t)
	phone, _ := mint(t, svc, time.Hour)
	browser, browserID := mint(t, svc, time.Hour)

	if _, err := svc.Revoke(context.Background(), phone); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	got, err := svc.VerifyAccess(context.Background(), browser)
	if err != nil || got != browserID {
		t.Fatalf("the other device must be untouched: %v %v", got, err)
	}
}

func TestAnUnreadableDenyListRefusesEverything(t *testing.T) {
	// ⚠️ The test this interface exists for. A deny-list that fails OPEN can be bypassed
	// by taking Redis down, which makes every revocation conditional on the attacker's
	// good manners. Redis is already in `/readyz`, so refusing here makes the data path
	// agree with the probe rather than quietly outliving it.
	svc, fake := serviceWithFake(t)
	tok, _ := mint(t, svc, time.Hour)
	fake.broken = true

	_, err := svc.VerifyAccess(context.Background(), tok)
	if err == nil {
		t.Fatal("an unreachable deny-list must not let a request through")
	}
	if errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrRevoked) {
		t.Fatalf("the failure must be distinguishable from a bad token, so the caller can "+
			"answer 503 rather than 401: %v", err)
	}
}

func TestRevokingAnExpiredTokenSaysSoRatherThanPretending(t *testing.T) {
	// A deny-list entry for a token that is already dead would be a row that can never
	// be used, and answering "revoked" would tell an operator they had done something.
	svc, fake := serviceWithFake(t)
	tok, _ := mint(t, svc, -time.Minute)

	if _, err := svc.Revoke(context.Background(), tok); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized for an expired token, got %v", err)
	}
	if len(fake.keys) != 0 {
		t.Fatal("nothing should have been written for an already-dead token")
	}
}

func TestTheDenyListEntryOutlivesTheTokenByNothing(t *testing.T) {
	// The entry's TTL is the token's remaining life: after that the JWT is refused on
	// expiry anyway, and a list that only grows is its own kind of outage.
	svc, _ := serviceWithFake(t)
	tok, _ := mint(t, svc, 42*time.Minute)

	expiry, err := svc.Revoke(context.Background(), tok)
	if err != nil {
		t.Fatalf("revoke: %v", err)
	}
	if d := time.Until(expiry); d > 42*time.Minute || d < 41*time.Minute {
		t.Fatalf("the reported expiry should be the token's own, got %v away", d)
	}
}

func TestTheDenyListNeverHoldsTheTokenItself(t *testing.T) {
	// A readable deny-list should not be a list of working credentials.
	svc, fake := serviceWithFake(t)
	tok, _ := mint(t, svc, time.Hour)
	if _, err := svc.Revoke(context.Background(), tok); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	for key := range fake.keys {
		if len(key) != len("revoked:")+64 {
			t.Fatalf("the key should be a sha256 hex digest, got %q", key)
		}
		if key == "revoked:"+tok {
			t.Fatal("the token itself must not be the key")
		}
	}
}
