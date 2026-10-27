package workouts

// The phone's `WorkoutIntensityTests` (HelsaKit/Tests/HelsaKitTests/
// WorkoutProgressTests.swift), case for case and with the same numbers, plus the
// per-session maximum that `WorkoutProgressViewModel.loadIntensity` builds and
// the fold it rests on. If one of these has to change, the Swift test has to
// change with it — or the two screens will disagree about the same week.

import (
	"math"
	"testing"
	"time"
)

var t0 = time.Unix(1_800_000_000, 0).UTC()

func series(bpms []float64, step time.Duration) []HRPoint {
	out := make([]HRPoint, len(bpms))
	for i, b := range bpms {
		out[i] = HRPoint{T: t0.Add(time.Duration(i) * step), BPM: b}
	}
	return out
}

// "The maximum is the second highest — one sensor spike does not set the zones"
func TestMeasuredMaximumIsSecondHighest(t *testing.T) {
	m, ok := MeasuredMaximum([]float64{150, 178, 182, 160, 229, 171})
	if !ok || m.BPM != 182 || m.Workouts != 6 {
		t.Fatalf("got %+v %v, want 182 from 6", m, ok)
	}
	// Within a rounding error: Go folds the constant `182*0.7` exactly at compile
	// time (127.4), while the runtime product is 127.39999…, as it is in Swift.
	if math.Abs(m.Zone3Threshold()-127.4) > 1e-9 {
		t.Errorf("threshold %v, want 127.4", m.Zone3Threshold())
	}
}

// "Too few workouts, or only implausible readings, give no maximum"
func TestMeasuredMaximumNeedsFivePlausible(t *testing.T) {
	if _, ok := MeasuredMaximum([]float64{180, 170, 175, 165}); ok {
		t.Error("four workouts gave a maximum")
	}
	// 250 and 60 are sensor errors; four plausible values remain — still too few.
	if _, ok := MeasuredMaximum([]float64{180, 170, 175, 165, 250, 60}); ok {
		t.Error("implausible readings were counted")
	}
	// The band edges are inclusive (`100...230`).
	if m, ok := MeasuredMaximum([]float64{100, 230, 120, 130, 140}); !ok || m.BPM != 140 {
		t.Errorf("edges: %+v %v, want 140", m, ok)
	}
}

// "Seconds above the threshold: each sample stands for the time to the next one"
func TestSecondsCountSampleIntervals(t *testing.T) {
	// 5 s apart: 120, 140, 140, 120 → two samples at or above 130, 10 s.
	got, ok := SecondsAtOrAbove(130, series([]float64{120, 140, 140, 120}, 5*time.Second), t0.Add(20*time.Second))
	if !ok || got != 10 {
		t.Errorf("got %v %v, want 10", got, ok)
	}
}

// "A gap in the heart rate is not filled with hard minutes"
func TestSecondsGapIsCapped(t *testing.T) {
	points := []HRPoint{{T: t0, BPM: 150}, {T: t0.Add(600 * time.Second), BPM: 150}}
	got, ok := SecondsAtOrAbove(130, points, t0.Add(605*time.Second))
	if !ok || got != MaxGap.Seconds()+5 {
		t.Errorf("got %v %v, want %v", got, ok, MaxGap.Seconds()+5)
	}
}

// "Fewer than two samples is an unmeasured workout, not zero hard minutes"
func TestSecondsUnmeasured(t *testing.T) {
	if _, ok := SecondsAtOrAbove(130, nil, t0); ok {
		t.Error("no samples was measured")
	}
	if _, ok := SecondsAtOrAbove(130, []HRPoint{{T: t0, BPM: 170}}, t0.Add(time.Minute)); ok {
		t.Error("one sample was measured")
	}
}

// The database returns readings in order, but the rule must not depend on it:
// the phone sorts, because `/samples` is newest first.
func TestSecondsSortsTheReadings(t *testing.T) {
	points := series([]float64{120, 140, 140, 120}, 5*time.Second)
	reversed := []HRPoint{points[3], points[2], points[1], points[0]}
	if got, _ := SecondsAtOrAbove(130, reversed, t0.Add(20*time.Second)); got != 10 {
		t.Errorf("reversed input: %v, want 10", got)
	}
}

// Exactly at the threshold counts ("at or above").
func TestSecondsThresholdIsInclusive(t *testing.T) {
	got, _ := SecondsAtOrAbove(130, series([]float64{130, 129}, 5*time.Second), t0.Add(10*time.Second))
	if got != 5 {
		t.Errorf("got %v, want 5", got)
	}
}

