package main

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func row(sub string) userRow {
	return userRow{ID: uuid.New(), AppleSub: sub, CreatedAt: time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)}
}

// An empty database: the first token creates the one user.
func TestResolveUserCreatesOnAnEmptyDatabase(t *testing.T) {
	res, err := resolveUser(nil, "")
	if err != nil || res.create != newOwnerSub {
		t.Fatalf("got %+v, %v; want create %q", res, err, newOwnerSub)
	}
	// With -user, that name becomes the apple_sub (the old dev: prefix dropped).
	res, err = resolveUser(nil, "dev:bob")
	if err != nil || res.create != "bob" {
		t.Fatalf("got %+v, %v; want create bob", res, err)
	}
}

// ⚠️ The existing installations: one user, left behind by the old default
// `-subject bob`. Every device name must bind to it — that is the whole fix.
func TestResolveUserBindsEveryDeviceToTheOneUser(t *testing.T) {
	bob := row("bob")
	for _, explicit := range []string{"", "bob", "dev:bob", bob.ID.String(), strings.ToUpper(bob.ID.String())} {
		res, err := resolveUser([]userRow{bob}, explicit)
		if err != nil || res.create != "" || res.user.ID != bob.ID {
			t.Errorf("-user %q: got %+v, %v; want the existing user", explicit, res, err)
		}
	}
}

// Several users: no guessing, and the refusal lists them so the operator can choose.
func TestResolveUserRefusesToGuessAmongSeveral(t *testing.T) {
	users := []userRow{row("bob"), row("browser"), row("ipad")}
	_, err := resolveUser(users, "")
	if err == nil {
		t.Fatal("expected a refusal with several users")
	}
	for _, u := range users {
		if !strings.Contains(err.Error(), u.ID.String()) || !strings.Contains(err.Error(), u.AppleSub) {
			t.Errorf("the refusal does not list %s (%s): %v", u.ID, u.AppleSub, err)
		}
	}
	if !strings.Contains(err.Error(), "-user") || !strings.Contains(err.Error(), "TOKEN_USER") {
		t.Errorf("the refusal does not say how to choose: %v", err)
	}

	// An explicit choice settles it — by apple_sub or by id.
	if res, err := resolveUser(users, "bob"); err != nil || res.user.ID != users[0].ID {
		t.Errorf("-user bob: %+v, %v", res, err)
	}
	if res, err := resolveUser(users, users[2].ID.String()); err != nil || res.user.ID != users[2].ID {
		t.Errorf("-user <id>: %+v, %v", res, err)
	}
}

// A -user that matches nobody on a non-empty database is an error, not a quiet
// second user — that would rebuild exactly the empty-dashboard trap.
func TestResolveUserDoesNotCreateASecondUser(t *testing.T) {
	users := []userRow{row("bob")}
	_, err := resolveUser(users, "alice")
	if err == nil || !strings.Contains(err.Error(), users[0].ID.String()) {
		t.Fatalf("got %v; want a refusal that lists the existing user", err)
	}
}
