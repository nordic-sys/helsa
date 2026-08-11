package metrics

import "testing"

// The metric table comes from the catalog in the Apple app, which is verified
// against the real iOS SDK. These tests guard the Go-side copy from drifting.

func TestCatalogCoversTheHealthKitTypes(t *testing.T) {
	// The catalog covers 120 quantity types (docs/23 §3). If this number drops, we
	// deleted something; if it grows, docs/23 needs updating too.
	if got, want := Len(), 120; got != want {
		t.Errorf("catalog size = %d, expected %d — docs/23 and the Go table have drifted apart", got, want)
	}
}

func TestEveryMetricHasAnExplicitAggregation(t *testing.T) {
	All(func(name string, m Info) {
		if m.Agg != Sum && m.Agg != Avg {
			t.Errorf("%s: agg is %q, but it may only be sum or avg", name, m.Agg)
		}
		if m.Unit == "" {
			t.Errorf("%s: empty unit", name)
		}
	})
}

// This is the most important test: mixing up cumulative and discrete quantities
// yields a SILENT, false number — an averaged step count or a summed body weight
// looks plausible while being meaningless.
func TestCumulativeQuantitiesAreSummedAndDiscreteOnesAveraged(t *testing.T) {
	sums := []string{
		"stepCount", "distanceWalkingRunning", "activeEnergy", "basalEnergyBurned",
		"flightsClimbed", "appleExerciseTime",
		// Every nutrient consumed is cumulative — this is the basis of the nutrition view.
		"dietaryEnergyConsumed", "dietaryProtein", "dietaryCarbohydrates", "dietaryFatTotal",
		"dietaryWater", "dietaryCalcium", "dietaryIron", "dietaryVitaminC",
	}
	for _, name := range sums {
		if !Known(name) {
			t.Errorf("%s is missing from the table", name)
			continue
		}
		if got := Meta(name).Agg; got != Sum {
			t.Errorf("%s: %q, but it is cumulative → must be summed", name, got)
		}
	}

	avgs := []string{
		"heartRate", "restingHeartRate", "hrv", "bodyMass", "bodyFatPercentage",
		"oxygenSaturation", "respiratoryRate", "vo2Max", "walkingSpeed",
		"bloodPressureSystolic", "appleSleepingWristTemperature",
	}
	for _, name := range avgs {
		if !Known(name) {
			t.Errorf("%s is missing from the table", name)
			continue
		}
		if got := Meta(name).Agg; got != Avg {
			t.Errorf("%s: %q, but it is a discrete measurement → must be averaged", name, got)
		}
	}
}

// `data_type` is deliberately open (docs/23 §1): a type from a future iOS version
// must be stored and handed back sensibly too, not with an empty agg.
func TestUnknownTypesFallBackToAveraging(t *testing.T) {
	m := Meta("someFutureAppleMetric")
	if m.Agg != Avg {
		t.Errorf("unknown type agg = %q, expected %q", m.Agg, Avg)
	}
}

// Preserving the wire names: these two deliberately differ from the HealthKit
// identifier (which would be activeEnergyBurned / heartRateVariabilitySDNN),
// because the already uploaded rows and the client use these. Renaming them would
// be a silent break in the data.
func TestLegacyWireNamesAreKept(t *testing.T) {
	for _, name := range []string{"activeEnergy", "hrv"} {
		if !Known(name) {
			t.Errorf("%s is missing — renaming it would cut off the already stored data", name)
		}
	}
}

// --- wire scaling (docs/23 §3.0.1) ---

// HealthKit's percent yields a fraction: 19.2% body fat arrives as 0.19238.
// Storage stays raw and the wire carries 0…100 — otherwise the UI would show
// "0.19 %".
func TestPercentMetricsAreScaledToHundred(t *testing.T) {
	cases := []struct {
		dataType string
		raw      float64
		want     float64
	}{
		{"bodyFatPercentage", 0.19238333, 19.238333},
		{"oxygenSaturation", 0.97, 97},
		{"walkingAsymmetryPercentage", 0.05, 5},
		{"appleWalkingSteadiness", 0.82, 82},
		{"atrialFibrillationBurden", 0.02, 2},
		{"peripheralPerfusionIndex", 0.011, 1.1},
		{"bloodAlcoholContent", 0.0008, 0.08},
	}
	for _, c := range cases {
		if !IsPercent(c.dataType) {
			t.Errorf("%s: does not look like a percentage (unit=%q)", c.dataType, Meta(c.dataType).Unit)
			continue
		}
		if got := ToWire(c.dataType, c.raw); !almostEqual(got, c.want) {
			t.Errorf("%s: ToWire(%v) = %v, expected %v", c.dataType, c.raw, got, c.want)
		}
	}
}

// Non-percentage metrics pass through untouched: a step count or a body weight
// scaled up hundredfold would be just as silent a bug as 0.19% body fat.
func TestNonPercentMetricsPassThroughUnchanged(t *testing.T) {
	for _, name := range []string{"stepCount", "bodyMass", "heartRate", "dietaryWater", "vo2Max", "someFutureAppleMetric"} {
		if IsPercent(name) {
			t.Errorf("%s: is wrongly classified as a percentage", name)
		}
		if got := ToWire(name, 72.5); got != 72.5 {
			t.Errorf("%s: ToWire(72.5) = %v, expected 72.5", name, got)
		}
	}
}

// Every catalog entry with a `%` unit must go through the scaling — this is what
// catches somebody adding a new percentage type without thinking of the conversion.
func TestEveryPercentUnitEntryIsScaled(t *testing.T) {
	seen := 0
	All(func(name string, m Info) {
		if m.Unit != PercentUnit {
			return
		}
		seen++
		if got := ToWire(name, 0.5); !almostEqual(got, 50) {
			t.Errorf("%s: has a %% unit, yet ToWire(0.5) = %v", name, got)
		}
	})
	if seen == 0 {
		t.Fatal("there is not a single percent-unit metric — the test is running blind")
	}
}

func TestToWirePtrKeepsNil(t *testing.T) {
	if ToWirePtr("bodyFatPercentage", nil) != nil {
		t.Error("a nil (SQL NULL) must not become 0")
	}
	v := 0.21
	got := ToWirePtr("bodyFatPercentage", &v)
	if got == nil || !almostEqual(*got, 21) {
		t.Errorf("ToWirePtr(0.21) = %v, expected 21", got)
	}
	// We do not overwrite the input — the caller may be using the same pointer
	// elsewhere.
	if v != 0.21 {
		t.Errorf("ToWirePtr modified its input: %v", v)
	}
}

func almostEqual(a, b float64) bool {
	d := a - b
	if d < 0 {
		d = -d
	}
	return d < 1e-9
}
