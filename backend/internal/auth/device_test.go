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
	svc, _, state := serviceWithFakes(t)
	user := uuid.New()
	state.addUser(user, RoleMember)
	now := time.Now()

	sess, err := svc.IssueDeviceToken(context.Background(), user, "iphone", uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := TokenDevice(sess.AccessToken); got != "iphone" {
		t.Errorf("device label: %q", got)
	}
	if d := sess.ExpiresAt.Sub(now); d < svc.cfg.DeviceTokenTTL-time.Second || d > svc.cfg.DeviceTokenTTL {
		t.Errorf("reported expiry is %v after issue, the TTL is %v", d, svc.cfg.DeviceTokenTTL)
	}
	p, err := svc.VerifyAccess(context.Background(), sess.AccessToken)
	if err != nil || p.UserID != user || p.TokenID != sess.TokenID || p.Label != "iphone" {
		t.Fatalf("VerifyAccess = %+v, %v; want user %v, token %v", p, err, user, sess.TokenID)
	}
}

// Two devices, one user: both tokens resolve to the same user, and revoking one
// leaves the other working — the single-user model the token tool now follows.
func TestTwoDevicesOneUserRevokeOne(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	user := uuid.New()
	state.addUser(user, RoleMember)
	p1, _ := svc.IssueDeviceToken(context.Background(), user, "iphone", uuid.Nil)
	p2, _ := svc.IssueDeviceToken(context.Background(), user, "browser", uuid.Nil)
	phone, browser := p1.AccessToken, p2.AccessToken

	if _, err := svc.Revoke(context.Background(), browser); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyAccess(context.Background(), browser); err != ErrRevoked {
		t.Errorf("the revoked browser token: %v", err)
	}
	if p, err := svc.VerifyAccess(context.Background(), phone); err != nil || p.UserID != user {
		t.Errorf("the phone token after revoking the browser's: %v, %v", p, err)
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
