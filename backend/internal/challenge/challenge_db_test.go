//go:build smoke

// The phone's uploaded settings (migration 00010) against a REAL database.
//
// Two things here are SQL and nothing else can show them: that "never touched"
// (NULL) and "deleted every milestone" ('{}') survive the round trip through
// pgx as two different values — the whole thresholds_source rule rests on it —
// and that GET /v1/challenge reads the uploaded milestones and rest days ahead
// of the badge snapshot.
package challenge

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
	"github.com/nordic-sys/helsa/backend/internal/store"
	"github.com/nordic-sys/helsa/backend/internal/tenant"
)

const dbTZ = "Europe/Budapest"

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("HELSA_DATABASE_URL")
	if url == "" {
		url = "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable"
	}
	pool, err := store.NewPool(context.Background(), url)
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
		`INSERT INTO users (handle, time_zone) VALUES ($1, $2) RETURNING id`,
		fmt.Sprintf("challenge-db-test-%d", time.Now().UnixNano()), dbTZ).Scan(&id)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(id))
	})
	return id
}

var sampleSeq int

// walk writes one day's steps at noon local time.
func walk(t *testing.T, pool *pgxpool.Pool, uid uuid.UUID, day time.Time, steps float64) {
	t.Helper()
	sampleSeq++
	_, err := pool.Exec(context.Background(),
		`INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid, source_bundle)
		 VALUES ($1, $2, 'stepCount', $3, 'count', $4, 'phone')`,
		pgconv.UUID(uid), day.Add(12*time.Hour), steps,
		fmt.Sprintf("ch-%d-%d", time.Now().UnixNano(), sampleSeq))
	if err != nil {
		t.Fatalf("insert steps: %v", err)
	}
}

func dateOf(day time.Time) pgtype.Date {
	return pgtype.Date{Time: time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC), Valid: true}
}

func TestNeverTouchedAndDeletedAllSurviveTheRoundTrip(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	q := db.New(pool)
	ctx := context.Background()

	if err := q.PutChallengeSettings(ctx, db.PutChallengeSettingsParams{UserID: pgconv.UUID(uid)}); err != nil {
		t.Fatal(err)
	}
	row, err := q.GetPhoneSettings(ctx, pgconv.UUID(uid))
	if err != nil {
		t.Fatal(err)
	}
	if row.ChallengeThresholds != nil {
		t.Errorf("NULL milestones came back as %#v, want nil", row.ChallengeThresholds)
	}
	if !row.ChallengeAt.Valid || row.HydrationAt.Valid || row.JourneyAt.Valid {
		t.Errorf("only the challenge block was sent: %+v", row)
	}

	if err := q.PutChallengeSettings(ctx, db.PutChallengeSettingsParams{
		UserID: pgconv.UUID(uid), Thresholds: []int32{},
	}); err != nil {
		t.Fatal(err)
	}
	row, err = q.GetPhoneSettings(ctx, pgconv.UUID(uid))
	if err != nil {
		t.Fatal(err)
	}
	if row.ChallengeThresholds == nil || len(row.ChallengeThresholds) != 0 {
		t.Errorf("'{}' milestones came back as %#v, want an empty non-nil slice", row.ChallengeThresholds)
	}

	// The other blocks: a cleared goal goes to NULL, a stopped journey too, and the
	// database refuses half a journey by itself.
	g := int32(2500)
	if err := q.PutHydrationSettings(ctx, db.PutHydrationSettingsParams{UserID: pgconv.UUID(uid), GoalMl: &g}); err != nil {
		t.Fatal(err)
	}
	if err := q.PutHydrationSettings(ctx, db.PutHydrationSettingsParams{UserID: pgconv.UUID(uid)}); err != nil {
		t.Fatal(err)
	}
	row, _ = q.GetPhoneSettings(ctx, pgconv.UUID(uid))
	if row.HydrationGoalMl != nil || !row.HydrationAt.Valid {
		t.Errorf("a cleared goal = %v (at %v), want NULL with the block marked sent", row.HydrationGoalMl, row.HydrationAt)
	}
	id := "rpddk"
	err = q.PutJourneySettings(ctx, db.PutJourneySettingsParams{UserID: pgconv.UUID(uid), RouteID: &id})
	if err == nil {
		t.Error("a route without a start day was stored")
	}
	tooMuch := int32(9000)
	if err := q.PutHydrationSettings(ctx, db.PutHydrationSettingsParams{UserID: pgconv.UUID(uid), GoalMl: &tooMuch}); err == nil {
		t.Error("a goal outside 500–6000 was stored")
	}
}

