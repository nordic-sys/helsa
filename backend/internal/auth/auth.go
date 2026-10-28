// Package auth issues and checks Helsa's device tokens, and tells the handlers
// who is asking.
//
// There is no interactive sign-in (ADR-0003): access is layered — an mTLS client
// certificate at the proxy, and above it a long-lived device token. A token is an
// HS256 JWT whose `sub` is the user; a token issued since the household work
// (docs/36) also carries a `jti` that names its row in `device_tokens`.
//
// Every request is checked against the database, not only the signature: the
// token's row (not revoked, not expired, the same user) and the user's own state
// (still there, not disabled, which role). See VerifyAccess for why there is no
// cache in front of that.
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	// ErrRevoked is separate from ErrUnauthorized so that the caller can say which
	// happened. They lead to the same status code and to very different sentences.
	ErrRevoked = errors.New("token revoked")
	// ErrDisabled: the token is fine, its user has been switched off. Not a
	// revocation — clearing users.disabled_at lets the same token work again.
	ErrDisabled = errors.New("account disabled")
)

// tokenDenyList is the deny-list's storage, narrowed to the two calls it makes.
//
// ⚠️ It exists so the FAILURE path can be tested. The valuable behaviour here is not
// "a revoked token is refused" — that one is easy and would pass either way — but
// "a deny-list that cannot be read refuses everything", and a test for that needs a
// store that can be told to break. A live Redis cannot be, without a dependency whose
// only job is to be stopped.
type tokenDenyList interface {
	Get(ctx context.Context, key string) *redis.StringCmd
	Set(ctx context.Context, key string, value any, ttl time.Duration) *redis.StatusCmd
}

// stateStore is the part of the database the check reads and the issuer writes —
// narrowed for the same reason as tokenDenyList: so that "the database cannot be
// read" can be tested to refuse rather than to wave through.
type stateStore interface {
	GetUserAuthState(ctx context.Context, id pgtypeUUID) (db.GetUserAuthStateRow, error)
	GetDeviceToken(ctx context.Context, id pgtypeUUID) (db.GetDeviceTokenRow, error)
	TouchDeviceToken(ctx context.Context, id pgtypeUUID) error
	InsertDeviceToken(ctx context.Context, arg db.InsertDeviceTokenParams) error
	RevokeDeviceToken(ctx context.Context, arg db.RevokeDeviceTokenParams) (db.RevokeDeviceTokenRow, error)
}

// Service bundles the auth dependencies.
type Service struct {
	cfg   *config.Config
	deny  tokenDenyList
	state stateStore
}

func New(cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client) *Service {
	s := &Service{cfg: cfg}
	// nil-safe: the handler unit tests build a Server with no database at all and
	// only ever reach the "no token" branch.
	if rdb != nil {
		s.deny = rdb
	}
	if pool != nil {
		s.state = db.New(pool)
	}
	return s
}

// Session is an issued token.
type Session struct {
	AccessToken string
	ExpiresIn   int
	ExpiresAt   time.Time // the token's own `exp`, so nobody has to recompute it
	UserID      uuid.UUID
	TokenID     uuid.UUID // = the `jti` and the device_tokens row
}

// accessClaims is the token's payload: the user in `sub`, the register row in `jti`,
// and the device's name.
//
// ⚠️ `device` is a LABEL, not an identity. The data belongs to the user in `sub`, and
// every device of that user reads the same data; the label is there so that a token
// pulled out of a browser or a log can be told apart from its siblings.
type accessClaims struct {
	Device string `json:"device,omitempty"`
	jwt.RegisteredClaims
}

