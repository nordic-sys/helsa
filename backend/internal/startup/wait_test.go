package startup

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestWaitRetriesUntilTheDependencyIsUp(t *testing.T) {
	interval = time.Millisecond
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	calls := 0
	v, err := Wait(context.Background(), log, "rabbitmq", time.Second, func(context.Context) (int, error) {
		calls++
		if calls < 3 {
			return 0, errors.New("connection refused")
		}
		return 42, nil
	})
	if err != nil || v != 42 || calls != 3 {
		t.Fatalf("got %v, %v after %d calls", v, err, calls)
	}
	// One line when the wait starts, one when it ends — not one per attempt.
	if n := strings.Count(buf.String(), "\n"); n != 2 {
		t.Errorf("%d log lines, want 2:\n%s", n, buf.String())
	}
}

func TestWaitGivesUpAfterTheBudget(t *testing.T) {
	interval = time.Millisecond
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	_, err := Wait(context.Background(), log, "postgres", 20*time.Millisecond, func(context.Context) (int, error) {
		return 0, errors.New("still down")
	})
	if err == nil || err.Error() != "still down" {
		t.Fatalf("want the last error back, got %v", err)
	}
}

func TestWaitIsSilentWhenTheDependencyIsAlreadyUp(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	if _, err := Wait(context.Background(), log, "x", time.Second, func(context.Context) (int, error) { return 1, nil }); err != nil {
		t.Fatal(err)
	}
	if buf.Len() != 0 {
		t.Errorf("an ordinary start logged: %s", buf.String())
	}
}
