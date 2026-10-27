package server

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/db"
)

// decodeSettings parses a PUT body the way the handler does, so the tests see
// exactly what oapi-codegen makes of absent, empty and null.
func decodeSettings(t *testing.T, body string) api.Settings {
	t.Helper()
	var s api.Settings
	if err := json.Unmarshal([]byte(body), &s); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return s
}

func mustClean(t *testing.T, body string) phoneSettingsWrite {
	t.Helper()
	s := decodeSettings(t, body)
	w, err := cleanPhoneSettings(&s)
	if err != nil {
		t.Fatalf("clean %s: %v", body, err)
	}
	return w
}

func mustRefuse(t *testing.T, body, wantDetail string) {
	t.Helper()
	s := decodeSettings(t, body)
	_, err := cleanPhoneSettings(&s)
	var bad *settingsError
	if !errors.As(err, &bad) {
		t.Fatalf("%s was accepted, want a 400", body)
	}
	if !strings.Contains(bad.detail, wantDetail) {
		t.Errorf("detail = %q, want it to mention %q", bad.detail, wantDetail)
	}
}

// An older phone sends only the server's own fields. Nothing about the phone's
// blocks may be written then — not even an empty row that would later read as
// "the phone said: nothing".
func TestAnOlderPhoneWritesNoBlocks(t *testing.T) {
	w := mustClean(t, `{"time_zone":"Europe/Budapest"}`)
	if !w.empty() {
		t.Errorf("a body without phone blocks produced a write: %+v", w)
	}
}

// The milestones go through the phone's own cleanup, and "never touched" and
// "deleted every one" stay two different values all the way to the query.
func TestChallengeThresholdsAreCleanedLikeThePhone(t *testing.T) {
	w := mustClean(t, `{"challenge":{"thresholds":[35000,20000,35000,0,-5]}}`)
	got := w.challenge.thresholds
	if len(got) != 2 || got[0] != 20000 || got[1] != 35000 {
		t.Errorf("thresholds = %v, want [20000 35000]", got)
	}

	never := mustClean(t, `{"challenge":{}}`)
	if never.challenge == nil || never.challenge.thresholds != nil {
		t.Errorf("an absent row must stay nil (NULL, factory row): %+v", never.challenge)
	}

	deleted := mustClean(t, `{"challenge":{"thresholds":[]}}`)
	if deleted.challenge.thresholds == nil || len(deleted.challenge.thresholds) != 0 {
		t.Errorf("an empty row must stay empty and non-nil ('{}'): %#v", deleted.challenge.thresholds)
	}

	// A row that cleans up to nothing is the same statement as an empty row: the
	// phone would show no goal for it either.
	zeros := mustClean(t, `{"challenge":{"thresholds":[0,-1]}}`)
	if zeros.challenge.thresholds == nil || len(zeros.challenge.thresholds) != 0 {
		t.Errorf("a row of non-positive values = %#v, want empty", zeros.challenge.thresholds)
	}
}

func TestChallengeThresholdLimits(t *testing.T) {
	mustRefuse(t, `{"challenge":{"thresholds":[20000000]}}`, "ceiling")
	many := make([]string, maxThresholds+1)
	for i := range many {
		many[i] = "1000"
	}
	mustRefuse(t, `{"challenge":{"thresholds":[`+strings.Join(many, ",")+`]}}`, "at most")
}

func TestRestDaysAreDedupedSortedAndBracketed(t *testing.T) {
	w := mustClean(t, `{"challenge":{"rest_days":["2026-08-12","2026-08-03","2026-08-12"]}}`)
	got := w.challenge.restDays
	if len(got) != 2 || got[0].Time.Format("2006-01-02") != "2026-08-03" ||
		got[1].Time.Format("2006-01-02") != "2026-08-12" {
		t.Errorf("rest days = %v, want 03, 12", got)
	}
	mustRefuse(t, `{"challenge":{"rest_days":["1999-12-31"]}}`, "2000–2100")

	// A malformed day never reaches the cleanup: the generated date type refuses
	// it while decoding, which the handler turns into a 400.
	var s api.Settings
	if err := json.Unmarshal([]byte(`{"challenge":{"rest_days":["2026-13-01"]}}`), &s); err == nil {
		t.Error("an impossible day decoded without an error")
	}
}

func TestHydrationGoal(t *testing.T) {
	w := mustClean(t, `{"hydration":{"goal_ml":2500}}`)
	if w.hydration == nil || *w.hydration == nil || **w.hydration != 2500 {
		t.Errorf("goal = %+v, want 2500", w.hydration)
	}
	// Sent, with no goal: the user cleared theirs. This must be a write (to NULL),
	// not "untouched" — the difference between the two is the whole point of
	// replacing the block.
	cleared := mustClean(t, `{"hydration":{}}`)
	if cleared.hydration == nil || *cleared.hydration != nil {
		t.Errorf("a cleared goal = %+v, want a write of NULL", cleared.hydration)
	}
	// The phone clamps to 500–6000, so anything outside did not come from it.
	mustRefuse(t, `{"hydration":{"goal_ml":499}}`, "500–6000")
	mustRefuse(t, `{"hydration":{"goal_ml":6001}}`, "500–6000")
}

