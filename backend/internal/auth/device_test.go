package auth

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
)

// A device token carries its device's name and still verifies as before: the
// label rides along, the user in `sub` is what VerifyAccess returns.
func TestDeviceTokenCarriesItsLabelAndVerifies(t *testing.T) {
	svc, _ := serviceWithFake(t)
	user := uuid.New()
	now := time.Now()

	tok, exp, err := svc.signAccess(user, "iphone", now)
	if err != nil {
		t.Fatal(err)
	}
	if got := TokenDevice(tok); got != "iphone" {
		t.Errorf("device label: %q", got)
	}
	if d := exp.Sub(now); d < svc.cfg.AccessTokenTTL-time.Second || d > svc.cfg.AccessTokenTTL {
		t.Errorf("reported expiry is %v after issue, the TTL is %v", d, svc.cfg.AccessTokenTTL)
	}
	id, err := svc.VerifyAccess(context.Background(), tok)
	if err != nil || id != user {
		t.Fatalf("VerifyAccess = %v, %v; want %v", id, err, user)
	}
}

// Two devices, one user: both tokens resolve to the same user, and revoking one
// leaves the other working — the single-user model the token tool now follows.
func TestTwoDevicesOneUserRevokeOne(t *testing.T) {
	svc, _ := serviceWithFake(t)
	user := uuid.New()
	phone, _, _ := svc.signAccess(user, "iphone", time.Now())
	browser, _, _ := svc.signAccess(user, "browser", time.Now())

	if _, err := svc.Revoke(context.Background(), browser); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyAccess(context.Background(), browser); err != ErrRevoked {
		t.Errorf("the revoked browser token: %v", err)
	}
	if id, err := svc.VerifyAccess(context.Background(), phone); err != nil || id != user {
		t.Errorf("the phone token after revoking the browser's: %v, %v", id, err)
	}
}

// A token minted before the label existed has none, and that is not an error.
func TestTokenDeviceOnAnOldToken(t *testing.T) {
	svc, _ := serviceWithFake(t)
	tok, _ := mint(t, svc, time.Hour)
	if got := TokenDevice(tok); got != "" {
		t.Errorf("an unlabelled token reported %q", got)
	}
	if got := TokenDevice("not a jwt"); got != "" {
		t.Errorf("garbage reported %q", got)
	}
}
