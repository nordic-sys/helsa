// Package metrics is the server-side metadata table for HealthKit metrics: which
// type must be summed and which averaged, what unit it arrives in, and whether
// the read responses need wire scaling.
//
// Why a separate package? The same knowledge is needed by the /summary
// aggregation, the raw /samples page, the export and the insight rules. If each
// carried its own copy, that would be exactly the "the truth lives in several
// places" bug that already bit us once over units (dietaryWater L vs mL).
package metrics

// Agg: whether the given metric is to be summed (cumulative) or averaged.
type Agg string

const (
	Sum Agg = "sum"
	Avg Agg = "avg"
)

// PercentUnit is the canonical spelling of the percent unit in the table.
const PercentUnit = "%"

// percentScale: HealthKit's `HKUnit.percent()` yields a FRACTION (0…1) — 21% body
// fat arrives as 0.21 (docs/23 §3.0.1). Storage deliberately stays raw, while the
// wire carries 0…100 — see ToWire.
const percentScale = 100

type Info struct {
	Agg  Agg
	Unit string
}

var catalog = map[string]Info{
	// --- Activity and movement ---
	"stepCount":                       {Sum, "count"},
	"distanceWalkingRunning":          {Sum, "m"},
	"distanceCycling":                 {Sum, "m"},
	"distanceSwimming":                {Sum, "m"},
	"distanceWheelchair":              {Sum, "m"},
	"distanceDownhillSnowSports":      {Sum, "m"},
	"distanceCrossCountrySkiing":      {Sum, "m"},
	"distancePaddleSports":            {Sum, "m"},
	"distanceRowing":                  {Sum, "m"},
	"distanceSkatingSports":           {Sum, "m"},
	"pushCount":                       {Sum, "count"},
	"swimmingStrokeCount":             {Sum, "count"},
	"flightsClimbed":                  {Sum, "count"},
	"activeEnergy":                    {Sum, "kcal"},
	"basalEnergyBurned":               {Sum, "kcal"},
	"appleExerciseTime":               {Sum, "min"},
	"appleMoveTime":                   {Sum, "min"},
	"appleStandTime":                  {Sum, "min"},
	"nikeFuel":                        {Sum, "count"},
	"physicalEffort":                  {Avg, "kcal/(kg*hr)"},
	"cyclingCadence":                  {Avg, "count/min"},
	"cyclingPower":                    {Avg, "W"},
	"cyclingFunctionalThresholdPower": {Avg, "W"},
	"cyclingSpeed":                    {Avg, "m/s"},
	"crossCountrySkiingSpeed":         {Avg, "m/s"},
	"paddleSportsSpeed":               {Avg, "m/s"},
	"rowingSpeed":                     {Avg, "m/s"},
	"workoutEffortScore":              {Sum, "appleEffortScore"},
	"estimatedWorkoutEffortScore":     {Sum, "appleEffortScore"},

	// --- Heart and circulation ---
	"heartRate":                  {Avg, "count/min"},
	"restingHeartRate":           {Avg, "count/min"},
	"walkingHeartRateAverage":    {Avg, "count/min"},
	"hrv":                        {Avg, "ms"},
	"heartRateRecoveryOneMinute": {Avg, "count/min"},
	"atrialFibrillationBurden":   {Avg, "%"},
	"bloodPressureSystolic":      {Avg, "mmHg"},
	"bloodPressureDiastolic":     {Avg, "mmHg"},
	"peripheralPerfusionIndex":   {Avg, "%"},
	"vo2Max":                     {Avg, "mL/(kg*min)"},

	// --- Respiration and blood oxygen ---
	"respiratoryRate":                    {Avg, "count/min"},
	"oxygenSaturation":                   {Avg, "%"},
	"forcedVitalCapacity":                {Avg, "L"},
	"forcedExpiratoryVolume1":            {Avg, "L"},
	"peakExpiratoryFlowRate":             {Avg, "L/min"},
	"inhalerUsage":                       {Sum, "count"},
	"appleSleepingBreathingDisturbances": {Sum, "count"},

	// --- Body composition ---
	"bodyMass":                      {Avg, "kg"},
	"bodyMassIndex":                 {Avg, "count"},
	"bodyFatPercentage":             {Avg, "%"},
	"leanBodyMass":                  {Avg, "kg"},
	"height":                        {Avg, "m"},
	"waistCircumference":            {Avg, "m"},
	"appleSleepingWristTemperature": {Avg, "degC"},
	"bodyTemperature":               {Avg, "degC"},
	"basalBodyTemperature":          {Avg, "degC"},

	// --- Nutrition — macros ---
	"dietaryEnergyConsumed":     {Sum, "kcal"},
	"dietaryProtein":            {Sum, "g"},
	"dietaryCarbohydrates":      {Sum, "g"},
	"dietaryFiber":              {Sum, "g"},
	"dietarySugar":              {Sum, "g"},
	"dietaryFatTotal":           {Sum, "g"},
	"dietaryFatSaturated":       {Sum, "g"},
	"dietaryFatMonounsaturated": {Sum, "g"},
	"dietaryFatPolyunsaturated": {Sum, "g"},
	"dietaryCholesterol":        {Sum, "mg"},
	"dietaryWater":              {Sum, "mL"},
	"dietaryCaffeine":           {Sum, "mg"},

	// --- Nutrition — minerals ---
	"dietaryCalcium":    {Sum, "mg"},
	"dietaryIron":       {Sum, "mg"},
	"dietaryMagnesium":  {Sum, "mg"},
	"dietaryPhosphorus": {Sum, "mg"},
	"dietaryPotassium":  {Sum, "mg"},
	"dietarySodium":     {Sum, "mg"},
	"dietaryZinc":       {Sum, "mg"},
	"dietaryChloride":   {Sum, "mg"},
	"dietaryCopper":     {Sum, "mg"},
	"dietaryManganese":  {Sum, "mg"},
	"dietaryChromium":   {Sum, "mcg"},
	"dietaryIodine":     {Sum, "mcg"},
	"dietaryMolybdenum": {Sum, "mcg"},
	"dietarySelenium":   {Sum, "mcg"},

	// --- Nutrition — vitamins ---
	"dietaryVitaminC":        {Sum, "mg"},
	"dietaryVitaminE":        {Sum, "mg"},
	"dietaryVitaminB6":       {Sum, "mg"},
	"dietaryThiamin":         {Sum, "mg"},
	"dietaryRiboflavin":      {Sum, "mg"},
	"dietaryNiacin":          {Sum, "mg"},
	"dietaryPantothenicAcid": {Sum, "mg"},
	"dietaryVitaminA":        {Sum, "mcg"},
	"dietaryVitaminD":        {Sum, "mcg"},
	"dietaryVitaminK":        {Sum, "mcg"},
	"dietaryVitaminB12":      {Sum, "mcg"},
	"dietaryFolate":          {Sum, "mcg"},
	"dietaryBiotin":          {Sum, "mcg"},

	// --- Mobility and gait ---
	"walkingSpeed":                   {Avg, "m/s"},
	"walkingStepLength":              {Avg, "m"},
	"walkingAsymmetryPercentage":     {Avg, "%"},
	"walkingDoubleSupportPercentage": {Avg, "%"},
	"sixMinuteWalkTestDistance":      {Avg, "m"},
	"stairAscentSpeed":               {Avg, "m/s"},
	"stairDescentSpeed":              {Avg, "m/s"},
	"appleWalkingSteadiness":         {Avg, "%"},
	"runningSpeed":                   {Avg, "m/s"},
	"runningPower":                   {Avg, "W"},
	"runningStrideLength":            {Avg, "m"},
	"runningVerticalOscillation":     {Avg, "cm"},
	"runningGroundContactTime":       {Avg, "ms"},

	// --- Environment and hearing ---
	"environmentalAudioExposure":  {Avg, "dBASPL"},
	"headphoneAudioExposure":      {Avg, "dBASPL"},
	"environmentalSoundReduction": {Avg, "dBASPL"},
	"timeInDaylight":              {Sum, "min"},
	"uvExposure":                  {Avg, "count"},

	// --- Other ---
	"bloodGlucose":               {Avg, "mg/dL"},
	"bloodAlcoholContent":        {Avg, "%"},
	"insulinDelivery":            {Sum, "IU"},
	"numberOfTimesFallen":        {Sum, "count"},
	"numberOfAlcoholicBeverages": {Sum, "count"},
	"electrodermalActivity":      {Avg, "S"},
	"waterTemperature":           {Avg, "degC"},
	"underwaterDepth":            {Avg, "m"},
}

