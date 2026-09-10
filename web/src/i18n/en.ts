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
    'nav.challenge': 'Monthly challenge',
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

    // --- Trends · your usual range ------------------------------------------
    // ⚠️ "Usual", never "normal": normal has a medical ring to it that this number
    // does not deserve — it is a description of the last two months, not a
    // reference range from a laboratory. The five words are the app's
    // (`TrendStanding.label`), and the two have to agree: someone who reads this on
    // the phone should not meet a second wording of the same number in a browser.
    // The same sentence the app's chart legend carries, because it answers the same
    // question — what the pale rectangle is — and naming the day count is the point
    // of it: a band resting on 14 days and one resting on 60 are not equally strong
    // claims, and the reader is entitled to tell them apart without asking.
    'trends.usual.band':
      'The wide band is your usual range: the middle of the last {days} days measured, give or take how much they scattered.',
    'trends.usual.pending':
      'Not enough measured days yet for a usual range ({days}/{min}). Until then no band is drawn — one resting on fewer days would not be a narrower claim, just an equally confident one.',
    'trends.standing.wellBelow': 'Well below your usual',
    'trends.standing.below': 'Below your usual',
    'trends.standing.typical': 'Your usual',
    'trends.standing.above': 'Above your usual',
    'trends.standing.wellAbove': 'Well above your usual',

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
    'sleep.overlap':
      'The sources wrote {duration} of overlap for this night; the overlap counts once, which is why the total is less than the sum of the stages.',
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

    // --- Monthly challenge -------------------------------------------------
    'challenge.title': 'Monthly challenge',
    'challenge.subtitle':
      "The month's step count against your own milestones. You set the milestones on the phone; what shows here is what has actually been uploaded.",
    'challenge.prevMonth': 'Previous month',
    'challenge.nextMonth': 'Next month',
    'challenge.notStarted': 'This month has not begun yet.',
    'challenge.empty.title': 'No measurement from this month yet',
    'challenge.empty.hint':
      'This is not zero steps: not one day has arrived. The iPhone is the only uploader — as soon as it syncs, the month shows up here.',
    'challenge.steps': "The month's steps",
    'challenge.stepsPerDay': 'Per day, over the days that have passed',
    'challenge.ofGoal': 'Of the goal',
    'challenge.daysRemaining': 'Days left (today included)',
    'challenge.goalLabel': 'Goal: {steps} steps',
    'challenge.complete': 'The goal is done.',
    'challenge.overshoot': '{steps} steps past the goal.',
    'challenge.milestones.title': 'Milestones',
    'challenge.milestones.empty':
      'No milestone is set, so there is nothing to measure the month against.',
    'challenge.milestones.reached': 'reached',
    'challenge.milestones.next': 'The next one is at {steps} steps — {remaining} to go.',
    'challenge.source.title': 'Where the milestones come from',
    'challenge.source.default':
      'These are the factory milestones: the phone has never told this server which ones you set. What you see in the app may differ.',
    'challenge.source.achievement':
      'From the snapshot on the badge your phone recorded most recently. The milestones live on the phone; nothing syncs them on their own.',
    'challenge.days.title': 'Day by day',
    'challenge.days.empty': 'Not one day of this month has arrived yet.',
    'challenge.days.gaps.one':
      '{n} day with no measurement — the empty slot is missing data, not a day of sitting still.',
    'challenge.days.gaps.other':
      '{n} days with no measurement — the empty slots are missing data, not days of sitting still.',
    'challenge.streak.title': 'Daily streak',
    'challenge.streak.length.one': '{n}-day streak',
    'challenge.streak.length.other': '{n}-day streak',
    'challenge.streak.current': 'Current run',
    'challenge.streak.none': 'No streak running.',
    'challenge.streak.noGoal':
      'Without a goal there is nothing to measure a day against, so no streak is claimed.',
    'challenge.streak.dailyGoal': 'Daily goal',
    'challenge.streak.longest': 'Longest in the period examined',
    'challenge.streak.window': 'The period examined: {from} – {to}.',
    'challenge.streak.broken.missed':
      '{date} — stayed under the daily goal; the streak restarted here.',
    'challenge.streak.broken.noData':
      '{date} — no step count arrived for this day. Not a missed day, we simply do not know about it.',
    'challenge.streak.broken.startOfHistory':
      'The streak reaches back to the start of the period examined — we say nothing about days older than that.',
    'challenge.streak.lowerBound.title': 'The phone knows more than this',
    'challenge.streak.lowerBound.body':
      'Sick days, and rest days you marked yourself, never break a streak — but neither of them reaches the server: the journal stays on the phone, and a marked rest day is a local setting. So the streak here can be shorter than the one in the app, never longer.',

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

    // --- Observations ------------------------------------------------------
    // The two nav labels belong with the block above; they are down here because
    // several pages were being added at once and appending is the only way to do
    // that without three agents rewriting the same lines.
    'nav.insights': 'Observations',
    'nav.achievements': 'Medals',

    'insights.title': 'Observations',
    'insights.subtitle':
      'What the rules found in the measured days. A rolling average, a z-score and a correlation — there is no model here, and no rule guesses at a day that was not measured.',
    'insights.serverLanguage':
      'The sentences below are composed by the server and appear in the language it speaks. The language switch governs this interface, not them.',
    'insights.empty.title': 'Nothing to report right now',
    'insights.empty.hint':
      'That is a complete answer, not a failure. Every rule has a minimum number of measured days, and a rule short of them stays quiet rather than inventing something.',
    'insights.kind.anomaly': 'Deviation from your baseline',
    'insights.kind.anomaly.about':
      'Recent days measured against a longer baseline window of your own.',
    'insights.kind.trend': 'Change against the previous window',
    'insights.kind.trend.about': 'One window compared with the one immediately before it.',
    'insights.kind.correlation': 'Two series moving together',
    'insights.kind.correlation.about':
      'Co-movement over a longer window. Moving together is not one causing the other.',
    'insights.kind.pattern': 'A property of the window',
    'insights.kind.pattern.about':
      'Not a change over time: how much something scatters, how the weekend differs from the week.',
    'insights.kind.other': 'Other observations',
    'insights.kind.other.about':
      'The server has a rule family this build of the web does not know by name yet.',
    'insights.severity.info': 'Information',
    'insights.severity.notice': 'Worth a look',
    'insights.generatedAt': 'computed {when}',
    'insights.unnamed': 'The server sent no sentence for this rule.',
    'insights.values.summary': 'The numbers the rule computed',
    'insights.values.note':
      'These travel with the observation so a client can word the sentence itself. They are the rule’s own working, not a score.',
    'insights.col.value': 'Value',

    // --- Medals ------------------------------------------------------------
    'achievements.title': 'Medals',
    'achievements.subtitle':
      'Milestones already earned. Each one is a historical fact — the record of a condition that was met at a given moment, kept as it stood then.',
    'achievements.empty.title': 'No medals yet',
    'achievements.empty.hint':
      'The phone works these out and uploads them; the web only reads the list. Nothing has arrived so far.',
    'achievements.total.one': '{n} medal',
    'achievements.total.other': '{n} medals',
    'achievements.kind.month': 'Monthly',
    'achievements.kind.year': 'Yearly',
    'achievements.kind.streak': 'Streaks',
    'achievements.kind.record': 'Records',
    'achievements.kind.milestone': 'Milestones',
    'achievements.kind.other': 'Other medals',
    'achievements.col.badge': 'Medal',
    'achievements.col.period': 'Period',
    'achievements.col.value': 'Value as earned',
    'achievements.col.thresholds': 'Thresholds then in force',
    'achievements.col.earned': 'Earned',
    'achievements.code.complete': 'Complete',
    'achievements.code.progress': 'Progress',
    'achievements.code.bestMonth': 'Best month',
    'achievements.code.streak': 'Streak',
    'achievements.code.total': 'Running total',
    'achievements.months.one': '{n} month',
    'achievements.months.other': '{n} months',
    'achievements.thresholds.aria':
      'Thresholds in force when earned: {all}. Of these, reached: {reached}.',
    'achievements.thresholds.none': 'none',
    'achievements.thresholds.reached': 'reached',
    'achievements.thresholds.missed': 'not reached',
    'achievements.thresholds.note':
      'The thresholds are a snapshot of what was in force at the moment the medal was earned, which is why a medal cannot lose its value when the targets are later rewritten.',
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
