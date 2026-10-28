package auth

import (
	"context"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type pgtypeUUID = pgtype.UUID

// Role is a user's place on a household server (docs/36 §1.3).
type Role string

const (
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

func (r Role) valid() bool { return r == RoleAdmin || r == RoleMember }

// Via is how the caller proved who they are.
type Via int

const (
	ViaDeviceToken Via = iota + 1
	// ViaWebSession — the browser's cookie session (F1).
)

// Principal is WHO is asking: the authenticated user, with the role read from the
// database on this very request (never from the token), and the token they came
// with.
//
// # Principal and Subject
//
// Principal is who asks; Subject is whose data a READ is about. On a v1 server they
// are always the same person. From F2 on, a share or a guardianship can make the
// Subject of a read somebody else — and that is why the line is drawn now, while it
// still changes nothing (docs/36 §2.4):
//
//   - a READ handler asks for Subject;
//   - a WRITE handler (ingest, settings, journal, goals, push, devices, export) and
//     every account, session or device operation asks for Principal — writes never
//     go to the Subject.
type Principal struct {
	UserID  uuid.UUID
	Role    Role
	TokenID uuid.UUID // device_tokens.id; uuid.Nil for a token issued before the register
	Label   string    // the device's name
	Via     Via
}

// IsAdmin reports whether the caller may administer the server.
func (p Principal) IsAdmin() bool { return p.Role == RoleAdmin }

type ctxKey int

const principalKey ctxKey = 0

// WithPrincipal puts an authenticated caller into a context. The middleware is the
// only production caller; tests use it to stand in for a verified token.
func WithPrincipal(ctx context.Context, p Principal) context.Context {
	return context.WithValue(ctx, principalKey, p)
}

// PrincipalFrom reads the authenticated caller out of the context.
func PrincipalFrom(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalKey).(Principal)
	return p, ok && p.UserID != uuid.Nil
}

// Subject is whose data a read is about. v1: always the Principal's own user.
func Subject(ctx context.Context) (uuid.UUID, bool) {
	p, ok := PrincipalFrom(ctx)
	return p.UserID, ok
}

// UserID is the old name of Subject, kept so that the read handlers keep reading as
// they did. Write handlers should ask PrincipalFrom.
func UserID(ctx context.Context) (uuid.UUID, bool) { return Subject(ctx) }

// RequireAdmin lets an admin through and answers 403 to anyone else. It sits INSIDE
// the session middleware: a caller without a valid token never gets this far, and
// hears 401 like on every other route.
func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p, ok := PrincipalFrom(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if !p.IsAdmin() {
			http.Error(w, "this needs an admin of this server", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
