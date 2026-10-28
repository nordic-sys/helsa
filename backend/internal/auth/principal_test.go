package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// fakeState is the users table and the token register, in memory, with a switch
// for breaking.
type fakeState struct {
	users   map[uuid.UUID]db.GetUserAuthStateRow
	tokens  map[uuid.UUID]db.GetDeviceTokenRow
	touched int
	broken  bool
}

func newFakeState() *fakeState {
	return &fakeState{users: map[uuid.UUID]db.GetUserAuthStateRow{}, tokens: map[uuid.UUID]db.GetDeviceTokenRow{}}
}

func (f *fakeState) addUser(id uuid.UUID, role Role) {
	f.users[id] = db.GetUserAuthStateRow{ID: pgconv.UUID(id), Role: string(role)}
}

var errBroken = errors.New("connection refused")

func (f *fakeState) GetUserAuthState(_ context.Context, id pgtype.UUID) (db.GetUserAuthStateRow, error) {
	if f.broken {
		return db.GetUserAuthStateRow{}, errBroken
	}
	u, ok := f.users[pgconv.ToUUID(id)]
	if !ok {
		return u, pgx.ErrNoRows
	}
	return u, nil
}

func (f *fakeState) GetDeviceToken(_ context.Context, id pgtype.UUID) (db.GetDeviceTokenRow, error) {
	if f.broken {
		return db.GetDeviceTokenRow{}, errBroken
	}
	t, ok := f.tokens[pgconv.ToUUID(id)]
	if !ok {
		return t, pgx.ErrNoRows
	}
	return t, nil
}

func (f *fakeState) TouchDeviceToken(context.Context, pgtype.UUID) error {
	f.touched++
	return nil
}

func (f *fakeState) InsertDeviceToken(_ context.Context, a db.InsertDeviceTokenParams) error {
	if f.broken {
		return errBroken
	}
	f.tokens[pgconv.ToUUID(a.ID)] = db.GetDeviceTokenRow{ID: a.ID, UserID: a.UserID, Label: a.Label, Kind: a.Kind, ExpiresAt: a.ExpiresAt}
	return nil
}

func (f *fakeState) RevokeDeviceToken(_ context.Context, a db.RevokeDeviceTokenParams) (db.RevokeDeviceTokenRow, error) {
	t, ok := f.tokens[pgconv.ToUUID(a.ID)]
	if !ok || t.UserID != a.UserID || t.RevokedAt.Valid {
		return db.RevokeDeviceTokenRow{}, pgx.ErrNoRows
	}
	t.RevokedAt = pgconv.Timestamptz(time.Now())
	f.tokens[pgconv.ToUUID(a.ID)] = t
	return db.RevokeDeviceTokenRow{ID: t.ID, UserID: t.UserID, Label: t.Label}, nil
}

func issue(t *testing.T, svc *Service, state *fakeState, role Role) (*Session, uuid.UUID) {
	t.Helper()
	user := uuid.New()
	state.addUser(user, role)
	sess, err := svc.IssueDeviceToken(context.Background(), user, "iphone", uuid.Nil)
	if err != nil {
		t.Fatal(err)
	}
	return sess, user
}

// The role comes from the database on every request — a token has no say in it.
func TestTheRoleIsReadFromTheDatabaseNotTheToken(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	sess, user := issue(t, svc, state, RoleAdmin)

	p, err := svc.VerifyAccess(context.Background(), sess.AccessToken)
	if err != nil || !p.IsAdmin() {
		t.Fatalf("an admin's token: %+v, %v", p, err)
	}
	// Demoted. The same token, the very next request: no longer admin — there is no
	// cache to wait out (docs/36 §9, C5).
	state.addUser(user, RoleMember)
	p, err = svc.VerifyAccess(context.Background(), sess.AccessToken)
	if err != nil || p.IsAdmin() {
		t.Fatalf("after the demotion: %+v, %v", p, err)
	}
}

func TestADisabledUsersTokensAreRefusedAndComeBackWhenEnabled(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	sess, user := issue(t, svc, state, RoleMember)
	old, _ := mint(t, svc, time.Hour) // a pre-register token of another user
	oldUser := uuid.MustParse(subjectOf(t, old))

	row := state.users[user]
	row.DisabledAt = pgconv.Timestamptz(time.Now())
	state.users[user] = row
	if _, err := svc.VerifyAccess(context.Background(), sess.AccessToken); !errors.Is(err, ErrDisabled) {
		t.Fatalf("a disabled user's token: want ErrDisabled, got %v", err)
	}

	// The old, jti-less tokens are checked too — the plan's first draft let them
	// through, because they have no register row to look at (§9, C5).
	row = state.users[oldUser]
	row.DisabledAt = pgconv.Timestamptz(time.Now())
	state.users[oldUser] = row
	if _, err := svc.VerifyAccess(context.Background(), old); !errors.Is(err, ErrDisabled) {
		t.Fatalf("a disabled user's OLD token: want ErrDisabled, got %v", err)
	}

	// Disabling is not revoking: enabled again, the same phone carries on (§9, A8).
	row = state.users[user]
	row.DisabledAt = pgtype.Timestamptz{}
	state.users[user] = row
	if _, err := svc.VerifyAccess(context.Background(), sess.AccessToken); err != nil {
		t.Fatalf("re-enabled, the same token must work: %v", err)
	}
}