// Meta handles unknown types sensibly too. Without it the map's zero value would
// hand back an empty `Agg`, which is neither sum nor avg — and the client would
// receive an empty agg field with no idea how to read the number.
//
// `data_type` is deliberately open (docs/23 §1): we store the type a new iOS
// release introduces, and would rather show it as an average than drop it. If it
// turns out to be cumulative, that is one line in the table above.
func Meta(dataType string) Info {
	if m, ok := catalog[dataType]; ok {
		return m
	}
	return Info{Agg: Avg, Unit: ""}
}

// Known reports whether the type is present in the catalog.
func Known(dataType string) bool {
	_, ok := catalog[dataType]
	return ok
}

// Len is the size of the catalog (for the test that keeps it in sync with docs/23).
func Len() int { return len(catalog) }

// All iterates over the catalog (read-only; the map itself is not handed out, so
// it cannot be written to).
func All(fn func(dataType string, info Info)) {
	for name, info := range catalog {
		fn(name, info)
	}
}

// IsPercent: is the metric a percentage, i.e. does it need the 0…1 → 0…100
// scaling on the wire?
func IsPercent(dataType string) bool {
	return Meta(dataType).Unit == PercentUnit
}

// ToWire converts the STORED (raw HealthKit) value into its wire
// representation. Today this only affects percentages: 0.19238 → 19.238. Every
// read path (summary, samples, export, insights) must go through THIS, otherwise
// one endpoint says 19.2 and another 0.19 — which is worse than a consistent
// mistake.
func ToWire(dataType string, v float64) float64 {
	if IsPercent(dataType) {
		return v * percentScale
	}
	return v
}

// ToWirePtr is the nil-tolerant flavour of ToWire (for the SQL aggregates that
// can return NULL).
func ToWirePtr(dataType string, v *float64) *float64 {
	if v == nil {
		return nil
	}
	out := ToWire(dataType, *v)
	return &out
}
