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
}

export type WorkoutPage = {
  items?: Workout[]
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
