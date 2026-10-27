// Package journal stores the phone's journal and events (docs/35 item 8):
// HealthKit category samples (symptoms, heart-rate / loud-environment /
// walking-steadiness events) and state-of-mind samples (the daily mood).
//
// # The rules everything here follows
//
//  1. **Opt-in, and a mirror.** The phone sends these only when the user turns
//     "Journal and events" on. The table is a copy of what HealthKit holds
//     (ADR-0007): a row exists because a HealthKit sample exists, and it goes
//     when that sample goes — a deletion, a DELETE /v1/journal, or a backfill's
//     sweep.
//  2. **Synchronous.** The phone moves its journal anchor only after this
//     package has written the chunk, so a chunk is never "accepted" and then
//     lost in a queue, and an older server's 404 leaves the anchor where it was.
//  3. **Validation guards the shape, not the vocabulary.** A data type is a
//     pattern, not a list, for the same reason `SampleIn.data_type` is open: a
//     phone one version ahead must not have a new type refused. What is refused
//     is what the phone cannot produce — an interval that ends before it starts,
//     a row that is both a mood and a category value, a megabyte in a label.
package journal

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// MaxItems caps one chunk (entries + deletions), the same order as /ingest.
const MaxItems = 2000

// MaxWindowDays caps a read: three years and a bit. The web's longest view is
// the year-by-year comparison of the illness episodes; a person writes a few
// entries a day, so this is at most a few thousand rows.
const MaxWindowDays = 1100

// DefaultDays is the window without from/to — the phone's own horizon for the
// event timeline and the illness episodes (`HealthEventTimeline.historyDays`).
const DefaultDays = 90

// Size limits on the free strings. Each is far above anything HealthKit
// produces; they exist so a confused client cannot store a megabyte in a row.
const (
	maxUUIDLen     = 64
	maxEventKeyLen = 200
	maxBundleLen   = 200
	maxListLen     = 64
	maxListItemLen = 64
)

