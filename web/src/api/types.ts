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
  reason: 'missed' | 'no_data' | 'start_of_history'
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
   * What the server cannot see: `illness_days` and `chosen_rest_days`. Both make
   * a day neutral on the phone, so this streak is a LOWER BOUND on the one in the
   * app — which the page has to say out loud.
   */
  missing_inputs: string[]
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
  /** Where the milestones came from — the user's own phone, or our factory row. */
  thresholds_source: 'request' | 'achievement' | 'default'
  days: ChallengeDay[]
  streak: ChallengeStreak
}
