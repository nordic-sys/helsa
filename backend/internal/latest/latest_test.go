package latest

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"
)

var budapest = mustLoc("Europe/Budapest")

func mustLoc(name string) *time.Location {
	loc, err := time.LoadLocation(name)
	if err != nil {
		panic(err)
	}
	return loc
}

func TestNormalizeTrimsDropsEmptiesAndDuplicates(t *testing.T) {
	got := Normalize([]string{" heartRate", "", "stepCount", "heartRate ", "  ", "bodyMass"})
	want := []string{"heartRate", "stepCount", "bodyMass"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Normalize = %v, want %v", got, want)
	}
	if got := Normalize(nil); len(got) != 0 {
		t.Errorf("Normalize(nil) = %v, want empty", got)
	}
}

// An averaged type gets the sample's value, scaled to the wire convention once;
// a summed type gets the merged day total and NO value — the last five-minute
// fragment of steps is not a figure anybody means.
func TestBuildPicksTheFigureByAggregation(t *testing.T) {
	ts := time.Date(2026, 10, 27, 7, 15, 0, 0, time.UTC)
	rows := []Row{
		{DataType: "bodyMass", Ts: ts, Value: 82.4},
		{DataType: "bodyFatPercentage", Ts: ts, Value: 0.192},
		{DataType: "stepCount", Ts: ts, Value: 37},
	}
	resp := Build(rows, map[string]float64{"stepCount": 6412}, budapest)

	mass := resp.Metrics["bodyMass"]
	if mass.Agg != "avg" || mass.Value == nil || *mass.Value != float32(82.4) || mass.DayTotal != nil {
		t.Errorf("bodyMass = %+v, want avg with value 82.4 and no day_total", mass)
	}
	fat := resp.Metrics["bodyFatPercentage"]
	if fat.Value == nil || abs32(*fat.Value-19.2) > 1e-4 {
		t.Errorf("a percentage must arrive as 0…100 (19.2), got %v", fat.Value)
	}
	steps := resp.Metrics["stepCount"]
	if steps.Agg != "sum" || steps.Value != nil {
		t.Errorf("stepCount must carry no value, got %+v", steps)
	}
	if steps.DayTotal == nil || *steps.DayTotal != 6412 {
		t.Errorf("stepCount day_total = %v, want the merged 6412", steps.DayTotal)
	}
	if resp.Tz != "Europe/Budapest" {
		t.Errorf("tz = %q", resp.Tz)
	}
}

// A type that never arrived is ABSENT, not a zero and not an empty object.
func TestBuildLeavesOutWhatNeverArrived(t *testing.T) {
	resp := Build([]Row{{DataType: "heartRate", Ts: time.Now(), Value: 61}}, nil, budapest)
	if _, ok := resp.Metrics["bloodGlucose"]; ok {
		t.Error("a type with no row must not be in the answer")
	}
	buf, _ := json.Marshal(Build(nil, nil, budapest))
	if !strings.Contains(string(buf), `"metrics":{}`) {
		t.Errorf("an empty answer is an empty map, got %s", buf)
	}
}

// A summed type whose total could not be read gets no day_total — never a 0.
func TestBuildDoesNotInventAZeroTotal(t *testing.T) {
	resp := Build([]Row{{DataType: "stepCount", Ts: time.Now(), Value: 12}}, map[string]float64{}, budapest)
	if resp.Metrics["stepCount"].DayTotal != nil {
		t.Error("a missing total must stay missing")
	}
}

// The day is the LOCAL day: 23:30 UTC on the 26th is 00:30 on the 27th in Budapest.
func TestTheDayIsCutInTheRequestedZone(t *testing.T) {
	ts := time.Date(2026, 10, 26, 23, 30, 0, 0, time.UTC)
	rows := []Row{{DataType: "stepCount", Ts: ts, Value: 40}, {DataType: "heartRate", Ts: ts, Value: 58}}

	resp := Build(rows, map[string]float64{"stepCount": 40}, budapest)
	if got := resp.Metrics["heartRate"].Day.Format("2006-01-02"); got != "2026-10-27" {
		t.Errorf("day in Budapest = %s, want 2026-10-27", got)
	}
	if got := Build(rows, nil, time.UTC).Metrics["heartRate"].Day.Format("2006-01-02"); got != "2026-10-26" {
		t.Errorf("day in UTC = %s, want 2026-10-26", got)
	}

	days := SumDays(rows, budapest)
	if len(days) != 1 || !reflect.DeepEqual(days[0].Types, []string{"stepCount"}) {
		t.Fatalf("SumDays = %+v, want one day holding only the summed type", days)
	}
	want := time.Date(2026, 10, 27, 0, 0, 0, 0, budapest)
	if !days[0].Start.Equal(want) {
		t.Errorf("the day starts %v, want local midnight %v", days[0].Start, want)
	}
}

// Summed types last written on different days are totalled per day, one query
// each, in day order.
func TestSumDaysGroupsByDay(t *testing.T) {
	today := time.Date(2026, 10, 27, 9, 0, 0, 0, budapest)
	rows := []Row{
		{DataType: "stepCount", Ts: today},
		{DataType: "activeEnergy", Ts: today.Add(time.Hour)},
		{DataType: "distanceCycling", Ts: today.AddDate(0, 0, -12)},
		{DataType: "bodyMass", Ts: today.AddDate(0, 0, -3)},
	}
	days := SumDays(rows, budapest)
	if len(days) != 2 {
		t.Fatalf("got %d days, want 2: %+v", len(days), days)
	}
	if !reflect.DeepEqual(days[0].Types, []string{"distanceCycling"}) {
		t.Errorf("first day = %v", days[0].Types)
	}
	if !reflect.DeepEqual(days[1].Types, []string{"activeEnergy", "stepCount"}) {
		t.Errorf("second day = %v, want sorted names", days[1].Types)
	}
}

// The day after the autumn DST switch is 25 hours long; local midnight must
// still be found by the calendar, not by subtracting seconds.
func TestLocalMidnightAcrossDST(t *testing.T) {
	ts := time.Date(2026, 10, 25, 23, 0, 0, 0, budapest) // the switch was at 03:00 that night
	if got := localMidnight(ts, budapest); !got.Equal(time.Date(2026, 10, 25, 0, 0, 0, 0, budapest)) {
		t.Errorf("localMidnight = %v", got)
	}
}

// An unknown type (a newer iOS) is still answered — as an average, with the unit
// the phone stored, rather than dropped.
func TestAnUnknownTypeKeepsItsStoredUnit(t *testing.T) {
	resp := Build([]Row{{DataType: "someFutureType", Ts: time.Now(), Value: 3, StoredUnit: "lux"}}, nil, budapest)
	lv := resp.Metrics["someFutureType"]
	if lv.Agg != "avg" || lv.Unit == nil || *lv.Unit != "lux" || lv.Value == nil {
		t.Errorf("unknown type = %+v", lv)
	}
}

func abs32(v float32) float32 {
	if v < 0 {
		return -v
	}
	return v
}
