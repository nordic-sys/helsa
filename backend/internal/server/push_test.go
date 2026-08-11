package server

import (
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

func TestPushEnvironmentDefaultsToProd(t *testing.T) {
	// Missing field: prod is the safe default — sending to a sandbox token via the
	// prod endpoint dies silently, whereas the other way round only the development
	// device misses a push.
	if got, ok := pushEnvironment(nil); !ok || got != "prod" {
		t.Errorf("pushEnvironment(nil) = %q, %v", got, ok)
	}
	for _, v := range []string{"sandbox", "prod"} {
		env := api.PushRegisterEnvironment(v)
		if got, ok := pushEnvironment(&env); !ok || got != v {
			t.Errorf("pushEnvironment(%q) = %q, %v", v, got, ok)
		}
	}
	bad := api.PushRegisterEnvironment("staging")
	if _, ok := pushEnvironment(&bad); ok {
		t.Error("an unknown environment: expected a rejection")
	}
}