var dataTypePattern = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9]{0,63}$`)

// ErrInvalid wraps every validation failure, so the handler can answer 400.
var ErrInvalid = errors.New("invalid journal batch")

func invalid(format string, args ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, args...))
}

// Earliest and latest instants a sample can plausibly carry: HealthKit's
// category types date from 2019 (symptoms) and 2018 (heart-rate events), and a
// manually back-dated entry still sits after 2000.
var (
	earliest = time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC)
	latest   = time.Date(2100, 1, 1, 0, 0, 0, 0, time.UTC)
)

// Batch is a validated chunk, in the shape the store writes.
type Batch struct {
	Entries     []api.JournalEntryIn
	Deletions   []string
	SweepBefore *time.Time
}

// Validate checks one chunk. Everything is checked before anything is
// written, so a chunk with one bad entry changes nothing.
func Validate(in api.JournalBatch) (Batch, error) {
	var b Batch
	if in.Entries != nil {
		b.Entries = *in.Entries
	}
	if in.Deletions != nil {
		b.Deletions = *in.Deletions
	}
	b.SweepBefore = in.SweepBefore
	if len(b.Entries)+len(b.Deletions) > MaxItems {
		return b, ErrTooLarge
	}
	seen := make(map[string]bool, len(b.Entries))
	for i, e := range b.Entries {
		if err := validateEntry(e); err != nil {
			return b, fmt.Errorf("entry %d: %w", i, err)
		}
		// A chunk with the same uuid twice would make the upsert touch one row
		// twice in one statement, which Postgres refuses — and it is a client
		// bug either way.
		if seen[e.SourceUuid] {
			return b, invalid("entry %d: source_uuid %q appears twice in the chunk", i, e.SourceUuid)
		}
		seen[e.SourceUuid] = true
	}
	for _, d := range b.Deletions {
		if d == "" || len(d) > maxUUIDLen {
			return b, invalid("a deletion must be a HealthKit uuid (1–%d characters)", maxUUIDLen)
		}
	}
	return b, nil
}

// ErrTooLarge: the chunk exceeds MaxItems (the handler answers 413).
var ErrTooLarge = fmt.Errorf("a journal chunk carries at most %d items", MaxItems)

func validateEntry(e api.JournalEntryIn) error {
	if e.SourceUuid == "" || len(e.SourceUuid) > maxUUIDLen {
		return invalid("source_uuid must be 1–%d characters", maxUUIDLen)
	}
	if !dataTypePattern.MatchString(e.DataType) {
		return invalid("%q is not a data type (lowerCamelCase letters and digits)", e.DataType)
	}
	if e.StartedAt.Before(earliest) || !e.StartedAt.Before(latest) {
		return invalid("started_at %s is outside 2000–2100", e.StartedAt.Format(time.RFC3339))
	}
	if e.EndedAt.Before(e.StartedAt) {
		return invalid("ended_at is before started_at")
	}
	if !e.EndedAt.Before(latest) {
		return invalid("ended_at %s is outside 2000–2100", e.EndedAt.Format(time.RFC3339))
	}
	isMood := e.Valence != nil
	if isMood == (e.Value != nil) {
		return invalid("an entry carries exactly one of value (a category sample) and valence (a state of mind)")
	}
	if isMood {
		if *e.Valence < -1 || *e.Valence > 1 {
			return invalid("valence must be within −1…1")
		}
		if e.MoodKind != nil && !e.MoodKind.Valid() {
			return invalid("mood_kind ∈ {daily_mood, momentary_emotion}")
		}
	} else if e.MoodKind != nil || e.Labels != nil || e.Associations != nil {
		return invalid("mood_kind, labels and associations belong to a state of mind only")
	}
	if err := checkList("labels", e.Labels); err != nil {
		return err
	}
	if err := checkList("associations", e.Associations); err != nil {
		return err
	}
	if e.EventKey != nil && (len(*e.EventKey) == 0 || len(*e.EventKey) > maxEventKeyLen) {
		return invalid("event_key must be 1–%d characters", maxEventKeyLen)
	}
	if e.FollowUpHours != nil && !e.FollowUpHours.Valid() {
		return invalid("follow_up_hours ∈ {24, 48}")
	}
	if e.WorkoutSourceUuid != nil && (len(*e.WorkoutSourceUuid) == 0 || len(*e.WorkoutSourceUuid) > maxUUIDLen) {
		return invalid("workout_source_uuid must be 1–%d characters", maxUUIDLen)
	}
	if e.SourceDevice != nil && !e.SourceDevice.Valid() {
		return invalid("source_device ∈ {watch, iphone}")
	}
	if e.SourceBundle != nil && len(*e.SourceBundle) > maxBundleLen {
		return invalid("source_bundle is longer than %d characters", maxBundleLen)
	}
	if e.DayKey != nil && (e.DayKey.Before(earliest) || !e.DayKey.Before(latest)) {
		return invalid("day_key is outside 2000–2100")
	}
	return nil
}

func checkList(name string, list *[]string) error {
	if list == nil {
		return nil
	}
	if len(*list) > maxListLen {
		return invalid("%s: at most %d items", name, maxListLen)
	}
	for _, v := range *list {
		if v == "" || len(v) > maxListItemLen {
			return invalid("%s: every item is 1–%d characters", name, maxListItemLen)
		}
	}
	return nil
}

// Store is the database side.
type Store struct{ pool *pgxpool.Pool }

func New(pool *pgxpool.Pool) *Store { return &Store{pool: pool} }

// WriteResult is what one chunk did.
type WriteResult struct {
	Stored, Deleted, Swept int
	ServerTime             time.Time
}

const upsertSQL = `
INSERT INTO journal_entries (
    user_id, source_uuid, data_type, started_at, ended_at, value, valence,
    mood_kind, labels, associations, event_key, follow_up_hours,
    workout_source_uuid, day_key, audio_level_dbaspl, source_bundle,
    source_device, user_entered, received_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, now())