// IssueDeviceToken issues a token for an EXISTING user, labelled with the device it
// is for, and writes its row into device_tokens. Choosing the user is the caller's
// job — see cmd/token for why the device name must never be what picks it.
//
// createdBy is who issued it (uuid.Nil: the operator, from the server's CLI).
//
// ⚠️ The row is written BEFORE the token exists, so there is never a token in the
// world without its row: a token whose INSERT failed would be refused by every
// request anyway (no row → unauthorised), but the caller would have printed it.
func (s *Service) IssueDeviceToken(ctx context.Context, userID uuid.UUID, device string, createdBy uuid.UUID) (*Session, error) {
	if s.state == nil {
		return nil, errors.New("auth: no database to register the token in")
	}
	now := time.Now()
	id := uuid.New()
	tok, exp, err := s.signAccess(userID, id, device, now)
	if err != nil {
		return nil, err
	}
	var by pgtypeUUID
	if createdBy != uuid.Nil {
		by = pgconv.UUID(createdBy)
	}
	if err := s.state.InsertDeviceToken(tenant.With(ctx, userID), db.InsertDeviceTokenParams{
		ID:        pgconv.UUID(id),
		UserID:    pgconv.UUID(userID),
		Label:     device,
		Kind:      "device",
		CreatedBy: by,
		ExpiresAt: pgconv.Timestamptz(exp),
	}); err != nil {
		return nil, fmt.Errorf("register token: %w", err)
	}
	return &Session{
		AccessToken: tok,
		ExpiresIn:   int(s.cfg.DeviceTokenTTL.Seconds()),
		ExpiresAt:   exp,
		UserID:      userID,
		TokenID:     id,
	}, nil
}

// signAccess mints the token and reports when it expires. jti == uuid.Nil mints a
// token without one — only the tests of the pre-register tokens do that.
func (s *Service) signAccess(userID, jti uuid.UUID, device string, now time.Time) (string, time.Time, error) {
	return s.signAccessUntil(userID, jti, device, now, now.Add(s.cfg.DeviceTokenTTL))
}

// signAccessUntil mints a token that expires at exp — a web session's, which slides.
func (s *Service) signAccessUntil(userID, jti uuid.UUID, device string, now, exp time.Time) (string, time.Time, error) {
	claims := accessClaims{
		Device: device,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(exp),
		},
	}
	if jti != uuid.Nil {
		claims.ID = jti.String()
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		return "", time.Time{}, fmt.Errorf("sign access: %w", err)
	}
	// The NumericDate is whole seconds; report what is actually in the token.
	return tok, claims.ExpiresAt.Time, nil
}

// TokenDevice reads the device label out of a token WITHOUT verifying it. For
// display only (the revoke output); never for a decision.
func TokenDevice(token string) string {
	var claims accessClaims
	if _, _, err := jwt.NewParser().ParseUnverified(token, &claims); err != nil {
		return ""
	}
	return claims.Device
}

// parse checks the signature and the expiry, and reads the claims.
func (s *Service) parse(token string) (accessClaims, uuid.UUID, uuid.UUID, error) {
	// ⛔ One token, one spelling. Base64url leaves a few bits of the last character
	// of each part unused, and a lenient decoder ignores them — so a revoked token
	// with those bits changed decodes to the same signature, verifies, and hashes to
	// a DIFFERENT deny-list key: revoked, and working again (Codex R1, 2026-10-28,
	// reproduced before this fix). Strict decoding refuses a non-canonical part; the
	// character check refuses what the decoder would skip (line breaks).
	if !canonicalChars(token) {
		return accessClaims{}, uuid.Nil, uuid.Nil, ErrUnauthorized
	}
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired(), jwt.WithStrictDecoding())
	var claims accessClaims
	if _, err := parser.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) {
		return []byte(s.cfg.JWTSecret), nil
	}); err != nil {
		return claims, uuid.Nil, uuid.Nil, ErrUnauthorized
	}
	user, err := uuid.Parse(claims.Subject)
	if err != nil {
		return claims, uuid.Nil, uuid.Nil, ErrUnauthorized
	}
	var jti uuid.UUID
	if claims.ID != "" {
		// A `jti` that is present but not a UUID is not one of ours: refuse, rather
		// than fall back to the register-less path a forged claim could aim for.
		if jti, err = uuid.Parse(claims.ID); err != nil || jti == uuid.Nil {
			return claims, uuid.Nil, uuid.Nil, ErrUnauthorized
		}
	}
	return claims, user, jti, nil
}