func TestADeletedUsersTokensAreRefused(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	sess, user := issue(t, svc, state, RoleMember)
	old, _ := mint(t, svc, time.Hour)
	delete(state.users, user)
	delete(state.users, uuid.MustParse(subjectOf(t, old)))

	for name, tok := range map[string]string{"new": sess.AccessToken, "old": old} {
		if _, err := svc.VerifyAccess(context.Background(), tok); !errors.Is(err, ErrUnauthorized) {
			t.Errorf("%s token of a deleted user: want ErrUnauthorized, got %v", name, err)
		}
	}
}

func TestARevokedRegisterRowRefusesItsToken(t *testing.T) {
	svc, deny, state := serviceWithFakes(t)
	sess, _ := issue(t, svc, state, RoleMember)
	if _, err := svc.Revoke(context.Background(), sess.AccessToken); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyAccess(context.Background(), sess.AccessToken); !errors.Is(err, ErrRevoked) {
		t.Fatalf("want ErrRevoked, got %v", err)
	}
	if len(deny.keys) != 0 {
		t.Error("a registered token is revoked in its row, not on the deny-list")
	}
}

func TestATokenWhoseRowIsMissingIsRefused(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	sess, _ := issue(t, svc, state, RoleMember)
	delete(state.tokens, sess.TokenID)
	if _, err := svc.VerifyAccess(context.Background(), sess.AccessToken); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
}

// A signed token pointing at somebody else's register row: unreachable without the
// secret, refused anyway.
func TestATokenNamingAnotherUsersRowIsRefused(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	nori, _ := issue(t, svc, state, RoleMember)
	bob := uuid.New()
	state.addUser(bob, RoleAdmin)
	forged, _, err := svc.signAccess(bob, nori.TokenID, "iphone", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.VerifyAccess(context.Background(), forged); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
}

func TestAMalformedJtiIsNotTreatedAsAnOldToken(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	user := uuid.New()
	state.addUser(user, RoleMember)
	claims := accessClaims{RegisteredClaims: jwt.RegisteredClaims{
		Subject: user.String(), ID: "not-a-uuid",
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(svc.cfg.JWTSecret))
	if _, err := svc.VerifyAccess(context.Background(), tok); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("want ErrUnauthorized, got %v", err)
	}
}

func TestAnUnreadableDatabaseRefusesEverything(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	sess, _ := issue(t, svc, state, RoleAdmin)
	old, _ := mint(t, svc, time.Hour)
	state.broken = true
	for name, tok := range map[string]string{"new": sess.AccessToken, "old": old} {
		_, err := svc.VerifyAccess(context.Background(), tok)
		if err == nil {
			t.Fatalf("%s token: an unreadable database must not let a request through", name)
		}
		if errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrRevoked) || errors.Is(err, ErrDisabled) {
			t.Fatalf("%s token: the failure must be distinguishable from a bad token (503, not 401): %v", name, err)
		}
	}
}

func TestIssuingFailsWhenTheRowCannotBeWritten(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	user := uuid.New()
	state.addUser(user, RoleMember)
	state.broken = true
	if sess, err := svc.IssueDeviceToken(context.Background(), user, "iphone", uuid.Nil); err == nil {
		t.Fatalf("a token without its row must not be handed out: %+v", sess)
	}
}

func TestRequireAdmin(t *testing.T) {
	ok := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) })
	h := RequireAdmin(ok)
	cases := []struct {
		name string
		ctx  context.Context
		want int
	}{
		{"no principal", context.Background(), http.StatusUnauthorized},
		{"member", WithPrincipal(context.Background(), Principal{UserID: uuid.New(), Role: RoleMember}), http.StatusForbidden},
		{"admin", WithPrincipal(context.Background(), Principal{UserID: uuid.New(), Role: RoleAdmin}), http.StatusTeapot},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil).WithContext(c.ctx))
		if rec.Code != c.want {
			t.Errorf("%s: %d, want %d", c.name, rec.Code, c.want)
		}
	}
}

func TestMiddlewareAnswersPerFailure(t *testing.T) {
	svc, _, state := serviceWithFakes(t)
	sess, user := issue(t, svc, state, RoleMember)
	h := svc.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p, ok := PrincipalFrom(r.Context()); !ok || p.UserID != user {
			t.Errorf("principal in context: %+v", p)
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	call := func() int {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/me", nil)
		req.Header.Set("Authorization", "Bearer "+sess.AccessToken)
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if got := call(); got != http.StatusNoContent {
		t.Fatalf("valid: %d", got)
	}
	row := state.users[user]
	row.DisabledAt = pgconv.Timestamptz(time.Now())
	state.users[user] = row
	if got := call(); got != http.StatusUnauthorized {
		t.Fatalf("disabled: %d", got)
	}
	state.broken = true
	if got := call(); got != http.StatusServiceUnavailable {
		t.Fatalf("database down: %d", got)
	}
}

func subjectOf(t *testing.T, tok string) string {
	t.Helper()
	var c jwt.RegisteredClaims
	if _, _, err := jwt.NewParser().ParseUnverified(tok, &c); err != nil {
		t.Fatal(err)
	}
	return c.Subject
}
