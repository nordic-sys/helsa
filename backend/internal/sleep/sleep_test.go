package sleep

import (
	"testing"
	"time"
)

// at builds a timestamp inside one imaginary night: hour 0 is 22:00, so the
// numbers in the tests read like a night rather than like a clock.
func at(minutes float64) time.Time {
	base := time.Date(2026, 8, 10, 22, 0, 0, 0, time.UTC)
	return base.Add(time.Duration(minutes * float64(time.Minute)))
}

func raw(fromMin, toMin float64, stage string) Raw {
	return Raw{Start: at(fromMin), End: at(toMin), Stage: stage}
}

func mustSpans(t *testing.T, rows []Raw) []Span {
	t.Helper()
	spans, unknown := Spans(rows)
	if len(unknown) > 0 {
		t.Fatalf("unexpected unknown stages: %v", unknown)
	}
	return spans
}

func hours(d time.Duration) float64 { return d.Hours() }

// The bug this package was written for: two sources describe the same night, and
// the naive sum reports it one and a half times over.
func TestTwoSourcesDescribingOneNightCountOnce(t *testing.T) {
	rows := []Raw{
		// The phone: eight hours in one piece.
		raw(0, 480, "asleepCore"),
		// The watch: the same eight hours, in its own words and at its own
		// boundaries.
		raw(0, 90, "asleepCore"),
		raw(90, 200, "asleepDeep"),
		raw(200, 300, "asleepREM"),
		raw(300, 480, "asleepCore"),
	}
	spans := mustSpans(t, rows)

	var naive time.Duration
	for _, s := range spans {
		naive += s.Duration()
	}
	if got := hours(naive); got != 16 {
		t.Fatalf("the raw sum should be 16 hours (this is the bug), got %v", got)
	}

	slices, overlap := Resolve(spans)
	if got := hours(asleep(slices)); got != 8 {
		t.Errorf("asleep = %v hours, want 8", got)
	}
	if got := hours(overlap); got != 8 {
		t.Errorf("overlap = %v hours, want 8", got)
	}
}

// `awake` beats every sleep stage: overestimating sleep is the worse error.
func TestAwakeBeatsSleepStages(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(0, 480, "asleepCore"),   // the phone thinks it slept through
		raw(200, 260, "awake"),      // the watch saw an hour of lying awake
		raw(200, 260, "asleepDeep"), // and a third opinion claims deep sleep there
	})

	slices, _ := Resolve(spans)
	if got := hours(asleep(slices)); got != 7 {
		t.Errorf("asleep = %v hours, want 7 (8 minus the hour awake)", got)
	}
	var awakeTotal time.Duration
	for _, s := range slices {
		if s.Stage == Awake {
			awakeTotal += s.Duration()
		}
	}
	if awakeTotal != time.Hour {
		t.Errorf("awake = %v, want 1h", awakeTotal)
	}
}

// `inBed` loses to everything: it is an envelope, not a measurement.
func TestInBedEnvelopeAddsNoSleep(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(-30, 510, "inBed"), // nine hours in bed
		raw(0, 480, "asleepCore"),
	})

	slices, _ := Resolve(spans)
	if got := hours(asleep(slices)); got != 8 {
		t.Errorf("asleep = %v hours, want 8 — `inBed` is not sleep", got)
	}
	// The half hour at each end stays visible as `inBed`, so the night's shape
	// (and with it the efficiency) is not lost either.
	var inBed time.Duration
	for _, s := range slices {
		if s.Stage == InBed {
			inBed += s.Duration()
		}
	}
	if inBed != time.Hour {
		t.Errorf("inBed = %v, want 1h (half an hour before and after)", inBed)
	}
}

// `asleepUnspecified` is sleep. A source that does not do staging must not
// report a night of zero.
func TestUnspecifiedCountsAsSleep(t *testing.T) {
	spans := mustSpans(t, []Raw{raw(0, 420, "asleepUnspecified")})
	if got := hours(AsleepDuration(spans)); got != 7 {
		t.Errorf("asleep = %v hours, want 7", got)
	}
}

// The short, legacy stage names mean the same thing as the long ones — and where
// both spellings describe the same night, that is still ONE night's sleep.
func TestLegacyShortStageNames(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want Stage
	}{
		{"core", Core}, {"asleepCore", Core}, {"light", Core},
		{"deep", Deep}, {"ASLEEPDEEP", Deep},
		{"rem", REM}, {"asleepREM", REM},
		{"asleep", Unspecified}, {"asleepUnspecified", Unspecified},
		{"awake", Awake}, {"inBed", InBed}, {"in_bed", InBed},
	} {
		got, ok := Normalize(tc.raw)
		if !ok || got != tc.want {
			t.Errorf("Normalize(%q) = %q, %v; want %q", tc.raw, got, ok, tc.want)
		}
	}

	spans := mustSpans(t, []Raw{
		raw(0, 480, "asleepCore"),
		raw(0, 480, "core"), // the same night under the other spelling
	})
	if got := hours(AsleepDuration(spans)); got != 8 {
		t.Errorf("asleep = %v hours, want 8", got)
	}
}