// VerifyAccess checks a token and says who is asking.
//
// # Why every request reads the database
//
// A device token lives for a year. A signature-and-expiry check alone means that a
// phone lost on day two keeps access for the rest of the year, and that a member who
// was disabled, deleted or demoted keeps what they had until then. So, on every
// request:
//
//  1. the hash deny-list (Redis) — the only revocation the tokens issued before the
//     register have;
//  2. for a token with a `jti`: its device_tokens row must exist, belong to the
//     same user, be unrevoked and unexpired;
//  3. for EVERY token, old and new: the user must still exist and not be disabled,
//     and the role is read here, from the row — it is never in the token.
//
// ⚠️ There is no cache in front of 2 and 3. The plan had a 60-second Redis cache
// (docs/36 §2.4); the review threw it out (§9, C5): it would keep a demoted admin an
// admin for a minute, and a cache that is invalidated on write can still be refilled
// by a read that started before the write. Two primary-key lookups per request are
// nothing for a household's traffic.
//
// ⚠️ **Every check fails CLOSED.** If Redis or the database cannot be read, this
// returns an error rather than waving the request through — the caller answers 503,
// not 401, because nothing is wrong with the token.
func (s *Service) VerifyAccess(ctx context.Context, token string) (Principal, error) {
	claims, userID, jti, err := s.parse(token)
	if err != nil {
		return Principal{}, err
	}
	if s.deny == nil || s.state == nil {
		return Principal{}, errors.New("auth: no deny-list or database to check against")
	}
	switch err := s.deny.Get(ctx, revokedKey(token)).Err(); {
	case err == redis.Nil:
		// Not on the deny-list — the ordinary case, and the only one that proceeds.
	case err == nil:
		return Principal{}, ErrRevoked
	default:
		return Principal{}, fmt.Errorf("deny-list unavailable: %w", err)
	}

	p := Principal{UserID: userID, Label: claims.Device, Via: ViaDeviceToken}
	// The lookups below read rows the policies guard (device_tokens is the user's own),
	// so they run as the token's user. The `sub` is signed: it was checked above.
	ctx = tenant.With(ctx, userID)
	if jti != uuid.Nil {
		row, err := s.state.GetDeviceToken(ctx, pgconv.UUID(jti))
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return Principal{}, ErrUnauthorized
		case err != nil:
			return Principal{}, fmt.Errorf("token register unavailable: %w", err)
		}
		switch {
		case pgconv.ToUUID(row.UserID) != userID:
			// A signed token naming another user's row. Cannot happen without the
			// signing secret; if it does, it is not a token to trust.
			return Principal{}, ErrUnauthorized
		case row.RevokedAt.Valid:
			return Principal{}, ErrRevoked
		case !row.ExpiresAt.Time.After(time.Now()):
			return Principal{}, ErrUnauthorized
		}
		p.TokenID = jti
		p.Label = row.Label
		p.Kind = row.Kind
		p.ExpiresAt = row.ExpiresAt.Time
	} else {
		p.Kind = "device" // every token from before the register was a device token
	}

	state, err := s.state.GetUserAuthState(ctx, pgconv.UUID(userID))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// The user is gone. Their tokens go with them, the old ones included.
		return Principal{}, ErrUnauthorized
	case err != nil:
		return Principal{}, fmt.Errorf("user state unavailable: %w", err)
	}
	if state.DisabledAt.Valid {
		return Principal{}, ErrDisabled
	}
	p.Role = Role(state.Role)
	if !p.Role.valid() {
		return Principal{}, fmt.Errorf("user %s has an unknown role %q", userID, state.Role)
	}

	if p.TokenID != uuid.Nil {
		// "Last used" is for display only; a failure to write it must not fail the
		// request, and the hourly condition lives in the UPDATE itself.
		_ = s.state.TouchDeviceToken(ctx, pgconv.UUID(p.TokenID))
	}
	return p, nil
}

