package samples

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestClampLimitStaysWithinTheContract(t *testing.T) {
	for _, c := range []struct{ in, want int }{
		{0, DefaultLimit},    // a missing parameter → the default, not an empty page
		{-5, DefaultLimit},   // a nonsensical request → the default
		{1, 1},               //
		{750, 750},           //
		{MaxLimit, MaxLimit}, //
		{99999, MaxLimit},    // the client must not pull the whole hypertable in one request
	} {
		if got := ClampLimit(c.in); got != c.want {
			t.Errorf("ClampLimit(%d) = %d, expected %d", c.in, got, c.want)
		}
	}
}

func TestCursorRoundTrip(t *testing.T) {
	ts := time.Date(2026, 8, 10, 21, 15, 30, 123456789, time.UTC)
	c := encodeCursor(ts, "hr-0042")

	gotTs, gotUUID, err := decodeCursor(c)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !gotTs.Equal(ts) {
		t.Errorf("ts = %v, expected %v", gotTs, ts)
	}
	if gotUUID != "hr-0042" {
		t.Errorf("source_uuid = %q, expected hr-0042", gotUUID)
	}
	// The cursor has to be URL-safe: it travels in a query parameter, unescaped.
	if strings.ContainsAny(c, "+/=&? ") {
		t.Errorf("the cursor is not URL-safe: %q", c)
	}
}

// A non-UTC timestamp must come back exactly too (normalised to UTC in RFC3339Nano).
func TestCursorNormalisesToUTC(t *testing.T) {
	loc, err := time.LoadLocation("Europe/Budapest")
	if err != nil {
		t.Fatalf("tz: %v", err)
	}
	ts := time.Date(2026, 8, 10, 23, 30, 0, 0, loc)
	gotTs, _, err := decodeCursor(encodeCursor(ts, "x"))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !gotTs.Equal(ts) {
		t.Errorf("ts = %v, expected %v (the same instant)", gotTs, ts)
	}
}

// An empty cursor means the first page: the sentinel has to sit ABOVE every real
// row, otherwise the first page would come back empty.
func TestEmptyCursorIsAnUpperSentinel(t *testing.T) {
	ts, key, err := decodeCursor("")
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if ts.Year() != 9999 {
		t.Errorf("sentinel ts = %v, expected the year 9999", ts)
	}
	for _, real := range []string{"hr-0001", "step-9999", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF", "zzz"} {
		if !(real < key) {
			t.Errorf("the sentinel (%q) is not greater than a real source_uuid (%q)", key, real)
		}
	}
}

func TestDecodeCursorRejectsGarbage(t *testing.T) {
	for _, c := range []string{"not-base64!!!", "YWJj", "MjAyNi0wOC0xMHxocg"} {
		if _, _, err := decodeCursor(c); err == nil {
			t.Errorf("%q: expected an error", c)
		}
	}
}

func TestBuildQueryAddsOnlyTheRequestedFilters(t *testing.T) {
	uid := uuid.New()
	ts := time.Now()

	sql, args := buildQuery(uid, "stepCount", nil, nil, ts, "x", 50)
	if strings.Contains(sql, "ts >=") || strings.Contains(sql, "ts <  ") {
		t.Errorf("without a filter no time condition may appear:\n%s", sql)
	}
	if len(args) != 5 {
		t.Errorf("args = %d, expected 5 (user, type, cursor-ts, cursor-uuid, limit)", len(args))
	}
	if args[len(args)-1] != 51 {
		t.Errorf("LIMIT is %v, expected 51 (limit+1 decides next_cursor)", args[len(args)-1])
	}
	if !strings.Contains(sql, "ORDER BY ts DESC, source_uuid DESC") {
		t.Errorf("the deterministic ordering is missing:\n%s", sql)
	}

	from := ts.Add(-24 * time.Hour)
	to := ts
	sql, args = buildQuery(uid, "stepCount", &from, &to, ts, "x", 10)
	if !strings.Contains(sql, "AND ts >= $5") || !strings.Contains(sql, "AND ts < $6") {
		t.Errorf("from/to did not land on the expected parameter numbers:\n%s", sql)
	}
	if len(args) != 7 {
		t.Errorf("args = %d, expected 7", len(args))
	}
}

// The cursor condition rides on the (ts, source_uuid) pair: otherwise samples
// sharing a timestamp (several source devices) would either be skipped or come
// back twice during pagination.
func TestBuildQueryUsesCompositeKeyset(t *testing.T) {
	sql, _ := buildQuery(uuid.New(), "heartRate", nil, nil, time.Now(), "x", 10)
	if !strings.Contains(sql, "(ts < $3 OR (ts = $3 AND source_uuid < $4))") {
		t.Errorf("the keyset condition is not composite:\n%s", sql)
	}
}

func TestToDTOScalesPercentAndPrefersCatalogUnit(t *testing.T) {
	ts := time.Date(2026, 8, 10, 12, 0, 0, 0, time.UTC)
	v := 0.19238333
	clientUnit := "%"
	dev := "watch"

	got := toDTO(ts, "bodyFatPercentage", &v, &clientUnit, &dev)
	if got.Value == nil || float64(*got.Value) < 19.23 || float64(*got.Value) > 19.25 {
		t.Errorf("value = %v, expected ~19.24 (the same scale as the summary)", got.Value)
	}
	if got.Unit == nil || *got.Unit != "%" {
		t.Errorf("unit = %v", got.Unit)
	}
	if got.SourceDevice == nil || *got.SourceDevice != "watch" {
		t.Errorf("source_device = %v", got.SourceDevice)
	}

	// A non-percentage type: the value is untouched.
	steps := 812.0
	got = toDTO(ts, "stepCount", &steps, nil, nil)
	if got.Value == nil || *got.Value != 812 {
		t.Errorf("value = %v, expected 812", got.Value)
	}
	if got.Unit == nil || *got.Unit != "count" {
		t.Errorf("unit = %v, expected count (from the catalog)", got.Unit)
	}
}

// The catalog's unit wins over a differing stored unit — this is the bug that hit
// dietaryWater in production (L vs mL). For an unknown type, however, the stored
// unit is the only source, and it has to be handed out.
func TestToDTOUnitPrecedence(t *testing.T) {
	ts := time.Now()
	v := 1527.29
	stored := "L"

	got := toDTO(ts, "dietaryWater", &v, &stored, nil)
	if got.Unit == nil || *got.Unit != "mL" {
		t.Errorf("unit = %v, expected mL (the server's unit wins)", got.Unit)
	}

	got = toDTO(ts, "someFutureAppleMetric", &v, &stored, nil)
	if got.Unit == nil || *got.Unit != "L" {
		t.Errorf("unknown type unit = %v, expected L (the stored value is the fallback)", got.Unit)
	}

	got = toDTO(ts, "someFutureAppleMetric", &v, nil, nil)
	if got.Unit != nil {
		t.Errorf("neither catalog nor stored unit → the field must stay absent, got %v", *got.Unit)
	}
}

// A NULL value (it happens with some of HealthKit's category samples) must not
// show up as a 0: "no value" and "zero" are not the same thing.
func TestToDTOKeepsNullValueAbsent(t *testing.T) {
	got := toDTO(time.Now(), "stepCount", nil, nil, nil)
	if got.Value != nil {
		t.Errorf("NULL value → %v, but the field should be absent", *got.Value)
	}
}
