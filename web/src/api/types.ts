// Types mapped by hand from the backend's OpenAPI contract
// (backend/api/openapi.yaml). `npm run gen:api` also generates the full schema
// (src/api/schema.d.ts), but the views use this narrow, readable set — that way a
// contract change surfaces as a compile error rather than at runtime.

export type Bucket = {
  t: string
  v?: number
  avg?: number
  min?: number
  max?: number
}

export type MetricSeries = {
  agg?: 'sum' | 'avg'
  unit?: string
  total?: number
  buckets?: Bucket[]
}

export type SummaryResponse = {
  range?: string
  from?: string
  to?: string
  tz?: string
  metrics?: Record<string, MetricSeries>
}

export type ActivitySummary = {
  day?: string
  active_energy?: number
  active_energy_goal?: number
  exercise_minutes?: number
  exercise_goal?: number
  stand_hours?: number
  stand_goal?: number
}

export type Workout = {
  id?: string
  source_uuid?: string
  activity_type?: string
  started_at?: string
  ended_at?: string
  total_energy_kcal?: number
  total_distance_m?: number
  avg_heart_rate?: number
  max_heart_rate?: number
  /** Whatever the recording app wrote alongside the workout. The one key the web
   * reads is `indoor` (see `lib/workouts.ts`); everything else travels but is not
   * interpreted, because it is another app's vocabulary. */
  metadata?: Record<string, unknown>
}

export type WorkoutPage = {
  items?: Workout[]
  next_cursor?: string | null
}

/**
 * One GPS fix of a workout's route (`GET /workouts/{id}/route`).
 *
 * ⚠️ `altitude_m`, `speed_mps` and `accuracy_m` may be absent, and 0 is a REAL
 * value for all three — sea level, a full stop, a perfect fix. The contract says
 * so explicitly (openapi.yaml, `RoutePoint`), because the phone had to strip
 * CoreLocation's "-1 means invalid" convention before uploading: a −1 stored as a
 * number is a lie nothing downstream can recognise as missing.
 */
export type RoutePoint = {
  ts?: string
  lat: number
  lon: number
  altitude_m?: number
  speed_mps?: number
  /** Horizontal error in metres — what lets the drawing throw the junk away. */
  accuracy_m?: number
}

/** ⚠️ An empty `points` is a **full answer**, not a 404: an indoor workout has no
 * route, and neither does anything recorded before route support. */
export type WorkoutRoute = {
  points?: RoutePoint[]
}

/**
 * A raw sample (`GET /samples`).
 *
 * ⚠️ Newest first. Anything that draws a line out of these has to sort them, or
 * the line runs backwards.
 */
export type Sample = {
  ts?: string
  data_type?: string
  value?: number
  unit?: string
  source_device?: string
}

export type SamplePage = {
  items?: Sample[]
  next_cursor?: string | null
}

export type SleepSegment = {
  started_at?: string
  ended_at?: string
  stage?: string
}

export type Goal = {
  metric?: 'stepCount' | 'activeEnergy' | 'exerciseTime' | 'standHours'
  target_value?: number
  unit?: string
  source?: 'healthkit' | 'user'
  hk_value?: number | null
  updated_at?: string
}

export type Device = {
  id?: string
  platform?: string
  model?: string
  name?: string
  time_zone?: string
  last_seen_at?: string
}

export type Settings = {
  time_zone?: string
  locale?: 'hu' | 'en'
  unit_system?: 'metric' | 'imperial'
  /**
   * The three blocks below are decisions made ON THE PHONE and uploaded by it
   * (app 1.0 (7) on). ⚠️ An ABSENT block means "this server has not been told" —
   * an older phone, an older server, or no phone at all — and a page must say so
   * rather than show a default as if it were the user's.
   */
  challenge?: ChallengeSettings
  hydration?: HydrationSettings
  journey?: JourneySettings
}

export type ChallengeSettings = {
  /** Absent: the phone is on its factory row. Empty: every milestone deleted. */
  thresholds?: number[]
  /** The chosen rest days, as `YYYY-MM-DD` day keys. */
  rest_days?: string[]
  /** When the phone last sent this block. */
  updated_at?: string
}

export type HydrationSettings = {
  /** The goal the user CHOSE. Absent inside a sent block: none of their own —
   * the phone then offers a body-mass suggestion it never stores or sends. */
  goal_ml?: number
  updated_at?: string
}

export type JourneySettings = {
  /** Both or neither; neither = no journey running. */
  route_id?: string
  started_on?: string
  updated_at?: string
}

