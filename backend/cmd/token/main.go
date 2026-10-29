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
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
	user := flag.String("user", "", "the user (id or handle) — needed only when the database holds more than one")
	revoke := flag.String("revoke", "", "an access token to revoke — the device it is on loses access immediately")
	addUser := flag.String("add-user", "", "add a household member with this handle (e.g. nori)")
	name := flag.String("name", "", "with -add-user: the member's display name")
	makeAdmin := flag.String("make-admin", "", "make the member with this handle an admin")
	loginCode := flag.String("login-code", "", "print a 10-minute web sign-in code for the member with this handle")
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
		var expiry time.Time
		err := pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
			q := db.New(st.DB).WithTx(tx)
			var err error
			if expiry, err = svc.WithQueries(q).Revoke(ctx, *revoke); err != nil {
				return err
			}
			// Into the owner's log when the token names one; a token that is not ours
			// was refused above with ErrUnauthorized.
			if owner, ok := auth.TokenSubject(*revoke); ok {
				detail, _ := json.Marshal(map[string]any{"label": auth.TokenDevice(*revoke), "by": "operator"})
				return q.InsertAccountEvent(ctx, db.InsertAccountEventParams{UserID: pgconv.UUID(owner), Kind: "token_revoked", Detail: detail})
			}
			return nil
		})
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

	// The household (docs/36 §3.4): what the operator does on the server, before
	// there is anybody to do it in the dashboard — the first admin's first sign-in,
	// above all. Each writes an account event with no actor: "the server's operator".
	if *addUser != "" || *makeAdmin != "" || *loginCode != "" {
		household(ctx, svc, st.DB, *addUser, *name, *makeAdmin, *loginCode)
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

	// The first user of a fresh database is created as its admin (resolveOrCreateUser),
	// so a new install is never left without one (docs/36 §9, C3). The migration does
	// the same for an existing install with exactly one user.

	// The token's row and the member's log entry together, or neither (docs/36
	// §10.4, S9): the member's log is where they see a token issued in their name.
	var sess *auth.Session
	err = pgx.BeginFunc(ctx, st.DB, func(tx pgx.Tx) error {
		q := db.New(st.DB).WithTx(tx)
		var err error
		if sess, err = svc.WithQueries(q).IssueDeviceToken(ctx, owner.ID, device, uuid.Nil); err != nil {
			return err
		}
		detail, _ := json.Marshal(map[string]any{"label": device, "token_id": sess.TokenID, "by": "operator"})
		return q.InsertAccountEvent(ctx, db.InsertAccountEventParams{UserID: pgconv.UUID(owner.ID), Kind: "token_issued", Detail: detail})
	})
	if err != nil {
		fail("issue token: %v", err)
	}

	fmt.Printf("device:        %s\n", device)
	if created {
		fmt.Printf("user:          %s (handle %s) — the database had no user, so this one was created\n", owner.ID, owner.Handle)
	} else {
		fmt.Printf("user:          %s (handle %s)\n", owner.ID, owner.Handle)
	}
	fmt.Printf("token id:      %s\n", sess.TokenID)
	fmt.Printf("access_token:  %s\n", sess.AccessToken)
	fmt.Printf("expires:       %s (%s from now)\n",
		sess.ExpiresAt.UTC().Format(time.RFC3339), cfg.DeviceTokenTTL)
	// The expiry above is read from the token itself.
	fmt.Printf("\nThe lifetime is HELSA_DEVICE_TOKEN_TTL in deploy/.env (default 8760h, one year).\n")
	fmt.Printf("Every device of this user reads the same data. Give each its own token, so that\n")
	fmt.Printf("`make prod-token-revoke TOKEN=...` can take one back without touching the others.\n")
}

