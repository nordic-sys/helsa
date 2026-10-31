package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// The tokens from before the register (docs/36 W4): no row to list or revoke, so
// one instant on the user's row refuses every one of them issued until then.

func mintLegacyAt(t *testing.T, s *Service, user uuid.UUID, issued *time.Time) string {
	t.Helper()
	claims := jwt.RegisteredClaims{Subject: user.String(), ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour))}
	if issued != nil {
		claims.IssuedAt = jwt.NewNumericDate(*issued)
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestRevokingTheOldTokensRefusesEveryOneIssuedUntilThen(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	ctx := context.Background()
	old, user := mint(t, svc, time.Hour)
	if _, err := svc.VerifyAccess(ctx, old); err != nil {
		t.Fatalf("an old token before any revoke: %v", err)
	}
	if state.legacyTouched != 1 {
		t.Errorf("an accepted old token marked its use %d times, want 1", state.legacyTouched)
	}
	// The register's own token of the same person keeps working, and marks nothing old.
	sess, err := svc.IssueDeviceToken(ctx, user, "iphone", uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}

	row := state.users[user]
	row.LegacyTokensRevokedAt = pgconv.Timestamptz(time.Now())
	state.users[user] = row

	if _, err := svc.VerifyAccess(ctx, old); !errors.Is(err, ErrRevoked) {
		t.Errorf("an old token after the revoke: %v, want ErrRevoked", err)
	}
	if _, err := svc.VerifyAccess(ctx, sess.AccessToken); err != nil {
		t.Errorf("a registered token of the same member after the revoke: %v", err)
	}
	if state.legacyTouched != 1 {
		t.Errorf("a refused or registered token marked old-token use: %d, want still 1", state.legacyTouched)
	}

	later := time.Now().Add(2 * time.Second)
	if _, err := svc.VerifyAccess(ctx, mintLegacyAt(t, svc, user, &later)); err != nil {
		t.Errorf("a jti-less token issued AFTER the revoke: %v", err)
	}
	// Without an issue time there is nothing to show it is newer.
	if _, err := svc.VerifyAccess(ctx, mintLegacyAt(t, svc, user, nil)); !errors.Is(err, ErrRevoked) {
		t.Errorf("a jti-less token with no iat after the revoke: %v, want ErrRevoked", err)
	}
}

func TestRevokingOneOldTokenByItsTextClearsTheInUseMark(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	old, _ := mint(t, svc, time.Hour)
	if _, err := svc.Revoke(context.Background(), old); err != nil {
		t.Fatal(err)
	}
	if state.legacyCleared != 1 {
		t.Errorf("the in-use mark was cleared %d times, want 1", state.legacyCleared)
	}
}