// Revoke takes one token back and reports when it would have expired.
//
// A token with a `jti` is revoked in its device_tokens row — the authoritative
// record, which the lists in the web and the app read. A token without one (issued
// before the register) goes on the hash deny-list, as it always has.
//
// ⚠️ The deny-list is keyed by a HASH of the token, not by a claim, and the reason is
// the tokens that already exist: every token in the field on the day the deny-list
// shipped would otherwise have stayed unrevocable. Hashing needs nothing of the token
// but the string the operator already holds.
func (s *Service) Revoke(ctx context.Context, token string) (time.Time, error) {
	claims, userID, jti, err := s.parse(token)
	if err != nil {
		// ⚠️ An expired or forged token is not an error worth reporting as a failure to
		// revoke: it already cannot be used. Saying "revoked" about it would be a lie in
		// the reassuring direction, so say what it is.
		return time.Time{}, ErrUnauthorized
	}
	expiry := claims.ExpiresAt.Time
	ttl := time.Until(expiry)
	if ttl <= 0 {
		return expiry, ErrUnauthorized
	}
	if jti != uuid.Nil {
		if s.state == nil {
			return time.Time{}, errors.New("auth: no database to revoke in")
		}
		_, err := s.state.RevokeDeviceToken(tenant.With(ctx, userID), db.RevokeDeviceTokenParams{ID: pgconv.UUID(jti), UserID: pgconv.UUID(userID)})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// Already revoked (or never registered): either way it no longer works.
			return expiry, nil
		case err != nil:
			return time.Time{}, fmt.Errorf("revoke: %w", err)
		}
		return expiry, nil
	}
	if s.deny == nil {
		return time.Time{}, errors.New("auth: no deny-list to revoke in")
	}
	if err := s.deny.Set(ctx, revokedKey(token), "1", ttl).Err(); err != nil {
		return time.Time{}, fmt.Errorf("deny-list write: %w", err)
	}
	return expiry, nil
}

// canonicalChars: three base64url parts and nothing else.
func canonicalChars(token string) bool {
	if token == "" || strings.Count(token, ".") != 2 {
		return false
	}
	for i := 0; i < len(token); i++ {
		c := token[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-', c == '_', c == '.':
		default:
			return false
		}
	}
	return true
}

// revokedKey is the deny-list key for a token: a SHA-256 of the token string, so the
// list never holds anything that could be replayed if Redis were read.
func revokedKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "revoked:" + hex.EncodeToString(sum[:])
}

// Middleware guards the /v1/* routes: a bearer device token or a browser's session
// cookie → Principal in the context. The rules for the cookie are in web.go.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok, via, msg, status := s.credential(r)
		if status != 0 {
			http.Error(w, msg, status)
			return
		}
		p, err := s.VerifyAccess(r.Context(), tok)
		switch {
		case errors.Is(err, ErrRevoked):
			// ⚠️ Said out loud on purpose. "Invalid token" would send somebody whose
			// phone was stolen to check their typing; this tells them the thing they
			// did worked.
			http.Error(w, "this token has been revoked", http.StatusUnauthorized)
			return
		case errors.Is(err, ErrDisabled):
			// Also said out loud: the phone shows it, and the member should hear that
			// it is the account, not the phone, so that they ask the admin rather than
			// re-enrol.
			http.Error(w, "this account has been disabled", http.StatusUnauthorized)
			return
		case errors.Is(err, ErrUnauthorized):
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		case err != nil:
			// The deny-list or the database could not be read. Not 401: nothing is
			// wrong with the token, and a 503 is what a client should retry.
			http.Error(w, "the token cannot be checked right now", http.StatusServiceUnavailable)
			return
		}
		// A web session only as a cookie, a device token only as a bearer header: a
		// session cookie lifted out of a browser does not become a phone's token, and a
		// device token does not become a browser session.
		if (via == ViaWebSession) != (p.Kind == "web") {
			http.Error(w, "this token is not accepted this way", http.StatusUnauthorized)
			return
		}
		p.Via = via
		if via == ViaWebSession {
			s.slideSession(w, r, &p, tok)
		}
		// The database work of this request is done as the caller: the pool sets
		// helsa.user_id from this (internal/store, docs/36 §4.8.8). In v1 the caller
		// and the person read are the same; from F2 on the policies decide what else
		// the caller may read, so this stays the Principal, never the Subject.
		ctx := tenant.With(WithPrincipal(r.Context(), p), p.UserID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}
