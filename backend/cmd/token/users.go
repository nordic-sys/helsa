package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Which user a device token belongs to.
//
// ⚠️ Until 2026-10-27 the device name WAS the user: `-subject browser` upserted a
// `users` row with handle `browser`, so every device got its own, empty data
// space. The documentation said "one token per device", people did exactly that,
// and the dashboard opened on a user that had never received a single sample.
// Helsa is single-user; the device name is now only a label on the token, and the
// user is chosen here — never by the device name.
//
// The rule is the same one the Home Assistant publisher follows (internal/hass):
// exactly one user, or an explicit choice. Guessing among several would hand one
// person's health data to another's device.

// newOwnerSub is the handle given to the user created on an empty database.
// Nothing reads it; it only has to be unique and recognisable in a listing.
const newOwnerSub = "owner"

// userRow is one row of `users`, as much of it as choosing needs.
type userRow struct {
	ID        uuid.UUID
	Handle    string
	CreatedAt time.Time
}

// resolution is the outcome: an existing user, or the handle to create one with.
type resolution struct {
	user   userRow
	create string // non-empty: no such user yet — create it with this handle
}

// resolveUser picks the token's user from every user in the database.
//
//   - explicit (-user) names one by id or handle; on an empty database it is
//     the handle the first user is created with.
//   - otherwise: none → create one; exactly one → that one; several → refuse.
//
// ⚠️ The existing installations: the old default (`-subject bob`) left exactly one
// user behind (handle `bob`). With one user, every new token binds to it,
// whatever device name it is given — which is what keeps those installations,
// and the tokens already on their phones, pointing at the same data.
func resolveUser(users []userRow, explicit string) (resolution, error) {
	explicit = strings.TrimSpace(explicit)
	if explicit != "" {
		// The old CLI passed "dev:<subject>" and stored it without the prefix; accept
		// both spellings rather than make somebody learn which one is in the table.
		want := strings.TrimPrefix(explicit, "dev:")
		for _, u := range users {
			if u.Handle == want || u.Handle == explicit || u.ID.String() == strings.ToLower(explicit) {
				return resolution{user: u}, nil
			}
		}
		if len(users) == 0 {
			return resolution{create: want}, nil
		}
		return resolution{}, fmt.Errorf("-user %q matches none of the users in the database.\n%s",
			explicit, listUsers(users))
	}

	switch len(users) {
	case 0:
		return resolution{create: newOwnerSub}, nil
	case 1:
		return resolution{user: users[0]}, nil
	default:
		return resolution{}, fmt.Errorf("the database holds %d users, and a token must belong to exactly one of them.\n"+
			"Helsa will not guess. Name it with -user <id or handle> "+
			"(through make: make prod-token SUBJECT=<device> TOKEN_USER=<id or handle>).\n%s",
			len(users), listUsers(users))
	}
}

// listUsers renders the users for an error message: id, handle, created.
func listUsers(users []userRow) string {
	var b strings.Builder
	b.WriteString("Users:\n")
	for _, u := range users {
		fmt.Fprintf(&b, "  %s  handle=%-12s  created %s\n",
			u.ID, u.Handle, u.CreatedAt.UTC().Format("2006-01-02 15:04 MST"))
	}
	return strings.TrimRight(b.String(), "\n")
}