// --- Data completeness (GET /v1/coverage) ---------------------------------
//
// ⚠️ The three states are the SERVER's, and they are deliberately not the app's
// five. The phone knows about permissions and can tell "the read ran and nothing
// came" from "the system will still ask" from "HealthKit refused it"; none of
// that reaches the server, where a refused type and a missing sensor look
// identical. So the words are different on purpose — see the endpoint's
// description in `backend/api/openapi.yaml`.
export type CoverageState =
  /** Something arrived within the window. */
  | 'measured'
  /** Nothing within the window, but this type HAS reached the server before. */
  | 'outside_window'
  /** No sample of this type has ever reached this server. */
  | 'never_arrived'

/** The catalog groups in the APP's vocabulary — `nutritionMacro`, not `macro`. */
export type CoverageGroup =
  | 'activity'
  | 'heart'
  | 'respiratory'
  | 'body'
  | 'nutritionMacro'
  | 'nutritionMineral'
  | 'nutritionVitamin'
  | 'mobility'
  | 'environment'
  | 'other'

/** Which app wrote it, and on what kind of device the client said it ran. */
export type CoverageSource = {
  bundle_id?: string
  device?: 'watch' | 'iphone'
  sample_count?: number
  last_day?: string
}

/** A metric that had a rhythm, and the rhythm has broken. An observation, not a problem. */
export type CoverageGap = {
  silent_days?: number
  typical_interval_days?: number
  observed_intervals?: number
  history_days?: number
}

export type CoverageType = {
  data_type?: string
  group?: CoverageGroup
  in_catalog?: boolean
  state?: CoverageState
  /** ⚠️ ABSENT, never 0, when nothing arrived. The difference is the whole feature. */
  measured_days?: number
  sample_count?: number
  last_day?: string
  sources?: CoverageSource[]
  gap?: CoverageGap
}

export type CoverageResponse = {
  from?: string
  to?: string
  tz?: string
  days?: number
  types?: CoverageType[]
}

/** RFC 9457 problem+json — this is how the backend returns every error. */
export type Problem = {
  type?: string
  title?: string
  status?: number
  detail?: string
}

export type Range = 'day' | 'week' | 'month' | 'year'

// --- Insights and achievements ----------------------------------------------

export type InsightKind = 'trend' | 'anomaly' | 'correlation' | 'pattern'
export type InsightSeverity = 'info' | 'notice'

/**
 * A rule-based observation. There is no model behind it: a rolling average, a
 * z-score and a Pearson correlation (openapi.yaml, `/insights`).
 *
 * ⚠️ `rule` + `values` is the statement: the web words the sentence itself, in
 * the interface language (`lib/insightText.ts`, a port of the app's composer).
 * `title` and `detail` are the server's Hungarian FALLBACK, printed only for a
 * rule this build does not know or a value set that cannot carry the sentence.
 */
export type Insight = {
  id?: string
  kind?: InsightKind
  metric?: string
  rule?: string
  values?: Record<string, number>
  title?: string
  detail?: string
  severity?: InsightSeverity
  generated_at?: string
}

export type AchievementKind = 'month' | 'year' | 'streak' | 'record' | 'milestone'

/**
 * A badge is a HISTORICAL FACT: the record of a condition met at a given moment.
 * That is why `value` and `thresholds` travel with it — the thresholds are a
 * snapshot of what was in force when it was earned, so a month completed long
 * ago cannot "degrade back" when the user rewrites their targets.
 */
export type Achievement = {
  id?: string
  kind?: AchievementKind
  code?: string
  /** `YYYY-MM` or `YYYY`, when the badge belongs to a calendar period. */
  period?: string
  value?: number
  unit?: string
  thresholds?: number[]
  earned_at?: string
}

/**
 * The ranges that can carry a usual range. The reference is always DAILY, so a
 * band drawn under the hourly buckets of `day` or the monthly ones of `year` would
 * compare quantities that differ by a factor of 24 or 30 — for a summed metric it
 * would be wrong by exactly that much. The contract offers these two only.
 */
export type BaselineRange = Extract<Range, 'week' | 'month'>

/**
 * Where a period stands against the person's own usual — five levels.
 *
 * ⚠️ A token, not a sentence, and not a grade: the server sends the position, the
 * client words it (the same division of labour as `Insight.rule`).
 */
export type Standing = 'wellBelow' | 'below' | 'typical' | 'above' | 'wellAbove'

