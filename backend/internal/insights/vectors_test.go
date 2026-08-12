package insights

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	// The vectors name their timezone, and the engine reads day boundaries in it.
	// A machine without a system zone database (a scratch container, for one)
	// would otherwise fail to load "Europe/Budapest" and take the whole suite with
	// it — for a reason that has nothing to do with the rules.
	_ "time/tzdata"
)

// The shared test vectors (docs/api/insight-vectors.md).
//
// The rules exist twice — here and in Swift, so the phone can produce insights
// with no server at all. That duplication cannot be designed away; the SILENT
// divergence can. Both sides run these files, so a threshold changed on one side
// fails the other side's tests instead of quietly letting a phone and a dashboard
// contradict each other about the same body.
//
// What the vectors pin is the DECISION: which rule fires, from which numbers.
// They do not pin the sentence — that is formatted differently in the two
// languages and is tested separately on each side (rules_test.go here).

const vectorDir = "testdata/vectors"

// valueTolerance: the vectors carry the numbers rounded to one decimal, so a
// value may legitimately sit half a unit of the last digit away from what the
// engine computed.
const valueTolerance = 0.05 + 1e-9

type vectorPoint struct {
	Day   string  `json:"day"`
	Value float64 `json:"value"`
}

type vectorNight struct {
	Day   string `json:"day"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type vectorWorkout struct {
	Day          string   `json:"day"`
	ActivityType string   `json:"activityType"`
	DurationMin  float64  `json:"durationMin"`
	DistanceM    *float64 `json:"distanceM,omitempty"`
	AvgHeartRate *float64 `json:"avgHeartRate,omitempty"`
	EnergyKcal   *float64 `json:"energyKcal,omitempty"`
}

type vectorExpect struct {
	ID       string             `json:"id"`
	Kind     string             `json:"kind"`
	Metric   string             `json:"metric"`
	Severity string             `json:"severity"`
	Values   map[string]float64 `json:"values"`
}

type vector struct {
	Name        string                   `json:"name"`
	Today       string                   `json:"today"`
	Timezone    string                   `json:"timezone"`
	Daily       map[string][]vectorPoint `json:"daily,omitempty"`
	SleepHours  []vectorPoint            `json:"sleepHours,omitempty"`
	SleepNights []vectorNight            `json:"sleepNights,omitempty"`
	Workouts    []vectorWorkout          `json:"workouts,omitempty"`
	Expect      []vectorExpect           `json:"expect"`
	// SilentFor names the rules this vector proves stay QUIET on this data. An
	// empty `expect` says nothing about which rule was actually exercised; this
	// says it out loud, and TestEveryRuleHasBothKindsOfVector holds every rule to
	// having at least one of each.
	SilentFor []string `json:"silentFor,omitempty"`
}

const (
	vectorDayLayout  = "2006-01-02"
	vectorTimeLayout = "2006-01-02T15:04"
)

// loadVectors reads every vector file. Decoding is STRICT: an unknown field is
// an error, because the failure it prevents is the worst kind — a mistyped key
// silently dropping the very data the case was written to exercise, leaving a
// test that passes while testing nothing.
func loadVectors(t *testing.T) []vector {
	t.Helper()
	paths, err := filepath.Glob(filepath.Join(vectorDir, "*.json"))
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	if len(paths) == 0 {
		t.Fatalf("no vector files in %s", vectorDir)
	}
	out := make([]vector, 0, len(paths))
	for _, p := range paths {
		f, err := os.Open(p) //nolint:gosec // test data, fixed directory
		if err != nil {
			t.Fatalf("open %s: %v", p, err)
		}
		dec := json.NewDecoder(f)
		dec.DisallowUnknownFields()
		var v vector
		if err := dec.Decode(&v); err != nil {
			_ = f.Close()
			t.Fatalf("%s: %v", p, err)
		}
		_ = f.Close()
		if v.Name == "" {
			t.Errorf("%s: the vector has no name", p)
		}
		out = append(out, v)
	}
	return out
}

func (v vector) input(t *testing.T) (Input, time.Time) {
	t.Helper()
	loc, err := time.LoadLocation(v.Timezone)
	if err != nil {
		t.Fatalf("%s: unknown timezone %q: %v", v.Name, v.Timezone, err)
	}
	day := func(s string) time.Time {
		d, err := time.ParseInLocation(vectorDayLayout, s, loc)
		if err != nil {
			t.Fatalf("%s: bad day %q: %v", v.Name, s, err)
		}
		return d
	}
	stamp := func(s string) time.Time {
		ts, err := time.ParseInLocation(vectorTimeLayout, s, loc)
		if err != nil {
			t.Fatalf("%s: bad timestamp %q: %v", v.Name, s, err)
		}
		return ts
	}

	in := Input{Today: day(v.Today), Daily: map[string]Series{}}
	for metric, points := range v.Daily {
		s := Series{}
		for _, p := range points {
			s = append(s, Point{Day: day(p.Day), Value: p.Value})
		}
		in.Daily[metric] = s
	}
	for _, p := range v.SleepHours {
		in.SleepHours = append(in.SleepHours, Point{Day: day(p.Day), Value: p.Value})
	}
	for _, n := range v.SleepNights {
		in.SleepNights = append(in.SleepNights, SleepNight{
			Day: day(n.Day), Start: stamp(n.Start), End: stamp(n.End),
		})
	}
	for _, w := range v.Workouts {
		in.Workouts = append(in.Workouts, Workout{
			Day:          day(w.Day),
			ActivityType: w.ActivityType,
			Duration:     time.Duration(w.DurationMin * float64(time.Minute)),
			DistanceM:    w.DistanceM,
			AvgHeartRate: w.AvgHeartRate,
			EnergyKcal:   w.EnergyKcal,
		})
	}
	// The evaluation moment only reaches `generated_at`, which the vectors
	// deliberately do not pin: mid-morning local time, so it is never a day
	// boundary.
	return in, in.Today.Add(9*time.Hour + 30*time.Minute)
}

func TestVectors(t *testing.T) {
	for _, v := range loadVectors(t) {
		t.Run(v.Name, func(t *testing.T) {
			in, now := v.input(t)
			got := EvaluateDetailed(in, now)

			if len(got) != len(v.Expect) {
				t.Fatalf("%d insights, expected %d\ngot:  %s\nwant: %s",
					len(got), len(v.Expect), idsOfResults(got), idsOfExpect(v.Expect))
			}
			for i, want := range v.Expect {
				checkResult(t, got[i], want)
			}
			// Silence is a claim too, and it has to hold.
			for _, prefix := range v.SilentFor {
				for _, r := range got {
					if strings.HasPrefix(*r.Insight.Id, prefix) {
						t.Errorf("%s was supposed to stay silent, but said: %s",
							prefix, *r.Insight.Title)
					}
				}
			}
		})
	}
}

func checkResult(t *testing.T, got Result, want vectorExpect) {
	t.Helper()
	ins := got.Insight
	if *ins.Id != want.ID {
		t.Errorf("id = %s, expected %s", *ins.Id, want.ID)
		return
	}
	if string(*ins.Kind) != want.Kind {
		t.Errorf("%s: kind = %s, expected %s", want.ID, *ins.Kind, want.Kind)
	}
	if *ins.Metric != want.Metric {
		t.Errorf("%s: metric = %s, expected %s", want.ID, *ins.Metric, want.Metric)
	}
	if string(*ins.Severity) != want.Severity {
		t.Errorf("%s: severity = %s, expected %s", want.ID, *ins.Severity, want.Severity)
	}
	// The key sets have to match exactly. A rule that quietly stopped publishing
	// one of its numbers, or started publishing a new one, is a change the other
	// implementation has to hear about.
	for key, wantVal := range want.Values {
		gotVal, ok := got.Values[key]
		if !ok {
			t.Errorf("%s: the rule did not compute %q", want.ID, key)
			continue
		}
		if math.Abs(gotVal-wantVal) > valueTolerance {
			t.Errorf("%s: %s = %.4f, expected %.1f", want.ID, key, gotVal, wantVal)
		}
	}
	for key := range got.Values {
		if _, ok := want.Values[key]; !ok {
			t.Errorf("%s: the rule computed %q = %.4f, which no vector pins",
				want.ID, key, got.Values[key])
		}
	}
}

// TestEveryRuleHasBothKindsOfVector is the reason `silentFor` exists.
//
// "A rule that has no vector for 'should stay silent' is not finished" — the
// failure mode that matters in this package is not a wrong number, it is a
// confident statement made from too little evidence, and only a negative vector
// can catch that.
func TestEveryRuleHasBothKindsOfVector(t *testing.T) {
	vectors := loadVectors(t)
	fires := map[string]string{}
	silent := map[string]string{}

	known := func(id string) (string, bool) {
		for _, prefix := range ruleIDPrefixes {
			if strings.HasPrefix(id, prefix) {
				return prefix, true
			}
		}
		return "", false
	}

	for _, v := range vectors {
		for _, e := range v.Expect {
			prefix, ok := known(e.ID)
			if !ok {
				t.Errorf("%s: %q belongs to no known rule", v.Name, e.ID)
				continue
			}
			if !strings.HasSuffix(e.ID, ":"+v.Today) {
				t.Errorf("%s: %q does not end in the vector's day (%s)", v.Name, e.ID, v.Today)
			}
			fires[prefix] = v.Name
		}
		for _, prefix := range v.SilentFor {
			if _, ok := known(prefix + ":"); !ok {
				t.Errorf("%s: silentFor names an unknown rule: %q", v.Name, prefix)
				continue
			}
			silent[prefix] = v.Name
		}
	}

	for _, prefix := range ruleIDPrefixes {
		if _, ok := fires[prefix]; !ok {
			t.Errorf("%s has no vector in which it speaks", prefix)
		}
		if _, ok := silent[prefix]; !ok {
			t.Errorf("%s has no vector in which it stays silent — the rule is not finished", prefix)
		}
	}
}

func idsOfResults(rs []Result) string {
	out := make([]string, 0, len(rs))
	for _, r := range rs {
		out = append(out, *r.Insight.Id)
	}
	return fmt.Sprintf("%v", out)
}

func idsOfExpect(es []vectorExpect) string {
	out := make([]string, 0, len(es))
	for _, e := range es {
		out = append(out, e.ID)
	}
	return fmt.Sprintf("%v", out)
}
