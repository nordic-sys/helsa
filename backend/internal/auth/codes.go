package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// # One-time codes (docs/36 §3.2, §3.4; the review §9 C7)
//
// A code is how a phone joins a member's account (purpose "device", redeemed at
// /v1/enroll for a device token) and how a browser signs in (purpose "web", redeemed
// at /v1/auth/web/login for a session). It is eight characters of Crockford base32
// — 40 bits — shown as XXXX-XXXX, stored only as a SHA-256, used once, short-lived,
// and redeemed behind a rate limit (internal/server).

// Purpose is what a code is for.
type Purpose string

const (
	PurposeDevice Purpose = "device"
	PurposeWeb    Purpose = "web"
)

const (
	// WebCodeTTL is fixed: a sign-in code is for the next few minutes.
	WebCodeTTL = 10 * time.Minute
	// DeviceCodeTTL is the default for joining a phone; an admin may give up to a day.
	DeviceCodeTTL    = 15 * time.Minute
	MaxDeviceCodeTTL = 24 * time.Hour
	// WebSessionTTL is a browser session's life; it slides while used (web.go).
	WebSessionTTL = 30 * 24 * time.Hour
)

// ErrBadCode is EVERY way a redemption can fail — unknown, expired, used, revoked,
// the wrong purpose, a disabled account. One error, so that nothing about a code can
// be learnt by trying one.
var ErrBadCode = errors.New("the code is not valid")

const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// newCode returns a fresh code, formatted for people.
func newCode() (string, error) {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 8)
	for i, v := range b {
		out[i] = crockford[int(v)%32] // 256 is a multiple of 32: no bias
	}
	return string(out[:4]) + "-" + string(out[4:]), nil
}

// normalizeCode is the code as it is hashed: upper case, no separators, and the
// letters people confuse read as Crockford says (O → 0, I and L → 1). What a person
// types from a screen and what the QR carries hash the same.
func normalizeCode(code string) string {
	var b strings.Builder
	for _, r := range strings.ToUpper(code) {
		switch {
		case r == '-' || r == ' ':
			continue
		case r == 'O':
			b.WriteByte('0')
		case r == 'I' || r == 'L':
			b.WriteByte('1')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func hashCode(code string) []byte {
	sum := sha256.Sum256([]byte(normalizeCode(code)))
	return sum[:]
}

// IssueCode writes a new code for user and returns it, shown once. The caller has
// already decided that this caller may issue it (internal/server); ctx must carry
// the issuing user (tenant), whose row-level policies the insert goes through: a
// member for themselves, an admin for a member.
func (s *Service) IssueCode(ctx context.Context, user uuid.UUID, purpose Purpose, ttl time.Duration, createdBy uuid.UUID) (string, time.Time, error) {
	if s.state == nil {
		return "", time.Time{}, errors.New("auth: no database")
	}
	switch purpose {
	case PurposeWeb:
		ttl = WebCodeTTL
	case PurposeDevice:
		if ttl <= 0 {
			ttl = DeviceCodeTTL
		}
		if ttl > MaxDeviceCodeTTL {
			ttl = MaxDeviceCodeTTL
		}
	default:
		return "", time.Time{}, fmt.Errorf("unknown purpose %q", purpose)
	}
	code, err := newCode()
	if err != nil {
		return "", time.Time{}, err
	}
	exp := time.Now().Add(ttl).Truncate(time.Second)
	var by pgtype.UUID
	if createdBy != uuid.Nil {
		by = pgconv.UUID(createdBy)
	}
	q := s.queries()
	if err := q.InsertCode(ctx, db.InsertCodeParams{
		CodeHash: hashCode(code), UserID: pgconv.UUID(user), Purpose: string(purpose),
		CreatedBy: by, ExpiresAt: pgconv.Timestamptz(exp),
	}); err != nil {
		return "", time.Time{}, fmt.Errorf("store code: %w", err)
	}
	return code, exp, nil
}

// Redeem consumes a code and issues its token: a device token for "device", a web
// session for "web". It is one database statement (redeem_code, 00015): the code,
// the token's row and the event are written together, or nothing is. The token
// belongs to the user the code names — never to anyone the request asks for.
func (s *Service) Redeem(ctx context.Context, code string, purpose Purpose, label string) (*Session, error) {
	if s.state == nil {
		return nil, errors.New("auth: no database")
	}
	ttl, kind := s.cfg.DeviceTokenTTL, "device"
	if purpose == PurposeWeb {
		ttl, kind = WebSessionTTL, "web"
	}
	now := time.Now()
	id := uuid.New()
	exp := now.Add(ttl).Truncate(time.Second)
	user, err := s.queries().RedeemCode(ctx, db.RedeemCodeParams{
		CodeHash: hashCode(code), Purpose: string(purpose), TokenID: pgconv.UUID(id),
		Label: label, Kind: kind, ExpiresAt: pgconv.Timestamptz(exp),
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows) || (err == nil && !user.Valid):
		return nil, ErrBadCode
	case err != nil:
		return nil, fmt.Errorf("redeem: %w", err)
	}
	uid := pgconv.ToUUID(user)
	tok, texp, err := s.signAccessUntil(uid, id, label, now, exp)
	if err != nil {
		return nil, err
	}
	return &Session{AccessToken: tok, ExpiresIn: int(time.Until(texp).Seconds()), ExpiresAt: texp, UserID: uid, TokenID: id}, nil
}

// queries is the full sqlc layer the code paths need (the narrow stateStore covers
// only what VerifyAccess and the CLI use).
func (s *Service) queries() *db.Queries {
	if q, ok := s.state.(*db.Queries); ok {
		return q
	}
	panic("auth: the code paths need a real database")
}

// RevokeToken revokes one of owner's tokens by id, as the caller in ctx (a member
// for themselves, an admin for anyone — the policies decide). The owner is part of
// the statement: a token id of another user matches nothing, and the caller answers
// 404 (C4).
func (s *Service) RevokeToken(ctx context.Context, owner, token uuid.UUID) (string, error) {
	row, err := s.state.RevokeDeviceToken(ctx, db.RevokeDeviceTokenParams{ID: pgconv.UUID(token), UserID: pgconv.UUID(owner)})
	if err != nil {
		return "", err
	}
	return row.Label, nil
}

// WithQueries is s working through q — a transaction's queries — so that an
// account action and its log entry commit together or not at all (docs/36 §10.4,
// S9). The returned Service shares everything else with s.
func (s *Service) WithQueries(q *db.Queries) *Service {
	c := *s
	c.state = q
	return &c
}
