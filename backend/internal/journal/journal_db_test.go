//go:build smoke

// The journal store (migration 00011) against a REAL database.
//
// Three things here are SQL and nothing else can show them: that a re-send
// replaces rather than duplicates, that a chunk's rows carry exactly the
// instant reported as `server_time` (so a sweep with that token keeps them and
// removes what the backfill did not re-send), and that the purge and the user
// cascade really leave nothing behind.
package journal

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("HELSA_DATABASE_URL")
	if url == "" {
		url = "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Fatalf("open the database: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("the database is not reachable (%s): %v — start it with `cd deploy && make up`", url, err)
	}
	return pool
}

func freshUser(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := pool.QueryRow(context.Background(),
		`INSERT INTO users (handle, time_zone) VALUES ($1, 'Europe/Budapest') RETURNING id`,
		fmt.Sprintf("journal-db-test-%d", time.Now().UnixNano())).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(id))
	})
	return id
}

var day = time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)

func symptomEntry(id string, value int, at time.Time) api.JournalEntryIn {
	key := "highHeartRate:E1"
	hours := api.JournalEntryInFollowUpHours(24)
	return api.JournalEntryIn{SourceUuid: id, DataType: "headache", StartedAt: at, EndedAt: at,
		Value: &value, EventKey: &key, FollowUpHours: &hours}
}

func moodEntry(id string, valence float64, at time.Time) api.JournalEntryIn {
	kind := api.JournalEntryInMoodKind("daily_mood")
	tags := []string{"work", "family"}
	return api.JournalEntryIn{SourceUuid: id, DataType: "stateOfMind", StartedAt: at, EndedAt: at,
		Valence: &valence, MoodKind: &kind, Associations: &tags}
}

func list(t *testing.T, s *Store, uid uuid.UUID) []api.JournalEntry {
	t.Helper()
	var out []api.JournalEntry
	if err := s.Each(context.Background(), uid, day.AddDate(0, 0, -30), day.AddDate(0, 0, 30),
		func(e api.JournalEntry) error { out = append(out, e); return nil }); err != nil {
		t.Fatalf("list: %v", err)
	}
	return out
}

func write(t *testing.T, s *Store, uid uuid.UUID, b Batch) WriteResult {
	t.Helper()
	res, err := s.Write(context.Background(), uid, b)
	if err != nil {
		t.Fatalf("write: %v", err)
	}
	return res
}

func TestAReSendReplacesAndADeletionRemoves(t *testing.T) {
	pool := testPool(t)
	s := New(pool)
	uid := freshUser(t, pool)

	write(t, s, uid, Batch{Entries: []api.JournalEntryIn{symptomEntry("S1", 2, day), moodEntry("M1", 0.5, day)}})
	write(t, s, uid, Batch{Entries: []api.JournalEntryIn{symptomEntry("S1", 4, day)}})

	got := list(t, s, uid)
	if len(got) != 2 {
		t.Fatalf("entries = %d, want 2 (a re-send must replace, not duplicate)", len(got))
	}
	for _, e := range got {
		switch e.SourceUuid {
		case "S1":
			if e.Value == nil || *e.Value != 4 || e.FollowUpHours == nil || *e.FollowUpHours != 24 ||
				e.EventKey == nil || *e.EventKey != "highHeartRate:E1" {
				t.Errorf("the symptom did not round-trip: %+v", e)
			}
		case "M1":
			if e.Valence == nil || *e.Valence != 0.5 || e.Value != nil || e.Associations == nil ||
				len(*e.Associations) != 2 || e.MoodKind == nil || *e.MoodKind != "daily_mood" {
				t.Errorf("the mood did not round-trip: %+v", e)
			}
		}
	}

	res := write(t, s, uid, Batch{Deletions: []string{"S1", "never-sent"}})
	if res.Deleted != 1 {
		t.Errorf("deleted = %d, want 1 (an unknown uuid is ignored)", res.Deleted)
	}
	if got := list(t, s, uid); len(got) != 1 || got[0].SourceUuid != "M1" {
		t.Errorf("after the deletion: %+v", got)
	}
}

// The backfill's sweep: whatever the server held that the backfill did not
// re-send was deleted in Health while the phone was not sending. The token is
// the first answer's server_time, so the backfill's own rows survive it.
func TestTheSweepRemovesOnlyWhatTheBackfillDidNotReSend(t *testing.T) {
	pool := testPool(t)
	s := New(pool)
	uid := freshUser(t, pool)

	write(t, s, uid, Batch{Entries: []api.JournalEntryIn{
		symptomEntry("KEPT", 2, day), symptomEntry("DELETED-IN-HEALTH", 3, day)}})
	time.Sleep(20 * time.Millisecond)

	first := write(t, s, uid, Batch{Entries: []api.JournalEntryIn{symptomEntry("KEPT", 2, day)}})
	time.Sleep(20 * time.Millisecond)
	token := first.ServerTime
	last := write(t, s, uid, Batch{Entries: []api.JournalEntryIn{moodEntry("NEW", -0.5, day)}, SweepBefore: &token})
	if last.Swept != 1 {
		t.Errorf("swept = %d, want 1", last.Swept)
	}
	got := map[string]bool{}
	for _, e := range list(t, s, uid) {
		got[e.SourceUuid] = true
	}
	if !got["KEPT"] || !got["NEW"] || got["DELETED-IN-HEALTH"] || len(got) != 2 {
		t.Errorf("after the sweep: %v", got)
	}
}

func TestThePurgeAndTheUserCascadeLeaveNothing(t *testing.T) {
	pool := testPool(t)
	s := New(pool)
	uid := freshUser(t, pool)
	other := freshUser(t, pool)
	write(t, s, uid, Batch{Entries: []api.JournalEntryIn{symptomEntry("P1", 2, day), moodEntry("P2", 0, day)}})
	write(t, s, other, Batch{Entries: []api.JournalEntryIn{symptomEntry("O1", 2, day)}})

	total, last, err := s.Status(context.Background(), uid)
	if err != nil || total != 2 || last == nil {
		t.Fatalf("status = %d, %v, %v", total, last, err)
	}
	n, err := s.Purge(context.Background(), uid)
	if err != nil || n != 2 {
		t.Fatalf("purge = %d, %v", n, err)
	}
	total, last, err = s.Status(context.Background(), uid)
	if err != nil || total != 0 || last != nil {
		t.Errorf("after the purge: %d, %v, %v — want 0 and never", total, last, err)
	}
	if got := list(t, s, other); len(got) != 1 {
		t.Errorf("the purge touched another user: %+v", got)
	}

	if _, err := pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(other)); err != nil {
		t.Fatal(err)
	}
	var left int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM journal_entries WHERE user_id = $1`, pgconv.UUID(other)).Scan(&left); err != nil {
		t.Fatal(err)
	}
	if left != 0 {
		t.Errorf("%d journal entries survived their user", left)
	}
}

// The database refuses a row that is both a mood and a category value even
// if a client got past Validate — the constraint is the last line.
func TestTheSchemaRefusesAHalfMoodHalfSymptom(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	_, err := pool.Exec(context.Background(),
		`INSERT INTO journal_entries (user_id, source_uuid, data_type, started_at, ended_at, value, valence)
		 VALUES ($1, 'X', 'headache', now(), now(), 2, 0.5)`, pgconv.UUID(uid))
	if err == nil {
		t.Error("a row with both value and valence was stored")
	}
}
