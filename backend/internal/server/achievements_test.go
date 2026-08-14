package server

import (
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/db"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

func TestAchievementParams(t *testing.T) {
	uid := uuid.New()
	earned := time.Date(2026, 8, 31, 22, 0, 0, 0, time.UTC)
	period, unit := "2026-08", "count"
	value := float32(312000)

	got, err := achievementParams(uid, api.AchievementInput{
		Id: "month:complete:2026-08", Kind: "month", Code: "complete",
		Period: &period, Value: &value, Unit: &unit,
		Thresholds: &[]int{5000, 8000, 10000}, EarnedAt: earned,
	})
	if err != nil {
		t.Fatalf("params: %v", err)
	}
	if got.ID != "month:complete:2026-08" || got.Kind != "month" || got.Code != "complete" {
		t.Errorf("identifier fields: %+v", got)
	}
	if pgconv.ToUUID(got.UserID) != uid {
		t.Errorf("user_id: %+v", got.UserID)
	}
	if got.Value == nil || *got.Value != 312000 {
		t.Errorf("value: %+v", got.Value)
	}
	// The threshold snapshot preserves order: the client draws the card's path from it.
	if len(got.Thresholds) != 3 || got.Thresholds[0] != 5000 || got.Thresholds[2] != 10000 {
		t.Errorf("thresholds: %+v", got.Thresholds)
	}
	if !got.EarnedAt.Valid || !got.EarnedAt.Time.Equal(earned) {
		t.Errorf("earned_at: %+v", got.EarnedAt)
	}
}

func TestAchievementParamsRejectsIncomplete(t *testing.T) {
	uid := uuid.New()
	ok := api.AchievementInput{Id: "record:best-month", Kind: "record", Code: "best-month",
		EarnedAt: time.Now()}

	cases := []struct {
		name string
		in   api.AchievementInput
	}{
		{"without an id", func() api.AchievementInput { c := ok; c.Id = ""; return c }()},
		{"without a code", func() api.AchievementInput { c := ok; c.Code = ""; return c }()},
		{"an unknown kind", func() api.AchievementInput { c := ok; c.Kind = "badge"; return c }()},
		// A missing earned_at decodes as the zero timestamp. Writing that in would park
		// the badge at the end of the list with year 1; a tacit "now", on the other hand,
		// would be a lie, because the client typically reports a moment in the past.
		{"without earned_at", func() api.AchievementInput { c := ok; c.EarnedAt = time.Time{}; return c }()},
	}
	for _, c := range cases {
		if _, err := achievementParams(uid, c.in); err == nil {
			t.Errorf("%s: expected a rejection", c.name)
		}
	}
	if _, err := achievementParams(uid, ok); err != nil {
		t.Errorf("the valid badge was rejected: %v", err)
	}
}

func TestAchievementDTO(t *testing.T) {
	earned := time.Date(2025, 12, 31, 23, 30, 0, 0, time.UTC)
	period, unit := "2025", "count"
	value := 4.2e6

	got := achievementDTO(db.Achievement{
		ID: "year:complete:2025", Kind: "year", Code: "complete",
		Period: &period, Unit: &unit, Value: &value,
		Thresholds: []int32{100000, 250000},
		EarnedAt:   pgtype.Timestamptz{Time: earned, Valid: true},
	})
	if got.Id != "year:complete:2025" || got.Kind != "year" {
		t.Errorf("identifier fields: %+v", got)
	}
	if got.Thresholds == nil || len(*got.Thresholds) != 2 || (*got.Thresholds)[1] != 250000 {
		t.Errorf("thresholds: %+v", got.Thresholds)
	}
	if !got.EarnedAt.Equal(earned) {
		t.Errorf("earned_at: %v", got.EarnedAt)
	}
}

// "No thresholds" (record, milestone) and "an empty threshold list" are not the
// same: we must not manufacture an empty array out of a NULL column, because the
// client would read that as "we know the thresholds and they really are empty".
func TestAchievementThresholdsNullStaysAbsent(t *testing.T) {
	got := achievementDTO(db.Achievement{ID: "record:best-month", Kind: "record", Code: "best-month"})
	if got.Thresholds != nil {
		t.Errorf("NULL thresholds must not become an array: %+v", got.Thresholds)
	}
	if got.Period != nil || got.Unit != nil || got.Value != nil {
		t.Errorf("the NULL columns must stay nil: %+v", got)
	}
	if th, err := thresholdsToDB(nil); err != nil || th != nil {
		t.Errorf("nil thresholds → NULL, not an empty array: %+v, %v", th, err)
	}
	if th, err := thresholdsToDB(&[]int{}); err != nil || th == nil || len(th) != 0 {
		t.Errorf("an empty list must stay an empty array (not NULL): %+v, %v", th, err)
	}
}

// The column is `integer[]`, the request field is a 64-bit `int`. A threshold that
// does not fit must be REFUSED, not silently truncated into a negative number —
// a wrapped value would be stored as a historical fact and never questioned again.
func TestAchievementThresholdsOutOfRangeRejected(t *testing.T) {
	for _, v := range []int{math.MaxInt32 + 1, math.MinInt32 - 1} {
		if _, err := thresholdsToDB(&[]int{1000, v}); err == nil {
			t.Errorf("threshold %d does not fit in int32, it must be rejected", v)
		}
	}
	// The edges themselves still fit and must go through.
	if th, err := thresholdsToDB(&[]int{math.MinInt32, math.MaxInt32}); err != nil || len(th) != 2 {
		t.Errorf("the int32 edges are valid thresholds: %+v, %v", th, err)
	}
}

// The upsert's SEMANTICS live in the query, which is why they are guarded here: on
// conflict value/unit/thresholds are updated (late-arriving HealthKit data can raise
// a month's step count after the badge was born), while earned_at is NOT — the date
// earned is settled at the first recording. The behaviour is verified against a real
// database by the smoke test (test/smoke); this test catches somebody rewriting the
// rule while editing the query.
func TestUpsertAchievementQueryKeepsEarnedAt(t *testing.T) {
	raw, err := os.ReadFile("../../db/queries/queries.sql")
	if err != nil {
		t.Fatalf("queries.sql: %v", err)
	}
	stmt, ok := statement(string(raw), "UpsertAchievement")
	if !ok {
		t.Fatal("there is no UpsertAchievement query")
	}
	_, update, ok := strings.Cut(stmt, "DO UPDATE SET")
	if !ok {
		t.Fatal("UpsertAchievement does not upsert (there is no DO UPDATE SET)")
	}
	if strings.Contains(update, "earned_at") {
		t.Error("the DO UPDATE branch touches earned_at — the date earned must not be overwritten")
	}
	for _, col := range []string{"value", "unit", "thresholds"} {
		if !strings.Contains(update, col+" ") && !strings.Contains(update, col+"=") {
			t.Errorf("the DO UPDATE branch does not update %s", col)
		}
	}
	// Only the SQL counts here, not the comment above it: the comment is the very
	// place where the word "delete" legitimately appears, explaining why there is
	// none in the statement.
	if strings.Contains(strings.ToUpper(sqlOnly(stmt)), "DELETE") {
		t.Error("the badge upsert may never delete")
	}
}

// sqlOnly drops the leading `--` comment lines, leaving the executable SQL.
func sqlOnly(stmt string) string {
	var b strings.Builder
	for _, line := range strings.Split(stmt, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		b.WriteString(line)
		b.WriteString("\n")
	}
	return b.String()
}

// statement returns the body of the named sqlc query from the query file.
func statement(src, name string) (string, bool) {
	_, after, ok := strings.Cut(src, "-- name: "+name+" ")
	if !ok {
		return "", false
	}
	if before, _, found := strings.Cut(after, "\n-- name: "); found {
		return before, true
	}
	return after, true
}