func TestJourney(t *testing.T) {
	w := mustClean(t, `{"journey":{"route_id":"balatoni-bringakorut","started_on":"2026-08-01"}}`)
	if w.journey == nil || w.journey.routeID == nil || *w.journey.routeID != "balatoni-bringakorut" ||
		w.journey.startedOn.Time.Format("2006-01-02") != "2026-08-01" {
		t.Errorf("journey = %+v", w.journey)
	}
	stopped := mustClean(t, `{"journey":{}}`)
	if stopped.journey == nil || stopped.journey.routeID != nil || stopped.journey.startedOn.Valid {
		t.Errorf("a stopped journey = %+v, want a write of NULLs", stopped.journey)
	}
	// An id the server has never heard of is accepted: the catalogue ships with
	// the app, and a newer phone must not have its journey refused.
	mustClean(t, `{"journey":{"route_id":"a-route-from-the-future","started_on":"2026-08-01"}}`)

	mustRefuse(t, `{"journey":{"route_id":"rpddk"}}`, "come together")
	mustRefuse(t, `{"journey":{"started_on":"2026-08-01"}}`, "come together")
	mustRefuse(t, `{"journey":{"route_id":"Not An Id","started_on":"2026-08-01"}}`, "not a route id")
	mustRefuse(t, `{"journey":{"route_id":"`+strings.Repeat("a", 65)+`","started_on":"2026-08-01"}}`, "not a route id")
	mustRefuse(t, `{"journey":{"route_id":"rpddk","started_on":"1990-01-01"}}`, "2000–2100")
}

// One bad block refuses the whole request: nothing is written, not even the
// blocks that were fine.
func TestOneBadBlockRefusesTheRequest(t *testing.T) {
	mustRefuse(t, `{"challenge":{"thresholds":[20000]},"hydration":{"goal_ml":10}}`, "500–6000")
}

func TestPhoneSettingsFromRow(t *testing.T) {
	at := pgtype.Timestamptz{Time: time.Date(2026, 10, 27, 9, 0, 0, 0, time.UTC), Valid: true}
	day := func(s string) pgtype.Date {
		d, _ := time.Parse("2006-01-02", s)
		return pgtype.Date{Time: d, Valid: true}
	}

	// No block ever sent: everything stays absent — "not told" is not "empty".
	none := phoneSettingsFromRow(db.GetPhoneSettingsRow{})
	if none.challenge != nil || none.hydration != nil || none.journey != nil {
		t.Errorf("unsent blocks came out: %+v", none)
	}

	got := phoneSettingsFromRow(db.GetPhoneSettingsRow{
		ChallengeThresholds: []int32{20000, 35000},
		ChallengeRestDays:   []pgtype.Date{day("2026-08-03")},
		ChallengeAt:         at,
		HydrationAt:         at, // sent, no goal
		JourneyRouteID:      ptr("rpddk"),
		JourneyStartedOn:    day("2026-08-01"),
		JourneyAt:           at,
	})
	if got.challenge == nil || got.challenge.Thresholds == nil || len(*got.challenge.Thresholds) != 2 {
		t.Fatalf("challenge = %+v", got.challenge)
	}
	if got.challenge.RestDays == nil || len(*got.challenge.RestDays) != 1 {
		t.Errorf("rest days = %+v", got.challenge.RestDays)
	}
	if got.challenge.UpdatedAt == nil || !got.challenge.UpdatedAt.Equal(at.Time) {
		t.Errorf("updated_at = %v", got.challenge.UpdatedAt)
	}
	if got.hydration == nil || got.hydration.GoalMl != nil {
		t.Errorf("a sent block without a goal = %+v, want a block with no goal_ml", got.hydration)
	}
	if got.journey == nil || got.journey.RouteId == nil || *got.journey.RouteId != "rpddk" {
		t.Errorf("journey = %+v", got.journey)
	}

	// NULL milestones ("never touched") stay absent inside the block; '{}' goes
	// out as an empty array.
	factory := phoneSettingsFromRow(db.GetPhoneSettingsRow{ChallengeAt: at})
	if factory.challenge == nil || factory.challenge.Thresholds != nil {
		t.Errorf("NULL milestones = %+v, want absent", factory.challenge)
	}
	deleted := phoneSettingsFromRow(db.GetPhoneSettingsRow{ChallengeAt: at, ChallengeThresholds: []int32{}})
	if deleted.challenge.Thresholds == nil || len(*deleted.challenge.Thresholds) != 0 {
		t.Errorf("'{}' milestones = %+v, want an empty array", deleted.challenge.Thresholds)
	}
	raw, _ := json.Marshal(api.Settings{Challenge: deleted.challenge})
	if !strings.Contains(string(raw), `"thresholds":[]`) {
		t.Errorf("an empty row must reach the wire as []: %s", raw)
	}
}

func ptr[T any](v T) *T { return &v }
