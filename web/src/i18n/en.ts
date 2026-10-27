// The English dictionary.
//
// Typed as `Dict` (= the shape of `hu.ts`), so a missing key or a typo in one is
// a compile error. Keep the two files in the same order — reviewing a diff of a
// translation is only cheap while they line up.

import type { Dict } from './types'

export const en: Dict = {
  ui: {
    // --- Navigation and chrome ---------------------------------------------
    'app.notMedical':
      'Statistics, not medicine. Helsa is not a medical device and nothing here is a diagnosis or advice. Talk to a doctor about anything that worries you.',
    'nav.today': 'Today',
    'nav.trends': 'Trends',
    'nav.workouts': 'Workouts',
    'nav.sleep': 'Sleep',
    'nav.nutrition': 'Nutrition',
    'nav.challenge': 'Monthly challenge',
    'nav.coverage': 'Completeness',
    'nav.ingest': 'Sync queue',
    'nav.settings': 'Settings',
    'lang.aria': 'Choose language',
    'lang.hu': 'Hungarian',
    'lang.en': 'English',

    // --- Shared units and separators ---------------------------------------
    // "min", not "m": distances in metres sit in the same tables, and "8 m" of
    // sleep is a genuinely confusing thing to read.
    'unit.minShort': 'min',
    'unit.hourShort': 'h',
    'unit.bpm': 'bpm',
    'unit.kmh': 'km/h',
    'unit.perKm': '/km',
    'unit.per100m': '/100 m',

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
    'dashboard.lastSync': 'a device last seen {when}',
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

    // --- Trends · stepping through periods -----------------------------------
    // What a ROLLING window is called. It has no name of its own — nobody calls
    // the stretch from last Friday to this one anything — so it is named by what
    // it is. A calendar window gets its real name instead ("August 2026"), built
    // from `Intl` rather than from a key here, because the month names are the
    // one thing the browser already knows in every language.
    'trends.window.day': 'Today, hour by hour',
    'trends.window.week': 'The last 7 days',
    'trends.window.month': 'The last 30 days',
    'trends.window.year': 'The last 12 months',
    'trends.step.back': 'Earlier period',
    'trends.step.forward': 'Later period',
    'trends.step.now': 'Back to now',
    // ⚠️ The drill hint is spelled out per level, not assembled from a range
    // name, because the month → week step is the one that surprises people: a
    // month's bars are days, and a tap on one opens the week around it.
    'trends.drill.toMonth': 'Tap the chart to open the month around that point.',
    'trends.drill.toWeek':
      'Tap the chart to open the week around that point — the bars are days, but the week is usually the level people mean.',
    'trends.drill.toDay': 'Tap the chart to open that day, hour by hour.',
    'trends.table.hint': 'With a keyboard, the table under the chart opens the same periods.',
    'trends.table.summary': 'The numbers behind the chart',
    'trends.table.period': 'Period',
    'trends.table.value': 'Value',
    'trends.table.notMeasured': 'not measured',
    'trends.table.open': 'Open {period}',
    'trends.loading': 'Loading the new period…',
    'trends.chartDesc':
      'One bar or point per bucket, {period}. Empty buckets were not measured. The table below the chart lists the same numbers.',

    // --- Trends · against the previous period --------------------------------
    // ⚠️ No colour and no verdict. A rise is sometimes a joy (steps) and
    // sometimes a warning (resting heart rate); this page has no way of knowing
    // which the reader is after, so it states the fact and stops.
    'trends.compare.title': 'Against the previous period',
    'trends.compare.unchanged': 'No change',
    'trends.compare.previous': 'The previous period ({dates}): {value}',
    'trends.compare.none':
      'Nothing was measured in the previous period, so there is nothing to compare against. That is not a fall to zero — it is a gap.',
    'trends.compare.clipped':
      'This period is still running, so only the {days} days that have happened are compared — against the same {days} days of the previous period, not against all of it. Twenty-seven days beside thirty-one would read as a collapse.',
    'trends.compare.coverage.day':
      'Measured in {a} of {total} hours; the previous period in {b} of {prevTotal}.',
    'trends.compare.coverage.week':
      'Measured on {a} of {total} days; the previous period on {b} of {prevTotal}.',
    'trends.compare.coverage.month':
      'Measured on {a} of {total} days; the previous period on {b} of {prevTotal}.',
    'trends.compare.coverage.year':
      'Measured in {a} of {total} months; the previous period in {b} of {prevTotal}.',
    'trends.compare.uneven':
      'Not compared: the two periods were measured on very different shares of their days, and a total over fewer measured days is smaller for that reason alone. The previous period ({dates}): {value}.',
    'trends.compare.unevenAvg':
      'The two averages rest on very different numbers of measurements, so read the difference loosely.',

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
    'trends.usual.flat':
      'No usual range to draw: all {days} measured days of the reference carried the same value ({value}), so there is no spread to make a band from. That is not a shortage of data.',
    'trends.usual.unavailable':
      'The server sent no usual range for this metric, although {days} days were measured.',
    'trends.standing.wellBelow': 'Well below your usual',
    'trends.standing.below': 'Below your usual',
    'trends.standing.typical': 'Your usual',
    'trends.standing.above': 'Above your usual',
    'trends.standing.wellAbove': 'Well above your usual',

    // --- Trends · day by day, and the weight trend -----------------------------
    // The words are the phone's (`DayValueGrid.swift`, `WeightTrend.swift`,
    // `TrendsView.swift`), so the two say the same thing about the same number.
    'daygrid.aria': 'Day by day',
    'daygrid.noData': 'no data',
    'daygrid.gaps.one': '{n} day brought no measurement — that cell is empty, not zero.',
    'daygrid.gaps.other': '{n} days brought no measurement — those cells are empty, not zero.',
    'trends.dayGrid.title': 'Day by day',
    'trends.weight.title': 'Trend line',
    'trends.weight.series': 'Trend line',
    'trends.weight.rate': '{rate} {unit}/week',
    'trends.weight.rateNoUnit': '{rate}/week',
    'trends.weight.explanation':
      'The trend line’s change over the last {days} days. Not the difference between readings: daily variation comes from salt, water and the time of the weigh-in, and that is not you.',
    'trends.weight.noRate':
      'The line is there, but a weekly change needs at least {days} days without a break in them.',
    'trends.weight.yearly':
      'The yearly view shows monthly averages — a trend line says nothing new about those. Switch to “Month”.',
    'trends.weight.fewSamples':
      'The trend line needs at least {min} readings within one unbroken stretch — right now there are {count}. Until then the raw readings are shown, with no invented curve.',
    'trends.weight.shortSpan':
      'The readings span {span} days; the trend line needs at least {min}. Over a shorter stretch the curve would still be mostly the first reading, merely dressed as a trend.',
    'trends.weight.legend':
      'The dark line is the weighted moving average: it smooths the daily swing. Where more than {days} days are missing it breaks — under that we do not know what happened.',

    // --- Workouts ----------------------------------------------------------
    'workouts.title': 'Workouts',
    'workouts.subtitle':
      'Sessions grouped by the month you trained in, newest first. A closed month is one line, and a session two devices recorded is one row.',
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
    'workouts.filter.title': 'Filter',
    'workouts.filter.place': 'Place',
    'workouts.place.any': 'Anywhere',
    'workouts.place.indoor': 'Indoor',
    'workouts.place.outdoor': 'Outdoor',
    'workouts.filter.minDuration': 'Lasting at least',
    'workouts.filter.minDistance': 'Distance at least',
    'workouts.filter.minEnergy': 'Energy at least',
    'workouts.filter.minHr': 'Avg HR from',
    'workouts.filter.maxHr': 'Avg HR up to',
    'workouts.filter.noLimit': 'No limit',
    'workouts.filter.clear': 'Clear the filter',
    'workouts.filter.count.one': '{shown} of {n} session',
    'workouts.filter.count.other': '{shown} of {n} sessions',
    'workouts.filter.none.title': 'No workout matches the filter',
    'workouts.filter.none.hint.one':
      'There is {n} session in the list — try widening the filter.',
    'workouts.filter.none.hint.other':
      'There are {n} sessions in the list — try widening the filter.',
    'workouts.filter.missingNote':
      'A workout that cannot answer a filter is not hidden by it. A strength session has no distance, so “at least 5 km” leaves it in rather than reading the missing distance as a zero.',
    'workouts.month.count.one': '{n} session',
    'workouts.month.count.other': '{n} sessions',
    'workouts.month.open.one': '{n} with no end time, outside the total',
    'workouts.month.open.other': '{n} with no end time, outside the total',
    'workouts.fold.identical.one':
      '{n} possible matching recording of this session — duration, distance and energy agree within 0.5%.',
    'workouts.fold.identical.other':
      '{n} possible matching recordings of this session — duration, distance and energy agree within 0.5%.',
    'workouts.fold.differ.one':
      '{n} possible matching recording of this session — its duration, distance or energy differ.',
    'workouts.fold.differ.other':
      '{n} possible matching recordings of this session — their duration, distance or energy differ.',
    'workouts.dupNote':
      '{sessions} sessions look as if they arrived in Health more than once: the same activity type at overlapping times (at least 70% of their combined span, or starts within 5 minutes). Health keeps no link between such recordings, so this is an inference. The list shows one row for each, so the monthly totals are not counted twice; {extra} further recordings sit behind those rows.',
    'workouts.loading.title': 'Still loading the history',
    'workouts.loading.body.one':
      '{n} recording so far. The older months are still arriving, so their totals are not final yet.',
    'workouts.loading.body.other':
      '{n} recordings so far. The older months are still arriving, so their totals are not final yet.',
    'workouts.truncated.title': 'The history stops here',
    'workouts.truncated.body':
      'Older workouts are not in this list: the walk through the pages reached its limit. What is above is complete — below it, there is more.',

    // --- One workout, opened -----------------------------------------------
    'workout.back': '← All workouts',
    'workout.missing.title': 'No such workout',
    'workout.missing.hint':
      'The link points at a session this server does not hold. It may have been deleted in Health, or the link may be from another server.',

    'workout.metric.time': 'Time',
    'workout.metric.distance': 'Distance',
    'workout.metric.energy': 'Energy',
    'workout.metric.pace': 'Pace',
    'workout.metric.speed': 'Speed',
    'workout.metric.avgHr': 'Avg heart rate',
    'workout.metric.maxHr': 'Max heart rate',
    'workout.metric.pool': 'Pool',
    'workout.metric.none.title': 'No measurement arrived for this workout',
    'workout.metric.none.hint':
      'The session was recorded, but not one number came with it. That is a fact about the recording, not a zero.',

    'workout.route.title': 'Route',
    'workout.route.loading': 'Loading the route…',
    'workout.route.none': 'There is no route for this workout.',
    'workout.route.failed.title': 'The route could not be loaded',
    'workout.route.failed.body':
      'This is a failed request, not an absent route — the workout may well have one.',
    'workout.route.start': 'Start',
    'workout.route.finish': 'Finish',
    'workout.route.startFinish': 'Start / Finish',
    'workout.route.aria': 'The shape of the route: {points} recorded points, {length}.',
    'workout.route.dropped.one': '{n} inaccurate point left out.',
    'workout.route.dropped.other': '{n} inaccurate points left out.',
    // ⚠️ Four states, and exactly one of them is true at a time. "No map" is the
    // DEFAULT, and it is where anyone who never opens the setting stays.
    'workout.route.noTiles':
      'Drawn from the recorded coordinates alone: there is no map under it because none is switched on. Settings has the choice — and says what each one tells whom.',
    'workout.route.viaOwn':
      'The map comes from your own tile server, through the Helsa server. Your browser talks only to the Helsa server, and the machine serving the tiles is yours too.',
    'workout.route.viaPublic':
      'The map comes from a public provider, through the Helsa server. Your browser talks only to the Helsa server — the provider sees the Helsa server’s address and which area you are looking at.',
    'workout.route.mapUndrawable':
      'A map source is chosen, but this browser could not draw it — it needs WebGL, or the source did not answer. The route is unchanged; the scale bar gives it its size.',
    // Both the OpenStreetMap and the OpenMapTiles licence require a visible
    // credit. ⚠️ Not translated and not shortened: this is a legal notice. And it
    // comes from our own strings — an attribution fetched over the network would
    // be one more thing the page asks of somebody else.
    'workout.route.attribution.osm': '© OpenStreetMap contributors',
    'workout.route.attribution.omt': '© OpenMapTiles © OpenStreetMap contributors',

    'workout.hr.title': 'Heart rate',
    'workout.hr.loading': 'Loading the heart-rate samples…',
    'workout.hr.none': 'There is no heart-rate measurement for this workout.',
    'workout.hr.single':
      'One heart-rate sample falls inside this session — too few to draw a curve, and too few to average.',
    'workout.hr.noWindow':
      'This recording has no end time, so there is no window to read the heart rate over.',
    'workout.hr.failed.title': 'The heart-rate samples cannot be loaded',
    'workout.hr.failed.body': 'A failed request, not a missing measurement.',
    'workout.hr.average': 'Average',
    'workout.hr.peak': 'Peak',
    'workout.hr.lowest': 'Lowest',
    'workout.hr.fromWindow':
      'The curve and the three figures above it are every heart-rate sample recorded inside this session’s time window, by any device or app. A sample is not tied to a recording, so another device’s readings from the same minutes are included.',
    'workout.hr.truncated':
      'The curve stops short: this session holds more samples than the read follows.',

    'workout.laps.title': 'Splits',
    'workout.laps.col.index': '#',
    'workout.laps.note':
      'Splits come from the recording app. A session with a single segment shows none — one lap is the system’s own shape, not a split you made.',

    'workout.weather.title': 'Weather',
    'workout.weather.condition': 'Conditions',
    'workout.weather.temperature': 'Temperature',
    'workout.weather.humidity': 'Humidity',

    'workout.dup.title': 'Possibly the same session, recorded elsewhere',
    'workout.dup.body.one': 'This session looks as if it is in Health {n} time.',
    'workout.dup.body.other':
      'This session looks as if it is in Health {n} times: recordings of the same activity at overlapping times — from a watch and an app, or from two apps. Health keeps no link between them, so this is an inference. The list shows one row for it; here are the others, exactly as they were recorded.',
    'workout.dup.thisOnly':
      'The summary figures above are this one recording’s, and nothing here averages the recordings together: two devices measuring the same half hour disagree, and which to believe is not ours to decide. The heart-rate curve is the exception — it holds every sample from the session’s time window, whichever device recorded it.',
    'workout.dup.secondary':
      'The list shows the other recording of this session, not this one.',
    'workout.dup.listed': 'shown in the list',
    'workout.dup.noMeasurement': 'No measurement on this recording.',
    'workout.dup.keep':
      'Helsa deletes neither of them: they are your Health data, and which recording to keep is not ours to decide.',
    'workout.dup.checking': 'Checking whether this session was recorded more than once…',

    'workout.source.title': 'Where it came from',
    'workout.source.uuid': 'HealthKit id',
    'workout.source.gap':
      'Only samples carry a source device on the wire, so this says who wrote the heart rate and nothing more. Which app recorded the session itself, and which wrote the route, is in HealthKit on the phone — the server is not told.',

    'device.watch': 'Apple Watch',
    'device.iphone': 'iPhone',

    // --- Weather conditions (HKWeatherCondition) ---------------------------
    // ⚠️ Their own keys, not the English words. On the phone the weather’s
    // “Clear” shares a key with the filter’s “Clear” button, and the Hungarian
    // bundle translates it as “Törlés” — so a clear sky reads “Delete”.
    'weather.clear': 'Clear',
    'weather.fair': 'Fair',
    'weather.partlyCloudy': 'Partly cloudy',
    'weather.mostlyCloudy': 'Mostly cloudy',
    'weather.cloudy': 'Overcast',
    'weather.foggy': 'Foggy',
    'weather.haze': 'Hazy',
    'weather.windy': 'Windy',
    'weather.blustery': 'Blustery',
    'weather.smoky': 'Smoky',
    'weather.dust': 'Dusty',
    'weather.snow': 'Snow',
    'weather.hail': 'Hail',
    'weather.sleet': 'Sleet',
    'weather.freezingDrizzle': 'Freezing drizzle',
    'weather.freezingRain': 'Freezing rain',
    'weather.mixedRainAndHail': 'Rain with hail',
    'weather.mixedRainAndSnow': 'Rain with snow',
    'weather.mixedRainAndSleet': 'Rain with sleet',
    'weather.mixedSnowAndSleet': 'Snow with sleet',
    'weather.drizzle': 'Drizzle',
    'weather.scatteredShowers': 'Scattered showers',
    'weather.showers': 'Showers',
    'weather.thunderstorms': 'Thunderstorm',
    'weather.tropicalStorm': 'Tropical storm',
    'weather.hurricane': 'Hurricane',
    'weather.tornado': 'Tornado',

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
    'sleep.night.latest': 'Last night · {date} — {duration} asleep',
    'sleep.night.title.notRecorded': '{date} — sleep duration not recorded',
    'sleep.night.latest.notRecorded': 'Last night · {date} — sleep duration not recorded',
    'sleep.nights.title.one': 'The night in this period',
    'sleep.nights.title.other': 'The {n} nights in this period',
    'sleep.nights.hint':
      'Pick a night to open it above. The bar is that night’s stages in proportion; the last two columns are efficiency and the number of awakenings.',
    'sleep.stagesChart.hint': 'Click a bar to open that night above.',
    'sleep.gap.one':
      '{nights} of the last {n} night carries sleep data. The rest are nights nothing was recorded on — not nights of no sleep.',
    'sleep.gap.other':
      '{nights} of the last {n} nights carry sleep data. The rest are nights nothing was recorded on — not nights of no sleep.',
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
    // --- Settings · map source ----------------------------------------------
    // ⚠️ The choice is a privacy trade-off and it is not ours: a tile request
    // tells whoever serves it that somebody is looking at that square of the
    // world. So the screen states the consequence of ALL THREE options before one
    // is picked — and defaults to the one that sends nothing.
    'settings.map.title': 'Map under the route',
    'settings.map.intro':
      'A workout route gets no map on its own. If it gets one, somebody has to serve the tiles — this is where you decide who.',
    'settings.map.off.label': 'No map',
    'settings.map.off.note': 'The drawn route only, as before. Nobody learns anything. This is the default.',
    'settings.map.own.label': 'Your own tile server',
    'settings.map.own.note':
      'A machine of yours serves the tiles — the optional container in deploy/, or anything else you run. Nothing reaches a stranger.',
    'settings.map.public.label': 'A public, open-source source',
    'settings.map.public.note':
      'OpenStreetMap-based tiles from the open internet. The provider — a stranger — sees the request: the Helsa server’s address, and which area you are looking at.',
    'settings.map.url.label': 'The address of the tile service',
    'settings.map.url.ok': 'This address can be used.',
    'settings.map.problem.empty': 'Enter an address, or there will be no map.',
    'settings.map.problem.scheme': 'This has to be an http:// or https:// address.',
    'settings.map.problem.placeholders':
      'The address needs the {z}, {x} and {y} placeholders — that is where a tile’s coordinates go.',
    'settings.map.format.label': 'What kind of tiles this address serves',
    'settings.map.format.raster': 'Images (png, jpg) — what public providers usually serve',
    'settings.map.format.vector': 'Vector (pbf, mvt) — what your own server usually serves',
    // ⚠️ This sentence is on the card whatever is chosen, and it says two
    // separate things. "Your browser only talks to the Helsa server" is NOT the
    // same claim as "nothing leaves".
    'settings.map.proxyNote':
      'Tiles always come through the Helsa server, never straight from your browser, so your browser never talks to a stranger’s machine. What the provider sees is therefore the Helsa server’s address and the area you are looking at — not yours.',
    'settings.map.saved': 'Saved. This setting lives in this browser.',

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

    // --- Medals · one month, opened -------------------------------------------
    // The phone's `MonthMedalDetailView` / `MonthStepsCard` words.
    'achievements.month.open': 'Open {period}',
    'achievements.month.back': '← All medals',
    'achievements.month.notFound.title': 'No monthly medal for {period}',
    'achievements.month.notFound.hint':
      'The phone works the medals out and uploads them; the list it sent has none for this month.',
    'achievements.month.total': 'Steps, as earned',
    'achievements.month.perDay': 'A day, over the whole month',
    'achievements.month.milestonesReached': 'Milestones reached',
    'achievements.month.milestones.title': 'Milestones',
    'achievements.month.steps': '{steps} steps',
    'achievements.month.days.title': 'Day by day',
    'achievements.month.days.perDay': '{steps} steps a day on average over the whole month.',
    'achievements.month.days.measured.one': '{steps} a day counting only the {n} day that was measured.',
    'achievements.month.days.measured.other': '{steps} a day counting only the {n} days that were measured.',
    'achievements.month.days.best': 'The strongest day: {day} — {steps} steps.',
    'achievements.month.days.goal': 'A solid column is a day that reached the daily target of {steps} steps.',
    'achievements.month.days.loading': 'Loading the days…',
    'achievements.month.days.error': 'The daily breakdown did not load: {error}',
    'achievements.month.days.empty': 'No day of this month brought a step measurement.',
    'achievements.month.textOnly.title': 'The month',
    'achievements.month.textOnly.body':
      'This medal did not keep the milestones it was earned with, so they cannot be shown for it.',
    'achievements.month.foot.locked':
      'The numbers are the ones the medal was earned with — changing a milestone today does not rewrite them.',
    'achievements.month.foot.fresh':
      'The day-by-day breakdown is read fresh each time: it is the one thing a medal does not store.',
    // --- Data completeness -------------------------------------------------
    'coverage.title': 'Data completeness',
    'coverage.subtitle': 'Which of your measurements are arriving here, and who writes them.',
    // ⚠️ Worded so that no number needs a suffix — the same reason the app's
    // headline is (Hungarian suffix harmony follows the last spoken part of the
    // numeral, so there is no single correct constant).
    'coverage.headline': '{measured} of the {total} types examined brought data in the last {days} days.',
    'coverage.window.30': '30 days',
    'coverage.window.90': '90 days',
    'coverage.window.365': 'A year',
    'coverage.window.aria': 'Length of the examined period',
    // The honesty note. It is not a caveat that can be dropped once the page is
    // familiar: the page's central claim is a distinction, and this is where the
    // limits of that distinction are stated.
    'coverage.limits.title': 'What this page can and cannot tell you',
    'coverage.limits.body':
      'This is what has arrived at the server. It cannot see permissions: a type you never granted, a type with no sensor behind it, and a type the phone failed to upload all look the same from here — as an absence. The app on your phone can tell those apart, and it says so per type.',
    'coverage.state.measured': 'There is data',
    'coverage.state.outside_window': 'Nothing in this period',
    'coverage.state.never_arrived': 'Nothing has ever arrived',
    'coverage.col.metric': 'Metric',
    'coverage.col.state': 'State',
    'coverage.col.days': 'Days measured',
    'coverage.col.samples': 'Samples',
    'coverage.col.last': 'Last arrival',
    'coverage.col.sources': 'Written by',
    'coverage.group.count': '{measured} of {total} bring data',
    'coverage.group.empty': 'Nothing in this area has ever arrived here.',
    'coverage.notInCatalog': 'not in the catalogue',
    'coverage.notInCatalogTitle':
      'This type arrived but the catalogue does not know it — probably from a newer iOS release. It is listed rather than dropped.',
    'coverage.device.watch': 'watch',
    'coverage.device.iphone': 'phone',
    'coverage.device.unknown': 'device not stated',
    'coverage.device.unknownTitle':
      'The upload did not say which device this came from. That means exactly that — not that the phone measured it.',
    // The gaps section. An observation, never an alarm: we say what we saw and
    // stop there, because a flat battery, a holiday and a broken sensor all look
    // identical from here.
    'coverage.gaps.title': 'Stopped arriving',
    'coverage.gaps.body':
      'These used to arrive in a rhythm, and the rhythm has broken. That is an observation, not a fault — we do not know why, and there may be no reason worth knowing.',
    'coverage.gaps.silent.one': 'nothing for {n} day',
    'coverage.gaps.silent.other': 'nothing for {n} days',
    'coverage.gaps.cadence': 'until now it arrived roughly {cadence}',
    'coverage.cadence.daily': 'daily',
    'coverage.cadence.everyOtherDay': 'every other day',
    'coverage.cadence.weekly': 'weekly',
    'coverage.cadence.fortnightly': 'every fortnight',
    'coverage.cadence.everyNDays': 'every {n} days',
    'coverage.empty.title': 'Nothing has arrived yet',
    'coverage.empty.hint':
      'Not one of the catalogue’s types has reached this server. If the phone is uploading, the first sync may still be running.',

    // --- Ingest queue ------------------------------------------------------
    'ingest.title': 'Sync queue',
    'ingest.subtitle': 'What the phone has already handed over and the server has not written into the database yet. Once the phone hands a part over, its job is done — this page is the part that happens after.',
    'ingest.checkedAt': 'Updated {time} · refreshes itself every 5 seconds',
    'ingest.stale.title': 'Could not refresh',
    'ingest.stale.body': 'What is shown below is the last successful reading (updated {time}).',
    'ingest.unreachable.title': 'The queue cannot be read right now',
    'ingest.unreachable.body': 'The server could not reach its queue (RabbitMQ), so there are no numbers to show — not zero, none. While this lasts, the server refuses uploads too.',
    'ingest.unreachable.detail': 'The error: {error}',
    'ingest.dlq.title.one': '{n} part could not be written and is set aside',
    'ingest.dlq.title.other': '{n} parts could not be written and are set aside',
    'ingest.dlq.body': 'Nothing retries them on its own, and the phone has already moved on, so this data is not in the database yet.',
    'ingest.noConsumer.title': 'Parts are waiting and nothing is writing them',
    'ingest.noConsumer.body': 'This looks like slowness and is not: the queue will not shrink at all until a worker runs. Check the worker container ({ps}, {logs}).',
    'ingest.noWorkerIdle.title': 'No worker connected',
    'ingest.noWorkerIdle.body':
      'The queue is empty right now, but nothing will process the next upload until the worker runs.',
    'ingest.eta': 'About {duration} left.',
    'ingest.eta.note':
      'An estimate for the current backlog, if nothing more arrives: the waiting parts (plus the most that can be in progress) divided by the rate of the last few minutes. Parts are not the same size, and a new upload adds to the queue without changing this figure until it is read again.',
    'ingest.stalled.one':
      'Batches are waiting, but none finished in the last {n} minute — there is no rate to estimate from.',
    'ingest.stalled.other':
      'Batches are waiting, but none finished in the last {n} minutes — there is no rate to estimate from.',
    'ingest.stalled.since':
      'Parts are waiting, and the last one finished {when} — nothing has finished since, so there is no current rate to estimate from.',
    'ingest.rateUnknown':
      'A worker is connected, but its counters cannot be read (Redis did not answer, or this worker is too old to report them) — so whether the queue is moving is not known. That is not the same as “not moving”.',
    'ingest.settling':
      'Nothing is waiting for delivery. The worker may still be finishing up to {n} parts it has already taken; this page says “nothing left to write” once nothing has finished for 30 seconds.',
    'ingest.settling.noBound':
      'Nothing is waiting for delivery. The worker may still be finishing parts it has already taken; this page says “nothing left to write” once nothing has finished for 30 seconds.',
    'ingest.idle':
      'Nothing left to write: nothing is waiting, and nothing has finished for at least 30 seconds, so the worker is not holding a part.',
    'ingest.idle.noWorker':
      'Nothing is waiting, and with no worker connected nothing can be half-written: a part a worker held goes back to the queue when it disconnects.',
    'ingest.stat.waiting': 'Waiting',
    'ingest.stat.inFlight': '+ up to {n} in progress',
    'ingest.stat.deadLetter': 'Dead-letter queue',
    'ingest.stat.consumers': 'Workers connected',
    'ingest.stat.batchesPerMin': 'Batches / min',
    'ingest.stat.itemsPerMin': 'Items / min',
    'ingest.window.one': 'Rates over the last {n} minute.',
    'ingest.window.other': 'Rates over the last {n} minutes.',
    'ingest.worker.title': 'Worker',
    'ingest.worker.started': 'Started',
    'ingest.worker.lastBatch': 'Last batch processed',
    'ingest.worker.batches': 'Batches since start',
    'ingest.worker.items': 'Items since start',
    'ingest.worker.failed': 'Batches given up since start',
    'ingest.worker.itemsNote':
      'An item is a sample, workout, sleep segment, activity summary or deletion. Received, not necessarily new: the writes are idempotent.',
    'ingest.worker.none': 'No worker of this version has reported yet.',
    'ingest.stats.unreachable.title': 'The worker’s counters cannot be read',
    'ingest.stats.unreachable.body':
      'The rate, the estimate and the time of the last batch are unknown because Redis did not answer. The queue depth is still exact.',

    // --- Navigation groups -------------------------------------------------
    // The headings make a claim about what belongs together, which is why two of
    // them are the app's band names word for word (`DashboardBand.title`). If
    // the two drift apart, the same content ends up with two names.
    'nav.aria': 'Sections',
    'nav.group.longView': 'The long view',
    'nav.group.areas': 'Areas',
    'nav.group.status': 'Status',
    // The button that opens the same list in the bar layout. One word in both
    // states — `aria-expanded` and the chevron say which one it is in, and a
    // label that changes to "Close" makes the button move under the finger.
    'nav.menu': 'Menu',

    // --- The bands of the Today page ---------------------------------------
    // The explanations are the app's own `DashboardBand.explanation` lines.
    'today.band.today': 'Today, about you',
    'today.band.today.hint': 'Today’s measurements, to read.',
    'today.band.longView.hint': 'Weeks and months — what a single day cannot show.',
    'today.band.status.hint': 'Whether the thing that moves your data is working.',

    // --- The cards of the Today page ---------------------------------------
    'today.workout.title': 'Latest workout',
    'today.workout.empty': 'No workout has arrived yet.',
    'today.sleep.title': 'Last night',
    'today.sleep.titleLatest': 'Latest sleep',
    'today.sleep.empty': 'No sleep segment has arrived for the last two days.',
    'today.sync.title': 'Sync',
    'today.insights.serverLanguage':
      'The server composes these sentences, in the language it speaks.',
    'today.insights.more.one': 'and {n} more observation',
    'today.insights.more.other': 'and {n} more observations',
    'today.medals.newest': 'Most recently: {badge} · {period}',
    'today.medals.newest.noPeriod': 'Most recently: {badge}',
    'today.coverage.gaps.one': '{n} measurement has broken its rhythm.',
    'today.coverage.gaps.other': '{n} measurements have broken their rhythm.',
    'today.coverage.noGaps': 'No measurement has broken its rhythm.',
    // A card's failure is one line, because a 401 takes the whole page: only one
    // endpoint having a bad day ever reaches this.
    'today.cardError': 'Could not be loaded: {reason}',

    // --- The sidebar: the queue badge and the footer ---------------------------
    'nav.badge.waiting.one': '{n} part waiting to be written',
    'nav.badge.waiting.other': '{n} parts waiting to be written',
    'nav.badge.setAside.one': '{n} part set aside — needs a look',
    'nav.badge.setAside.other': '{n} parts set aside — need a look',
    'nav.badge.unknown': 'The queue cannot be read right now',
    'nav.serverAria': 'This server and the time zone the pages are cut in',

    // --- Today: tiles, the queue pill, the sync card ---------------------------
    'today.tile.soFar': 'So far today',
    'today.tile.average': 'Today’s average',
    'today.tile.notMeasured': 'Not measured today yet',
    'today.sleep.asleep': 'asleep',
    'today.sleep.noStages':
      'This night has no sleep stages — the device recorded only asleep or awake.',
    'today.sleep.notRecorded': 'Sleep duration not recorded',
    'today.sleep.inBedOnly':
      'Only time in bed arrived ({duration}), with no asleep segment — so how long you slept is not known, not zero.',
    'today.challenge.steps': 'steps',
    'today.challenge.allMilestones': 'all {n} milestones reached',
    'today.medals.earned.one': 'earned',
    'today.medals.earned.other': 'earned',
    'today.pill.upToDate': 'Up to date — nothing left to write',
    'today.pill.writing': 'Writing queued parts',
    'today.pill.writingEta': 'Writing queued parts · about {duration} for the current backlog',
    'today.pill.stalled': 'Parts are waiting and nothing finished recently',
    'today.pill.noConsumer': 'Parts are waiting and nothing is writing them',
    'today.pill.rateUnknown': 'Parts are waiting · progress cannot be read',
    'today.pill.settling': 'Nothing waiting · the worker may still be finishing up to {n}',
    'today.pill.settling.noBound': 'Nothing waiting · the worker may still be finishing up',
    'today.pill.setAside.one': '{n} part could not be written',
    'today.pill.setAside.other': '{n} parts could not be written',
    'today.pill.unknown': 'The queue cannot be read right now',
    'today.pill.apiOld': 'The server is older than this page',
    'today.sync.lastSeen': 'Device last seen {when}: {device}',
    'today.sync.writing.one': 'The queue holds {n} part waiting to be written',
    'today.sync.writing.other': 'The queue holds {n} parts waiting to be written',
    'today.sync.writingEta.one':
      'The queue holds {n} part waiting to be written · about {duration} for the current backlog, if nothing more arrives',
    'today.sync.writingEta.other':
      'The queue holds {n} parts waiting to be written · about {duration} for the current backlog, if nothing more arrives',
    'today.sync.stuck.one': 'The queue holds {n} part, and nothing has finished recently',
    'today.sync.stuck.other': 'The queue holds {n} parts, and nothing has finished recently',
    'today.sync.rateUnknown.one': 'The queue holds {n} part; whether it is moving cannot be read',
    'today.sync.rateUnknown.other':
      'The queue holds {n} parts; whether they are moving cannot be read',
    'today.sync.allWritten': 'Nothing left to write in the queue.',

    // --- Trends: the redesigned chart card -------------------------------------
    'trends.periodAria': 'Period',
    'trends.total': 'Total',
    'trends.perDay': 'A day · over {n} measured days',
    'trends.perMonth': 'A month · over {n} measured months',
    'trends.legend.usualRange': 'your usual range',
    'trends.legend.average': 'your average',
    'trends.sources.title': 'Where these numbers come from',
    'trends.sources.body':
      'When more than one device or app recorded the same hour, that hour counts once: the largest of them wins. The Health app merges sources more finely, so the server can read a little above what the phone shows.',
    'picker.searchLabel': 'Search {n} measurements',
    'picker.groupLabel': 'Group',
    'picker.placeholder': 'Steps, heart rate…',

    // --- Workouts: master/detail, filters, rows --------------------------------
    'workouts.detailAria': 'The selected workout',
    'workouts.listAria': 'Workout list',
    'workout.route.toSettings': 'Show a map underneath — Settings',
    'workout.hr.highest': 'Highest',
    'workout.weather.note': 'As the recording app wrote it with the session.',
    'workouts.filter.type': 'Type',
    'workouts.filter.allTypes': 'All types',
    'workouts.filter.typesChosen.one': '{n} type',
    'workouts.filter.typesChosen.other': '{n} types',
    'workouts.filter.where': 'Where',
    'workouts.filter.atLeast': 'At least',
    'workouts.filter.anyLength': 'any length',
    'workouts.filter.more': 'More filters',
    'workouts.row.dup.aria': 'Possibly recorded {n} times in Health',
    'workouts.row.open': 'Open',
    'workouts.select.hint': 'Choose a workout from the list.',
    'workouts.row.max': 'max',

    // --- Sync queue: the redesigned page, set-aside reasons and the retry ------
    'ingest.unreachable.lastGood': 'Last successful reading: {time}.',
    'ingest.apiOld.title': 'This server’s API is older than this web page',
    'ingest.apiOld.body':
      'The page asked the server for something it does not know yet. That happens when the web image is updated before the backend image. Update the server, then reload this page:',
    'ingest.apiOld.tech':
      'Technically: the API answered 404 to a route this page relies on, while the rest of it works.',
    'ingest.hero.waiting': 'Waiting to be written',
    'ingest.hero.parts.one': 'part',
    'ingest.hero.parts.other': 'parts',
    'ingest.hero.tech': 'batches in {name}',
    'ingest.hero.etaLabel': 'For the current backlog, if nothing more arrives — an estimate',
    'ingest.hero.eta': 'about {duration}',
    'ingest.hero.nothing': 'Nothing to wait for',
    'ingest.hero.notMoving': 'Not moving',
    'ingest.hero.noEstimate': 'no estimate',
    'ingest.hero.rateUnknown': 'Rate unknown',
    'ingest.hero.settling': 'Nothing waiting for delivery',
    'ingest.tile.rate': 'Rate',
    'ingest.tile.rateUnit': 'parts/min',
    'ingest.tile.itemsRate': '≈ {n} items a minute',
    'ingest.tile.noRate': 'Nothing finished in the window',
    'ingest.tile.worker': 'Worker',
    'ingest.worker.state.working': 'Working',
    'ingest.worker.state.waiting': 'Waiting',
    'ingest.worker.state.none': 'None',
    'ingest.worker.state.noRecent': 'Nothing finished recently',
    'ingest.worker.state.connected': 'Connected',
    'ingest.worker.state.finishing': 'May be finishing up',
    'ingest.worker.line.none': 'No worker is connected',
    'ingest.worker.line.connected.one': '{n} worker connected',
    'ingest.worker.line.connected.other': '{n} workers connected',
    'ingest.tile.last': 'Last written',
    'ingest.tile.lastNone': 'Nothing written since the worker started',
    'ingest.tile.setAside': 'Set aside',
    'ingest.tile.setAsideNote': 'Could not be written; not retried by itself',
    'ingest.tile.setAsideTech': 'the dead-letter queue',
    'ingest.since.title': 'Written since the worker started · {when}',
    'ingest.since.parts': 'parts',
    'ingest.since.items': 'items',
    'ingest.since.setAside': 'set aside',
    'ingest.dlq.tech':
      'Technically: RabbitMQ’s dead-letter queue, {name}. The full error of each part is in the worker’s log:',
    'ingest.dlq.resync':
      'If retrying does not help, a “Full resync” on the phone sends the same data again — the writes are idempotent, so nothing is stored twice.',
    'ingest.redrive.button.one': 'Retry {n} set-aside part',
    'ingest.redrive.button.other': 'Retry {n} set-aside parts',
    'ingest.redrive.buttonCapped': 'Retry {max} of {n} set-aside parts',
    'ingest.redrive.confirmAria': 'Confirm the retry',
    'ingest.redrive.confirm.one':
      'Retry {n} part? Writing is idempotent: anything already in the database is only updated.',
    'ingest.redrive.confirm.other':
      'Retry {n} parts? Writing is idempotent: anything already in the database is only updated.',
    'ingest.redrive.limit':
      'One retry moves at most {max} parts. If more are set aside, press again for the rest.',
    'ingest.redrive.confirmYes': 'Retry',
    'ingest.redrive.cancel': 'Cancel',
    'ingest.redrive.running': 'Retrying…',
    'ingest.redrive.result':
      'Moved {moved} back to the queue · {remaining} still set aside',
    'ingest.redrive.resultUnknown':
      'Moved {moved} back to the queue · how many are still set aside could not be read',
    'ingest.redrive.stopped':
      'It stopped part-way: {reason}. The count above includes only the parts confirmed moved. Unless the reason says otherwise, the part being moved at that moment stayed set aside; if it says the part is now in both queues, that copy is harmless — writing is idempotent.',
    'ingest.redrive.repeated.one':
      '{n} of them is now on its third retry or later — the earlier retries did not help, so this one is unlikely to either until the cause is fixed.',
    'ingest.redrive.repeated.other':
      '{n} of them are now on their third retry or later — the earlier retries did not help, so this one is unlikely to either until the cause is fixed.',
    'ingest.redrive.watch':
      'They are back in the queue, behind whatever was already waiting; when they are written depends on the worker and the backlog above. A part that fails on its content will come back here — this page refreshes itself.',
    'ingest.redrive.busy':
      'A retry is already running. Wait for it to finish, then look again.',
    'ingest.redrive.brokerDown': 'RabbitMQ could not be reached, so nothing was moved.',
    'ingest.redrive.failed': 'The server refused the retry, so nothing was moved: {reason}',
    'ingest.redrive.unknown':
      'No answer arrived, so whether the retry ran is not known ({reason}). The set-aside count is being read again — check it before pressing again.',
    'ingest.redrive.tooOld':
      'Retrying from this page needs a newer server API. Update the server ({cmd}) and reload.',
    'ingest.reasons.title': 'Recent failures — a log, not the queue',
    'ingest.reasons.hint':
      'The worker’s record of the parts it set aside lately, newest first. An entry stays after its part was retried, and a part set aside by an older worker has no entry — so this does not say which parts are set aside now.',
    'ingest.reason.transient':
      'The database or the network was not available at that moment — a retry usually goes through.',
    'ingest.reason.rejected':
      'The database refused what was in it — retrying the same part will fail again until the cause is fixed.',
    'ingest.reason.undecodable': 'The worker could not read this part at all.',
    'ingest.reason.other': 'The worker could not write it.',
    'ingest.reason.items.one': '{n} item',
    'ingest.reason.items.other': '{n} items',
    'ingest.reason.samples.one': '{n} sample',
    'ingest.reason.samples.other': '{n} samples',
    'ingest.reason.workouts.one': '{n} workout',
    'ingest.reason.workouts.other': '{n} workouts',
    'ingest.reason.sleep.one': '{n} sleep segment',
    'ingest.reason.sleep.other': '{n} sleep segments',
    'ingest.reason.activity.one': '{n} activity summary',
    'ingest.reason.activity.other': '{n} activity summaries',
    'ingest.reason.deletions.one': '{n} deletion',
    'ingest.reason.deletions.other': '{n} deletions',
    'ingest.reason.repeated': 'Failed again after {n} retries',
    'ingest.reason.raw': 'The worker’s message',
    'ingest.reason.batch': 'Batch {id}',
    'ingest.reason.lastRedrive': 'Last retry finished {when}: {moved} moved back.',
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
  // ⚠️ The wire vocabulary is the SHORT one the phone writes
  // (`HealthKitMapping.workoutName`): running · walking · cycling · swimming ·
  // hiking · yoga · strength · hiit · other. The long HealthKit spellings below
  // never travel; `strength` and `hiit` do, and until they were added here the
  // page printed the raw wire tokens at the reader.
  activity: {
    running: 'Running',
    strength: 'Strength',
    hiit: 'HIIT',
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
    // ⚠️ These fifteen are in the server catalog (and in the app's) but NOT in
    // `lib/metrics.ts` — the web catalog stopped at 105 types while the other two
    // grew to 120. The names are here so that the completeness page, which lists
    // every type the server knows, does not print machine-generated English at a
    // Hungarian reader. `numberOfAlcoholicBeverages` is the one that already has
    // real data behind it, so it was the visible half of the drift.
    distanceCrossCountrySkiing: 'Cross-country skiing distance',
    distancePaddleSports: 'Paddle sports distance',
    distanceRowing: 'Rowing distance',
    distanceSkatingSports: 'Skating distance',
    cyclingCadence: 'Cycling cadence',
    cyclingPower: 'Cycling power',
    cyclingFunctionalThresholdPower: 'Functional threshold power',
    cyclingSpeed: 'Cycling speed',
    crossCountrySkiingSpeed: 'Cross-country skiing speed',
    paddleSportsSpeed: 'Paddle sports speed',
    rowingSpeed: 'Rowing speed',
    workoutEffortScore: 'Workout effort',
    estimatedWorkoutEffortScore: 'Estimated workout effort',

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
    appleSleepingBreathingDisturbances: 'Breathing disturbances',

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
    numberOfAlcoholicBeverages: 'Alcoholic drinks',
  },
}
