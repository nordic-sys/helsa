// Package auth provides Sign in with Apple verification and our own session
// handling.
//
// Flow (docs/08): client → Apple identity JWT → POST /v1/auth/apple → JWKS
// verify → users upsert (apple_sub) → our own session JWT (short-lived) +
// refresh token (in Redis, revocable). The /v1/* routes are guarded by
// Middleware using the session JWT.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

var (
	ErrUnauthorized = errors.New("unauthorized")
	// ErrRevoked is separate from ErrUnauthorized so that the caller can say which
	// happened. They lead to the same status code and to very different sentences.
	ErrRevoked = errors.New("token revoked")
)

type ctxKey int

const userIDKey ctxKey = 0

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

// Service bundles the auth dependencies.
type Service struct {
	cfg   *config.Config
	pool  *pgxpool.Pool
	q     *db.Queries
	redis *redis.Client
	deny  tokenDenyList
	jwks  *jwksCache
}

func New(cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client) *Service {
	return &Service{
		cfg:   cfg,
		pool:  pool,
		q:     db.New(pool),
		redis: rdb,
		deny:  rdb,
		jwks:  newJWKSCache(cfg.AppleIssuer + "/auth/keys"),
	}
}

// appleClaims holds the Apple identity-token fields we care about.
type appleClaims struct {
	Email string `json:"email"`
	Nonce string `json:"nonce"`
	jwt.RegisteredClaims
}

// VerifyApple validates the identity token and returns the stable apple_sub
// plus the (optional) email.
// Local dev: with AuthDevMode on and a token shaped "dev:<apple_sub>", the JWKS
// round-trip is skipped.
func (s *Service) VerifyApple(ctx context.Context, identityToken, nonce string) (sub, email string, err error) {
	if s.cfg.AuthDevMode && strings.HasPrefix(identityToken, "dev:") {
		sub = strings.TrimPrefix(identityToken, "dev:")
		if sub == "" {
			return "", "", fmt.Errorf("dev token has an empty apple_sub")
		}
		return sub, "", nil
	}

	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(s.cfg.AppleIssuer),
		jwt.WithExpirationRequired(),
	)
	var claims appleClaims
	_, err = parser.ParseWithClaims(identityToken, &claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, fmt.Errorf("missing kid")
		}
		return s.jwks.keyForKid(ctx, kid)
	})
	if err != nil {
		return "", "", fmt.Errorf("apple token verify: %w", err)
	}

	// Audience: aud must be one of the allowed values (native bundleID / web serviceID).
	if !audienceAllowed(claims.Audience, s.cfg.AppleAudiences) {
		return "", "", fmt.Errorf("audience not allowed")
	}
	// Nonce (anti-replay): if the client sent one, it must match the claim in the
	// token. (docs/08 §8: the native flow sends SHA256(nonce) — an implementation
	// refinement.)
	if nonce != "" && claims.Nonce != nonce {
		return "", "", fmt.Errorf("nonce mismatch")
	}
	if claims.Subject == "" {
		return "", "", fmt.Errorf("missing sub")
	}
	return claims.Subject, claims.Email, nil
}

// Session is the issued token pair.
type Session struct {
	AccessToken  string
	RefreshToken string
	ExpiresIn    int
	UserID       uuid.UUID
}

// LoginWithApple is the full sign-in: verify → users upsert → issue session.
func (s *Service) LoginWithApple(ctx context.Context, identityToken, nonce string) (*Session, error) {
	sub, email, err := s.VerifyApple(ctx, identityToken, nonce)
	if err != nil {
		return nil, err
	}
	var emailPtr *string
	if email != "" {
		emailPtr = &email
	}
	u, err := s.q.UpsertUserByAppleSub(ctx, db.UpsertUserByAppleSubParams{
		AppleSub: sub,
		Email:    emailPtr,
	})
	if err != nil {
		return nil, fmt.Errorf("user upsert: %w", err)
	}
	return s.issueSession(ctx, pgconv.ToUUID(u.ID))
}

// issueSession issues an access JWT and a refresh token (in Redis, with a TTL).
func (s *Service) issueSession(ctx context.Context, userID uuid.UUID) (*Session, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   userID.String(),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(s.cfg.AccessTokenTTL)),
	}
	access, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		return nil, fmt.Errorf("sign access: %w", err)
	}
	refresh, err := randomToken()
	if err != nil {
		return nil, err
	}
	if err := s.redis.Set(ctx, refreshKey(refresh), userID.String(), s.cfg.RefreshTokenTTL).Err(); err != nil {
		return nil, fmt.Errorf("refresh store: %w", err)
	}
	return &Session{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    int(s.cfg.AccessTokenTTL.Seconds()),
		UserID:       userID,
	}, nil
}

// Refresh rotates the refresh token: the old one is revoked, a new one issued.
func (s *Service) Refresh(ctx context.Context, refresh string) (*Session, error) {
	val, err := s.redis.Get(ctx, refreshKey(refresh)).Result()
	if err == redis.Nil {
		return nil, ErrUnauthorized
	} else if err != nil {
		return nil, err
	}
	userID, err := uuid.Parse(val)
	if err != nil {
		return nil, ErrUnauthorized
	}
	s.redis.Del(ctx, refreshKey(refresh)) // rotation
	return s.issueSession(ctx, userID)
}