// Two sources writing the same minutes interleave: the total stays bounded by
// the workout, it does not double (the source-merge decision in intensity.go).
func TestSecondsInterleavedSourcesDoNotDouble(t *testing.T) {
	var points []HRPoint
	for i := 0; i < 12; i++ { // a minute, every 5 s from the watch...
		points = append(points, HRPoint{T: t0.Add(time.Duration(i) * 5 * time.Second), BPM: 150})
		// ...and the same minute from a strap, offset by 2 s.
		points = append(points, HRPoint{T: t0.Add(time.Duration(i)*5*time.Second + 2*time.Second), BPM: 152})
	}
	got, _ := SecondsAtOrAbove(130, points, t0.Add(60*time.Second))
	if got != 60 {
		t.Errorf("got %v, want 60", got)
	}
}

func ptr[T any](v T) *T { return &v }

func rec(id, kind string, start time.Time, minutes float64, maxHR *float64) Recording {
	end := start.Add(time.Duration(minutes * float64(time.Minute)))
	return Recording{ID: id, ActivityType: kind, Start: start, End: &end, MaxHR: maxHR}
}

// One maximum per SESSION: a race recorded by a watch and a strap must not be
// its own "second highest", or the spike rule is gone.
func TestSessionMaximaFoldDuplicates(t *testing.T) {
	day := func(d int) time.Time { return t0.AddDate(0, 0, d) }
	recs := []Recording{
		rec("race-watch", "running", day(0), 40, ptr(195.0)),
		rec("race-strap", "running", day(0).Add(time.Minute), 40, ptr(193.0)),
		rec("a", "running", day(3), 30, ptr(170.0)),
		rec("b", "cycling", day(5), 60, ptr(165.0)),
		rec("c", "running", day(7), 30, ptr(172.0)),
		rec("d", "walking", day(9), 30, nil), // no maximum: not a session for the count
		rec("e", "running", day(11), 30, ptr(168.0)),
	}
	maxima := SessionMaxima(recs)
	if len(maxima) != 5 {
		t.Fatalf("maxima %v, want 5 sessions", maxima)
	}
	m, ok := MeasuredMaximum(maxima)
	if !ok || m.BPM != 172 || m.Workouts != 5 {
		t.Errorf("got %+v %v, want 172 from 5 — the race counted once", m, ok)
	}
}

// The fold's own rules: overlap ÷ union, the activity type, and the chain.
func TestGroupSessions(t *testing.T) {
	// 0–30 and 2–32 minutes share 28 of 32: 0.875, the same session.
	a := rec("a", "running", t0, 30, nil)
	b := rec("b", "running", t0.Add(2*time.Minute), 30, nil)
	if !IsSameSession(a, b) {
		t.Error("0–30 / 2–32 not merged")
	}
	// A different type is never the same session.
	c := rec("c", "cycling", t0, 30, nil)
	if IsSameSession(a, c) {
		t.Error("different types merged")
	}
	// A twenty-minute run inside a three-hour hike: covered entirely, but 0.11 of
	// the union — two workouts.
	hike := rec("hike", "hiking", t0, 180, nil)
	run := rec("run", "hiking", t0.Add(60*time.Minute), 20, nil)
	if IsSameSession(hike, run) {
		t.Error("run inside a hike merged")
	}
	// No end: the starts decide, within five minutes.
	noEnd := Recording{ID: "x", ActivityType: "running", Start: t0.Add(4 * time.Minute)}
	if !IsSameSession(a, noEnd) {
		t.Error("open recording 4 min apart not merged")
	}
	noEnd.Start = t0.Add(6 * time.Minute)
	if IsSameSession(a, noEnd) {
		t.Error("open recording 6 min apart merged")
	}

	// The more complete recording leads, whatever the order.
	poor := rec("p", "running", t0, 30, nil)
	rich := rec("r", "running", t0.Add(time.Minute), 30, ptr(180.0))
	rich.EnergyKcal = ptr(300.0)
	got := GroupSessions([]Recording{poor, rich})
	if len(got) != 1 || got[0].Primary.ID != "r" || len(got[0].Others) != 1 {
		t.Errorf("primary %+v", got)
	}

	// Three sessions chained by overlap stay three where A and C do not overlap.
	g := GroupSessions([]Recording{
		rec("A", "walking", t0, 60, nil),
		rec("B", "walking", t0.Add(12*time.Minute), 60, nil),
		rec("C", "walking", t0.Add(40*time.Minute), 60, nil),
	})
	if len(g) < 2 {
		t.Errorf("a chain collapsed into %d session(s)", len(g))
	}
}

func TestZoneConstantsMatchThePhone(t *testing.T) {
	if Zone3Fraction != 0.70 || LookbackDays != 365 || MinimumWorkouts != 5 ||
		MaxGap != 60*time.Second || PlausibleMin != 100 || PlausibleMax != 230 ||
		MinimumOverlap != 0.7 || StartTolerance != 5*time.Minute {
		t.Error("a constant drifted from WorkoutIntensity.swift / WorkoutDuplicates.swift")
	}
	if math.Abs(Maximum{BPM: 200}.Zone3Threshold()-140) > 1e-9 {
		t.Error("threshold arithmetic")
	}
}
