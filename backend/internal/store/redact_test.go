package store

import (
	"context"
	"strings"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/config"
)

// pgx redacts its own connection string but quotes the password up to its first
// slash in the "invalid port" detail. Open must not let even that fragment out.
// The URL is refused at parse time, so this needs no database.
func TestOpenDoesNotPrintThePassword(t *testing.T) {
	const pass = "q8Zk+3vR1x9/TbE+uWm7nA2pL0sYc4dHf6gJe5iKo=="
	cfg := &config.Config{
		// Deliberately NOT normalised (Load would repair it): this is the error path.
		DatabaseURL: "postgres://helsa:" + pass + "@timescaledb:5432/helsa?sslmode=disable",
	}
	_, err := Open(context.Background(), cfg)
	if err == nil {
		t.Fatal("expected the raw URL to be refused")
	}
	for _, piece := range []string{"q8Zk+3vR1x9", "TbE+uWm7nA2pL0sYc4dHf6gJe5iKo"} {
		if strings.Contains(err.Error(), piece) {
			t.Fatalf("password piece %q in the error: %v", piece, err)
		}
	}
}