ON CONFLICT (user_id, source_uuid) DO UPDATE SET
    data_type = EXCLUDED.data_type, started_at = EXCLUDED.started_at,
    ended_at = EXCLUDED.ended_at, value = EXCLUDED.value, valence = EXCLUDED.valence,
    mood_kind = EXCLUDED.mood_kind, labels = EXCLUDED.labels,
    associations = EXCLUDED.associations, event_key = EXCLUDED.event_key,
    follow_up_hours = EXCLUDED.follow_up_hours,
    workout_source_uuid = EXCLUDED.workout_source_uuid, day_key = EXCLUDED.day_key,
    audio_level_dbaspl = EXCLUDED.audio_level_dbaspl,
    source_bundle = EXCLUDED.source_bundle, source_device = EXCLUDED.source_device,
    user_entered = EXCLUDED.user_entered, received_at = now()`

// Write stores one validated chunk in ONE transaction: upserts, then
// deletions, then the sweep. `now()` is the transaction's start, so every row
// of the chunk carries exactly the instant reported back as `ServerTime` — and
// a sweep whose token is that instant (`received_at < token`) keeps them.
func (s *Store) Write(ctx context.Context, userID uuid.UUID, b Batch) (WriteResult, error) {
	var res WriteResult
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer func() { _ = tx.Rollback(ctx) }() // a no-op after Commit

	var now pgtype.Timestamptz
	if err := tx.QueryRow(ctx, `SELECT now()`).Scan(&now); err != nil {
		return res, err
	}
	res.ServerTime = now.Time
	uid := pgconv.UUID(userID)

	if len(b.Entries) > 0 {
		batch := &pgx.Batch{}
		for _, e := range b.Entries {
			batch.Queue(upsertSQL, entryArgs(uid, e)...)
		}
		br := tx.SendBatch(ctx, batch)
		for range b.Entries {
			if _, err := br.Exec(); err != nil {
				_ = br.Close()
				return res, fmt.Errorf("store journal entry: %w", err)
			}
		}
		if err := br.Close(); err != nil {
			return res, err
		}
		res.Stored = len(b.Entries)
	}
	if len(b.Deletions) > 0 {
		tag, err := tx.Exec(ctx,
			`DELETE FROM journal_entries WHERE user_id = $1 AND source_uuid = ANY($2::text[])`,
			uid, b.Deletions)
		if err != nil {
			return res, fmt.Errorf("delete journal entries: %w", err)
		}
		res.Deleted = int(tag.RowsAffected())
	}
	if b.SweepBefore != nil {
		tag, err := tx.Exec(ctx,
			`DELETE FROM journal_entries WHERE user_id = $1 AND received_at < $2`,
			uid, pgconv.Timestamptz(*b.SweepBefore))
		if err != nil {
			return res, fmt.Errorf("sweep journal entries: %w", err)
		}
		res.Swept = int(tag.RowsAffected())
	}
	return res, tx.Commit(ctx)
}

func entryArgs(uid pgtype.UUID, e api.JournalEntryIn) []any {
	var moodKind, device *string
	if e.MoodKind != nil {
		v := string(*e.MoodKind)
		moodKind = &v
	}
	if e.SourceDevice != nil {
		v := string(*e.SourceDevice)
		device = &v
	}
	var followUp *int16
	if e.FollowUpHours != nil {
		v := int16(*e.FollowUpHours) // #nosec G115 -- validated: 24 or 48
		followUp = &v
	}
	var value *int32
	if e.Value != nil {
		v := int32(*e.Value) // #nosec G115 -- a HealthKit enum value
		value = &v
	}
	dayKey := pgtype.Date{}
	if e.DayKey != nil {
		dayKey = pgtype.Date{Time: e.DayKey.Time, Valid: true}
	}
	return []any{
		uid, e.SourceUuid, e.DataType, pgconv.Timestamptz(e.StartedAt), pgconv.Timestamptz(e.EndedAt),
		value, e.Valence, moodKind, derefList(e.Labels), derefList(e.Associations), e.EventKey,
		followUp, e.WorkoutSourceUuid, dayKey, e.AudioLevelDbaspl, e.SourceBundle, device,
		e.UserEntered,
	}
}

func derefList(l *[]string) []string {
	if l == nil {
		return nil
	}
	return *l
}

// Purge deletes every journal entry of the user — the phone's "delete from
// the server" and the web's button.
func (s *Store) Purge(ctx context.Context, userID uuid.UUID) (int, error) {
	tag, err := s.pool.Exec(ctx, `DELETE FROM journal_entries WHERE user_id = $1`, pgconv.UUID(userID))
	if err != nil {
		return 0, err
	}
	return int(tag.RowsAffected()), nil
}

const listSQL = `
SELECT source_uuid, data_type, started_at, ended_at, value, valence, mood_kind,
       labels, associations, event_key, follow_up_hours, workout_source_uuid,
       day_key, audio_level_dbaspl, source_bundle, source_device, user_entered