/**
 * One metric's usual range: the middle of the person's own last 60 days, and where
 * the period being looked at sits against it.
 *
 * ⚠️ **Everything but `day_count` is optional, and the absence is the answer** —
 * too few measured days, or a reference window that never varied, means there is
 * no band. It does not mean zero.
 */
export type MetricBaseline = {
  agg?: 'sum' | 'avg'
  unit?: string
  /** How many reference days carried a measurement. Worth naming on screen: a
   * band resting on 14 days and one resting on 60 are not equally strong claims. */
  day_count?: number
  mean?: number
  /** The sample standard deviation (n-1) of those days. */
  sd?: number
  /** `mean − sd` */
  low?: number
  /** `mean + sd` */
  high?: number
  /** The period's average measured DAY — not its total. */
  period_value?: number
  standing?: Standing
}

export type BaselineResponse = {
  range?: string
  tz?: string
  from?: string
  to?: string
  reference_from?: string
  reference_to?: string
  /** 60 — how far the reference window reaches back. */
  reference_days?: number
  /** 14 — how many measured days a band needs. It arrives from the server so that
   * the web does not keep a third copy of the number. */
  min_days?: number
  metrics?: Record<string, MetricBaseline>
}

// --- The monthly challenge (GET /v1/challenge) -----------------------------
//
// ⚠️ Note which fields are optional, and why. `steps`, `percent` and the rest of
// the derived numbers are ABSENT when not one day of the month carried a
// measurement — the backend refuses to send a 0 for "nothing has arrived yet",
// and the page must not put one back.

export type ChallengeMilestone = {
  steps: number
  /** Exactly at the threshold counts as reached; nothing is reached without data. */
  reached: boolean
}

/** One day of the month. `steps` absent = a gap, not a day of sitting still. */
export type ChallengeDay = {
  day: string
  steps?: number
}

export type ChallengeStreakBreak = {
  /** `rest_over_budget`: a day marked as a rest day after the weekly allowance
   * (two in any seven days) was spent. Only from servers that read the phone's
   * rest days. */
  reason: 'missed' | 'no_data' | 'rest_over_budget' | 'start_of_history'
  day?: string
}

export type ChallengeStreak = {
  daily_goal?: number
  length: number
  active_days: number
  longest: number
  broken_by?: ChallengeStreakBreak
  window_from: string
  window_to: string
  /**
   * What the server cannot see: `illness_days` always (the journal stays on the
   * phone), `chosen_rest_days` until the phone has uploaded them. Whatever is
   * listed makes this streak a LOWER BOUND on the one in the app — which the page
   * has to say out loud.
   */
  missing_inputs: string[]
  /** Chosen rest days inside the current run. ⚠️ Optional HERE although the
   * contract requires it: a server older than the field does not send it, and
   * the page must not read its absence as "you took none". */
  chosen_rest_days?: number
  /** The chosen rest days of the current run, newest first. Same caveat. */
  rest_days?: string[]
}

export type Challenge = {
  month: string
  tz: string
  days_in_month: number
  days_elapsed: number
  days_remaining: number
  steps?: number
  steps_per_day?: number
  measured_days: number
  goal?: number
  percent?: number
  complete: boolean
  remaining_steps?: number
  overshoot_steps?: number
  next_threshold?: number
  steps_to_next_threshold?: number
  thresholds: ChallengeMilestone[]
  /** Where the milestones came from: the request, the phone's uploaded settings,
   * a badge's snapshot, or our factory row. */
  thresholds_source: 'request' | 'settings' | 'achievement' | 'default'
  days: ChallengeDay[]
  streak: ChallengeStreak
}

// --- Ingest queue (GET /v1/ingest/status) ---------------------------------
//
// Every block is present only when it was measured: `queue`/`dead_letter` are
// absent when the API could not reach RabbitMQ, `worker`/`throughput` when the
// worker's counters (Redis) could not be read. Never fill them in with zeros.

export type IngestQueueDepth = {
  name: string
  /** Waiting to be handed to a worker — exact. */
  ready: number
  consumers: number
  /** Upper bound of batches a worker holds unacknowledged (prefetch × consumers). */
  in_flight_max?: number
}

/**
 * One dead-lettered batch, as the worker logged it. Counts and a sanitised error
 * only — never a value from the batch.
 *
 * ⚠️ A LOG, not the queue's contents: an entry outlives its batch's redrive, and
 * a batch parked by an older worker has no entry at all.
 */