// resolveOrCreateUser reads every user, lets resolveUser choose, and creates the
// user when the choice is "none yet". created reports the latter.
// resolveOrCreateUser reads every user, lets resolveUser choose, and creates the
// user when the choice is "none yet". created reports the latter.
//
// ⚠️ One transaction, under the admins' lock: the first user of an empty database
// is created AS admin, in the same statement — never created and promoted in two
// steps, where a failure between them would leave a server whose only user is not
// its admin, and two concurrent runs could each find the database empty and each
// make an admin (Codex R3).
func resolveOrCreateUser(ctx context.Context, pool *pgxpool.Pool, explicit string) (userRow, bool, error) {
	var out userRow
	var created bool
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := db.New(pool).WithTx(tx)
		if err := q.LockAdmins(ctx); err != nil {
			return fmt.Errorf("lock: %w", err)
		}
		rows, err := tx.Query(ctx, `SELECT id, handle, created_at FROM users ORDER BY created_at, id`)
		if err != nil {
			return fmt.Errorf("list users: %w", err)
		}
		var users []userRow
		for rows.Next() {
			var id pgtype.UUID
			var u userRow
			var c pgtype.Timestamptz
			if err := rows.Scan(&id, &u.Handle, &c); err != nil {
				rows.Close()
				return fmt.Errorf("scan user: %w", err)
			}
			u.ID, u.CreatedAt = pgconv.ToUUID(id), c.Time
			users = append(users, u)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("list users: %w", err)
		}
		res, err := resolveUser(users, explicit)
		if err != nil {
			return err
		}
		if res.create == "" {
			out = res.user
			return nil
		}
		u, err := q.CreateMember(ctx, db.CreateMemberParams{Handle: res.create, Role: string(auth.RoleAdmin)})
		if err != nil {
			return fmt.Errorf("create user: %w", err)
		}
		out, created = userRow{ID: pgconv.ToUUID(u.ID), Handle: u.Handle, CreatedAt: u.CreatedAt.Time}, true
		return nil
	})
	return out, created, err
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}

func household(ctx context.Context, svc *auth.Service, pool *pgxpool.Pool, add, name, admin, login string) {
	q := db.New(pool)
	event := func(user pgtype.UUID, kind string, detail string) {
		if err := q.InsertAccountEvent(ctx, db.InsertAccountEventParams{UserID: user, Kind: kind, Detail: []byte(detail)}); err != nil {
			fmt.Fprintf(os.Stderr, "warning: the account log was not written: %v\n", err)
		}
	}
	switch {
	case add != "":
		var dn *string
		if n := strings.TrimSpace(name); n != "" {
			dn = &n
		}
		u, err := q.CreateMember(ctx, db.CreateMemberParams{Handle: strings.TrimSpace(add), DisplayName: dn, Role: string(auth.RoleMember)})
		if err != nil {
			fail("add %s: %v", add, err)
		}
		event(u.ID, "member_added", `{"by":"operator"}`)
		fmt.Printf("added %s (%s) as a member. Give them a code: make prod-login-code HANDLE=%s, or from the dashboard.\n", u.Handle, pgconv.ToUUID(u.ID), u.Handle)
	case admin != "":
		u, err := q.GetUserByHandle(ctx, strings.TrimSpace(admin))
		if err != nil {
			fail("no member called %s: %v", admin, err)
		}
		if err := q.SetUserRole(ctx, db.SetUserRoleParams{ID: u.ID, Role: string(auth.RoleAdmin)}); err != nil {
			fail("make %s an admin: %v", admin, err)
		}
		event(u.ID, "role_changed", `{"to":"admin","by":"operator"}`)
		fmt.Printf("%s is an admin.\n", u.Handle)
	case login != "":
		u, err := q.GetUserByHandle(ctx, strings.TrimSpace(login))
		if err != nil {
			fail("no member called %s: %v", login, err)
		}
		code, exp, err := svc.IssueCode(ctx, pgconv.ToUUID(u.ID), auth.PurposeWeb, 0, uuid.Nil)
		if err != nil {
			fail("issue the code: %v", err)
		}
		event(u.ID, "code_issued", `{"purpose":"web","by":"operator"}`)
		fmt.Printf("sign-in code for %s: %s\nvalid until %s, once. Type it on the dashboard's sign-in page.\n",
			u.Handle, code, exp.Local().Format("15:04"))
	}
}
