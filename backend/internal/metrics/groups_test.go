package metrics

import "testing"

// The grouping and the catalog live in two files, so the only thing keeping them
// together is this test. Both directions matter: a type without a group would
// silently vanish from the completeness report, and a group entry without a
// catalog row would put a metric on the screen the aggregation cannot serve.
func TestGroupsCoverTheCatalogExactly(t *testing.T) {
	seen := map[string]int{}
	for _, name := range Ordered() {
		seen[name]++
		if !Known(name) {
			t.Errorf("%s is grouped but missing from the catalog", name)
		}
	}
	for name, n := range seen {
		if n > 1 {
			t.Errorf("%s appears in %d groups — a metric belongs to exactly one", name, n)
		}
	}
	All(func(name string, _ Info) {
		if seen[name] == 0 {
			t.Errorf("%s is in the catalog but in no group — it would drop out of the coverage report", name)
		}
	})
	if got, want := len(Ordered()), Len(); got != want {
		t.Errorf("grouped types = %d, catalog = %d", got, want)
	}
}

// The order is the point of Ordered(): a map's iteration order is random, and a
// report that lists 120 types in a different order on every call is unreadable.
func TestOrderedIsStableAndStartsWithActivity(t *testing.T) {
	first, second := Ordered(), Ordered()
	for i := range first {
		if first[i] != second[i] {
			t.Fatalf("the order changes between calls at position %d: %q vs %q", i, first[i], second[i])
		}
	}
	if first[0] != "stepCount" {
		t.Errorf("the first type is %q, expected stepCount — the activity group comes first", first[0])
	}
}

// A caller must not be able to reorder the catalog for everybody else.
func TestOrderedHandsBackACopy(t *testing.T) {
	mine := Ordered()
	mine[0] = "tampered"
	if Ordered()[0] == "tampered" {
		t.Error("Ordered() handed out the underlying slice")
	}
}

// An unknown type is not an error: `data_type` is an open string, and a metric from
// a newer iOS release must not fall out of a completeness report of all places.
func TestUnknownTypesLandInOther(t *testing.T) {
	if got := GroupOf("someFutureAppleMetric"); got != GroupOther {
		t.Errorf("unknown type group = %q, expected %q", got, GroupOther)
	}
	if got := GroupOf("dietaryVitaminB12"); got != GroupNutritionVitamin {
		t.Errorf("dietaryVitaminB12 group = %q, expected %q", got, GroupNutritionVitamin)
	}
}

// The group names are the app's `HealthMetricGroup` raw values. If one of them is
// renamed here, the two lists stop lining up — and nothing else would notice.
func TestGroupNamesMatchTheAppsRawValues(t *testing.T) {
	want := []Group{
		"activity", "heart", "respiratory", "body",
		"nutritionMacro", "nutritionMineral", "nutritionVitamin",
		"mobility", "environment", "other",
	}
	got := Groups()
	if len(got) != len(want) {
		t.Fatalf("group count = %d, expected %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("group %d = %q, expected %q", i, got[i], want[i])
		}
	}
}
