package hass

import (
	"encoding/json"
	"testing"
	"time"
)

func at(h, m int) time.Time {
	return time.Date(2026, 8, 12, h, m, 0, 0, time.UTC)
}

func TestLatestSessionHours(t *testing.T) {
	tests := []struct {
		name string
		segs []sleepSegment
		want *float64
	}{
		{name: "no segments at all", segs: nil, want: nil},
		{
			// Time asleep, not time in bed. Counting `awake` and `inBed` would report a
			// full night for somebody who lay there staring at the ceiling.
			name: "awake and inBed do not count as sleep",
			segs: []sleepSegment{
				{at(0, 0), at(1, 0), "inBed"},
				{at(1, 0), at(3, 0), "core"},
				{at(3, 0), at(3, 30), "awake"},
				{at(3, 30), at(5, 30), "deep"},
			},
			want: f(4),
		},
		{
			// A nap in the afternoon is not last night. The three-hour gap closes the
			// session, and only the later one is published.
			name: "a gap longer than three hours starts a new session",
			segs: []sleepSegment{
				{at(1, 0), at(6, 0), "core"},
				{at(14, 0), at(15, 0), "core"},
			},
			want: f(1),
		},
		{
			// Sleep crosses midnight; a shorter break inside the night is still the same
			// night, not two half-nights.
			name: "a short break keeps the session together",
			segs: []sleepSegment{
				{at(1, 0), at(3, 0), "core"},
				{at(4, 0), at(6, 0), "rem"},
			},
			want: f(4),
		},
		{
			name: "only wakefulness recorded is not zero hours of sleep",
			segs: []sleepSegment{{at(1, 0), at(6, 0), "awake"}},
			want: nil,
		},
		{
			// Two sources, one night. The phone says five hours in one piece, the
			// watch breaks the same five hours into stages — that is five hours of
			// sleep, not ten.
			name: "two sources describing the same night count once",
			segs: []sleepSegment{
				{at(1, 0), at(6, 0), "asleepCore"},
				{at(1, 0), at(2, 30), "asleepCore"},
				{at(2, 30), at(4, 0), "asleepDeep"},
				{at(4, 0), at(6, 0), "asleepREM"},
			},
			want: f(5),
		},
		{
			// Where the sources disagree, wakefulness wins: claiming deep sleep over
			// an hour another source saw as awake would be wrong in the more
			// flattering direction.
			name: "awake beats the sleep stage under it",
			segs: []sleepSegment{
				{at(0, 0), at(6, 0), "inBed"},
				{at(1, 0), at(6, 0), "asleepCore"},
				{at(3, 0), at(4, 0), "awake"},
			},
			want: f(4),
		},
		{
			// A source that does not do staging still measured sleep.
			name: "asleepUnspecified is sleep",
			segs: []sleepSegment{
				{at(0, 0), at(6, 30), "inBed"},
				{at(1, 0), at(6, 0), "asleepUnspecified"},
			},
			want: f(5),
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := latestSessionHours(tc.segs)
			switch {
			case tc.want == nil && got != nil:
				t.Fatalf("got %v hours, want missing", *got)
			case tc.want != nil && got == nil:
				t.Fatalf("got missing, want %v hours", *tc.want)
			case tc.want != nil && *got != *tc.want:
				t.Fatalf("got %v hours, want %v", *got, *tc.want)
			}
		})
	}
}

func TestCountClosed(t *testing.T) {
	// A ring with no goal is neither closed nor open — it is unknown, and then the
	// whole count is meaningless. "0 of 3 closed" told to somebody who never set a
	// Move goal is a lie an automation would act on.
	if got := countClosed(ringPair{f(500), nil}, ringPair{f(30), f(30)}, ringPair{f(12), f(12)}); got != nil {
		t.Errorf("a missing goal must make the count missing, got %v", *got)
	}
	if got := countClosed(ringPair{f(500), f(0)}, ringPair{f(30), f(30)}, ringPair{f(12), f(12)}); got != nil {
		t.Errorf("a zero goal is not a goal, got %v", *got)
	}
	got := countClosed(ringPair{f(500), f(400)}, ringPair{f(20), f(30)}, ringPair{nil, f(12)})
	if got == nil || *got != 1 {
		t.Errorf("got %v, want 1 ring closed", got)
	}
	got = countClosed(ringPair{f(400), f(400)}, ringPair{f(30), f(30)}, ringPair{f(12), f(12)})
	if got == nil || *got != 3 {
		t.Errorf("reaching the goal exactly closes the ring; got %v", got)
	}
}

func TestFreshnessFrom(t *testing.T) {
	now := at(12, 0)

	if f := freshnessFrom(time.Time{}, now); f.Hours != nil {
		t.Errorf("no data at all must be missing, not %v hours", *f.Hours)
	}
	// The SQL falls back to 'epoch' when there is nothing; that is "never", not
	// "half a century stale".
	if f := freshnessFrom(time.Unix(0, 0).UTC(), now); f.Hours != nil {
		t.Errorf("the epoch fallback must read as missing, not %v hours", *f.Hours)
	}

	f2 := freshnessFrom(at(9, 30), now)
	if f2.Hours == nil || *f2.Hours != 2.5 {
		t.Fatalf("got %v, want 2.5 hours", f2.Hours)
	}
	if f2.FutureSkew != 0 {
		t.Errorf("unexpected skew %v", f2.FutureSkew)
	}

	// ⚠️ The important one. A negative age never crosses an "above 12 hours"
	// threshold, so without the clamp a wrong clock silently switches the alert off
	// for as long as the skew lasts.
	f3 := freshnessFrom(at(14, 0), now)
	if f3.Hours == nil || *f3.Hours != 0 {
		t.Fatalf("data from the future must clamp to 0, got %v", f3.Hours)
	}
	if f3.FutureSkew != 2*time.Hour {
		t.Errorf("the skew must be reported, got %v", f3.FutureSkew)
	}
}

func TestAttributesJSONSpellsOutTheClamp(t *testing.T) {
	buf, err := attributesJSON(freshnessFrom(at(14, 0), at(12, 0)), "helsa-worker")
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(buf, &got); err != nil {
		t.Fatal(err)
	}
	if got["future_skew_s"] != float64(7200) {
		t.Errorf("future_skew_s = %v, want 7200", got["future_skew_s"])
	}
	if got["newest_data"] != "2026-08-12T14:00:00Z" {
		t.Errorf("newest_data = %v", got["newest_data"])
	}

	buf, err = attributesJSON(Freshness{}, "helsa-worker")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(buf, &got); err != nil {
		t.Fatal(err)
	}
	if got["newest_data"] != "never" {
		t.Errorf("with no data at all newest_data = %v, want \"never\"", got["newest_data"])
	}
}

func TestSnapshotValueCoversEveryDailyEntity(t *testing.T) {
	// If an entity is added to the table without a matching case in Snapshot.value,
	// it would publish "None" for ever and nothing would say why.
	full := Snapshot{Steps: f(1), ActiveEnergy: f(2), SleepHours: f(3), RestingHeartRate: f(4), RingsClosed: f(5)}
	for _, e := range entities {
		if e.expiring {
			continue
		}
		if full.value(e.suffix) == nil {
			t.Errorf("Snapshot.value has no case for %q", e.suffix)
		}
	}
}

func f(v float64) *float64 { return &v }
