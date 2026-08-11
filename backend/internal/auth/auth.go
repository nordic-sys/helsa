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

var ErrUnauthorized = errors.New("unauthorized")

type ctxKey int

const userIDKey ctxKey = 0

// Service bundles the auth dependencies.
type Service struct {
	cfg   *config.Config
	pool  *pgxpool.Pool
	q     *db.Queries
	redis *redis.Client
	jwks  *jwksCache
}

func New(cfg *config.Config, pool *pgxpool.Pool, rdb *redis.Client) *Service {
	return &Service{
		cfg:   cfg,
		pool:  pool,
		q:     db.New(pool),
		redis: rdb,
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
func (s *Service) VerifyAccess(token string) (uuid.UUID, error) {
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
	return id, nil
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
		userID, err := s.VerifyAccess(tok)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
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