// Logout revokes the refresh token.
func (s *Service) Logout(ctx context.Context, refresh string) error {
	return s.redis.Del(ctx, refreshKey(refresh)).Err()
}

// VerifyAccess validates our own session JWT and returns the user_id.
//
// # Why this touches Redis, when a JWT is supposed to be checkable on its own
//
// A device token here lives for a year (`HELSA_ACCESS_TTL=8760h` is the documented
// setting). A signature-and-expiry check alone therefore means that a phone which is
// lost on day two keeps full access for the remaining three hundred and sixty-three
// days, and the only way to stop it is to rotate `HELSA_JWT_SECRET` — which logs out
// every other device at the same time. That is not a revocation, it is an evacuation.
//
// So a revoked token is written to a deny-list and every request checks it. The cost
// is one Redis lookup per request against a store that is already on the request path
// for `/v1/summary`'s cache.
//
// ⚠️ **The check fails CLOSED.** If Redis cannot be reached, this returns
// unauthorised rather than waving the request through. A deny-list that can be
// bypassed by taking Redis down is not one, and "revoked" has to mean revoked on the
// worst day rather than the ordinary one. The cost is honest and bounded: Redis is
// already part of `/readyz` (`store.Ready`), so an instance that cannot reach it is
// reporting itself unready anyway — this makes the data path agree with the probe
// instead of quietly outliving it.
func (s *Service) VerifyAccess(ctx context.Context, token string) (uuid.UUID, error) {
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	var claims jwt.RegisteredClaims
	_, err := parser.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) {
		return []byte(s.cfg.JWTSecret), nil
	})
	if err != nil {
		return uuid.Nil, ErrUnauthorized
	}
	id, err := uuid.Parse(claims.Subject)
	if err != nil {
		return uuid.Nil, ErrUnauthorized
	}
	switch err := s.deny.Get(ctx, revokedKey(token)).Err(); {
	case err == redis.Nil:
		// Not revoked — the ordinary case, and the only one that proceeds.
	case err == nil:
		return uuid.Nil, ErrRevoked
	default:
		return uuid.Nil, fmt.Errorf("deny-list unavailable: %w", err)
	}
	return id, nil
}

// Revoke puts one token on the deny-list and reports when the entry will expire.
//
// ⚠️ Keyed by a HASH of the token, not by a `jti` claim, and the reason is the tokens
// that already exist. A `jti` would have to be minted into new tokens, so every token
// in the field on the day this shipped — the ones on a phone, in a browser, in a Home
// Assistant configuration — would have stayed unrevocable. Hashing needs nothing of
// the token but the string the operator already holds.
//
// The entry's TTL is the token's own remaining life. After that the JWT is refused on
// expiry anyway, so keeping the row would only grow a list that can never shrink.
func (s *Service) Revoke(ctx context.Context, token string) (time.Time, error) {
	parser := jwt.NewParser(jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	var claims jwt.RegisteredClaims
	if _, err := parser.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) {
		return []byte(s.cfg.JWTSecret), nil
	}); err != nil {
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
	if err := s.deny.Set(ctx, revokedKey(token), "1", ttl).Err(); err != nil {
		return time.Time{}, fmt.Errorf("deny-list write: %w", err)
	}
	return expiry, nil
}

// revokedKey is the deny-list key for a token: a SHA-256 of the token string, so the
// list never holds anything that could be replayed if Redis were read.
func revokedKey(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "revoked:" + hex.EncodeToString(sum[:])
}

// Middleware guards the /v1/* routes: Bearer access token → user_id in the context.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authz := r.Header.Get("Authorization")
		tok, ok := strings.CutPrefix(authz, "Bearer ")
		if !ok || tok == "" {
			http.Error(w, "missing bearer token", http.StatusUnauthorized)
			return
		}
		userID, err := s.VerifyAccess(r.Context(), tok)
		switch {
		case errors.Is(err, ErrRevoked):
			// ⚠️ Said out loud on purpose. "Invalid token" would send somebody whose
			// phone was stolen to check their typing; this tells them the thing they
			// did worked.
			http.Error(w, "this token has been revoked", http.StatusUnauthorized)
			return
		case errors.Is(err, ErrUnauthorized):
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		case err != nil:
			// The deny-list could not be read. Not 401: nothing is wrong with the
			// token, and a 503 is what a client should retry.
			http.Error(w, "the deny-list cannot be reached", http.StatusServiceUnavailable)
			return
		}
		ctx := context.WithValue(r.Context(), userIDKey, userID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// UserID reads the authenticated user_id out of the context.
func UserID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := ctx.Value(userIDKey).(uuid.UUID)
	return id, ok
}

func audienceAllowed(aud jwt.ClaimStrings, allowed []string) bool {
	for _, a := range aud {
		for _, ok := range allowed {
			if a == ok {
				return true
			}
		}
	}
	return false
}

func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

func refreshKey(token string) string { return "refresh:" + token }
