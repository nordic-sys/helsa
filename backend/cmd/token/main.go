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
// The access token it prints is what you enter on the web Settings page, or
// bake into the iOS app / store in its Keychain.
package main

import (
	"context"
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