// An unknown stage is reported, not silently counted as sleep.
func TestUnknownStageIsReportedNotCounted(t *testing.T) {
	spans, unknown := Spans([]Raw{
		raw(0, 480, "asleepCore"),
		raw(480, 540, "asleepSomethingNew"),
		raw(540, 600, "asleepSomethingNew"),
	})
	if len(unknown) != 1 || unknown[0] != "asleepSomethingNew" {
		t.Fatalf("unknown = %v, want [asleepSomethingNew] exactly once", unknown)
	}
	if got := hours(AsleepDuration(spans)); got != 8 {
		t.Errorf("asleep = %v hours, want 8 — the unknown stage must not become sleep", got)
	}
}

// Zero-length and reversed segments carry no time and must not break the cuts.
func TestDegenerateSegmentsAreDropped(t *testing.T) {
	spans, _ := Spans([]Raw{
		raw(0, 480, "asleepCore"),
		raw(100, 100, "asleepDeep"),
		raw(300, 200, "asleepREM"),
	})
	if len(spans) != 1 {
		t.Fatalf("got %d spans, want 1", len(spans))
	}
	if got := hours(AsleepDuration(spans)); got != 8 {
		t.Errorf("asleep = %v hours, want 8", got)
	}
}

// A nap three and a half hours after waking is its own session, not the tail of
// the night.
func TestNightsSplitOnTheGap(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(-30, 510, "inBed"),
		raw(0, 480, "asleepCore"),
		raw(720, 810, "asleepCore"), // an afternoon nap
	})

	nights := Nights(spans, NightGap)
	if len(nights) != 2 {
		t.Fatalf("got %d sessions, want 2", len(nights))
	}
	if got := hours(nights[0].Asleep()); got != 8 {
		t.Errorf("the night = %v hours, want 8", got)
	}
	if got := nights[1].Asleep(); got != 90*time.Minute {
		t.Errorf("the nap = %v, want 1h30m", got)
	}
}

// The gap is measured against the running maximum end. Under an `inBed`
// envelope, every stage starts "before" where the previous one ended — measured
// against the previous END, a night with a long first stage would fall apart.
func TestNightsMeasureTheGapAgainstTheRunningEnd(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(0, 480, "inBed"),      // the envelope comes first
		raw(0, 240, "asleepCore"), // and only then the stages under it
		raw(240, 480, "asleepREM"),
	})
	if got := len(Nights(spans, NightGap)); got != 1 {
		t.Errorf("got %d sessions, want 1", got)
	}
}

// Falling asleep and waking are the edges of the SLEEP, not of the time in bed:
// half an hour of tossing and turning is not sleep onset.
func TestOnsetAndWakeIgnoreAwakeAndInBed(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(-30, 510, "inBed"),
		raw(-30, 0, "awake"),
		raw(0, 480, "asleepCore"),
		raw(480, 510, "awake"),
	})
	night := Nights(spans, NightGap)[0]

	onset, ok := night.Onset()
	if !ok || !onset.Equal(at(0)) {
		t.Errorf("onset = %v (%v), want %v", onset, ok, at(0))
	}
	wake, ok := night.Wake()
	if !ok || !wake.Equal(at(480)) {
		t.Errorf("wake = %v (%v), want %v", wake, ok, at(480))
	}
}

// A session with no sleep in it has no falling-asleep moment — and says so,
// instead of inventing midnight.
func TestNightWithoutSleepHasNoOnset(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(0, 120, "inBed"),
		raw(0, 120, "awake"),
	})
	night := Nights(spans, NightGap)[0]
	if _, ok := night.Onset(); ok {
		t.Error("a night spent awake reported a sleep onset")
	}
	if night.Asleep() != 0 {
		t.Errorf("asleep = %v, want 0", night.Asleep())
	}
}

// Two stages that touch but do not overlap stay two stages, and the timeline
// does not report a phantom overlap.
func TestAdjacentStagesDoNotOverlap(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(0, 240, "asleepCore"),
		raw(240, 480, "asleepDeep"),
	})
	slices, overlap := Resolve(spans)
	if overlap != 0 {
		t.Errorf("overlap = %v, want 0", overlap)
	}
	if len(slices) != 2 {
		t.Errorf("got %d slices, want 2", len(slices))
	}
	if got := hours(asleep(slices)); got != 8 {
		t.Errorf("asleep = %v hours, want 8", got)
	}
}

// Neighbouring slices of the same stage are merged: an invisible cut (where
// another source's boundary fell) must not break the timeline into pieces.
func TestSameStageSlicesAreMerged(t *testing.T) {
	spans := mustSpans(t, []Raw{
		raw(0, 480, "asleepCore"),
		raw(120, 240, "core"), // the other spelling, from the other source
	})
	slices, _ := Resolve(spans)
	if len(slices) != 1 {
		t.Fatalf("got %d slices, want 1 (merged)", len(slices))
	}
	if got := hours(slices[0].Duration()); got != 8 {
		t.Errorf("the merged slice = %v hours, want 8", got)
	}
}
