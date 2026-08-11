package server

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

func TestDeviceDTO(t *testing.T) {
	id := uuid.New()
	seen := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	model, name, tz := "iPhone17,1", "Bob iPhone", "Europe/Budapest"

	got := deviceDTO(db.Device{
		ID:         pgconv.UUID(id),
		Platform:   "ios",
		Model:      &model,
		Name:       &name,
		TimeZone:   &tz,
		LastSeenAt: pgtype.Timestamptz{Time: seen, Valid: true},
	})
	if got.Id == nil || uuid.UUID(*got.Id) != id {
		t.Errorf("id: %+v", got.Id)
	}
	if got.Platform != "ios" {
		t.Errorf("platform: %v", got.Platform)
	}
	if got.LastSeenAt == nil || !got.LastSeenAt.Equal(seen) {
		t.Errorf("last_seen_at: %+v", got.LastSeenAt)
	}
}

// For a device never seen before, last_seen_at is NULL — a difference from "the
// zero timestamp" that matters to the alert, so no invented time may be supplied.
func TestDeviceDTONullLastSeen(t *testing.T) {
	got := deviceDTO(db.Device{ID: pgconv.UUID(uuid.New()), Platform: "watchos"})
	if got.LastSeenAt != nil {
		t.Errorf("a NULL last_seen_at must not become a value: %+v", got.LastSeenAt)
	}
	if got.Model != nil || got.Name != nil || got.TimeZone != nil {
		t.Errorf("the NULL columns must stay nil: %+v", got)
	}
}
