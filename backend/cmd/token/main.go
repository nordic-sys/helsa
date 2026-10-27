// cmd/token issues a device token.
//
// A single-user system has no interactive login (ADR-0003): access is layered —
// an mTLS client certificate at the proxy, and above it a long-lived device
// token in the application. The token is not handed out by an HTTP endpoint
// (anyone could call that); the operator issues it with this CLI, on the
// server, once per device.
//
// Usage on the VM:
//
//	make prod-token SUBJECT=iphone                 # one token per device
//	make prod-token SUBJECT=browser TOKEN_USER=bob # only when there are several users
//
// -subject names the DEVICE. It is written into the token as a label and printed,
// so that tokens can be told apart; it does NOT choose whose data the token opens.
// The user is resolved on its own (users.go): the one user if there is exactly one,
// a new one on an empty database, and an explicit -user when there are several.
//
// And to take one back — a lost phone, a retired browser:
//
//	make prod-token-revoke TOKEN="<the access token>"
//
// That is a real revocation: the token stops working on the next request, and the
// other devices are untouched. Rotating HELSA_JWT_SECRET remains the bigger hammer,
// and logs out everything.
//
// The access token it prints is what you enter on the web Settings page, or
// bake into the iOS app / store in its Keychain.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/store"
)

// maxDeviceLabel keeps the label a label: it is printed and travels in every request.
const maxDeviceLabel = 64

func main() {
	subject := flag.String("subject", "", "the DEVICE this token is for, e.g. iphone or browser — a label on the token, not a user")
	user := flag.String("user", "", "the user (id or apple_sub) — needed only when the database holds more than one")
	revoke := flag.String("revoke", "", "an access token to revoke — the device it is on loses access immediately")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fail("config: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	st, err := store.Open(ctx, cfg)
	if err != nil {
		fail("store: %v", err)
	}
	defer st.Close()

	svc := auth.New(cfg, st.DB, st.Redis)

	// ⚠️ Revocation is a separate mode of the same tool rather than a second binary or
	// an HTTP route, for the reason the header gives about issuance: a route that
	// revokes tokens is a route somebody else can call. Both halves of a token's life
	// are operator actions, taken on the server.
	if *revoke != "" {
		expiry, err := svc.Revoke(ctx, *revoke)
		switch {
		case errors.Is(err, auth.ErrUnauthorized):
			fail("that token is expired or not one of ours — it already cannot be used")
		case err != nil:
			fail("revoke: %v", err)
		}
		if device := auth.TokenDevice(*revoke); device != "" {
			fmt.Printf("revoked the token of device %q. It is refused from the next request on.\n", device)
		} else {
			fmt.Printf("revoked. The device using it is refused from the next request on.\n")
		}
		fmt.Printf("The other tokens keep working. The deny-list entry is kept until this one would have expired anyway: %s\n",
			expiry.Format(time.RFC3339))
		return
	}

	device := strings.TrimSpace(*subject)
	switch {
	case device == "":
		fail("name the device this token is for: -subject iphone (through make: make prod-token SUBJECT=iphone)")
	case len(device) > maxDeviceLabel:
		fail("-subject is a device name; keep it under %d characters", maxDeviceLabel)
	}

	owner, created, err := resolveOrCreateUser(ctx, st.DB, *user)
	if err != nil {
		fail("%v", err)
	}

	sess, err := svc.IssueDeviceToken(ctx, owner.ID, device)
	if err != nil {
		fail("issue token: %v", err)
	}

	fmt.Printf("device:        %s\n", device)
	if created {
		fmt.Printf("user:          %s (apple_sub %s) — the database had no user, so this one was created\n", owner.ID, owner.AppleSub)
	} else {
		fmt.Printf("user:          %s (apple_sub %s)\n", owner.ID, owner.AppleSub)
	}
	fmt.Printf("access_token:  %s\n", sess.AccessToken)
	fmt.Printf("refresh_token: %s\n", sess.RefreshToken)
	fmt.Printf("expires:       %s (%s from now)\n",
		sess.ExpiresAt.UTC().Format(time.RFC3339), cfg.AccessTokenTTL)
	// ⚠️ This used to say "the lifetime comes from HELSA_ACCESS_TTL (default: 15
	// minutes) — run this with HELSA_ACCESS_TTL=8760h", while the token it had just
	// printed was already valid for a year: the compose file sets HELSA_ACCESS_TTL
	// for this container from HELSA_DEVICE_TOKEN_TTL. Both statements below are true
	// on both paths, and the expiry above is read from the token itself.
	fmt.Printf("\nThe lifetime is HELSA_ACCESS_TTL as this process saw it (%s).\n", cfg.AccessTokenTTL)
	fmt.Printf("Through `make prod-token` it is set from HELSA_DEVICE_TOKEN_TTL in deploy/.env (default 8760h, one year).\n")
	fmt.Printf("Every device of this user reads the same data. Give each its own token, so that\n")
	fmt.Printf("`make prod-token-revoke TOKEN=...` can take one back without touching the others.\n")
}

// resolveOrCreateUser reads every user, lets resolveUser choose, and creates the
// user when the choice is "none yet". created reports the latter.
func resolveOrCreateUser(ctx context.Context, pool *pgxpool.Pool, explicit string) (userRow, bool, error) {
	rows, err := pool.Query(ctx, `SELECT id, apple_sub, created_at FROM users ORDER BY created_at, id`)
	if err != nil {
		return userRow{}, false, fmt.Errorf("list users: %w", err)
	}
	var users []userRow
	for rows.Next() {
		var id pgtype.UUID
		var u userRow
		var created pgtype.Timestamptz
		if err := rows.Scan(&id, &u.AppleSub, &created); err != nil {
			rows.Close()
			return userRow{}, false, fmt.Errorf("scan user: %w", err)
		}
		u.ID, u.CreatedAt = pgconv.ToUUID(id), created.Time
		users = append(users, u)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return userRow{}, false, fmt.Errorf("list users: %w", err)
	}

	res, err := resolveUser(users, explicit)
	if err != nil {
		return userRow{}, false, err
	}
	if res.create == "" {
		return res.user, false, nil
	}
	u, err := db.New(pool).UpsertUserByAppleSub(ctx, db.UpsertUserByAppleSubParams{AppleSub: res.create})
	if err != nil {
		return userRow{}, false, fmt.Errorf("create user: %w", err)
	}
	return userRow{ID: pgconv.ToUUID(u.ID), AppleSub: u.AppleSub, CreatedAt: u.CreatedAt.Time}, true, nil
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}
