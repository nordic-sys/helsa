// The English dictionary.
//
// Typed as `Dict` (= the shape of `hu.ts`), so a missing key or a typo in one is
// a compile error. Keep the two files in the same order — reviewing a diff of a
// translation is only cheap while they line up.

import type { Dict } from './types'

export const en: Dict = {
  ui: {
    // --- Navigation and chrome ---------------------------------------------
    'nav.today': 'Today',
    'nav.trends': 'Trends',
    'nav.workouts': 'Workouts',
    'nav.sleep': 'Sleep',
    'nav.nutrition': 'Nutrition',
    'nav.settings': 'Settings',
    'lang.aria': 'Choose language',
    'lang.hu': 'Hungarian',
    'lang.en': 'English',

    // --- Shared units and separators ---------------------------------------
    // "min", not "m": distances in metres sit in the same tables, and "8 m" of
    // sleep is a genuinely confusing thing to read.
    'unit.minShort': 'min',
    'unit.hourShort': 'h',

    // --- Duration ----------------------------------------------------------
    'duration.hm': '{h} h {m} min',
    'duration.h': '{h} h',
    'duration.m': '{m} min',

    // --- Relative time -----------------------------------------------------
    'relative.never': 'never',
    'relative.now': 'just now',

    // --- Error and empty states -------------------------------------------
    'error.noToken.title': 'No valid device token',
    'error.noToken.body':
      'Set one on the Settings page. This is a single-user system — there is no sign-in, just one token to enter once on this machine.',
    'error.generic.title': 'Something went wrong',
    'error.generic.detail': 'The backend did not respond as expected.',

    // --- Ranges ------------------------------------------------------------
    'range.day': 'Day',
    'range.week': 'Week',
    'range.month': 'Month',
    'range.year': 'Year',

    // --- Dashboard ---------------------------------------------------------
    'dashboard.title': 'Today',
    'dashboard.tz': 'time zone: {tz}',
    'dashboard.lastSync': 'last sync: {when}',
    'dashboard.empty.title': 'No data yet',
    'dashboard.empty.hint':
      'The iPhone is the only uploader — as soon as it syncs, the data shows up here.',
    'dashboard.rings.title': 'Activity rings',
    'dashboard.rings.move': 'Move',
    'dashboard.rings.exercise': 'Exercise',
    'dashboard.rings.stand': 'Stand',
    'dashboard.rings.empty.title': 'No ring data',
    'dashboard.rings.empty.hint': 'HealthKit’s daily activity summary has not arrived yet.',

    // --- Trends ------------------------------------------------------------
    'trends.title': 'Trends',
    'trends.subtitle': 'Longer-term movement, bucketed in your own time zone.',
    'trends.metric': 'Metric',
    'trends.degraded.title': 'This type arrives as a per-sample average, not a daily total',
    'trends.degraded.body':
      '{metric} is a metric that should be summed, but the server only knows by name the five types with a hard-coded aggregation — for every other one it returns an average, a minimum and a maximum, but no count. A daily total cannot be reconstructed from that, so what you see here is the per-sample average. The fix belongs in the backend’s {file} metricMeta table.',
    'trends.empty.title': 'No data in this period: {metric}',
    'trends.empty.hintElsewhere':
      'This type does have data, just not in this window — try another range.',
    'trends.empty.hintNever':
      'No sample has arrived for this type yet. HealthKit does not distinguish “no data” from “no permission” — both come back empty.',
    'trends.extremes': 'Range',
    'trends.periodAverage': 'Average over the period',
    'trends.periodTotal': 'Total over the period',
    'trends.bandNote': '· the pale band is the minimum–maximum inside the bucket',

    // --- Workouts ----------------------------------------------------------
    'workouts.title': 'Workouts',
    'workouts.subtitle': 'The most recent workouts, newest first.',
    'workouts.empty.title': 'No workouts yet',
    'workouts.empty.hint':
      'Workouts recorded on the Watch land in the paired iPhone’s HealthKit, and are uploaded from there.',
    'workouts.col.type': 'Type',
    'workouts.col.when': 'When',
    'workouts.col.duration': 'Duration',
    'workouts.col.energy': 'Energy',
    'workouts.col.distance': 'Distance',
    'workouts.col.avgHr': 'Avg HR',
    'workouts.col.maxHr': 'Max HR',
    'workouts.hrNote':
      'Empty heart-rate columns: samples only know HealthKit’s {field}, and binding them to the server-side workout id happens in the ingest worker.',

    // --- Sleep -------------------------------------------------------------
    'sleep.title': 'Sleep',
    'sleep.subtitle':
      'Night by night, broken down into stages. The quality figures — efficiency, awakenings, stage shares — are {derived} from the stages; HealthKit has no “sleep quality” field. A night is a run of contiguous segments: a gap longer than three hours starts a new entry, so a nap shows up on its own.',
    'sleep.subtitle.derived': 'derived',
    'sleep.window.one': '{n} night',
    'sleep.window.other': '{n} nights',
    'sleep.empty.title': 'No sleep data yet',
    'sleep.empty.hint':
      'Sleep stages are recorded by the Watch and uploaded by the paired iPhone.',
    'sleep.avgSleep.one': 'Average sleep — {n} night',
    'sleep.avgSleep.other': 'Average sleep — {n} nights',
    'sleep.efficiency': 'Sleep efficiency',
    'sleep.awakeningsPerNight': 'Awakenings per night',
    'sleep.deepRemShare': 'Deep + REM share',
    'sleep.stagesChart': 'Stages per night (minutes)',
    'sleep.physio.title': 'Physiological metrics over the period',
    'sleep.physio.note':
      'These are averages over the whole period, not the sleep window alone — filtering samples to the sleep window is waiting on the backend’s {insights} layer (docs/23 §5).',
    'sleep.night.title': '{date} — {duration} asleep',
    'sleep.night.aria': 'Sleep stages on {date}',
    'sleep.inBed': 'In bed',
    'sleep.efficiencyShort': 'Efficiency',
    'sleep.onset': 'Fell asleep',
    'sleep.wakeUp': 'Woke up',
    'sleep.awakenings': 'Awakenings',
    'sleep.deepRem': 'Deep + REM',
    'sleep.col.stage': 'Stage',
    'sleep.col.length': 'Length',
    'sleep.col.shareOfSleep': 'Share of time asleep',
    'sleep.col.start': 'Start',
    'sleep.col.end': 'End',
    'sleep.raw.one': 'Raw segment ({n})',
    'sleep.raw.other': 'Raw segments ({n})',

    // --- Nutrition ---------------------------------------------------------
    'nutrition.title': 'Nutrition',
    'nutrition.subtitle':
      'Energy consumed, macros and micronutrients. A meal-logging app writes these into Health; Helsa only reads them.',
    'nutrition.range.day': 'Today',
    'nutrition.range.week': 'Week',
    'nutrition.range.month': '30 days',
    'nutrition.degraded.title': 'The server is returning per-sample averages instead of daily totals',
    'nutrition.degraded.body':
      'Every nutrition type should be summed, but the backend only knows the aggregation of five metrics by name ({file}); for the rest it returns an average without a count. Daily intake cannot be restored from that, so the numbers here are the average of a single entry, not the daily total.',
    'nutrition.empty.title': 'No nutrition data yet',
    'nutrition.empty.hint':
      'HealthKit does not collect meals on its own — a logging app (a calorie counter, say) writes them into Health, and the iPhone uploads them from there.',
    'nutrition.headline.sampleAverage': 'Per-sample average',
    'nutrition.headline.todayTotal': 'Total today',
    'nutrition.headline.dailyAverage': 'Daily average',
    'nutrition.stat': '{metric} — {headline}',
    'nutrition.macroSplit.title': 'Macro split (by energy)',
    'nutrition.macroSplit.aria': 'Macro share by energy',
    'nutrition.macroSplit.note':
      'The energy computed from the grams above is {computed} kcal (4 / 4 / 9 kcal per gram). HealthKit’s separately measured {field} is {measured} kcal — the two can differ if the logging app does not record macros for every entry.',
    'nutrition.chart.perBucket': 'Macro energy per bucket (kcal)',
    'nutrition.chart.perDay': 'Macro energy per day (kcal)',
    'nutrition.section.macros': 'Macros in detail',
    'nutrition.section.minerals': 'Minerals',
    'nutrition.section.vitamins': 'Vitamins',
    'nutrition.col.nutrient': 'Nutrient',
    'nutrition.col.periodTotal': 'Period total',
    'nutrition.col.unit': 'Unit',
    'nutrition.hideEmpty': 'Hide the nutrients without data',
    'nutrition.showEmpty.one': 'Show the {n} nutrient without data',
    'nutrition.showEmpty.other': 'Show the {n} nutrients without data',

    // --- Settings ----------------------------------------------------------
    'settings.title': 'Settings',
    'settings.subtitle':
      'A single-user system — there is no sign-in. Access is layered: network (WireGuard) and application (device token).',
    'settings.token.title': 'Device token',
    'settings.token.present': 'Set on this machine. On a new machine it has to be entered once.',
    'settings.token.clear': 'Clear token',
    'settings.token.hint':
      'Paste the token — the browser stores it, the server asks for no password.',
    'settings.token.placeholder': 'device token',
    'settings.token.save': 'Save',
    'settings.devices.title': 'Devices and sync freshness',
    'settings.devices.empty': 'No device registered yet.',
    'settings.devices.col.device': 'Device',
    'settings.devices.col.platform': 'Platform',
    'settings.devices.col.lastSync': 'Last sync',
    'settings.goals.title': 'Goals',
    'settings.goals.empty': 'No goal data yet.',
    'settings.goals.note':
      'The three Apple ring goals come from HealthKit (read-only); the step goal is set by the user.',
    'settings.system.title': 'System',
    'settings.system.browserTz': 'Browser time zone',
    'settings.system.serverTz': 'Server time zone',
    'settings.system.units': 'Unit system',
    'settings.language.title': 'Language',
    'settings.language.note':
      'The language of the interface. It is stored in the browser only — text that comes from the server (insight sentences, error messages) stays in the server’s language regardless.',

    // --- Metric picker -----------------------------------------------------
    'picker.search': 'Search {n} metrics…',
    'picker.searchAria': 'Search metrics',
    'picker.onlyWithData': 'Only with data',
    'picker.onlyWithDataTitle':
      'HealthKit will not tell you whether a type has no data or no permission — both come back empty.',
    'picker.all': 'All',
    'picker.noMatch': 'Nothing matches this filter.',
    'picker.listAria': 'Metrics',
    'picker.noDataYet': '{key} — no data yet',
    'picker.selected':
      'Selected: {name} · metrics marked {sum} are summed over the period, those marked {avg} are averaged.',
  },

  // --- Metric group names ---------------------------------------------------
  group: {
    activity: 'Activity',
    heart: 'Heart',
    respiratory: 'Respiration',
    body: 'Body composition',
    macro: 'Nutrition — macros',
    mineral: 'Nutrition — minerals',
    vitamin: 'Nutrition — vitamins',
    mobility: 'Mobility',
    environment: 'Environment',
    other: 'Other',
  },

  // --- Workout activity types (HealthKit `activity_type`) -------------------
  activity: {
    running: 'Running',
    walking: 'Walking',
    cycling: 'Cycling',
    hiking: 'Hiking',
    swimming: 'Swimming',
    strengthTraining: 'Strength training',
    functionalStrengthTraining: 'Functional strength training',
    traditionalStrengthTraining: 'Traditional strength training',
    yoga: 'Yoga',
    rowing: 'Rowing',
    elliptical: 'Elliptical',
    highIntensityIntervalTraining: 'HIIT',
    other: 'Other',
  },

  // --- Sleep stages ---------------------------------------------------------
  stage: {
    deep: 'Deep',
    rem: 'REM',
    core: 'Core',
    light: 'Light',
    awake: 'Awake',
    inBed: 'In bed',
    asleep: 'Asleep',
  },

  // --- Units ----------------------------------------------------------------
  unit: {
    count: '',
    'count/min': '/min',
    min: 'min',
    h: 'h',
    'kcal/hr/kg': 'kcal/hr/kg',
    'ml/kg/min': 'ml/kg/min',
    'L/min': 'L/min',
  },

  // --- Metric display names -------------------------------------------------
  metric: {
    // 3.1 Activity and movement
    stepCount: 'Steps',
    distanceWalkingRunning: 'Walking/running distance',
    distanceCycling: 'Cycling distance',
    distanceSwimming: 'Swimming distance',
    distanceWheelchair: 'Wheelchair distance',
    distanceDownhillSnowSports: 'Downhill distance',
    pushCount: 'Pushes',
    swimmingStrokeCount: 'Swimming strokes',
    flightsClimbed: 'Flights climbed',
    activeEnergy: 'Active energy',
    basalEnergyBurned: 'Resting energy',
    appleExerciseTime: 'Exercise time',
    appleMoveTime: 'Move time',
    appleStandTime: 'Stand time',
    exerciseTime: 'Exercise time',
    standHours: 'Stand hours',
    nikeFuel: 'Nike Fuel',
    physicalEffort: 'Physical effort',

    // 3.2 Heart and circulation
    heartRate: 'Heart rate',
    restingHeartRate: 'Resting heart rate',
    walkingHeartRateAverage: 'Walking heart rate',
    hrv: 'HRV (SDNN)',
    heartRateRecoveryOneMinute: 'Heart rate recovery (1 min)',
    atrialFibrillationBurden: 'AFib burden',
    bloodPressureSystolic: 'Blood pressure — systolic',
    bloodPressureDiastolic: 'Blood pressure — diastolic',
    peripheralPerfusionIndex: 'Peripheral perfusion index',
    vo2Max: 'VO₂max',

    // 3.3 Respiration and blood oxygen
    respiratoryRate: 'Respiratory rate',
    oxygenSaturation: 'Blood oxygen (SpO₂)',
    forcedVitalCapacity: 'Forced vital capacity',
    forcedExpiratoryVolume1: 'FEV1',
    peakExpiratoryFlowRate: 'Peak expiratory flow',
    inhalerUsage: 'Inhaler usage',

    // 3.4 Body composition
    bodyMass: 'Body mass',
    bodyMassIndex: 'BMI',
    bodyFatPercentage: 'Body fat',
    leanBodyMass: 'Lean body mass',
    height: 'Height',
    waistCircumference: 'Waist circumference',
    appleSleepingWristTemperature: 'Sleeping wrist temperature',
    bodyTemperature: 'Body temperature',
    basalBodyTemperature: 'Basal body temperature',

    // 3.5 Nutrition — macros
    dietaryEnergyConsumed: 'Energy consumed',
    dietaryProtein: 'Protein',
    dietaryCarbohydrates: 'Carbohydrates',
    dietaryFatTotal: 'Fat (total)',
    dietaryFiber: 'Fibre',
    dietarySugar: 'Sugar',
    dietaryFatSaturated: 'Saturated fat',
    dietaryFatMonounsaturated: 'Monounsaturated fat',
    dietaryFatPolyunsaturated: 'Polyunsaturated fat',
    dietaryCholesterol: 'Cholesterol',
    dietaryWater: 'Water',
    dietaryCaffeine: 'Caffeine',

    // 3.6 Nutrition — minerals
    dietaryCalcium: 'Calcium',
    dietaryIron: 'Iron',
    dietaryMagnesium: 'Magnesium',
    dietaryPhosphorus: 'Phosphorus',
    dietaryPotassium: 'Potassium',
    dietarySodium: 'Sodium',
    dietaryZinc: 'Zinc',
    dietaryChloride: 'Chloride',
    dietaryChromium: 'Chromium',
    dietaryCopper: 'Copper',
    dietaryIodine: 'Iodine',
    dietaryManganese: 'Manganese',
    dietaryMolybdenum: 'Molybdenum',
    dietarySelenium: 'Selenium',

    // 3.7 Nutrition — vitamins
    dietaryVitaminA: 'Vitamin A',
    dietaryVitaminB6: 'Vitamin B6',
    dietaryVitaminB12: 'Vitamin B12',
    dietaryVitaminC: 'Vitamin C',
    dietaryVitaminD: 'Vitamin D',
    dietaryVitaminE: 'Vitamin E',
    dietaryVitaminK: 'Vitamin K',
    dietaryThiamin: 'Thiamin (B1)',
    dietaryRiboflavin: 'Riboflavin (B2)',
    dietaryNiacin: 'Niacin (B3)',
    dietaryFolate: 'Folate (B9)',
    dietaryBiotin: 'Biotin (B7)',
    dietaryPantothenicAcid: 'Pantothenic acid (B5)',

    // 3.8 Mobility and gait
    walkingSpeed: 'Walking speed',
    walkingStepLength: 'Step length',
    walkingAsymmetryPercentage: 'Walking asymmetry',
    walkingDoubleSupportPercentage: 'Double support time',
    sixMinuteWalkTestDistance: 'Six-minute walk test',
    stairAscentSpeed: 'Stair ascent speed',
    stairDescentSpeed: 'Stair descent speed',
    appleWalkingSteadiness: 'Walking steadiness',
    runningSpeed: 'Running speed',
    runningPower: 'Running power',
    runningStrideLength: 'Running stride length',
    runningVerticalOscillation: 'Vertical oscillation',
    runningGroundContactTime: 'Ground contact time',

    // 3.9 Environment and hearing
    environmentalAudioExposure: 'Environmental sound levels',
    headphoneAudioExposure: 'Headphone audio levels',
    environmentalSoundReduction: 'Sound reduction',
    timeInDaylight: 'Time in daylight',
    uvExposure: 'UV exposure',

    // 3.10 Other
    bloodGlucose: 'Blood glucose',
    bloodAlcoholContent: 'Blood alcohol content',
    insulinDelivery: 'Insulin delivery',
    numberOfTimesFallen: 'Falls',
    electrodermalActivity: 'Electrodermal activity',
    waterTemperature: 'Water temperature',
    underwaterDepth: 'Underwater depth',
  },
}