FROM journal_entries
WHERE user_id = $1 AND started_at >= $2 AND started_at < $3
ORDER BY started_at, data_type, source_uuid`

// Each walks the entries whose start falls in [start, end), oldest first,
// handing them on one by one — the list endpoint collects them, the export
// streams them.
func (s *Store) Each(ctx context.Context, userID uuid.UUID, start, end time.Time,
	fn func(api.JournalEntry) error) error {
	rows, err := s.pool.Query(ctx, listSQL, pgconv.UUID(userID),
		pgconv.Timestamptz(start), pgconv.Timestamptz(end))
	if err != nil {
		return fmt.Errorf("read journal: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			e              api.JournalEntry
			started, ended pgtype.Timestamptz
			value          *int32
			moodKind       *string
			labels, assocs []string
			followUp       *int16
			dayKey         pgtype.Date
		)
		if err := rows.Scan(&e.SourceUuid, &e.DataType, &started, &ended, &value, &e.Valence,
			&moodKind, &labels, &assocs, &e.EventKey, &followUp, &e.WorkoutSourceUuid,
			&dayKey, &e.AudioLevelDbaspl, &e.SourceBundle, &e.SourceDevice, &e.UserEntered); err != nil {
			return fmt.Errorf("scan journal entry: %w", err)
		}
		e.StartedAt, e.EndedAt = started.Time.UTC(), ended.Time.UTC()
		if value != nil {
			v := int(*value)
			e.Value = &v
		}
		if moodKind != nil {
			k := api.JournalEntryMoodKind(*moodKind)
			e.MoodKind = &k
		}
		if labels != nil {
			e.Labels = &labels
		}
		if assocs != nil {
			e.Associations = &assocs
		}
		if followUp != nil {
			v := int(*followUp)
			e.FollowUpHours = &v
		}
		if dayKey.Valid {
			e.DayKey = &openapi_types.Date{Time: dayKey.Time}
		}
		if err := fn(e); err != nil {
			return err
		}
	}
	return rows.Err()
}

// Status is what the list endpoint says beside the entries: how many the
// server holds at all, and when the phone last sent one (nil = never).
func (s *Store) Status(ctx context.Context, userID uuid.UUID) (total int, last *time.Time, err error) {
	var ts pgtype.Timestamptz
	err = s.pool.QueryRow(ctx,
		`SELECT count(*), max(received_at) FROM journal_entries WHERE user_id = $1`,
		pgconv.UUID(userID)).Scan(&total, &ts)
	if err != nil {
		return 0, nil, err
	}
	if ts.Valid {
		t := ts.Time.UTC()
		last = &t
	}
	return total, last, nil
}
