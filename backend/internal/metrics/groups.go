// The catalog's GROUPING and its ORDER.
//
// Why a second file next to the `catalog` map rather than a field on `Info`? Two
// reasons, and the second is the real one:
//
//  1. `catalog` is a map, so it has no order at all. A completeness report that
//     lists 120 types has to list them in a sensible order, and "sensible" here
//     means the same order the app and the web show them in — otherwise the same
//     data reads as a different list on every surface.
//  2. The grouping is a fact about presentation, not about arithmetic. Nothing on
//     the aggregation path (sum vs avg, unit, wire scaling) wants to know which
//     group a metric is in.
//
// ⚠️ **The group names are the APP's raw values** (`HealthMetricGroup` in
// `HealthMetricCatalog.swift`) — `nutritionMacro`, not `macro`. The app's enum is
// `Codable`, so those strings are already a wire vocabulary; inventing a second
// one here would mean a translation table between two lists that describe the
// same thing. The web dictionary happens to use shorter keys, and it does the
// mapping at its own edge.
//
// The ordering inside a group follows the section comments of `metrics.go`, which
// in turn follow `docs/23` §3. `TestGroupsCoverTheCatalogExactly` is what keeps
// the two files from drifting: a type added to `catalog` without a group here
// fails the build's tests rather than quietly falling out of the report.

package metrics

// Group is a catalog group, in the app's `HealthMetricGroup` vocabulary.
type Group string

const (
	GroupActivity         Group = "activity"
	GroupHeart            Group = "heart"
	GroupRespiratory      Group = "respiratory"
	GroupBody             Group = "body"
	GroupNutritionMacro   Group = "nutritionMacro"
	GroupNutritionMineral Group = "nutritionMineral"
	GroupNutritionVitamin Group = "nutritionVitamin"
	GroupMobility         Group = "mobility"
	GroupEnvironment      Group = "environment"
	GroupOther            Group = "other"
)

// groupedCatalog is the catalog in display order, group by group.
var groupedCatalog = []struct {
	Group Group
	Types []string
}{
	{GroupActivity, []string{
		"stepCount", "distanceWalkingRunning", "distanceCycling", "distanceSwimming",
		"distanceWheelchair", "distanceDownhillSnowSports", "distanceCrossCountrySkiing",
		"distancePaddleSports", "distanceRowing", "distanceSkatingSports",
		"pushCount", "swimmingStrokeCount", "flightsClimbed",
		"activeEnergy", "basalEnergyBurned",
		"appleExerciseTime", "appleMoveTime", "appleStandTime",
		"nikeFuel", "physicalEffort",
		"cyclingCadence", "cyclingPower", "cyclingFunctionalThresholdPower", "cyclingSpeed",
		"crossCountrySkiingSpeed", "paddleSportsSpeed", "rowingSpeed",
		"workoutEffortScore", "estimatedWorkoutEffortScore",
	}},
	{GroupHeart, []string{
		"heartRate", "restingHeartRate", "walkingHeartRateAverage", "hrv",
		"heartRateRecoveryOneMinute", "atrialFibrillationBurden",
		"bloodPressureSystolic", "bloodPressureDiastolic",
		"peripheralPerfusionIndex", "vo2Max",
	}},
	{GroupRespiratory, []string{
		"respiratoryRate", "oxygenSaturation", "forcedVitalCapacity",
		"forcedExpiratoryVolume1", "peakExpiratoryFlowRate", "inhalerUsage",
		"appleSleepingBreathingDisturbances",
	}},
	{GroupBody, []string{
		"bodyMass", "bodyMassIndex", "bodyFatPercentage", "leanBodyMass",
		"height", "waistCircumference",
		"appleSleepingWristTemperature", "bodyTemperature", "basalBodyTemperature",
	}},
	{GroupNutritionMacro, []string{
		"dietaryEnergyConsumed", "dietaryProtein", "dietaryCarbohydrates",
		"dietaryFiber", "dietarySugar", "dietaryFatTotal", "dietaryFatSaturated",
		"dietaryFatMonounsaturated", "dietaryFatPolyunsaturated", "dietaryCholesterol",
		"dietaryWater", "dietaryCaffeine",
	}},
	{GroupNutritionMineral, []string{
		"dietaryCalcium", "dietaryIron", "dietaryMagnesium", "dietaryPhosphorus",
		"dietaryPotassium", "dietarySodium", "dietaryZinc", "dietaryChloride",
		"dietaryCopper", "dietaryManganese", "dietaryChromium", "dietaryIodine",
		"dietaryMolybdenum", "dietarySelenium",
	}},
	{GroupNutritionVitamin, []string{
		"dietaryVitaminC", "dietaryVitaminE", "dietaryVitaminB6", "dietaryThiamin",
		"dietaryRiboflavin", "dietaryNiacin", "dietaryPantothenicAcid",
		"dietaryVitaminA", "dietaryVitaminD", "dietaryVitaminK", "dietaryVitaminB12",
		"dietaryFolate", "dietaryBiotin",
	}},
	{GroupMobility, []string{
		"walkingSpeed", "walkingStepLength", "walkingAsymmetryPercentage",
		"walkingDoubleSupportPercentage", "sixMinuteWalkTestDistance",
		"stairAscentSpeed", "stairDescentSpeed", "appleWalkingSteadiness",
		"runningSpeed", "runningPower", "runningStrideLength",
		"runningVerticalOscillation", "runningGroundContactTime",
	}},
	{GroupEnvironment, []string{
		"environmentalAudioExposure", "headphoneAudioExposure",
		"environmentalSoundReduction", "timeInDaylight", "uvExposure",
	}},
	{GroupOther, []string{
		"bloodGlucose", "bloodAlcoholContent", "insulinDelivery",
		"numberOfTimesFallen", "numberOfAlcoholicBeverages",
		"electrodermalActivity", "waterTemperature", "underwaterDepth",
	}},
}

var (
	orderedTypes = func() []string {
		out := make([]string, 0, len(catalog))
		for _, g := range groupedCatalog {
			out = append(out, g.Types...)
		}
		return out
	}()

	groupOf = func() map[string]Group {
		out := make(map[string]Group, len(catalog))
		for _, g := range groupedCatalog {
			for _, name := range g.Types {
				out[name] = g.Group
			}
		}
		return out
	}()
)

// Groups lists the groups in display order.
func Groups() []Group {
	out := make([]Group, 0, len(groupedCatalog))
	for _, g := range groupedCatalog {
		out = append(out, g.Group)
	}
	return out
}

// Ordered returns every catalog type in display order — a copy, so a caller
// cannot reorder the catalog for everyone else.
func Ordered() []string {
	out := make([]string, len(orderedTypes))
	copy(out, orderedTypes)
	return out
}

// GroupOf answers with the type's group. An unknown type — `data_type` is an open
// string, and a newer iOS release may send one — lands in `other`, the same place
// the web catalog puts it. It is deliberately not an error: dropping a type from a
// COMPLETENESS report because we have not heard of it yet would be the one bug
// this whole feature exists to prevent.
func GroupOf(dataType string) Group {
	if g, ok := groupOf[dataType]; ok {
		return g
	}
	return GroupOther
}
