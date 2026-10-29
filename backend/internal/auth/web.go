package auth

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

// # The browser's session (docs/36 §2.1, the review §9 C10–C12)
//
// A browser signs in with a one-time code (/v1/auth/web/login) and gets a cookie
// holding a token of kind "web" — a row in device_tokens like a phone's, listed and
// revocable the same way. The cookie:
//
//   - is httpOnly (no script can read it), Secure, SameSite=Strict, host-only (no
//     Domain attribute), and Path=/v1;
//   - is accepted only on the WEB port. A cookie does not know ports (RFC 6265
//     §8.5): a browser that holds it sends it to :443 too. The proxy says which door
//     a request came through (X-Helsa-Listener, set by Caddy, never passed through),
//     and on the device door the cookie is refused;
//   - never together with a bearer header: which one would win is exactly the kind
//     of question that ends with Nóri's browser acting as Bob (C11);
//   - on a request that changes anything, only with an Origin the server recognises
//     — SameSite does not stop a sibling origin of the same site (C10);
//   - slides: used, it is renewed at most once a day, to 30 days from then.

const SessionCookie = "helsa_session"

// credential picks the request's one credential. status != 0 is a refusal.
func (s *Service) credential(r *http.Request) (tok string, via Via, msg string, status int) {
	bearer, hasBearer := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
	hasBearer = hasBearer && bearer != ""
	var cookie string
	if c, err := r.Cookie(SessionCookie); err == nil {
		cookie = c.Value
	}
	switch {
	case hasBearer && cookie != "":
		return "", 0, "send a bearer token or a session cookie, not both", http.StatusBadRequest
	case hasBearer:
		return bearer, ViaDeviceToken, "", 0
	case cookie == "":
		return "", 0, "missing bearer token", http.StatusUnauthorized
	}
	if r.Header.Get("X-Helsa-Listener") == "device" {
		return "", 0, "a browser session is not accepted on this port", http.StatusUnauthorized
	}
	if !safeMethod(r.Method) && !s.OriginAllowed(r) {
		return "", 0, "this request's origin is not this server's", http.StatusForbidden
	}
	return cookie, ViaWebSession, "", 0
}

func safeMethod(m string) bool {
	return m == http.MethodGet || m == http.MethodHead || m == http.MethodOptions
}

// OriginAllowed: the request names an Origin, and it is the request's own host or
// one of HELSA_WEB_ORIGINS. A request without Origin is refused — every browser
// sends one on a non-GET fetch, and a cookie request that lacks it is not one.
func (s *Service) OriginAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	if strings.EqualFold(u.Host, r.Host) {
		return true
	}
	for _, o := range s.cfg.WebOrigins {
		if strings.EqualFold(strings.TrimRight(o, "/"), origin) {
			return true
		}
	}
	return false
}

// SetSessionCookie hands the browser its session.
func SetSessionCookie(w http.ResponseWriter, token string, exp time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: SessionCookie, Value: token, Path: "/v1",
		Expires: exp, MaxAge: int(time.Until(exp).Seconds()),
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	})
}

// ClearSessionCookie removes it — with the same attributes, or the browser keeps it.
func ClearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: SessionCookie, Value: "", Path: "/v1", MaxAge: -1,
		HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode,
	})
}

// slideSession renews a session that has been used a day or more since its last
// renewal: the row's expiry first, then a fresh token with the same id. A failure
// to renew is not a failure of the request — the session simply ends on its date.
func (s *Service) slideSession(w http.ResponseWriter, r *http.Request, p *Principal, _ string) {
	if p.ExpiresAt.IsZero() {
		return
	}
	now := time.Now()
	// The row was renewed but the browser never got the new cookie (a lost
	// response): its token still carries the old expiry. Hand it a token for the
	// row's date, rather than letting a session in use run out (docs/36 §10.4, S11).
	if p.TokenExpiresAt.Before(p.ExpiresAt.Add(-time.Minute)) {
		if tok, texp, err := s.signAccessUntil(p.UserID, p.TokenID, p.Label, now, p.ExpiresAt); err == nil {
			SetSessionCookie(w, tok, texp)
		}
		return
	}
	if time.Until(p.ExpiresAt) > WebSessionTTL-24*time.Hour {
		return
	}
	exp := now.Add(WebSessionTTL).Truncate(time.Second)
	ctx := tenant.With(r.Context(), p.UserID)
	if err := s.queries().ExtendDeviceToken(ctx, db.ExtendDeviceTokenParams{ID: pgconv.UUID(p.TokenID), ExpiresAt: pgconv.Timestamptz(exp)}); err != nil {
		return
	}
	tok, texp, err := s.signAccessUntil(p.UserID, p.TokenID, p.Label, now, exp)
	if err != nil {
		return
	}
	p.ExpiresAt = texp
	SetSessionCookie(w, tok, texp)
}

// EndSession revokes the session a request came with (logout).
func (s *Service) EndSession(ctx context.Context, p Principal) error {
	_, err := s.RevokeToken(ctx, p.UserID, p.TokenID)
	return err
}
