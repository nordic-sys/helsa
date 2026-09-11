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
//	docker compose -f docker-compose.yml -f docker-compose.prod.yml \
//	  run --rm --entrypoint /usr/local/bin/token api -subject bob-web
//
// And to take one back — a lost phone, a retired browser:
//
//	... -revoke "<the access token>"
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
	"time"

	"github.com/nordic-sys/helsa/backend/internal/auth"
	"github.com/nordic-sys/helsa/backend/internal/config"
	"github.com/nordic-sys/helsa/backend/internal/store"
)

func main() {
	subject := flag.String("subject", "bob", "the device identifier (this becomes users.apple_sub)")
	revoke := flag.String("revoke", "", "an access token to revoke — the device it is on loses access immediately")
	flag.Parse()

	cfg, err := config.Load()
	if err != nil {
		fail("config: %v", err)
	}
	// Token issuance takes the same path the earlier dev mode did: no Apple
	// JWKS, the subject is given directly.
	cfg.AuthDevMode = true

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
		fmt.Printf("revoked. The device using it is refused from the next request on.\n")
		fmt.Printf("The deny-list entry is kept until the token would have expired anyway: %s\n",
			expiry.Format(time.RFC3339))
		return
	}

	sess, err := svc.LoginWithApple(ctx, "dev:"+*subject, "")
	if err != nil {
		fail("issue token: %v", err)
	}

	fmt.Printf("subject:       %s\n", *subject)
	fmt.Printf("access_token:  %s\n", sess.AccessToken)
	fmt.Printf("refresh_token: %s\n", sess.RefreshToken)
	fmt.Printf("\nThe access token lifetime comes from HELSA_ACCESS_TTL (default: 15 minutes).\n")
	fmt.Printf("For a long-lived device token, run this with a large TTL, e.g.:\n")
	fmt.Printf("  HELSA_ACCESS_TTL=8760h  (one year)\n")
}

func fail(format string, a ...any) {
	fmt.Fprintf(os.Stderr, format+"\n", a...)
	os.Exit(1)
}
