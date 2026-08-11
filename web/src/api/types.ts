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