func TestTheChallengeReadsTheUploadedSettings(t *testing.T) {
	pool := testPool(t)
	uid := freshUser(t, pool)
	q := db.New(pool)
	ctx := context.Background()
	loc, _ := time.LoadLocation(dbTZ)
	now := time.Date(2026, 8, 14, 18, 0, 0, 0, loc)
	m := MonthContaining(now, loc)
	svc := New(pool)

	// A badge snapshot exists — the fallback an older phone leaves behind.
	_, err := pool.Exec(ctx, `INSERT INTO achievements (user_id, id, kind, code, period, thresholds, earned_at)
		VALUES ($1, 'month:complete:2026-07', 'month', 'complete', '2026-07', '{10000,99000}', now())`,
		pgconv.UUID(uid))
	if err != nil {
		t.Fatal(err)
	}
	got, err := svc.Get(tenant.With(ctx, uid), uid, Query{Month: m, Loc: loc, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if got.ThresholdsSource != api.ChallengeResponseThresholdsSourceAchievement {
		t.Fatalf("before any upload: source = %q, want achievement", got.ThresholdsSource)
	}
	if len(got.Streak.MissingInputs) != 2 {
		t.Errorf("before any upload: missing = %v, want both", got.Streak.MissingInputs)
	}

	// August 1…14 walked against a 186 000 goal (6 000 a day over 31 days), the
	// 5th and 6th under it but marked as rest days, the 7th under it and marked
	// too — over the weekly allowance.
	for d := 1; d <= 14; d++ {
		steps := 9_000.0
		if d == 5 || d == 6 || d == 7 {
			steps = 300
		}
		walk(t, pool, uid, time.Date(2026, 8, d, 0, 0, 0, 0, loc), steps)
	}
	err = q.PutChallengeSettings(ctx, db.PutChallengeSettingsParams{
		UserID:     pgconv.UUID(uid),
		Thresholds: []int32{186_000, 50_000},
		RestDays: []pgtype.Date{
			dateOf(time.Date(2026, 8, 5, 0, 0, 0, 0, time.UTC)),
			dateOf(time.Date(2026, 8, 6, 0, 0, 0, 0, time.UTC)),
			dateOf(time.Date(2026, 8, 7, 0, 0, 0, 0, time.UTC)),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, err = svc.Get(tenant.With(ctx, uid), uid, Query{Month: m, Loc: loc, Now: now})
	if err != nil {
		t.Fatal(err)
	}
	if got.ThresholdsSource != api.ChallengeResponseThresholdsSourceSettings {
		t.Errorf("source = %q, want settings — the upload wins over the badge", got.ThresholdsSource)
	}
	if got.Goal == nil || *got.Goal != 186_000 {
		t.Errorf("goal = %v, want 186000", got.Goal)
	}
	if got.Streak.DailyGoal == nil || *got.Streak.DailyGoal != 6_000 {
		t.Errorf("daily goal = %v, want 6000", got.Streak.DailyGoal)
	}
	if len(got.Streak.MissingInputs) != 1 || got.Streak.MissingInputs[0] != "illness_days" {
		t.Errorf("missing = %v, want only illness_days", got.Streak.MissingInputs)
	}
	// 8…14 walked; the 7th was a rest day over the allowance and broke it.
	if got.Streak.Length != 7 {
		t.Errorf("length = %d, want 7 (8…14)", got.Streak.Length)
	}
	if got.Streak.BrokenBy == nil || got.Streak.BrokenBy.Reason != api.RestOverBudget {
		t.Errorf("broken_by = %+v, want rest_over_budget", got.Streak.BrokenBy)
	}

	// The phone back on its factory row: still `settings`, because the server is
	// no longer guessing — the factory row IS the user's row now.
	if err := q.PutChallengeSettings(ctx, db.PutChallengeSettingsParams{UserID: pgconv.UUID(uid)}); err != nil {
		t.Fatal(err)
	}
	got, _ = svc.Get(tenant.With(ctx, uid), uid, Query{Month: m, Loc: loc, Now: now})
	if got.ThresholdsSource != api.ChallengeResponseThresholdsSourceSettings || got.Goal == nil ||
		*got.Goal != DefaultThresholds[len(DefaultThresholds)-1] {
		t.Errorf("factory row: source %q goal %v", got.ThresholdsSource, got.Goal)
	}

	// Every milestone deleted: no goal, no streak — and still `settings`.
	if err := q.PutChallengeSettings(ctx, db.PutChallengeSettingsParams{
		UserID: pgconv.UUID(uid), Thresholds: []int32{},
	}); err != nil {
		t.Fatal(err)
	}
	got, _ = svc.Get(tenant.With(ctx, uid), uid, Query{Month: m, Loc: loc, Now: now})
	if got.Goal != nil || len(got.Thresholds) != 0 || got.Streak.DailyGoal != nil {
		t.Errorf("deleted milestones: goal %v, thresholds %v, daily %v", got.Goal, got.Thresholds, got.Streak.DailyGoal)
	}

	// An explicit parameter still wins over everything.
	explicit := NewThresholds([]int{1_000})
	got, _ = svc.Get(tenant.With(ctx, uid), uid, Query{Month: m, Loc: loc, Now: now, Thresholds: &explicit})
	if got.ThresholdsSource != api.ChallengeResponseThresholdsSourceRequest {
		t.Errorf("explicit parameter: source = %q", got.ThresholdsSource)
	}
}
