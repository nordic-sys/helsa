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

/** RFC 9457 problem+json — this is how the backend returns every error. */
export type Problem = {
  type?: string
  title?: string
  status?: number
  detail?: string
}

export type Range = 'day' | 'week' | 'month' | 'year'

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