export type IngestFailure = {
  batch_id?: string
  failed_at: string
  /** ≤ 300 chars; numbers and quoted strings blanked to `#` and `"…"`. */
  error: string
  items: number
  samples: number
  workouts: number
  sleep_segments: number
  activity_summaries: number
  deletions: number
  /** How many times the batch had been redriven before this failure. */
  redriven: number
}

/** The most recent redrive that moved at least one batch (kept 30 days). */
export type IngestLastRedrive = { at: string; moved: number }

export type IngestDeadLetter = {
  name: string
  ready: number
  /** Newest first, ≤ 20, 30 days. Absent when none or unreadable. */
  recent_failures?: IngestFailure[]
  last_redrive?: IngestLastRedrive
}

/** The answer of `POST /ingest/dead-letter/redrive`. */
export type IngestRedriveResult = {
  /** Exact: confirmed on the main queue and gone from the dead-letter queue. */
  moved: number
  /** The dead-letter depth afterwards — ABSENT if it could not be read, never 0 by default. */
  remaining?: number
  max_redriven: number
  /** Moved batches now redriven 3+ times: they failed again after earlier retries. */
  repeated: number
  /** Set when the run stopped before its count: why. A partial success. */
  stopped_early?: string
}

export type IngestWorkerStats = {
  started_at?: string
  last_batch_at?: string
  prefetch?: number
  batches_since_start?: number
  items_since_start?: number
  failed_since_start?: number
}

export type IngestThroughput = {
  window_seconds: number
  batches: number
  items: number
  failed: number
  batches_per_minute?: number
  items_per_minute?: number
}

export type IngestStatus = {
  checked_at: string
  broker_reachable: boolean
  broker_error?: string
  queue?: IngestQueueDepth
  dead_letter?: IngestDeadLetter
  stats_reachable: boolean
  worker?: IngestWorkerStats
  throughput?: IngestThroughput
  /** An ESTIMATE; absent when there is nothing to estimate from. */
  eta_seconds?: number
}

// --- GET /v1/workout-intensity (training progress, zone 3+) -----------------

export type HeartRateMaximum = {
  /** The second-highest per-session maximum of the look-back. */
  bpm: number
  /** How many sessions with a usable maximum it was taken from. */
  workouts: number
  zone3_threshold_bpm: number
}

export type WorkoutIntensityItem = {
  id: string
  /** `null` = fewer than two heart-rate samples in the window — unmeasured,
   * not zero hard minutes. */
  seconds: number | null
}

export type WorkoutIntensity = {
  zone3_fraction: number
  lookback_days: number
  minimum_workouts: number
  max_gap_seconds: number
  /** ABSENT when too few sessions recorded a maximum — there are no zones. */
  maximum?: HeartRateMaximum
  workouts: WorkoutIntensityItem[]
}

// --- GET /v1/latest — the newest measurement per type -----------------------

/**
 * One type's most recent measurement (openapi.yaml `LatestValue`).
 *
 * ⚠️ Exactly one of `value` and `day_total` is present, and the server picks
 * which from its own catalog: an averaged type gets the latest SAMPLE, a summed
 * type the source-merged total of the local day that sample fell on (the same
 * figure the day's `/summary` bucket carries). The last sample of a summed type
 * is a five-minute fragment, so the server does not send it at all.
 */
export type LatestValue = {
  agg: 'sum' | 'avg'
  unit?: string
  /** When the most recent sample was taken (an instant). */
  ts: string
  /** Its local calendar day in the response's `tz`. */
  day: string
  value?: number
  day_total?: number
}

export type LatestResponse = {
  tz: string
  /** A type that never reached the server is ABSENT — not zero, not empty. */
  metrics: Record<string, LatestValue>
}

// --- The phone's opt-in journal and events (`GET /journal`, openapi.yaml) ---
// The rules that read them are in `lib/journal.ts`.

export type JournalEntry = {
  source_uuid: string
  data_type: string
  started_at: string
  ended_at: string
  value?: number
  valence?: number
  mood_kind?: 'daily_mood' | 'momentary_emotion'
  labels?: string[]
  associations?: string[]
  event_key?: string
  follow_up_hours?: number
  workout_source_uuid?: string
  day_key?: string
  audio_level_dbaspl?: number
  source_device?: string
  source_bundle?: string
  user_entered?: boolean
}

export type JournalResponse = {
  tz: string
  from: string
  to: string
  entries: JournalEntry[]
  total: number
  last_received_at?: string | null
}
