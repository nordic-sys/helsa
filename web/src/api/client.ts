import type {
  Achievement,
  ActivitySummary,
  BaselineRange,
  BaselineResponse,
  Challenge,
  CoverageResponse,
  Device,
  Goal,
  IngestRedriveResult,
  IngestStatus,
  Insight,
  Range,
  Settings,
  SamplePage,
  SleepSegment,
  SummaryResponse,
  Workout,
  WorkoutPage,
  WorkoutRoute,
  WorkoutIntensity,
} from './types'

// Access is layered (docs/08-auth-hozzaferes.md):
//   1. network — the web is reachable over WireGuard ONLY; Caddy serves it on
//      :8443, which is deliberately NOT port-forwarded on the router;
//   2. application — a long-lived device token.
//
// There is no sign-in screen and no Sign in with Apple: in a single-user system
// there is nobody to sign in.
//
// Where the token comes from, in order: an httpOnly cookie (sent by the server,
// carried by fetch automatically) → localStorage (set by hand on a new machine).
const TOKEN_KEY = 'helsa.device_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t: string) {
  localStorage.setItem(TOKEN_KEY, t.trim())
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  detail?: string
  constructor(status: number, title: string, detail?: string) {
    super(title)
    this.status = status
    this.detail = detail
  }
}

const BASE = '/v1'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  })

  if (!res.ok) {
    // The backend returns RFC 9457 problem+json; if it does not, do not fall over.
    let title = `HTTP ${res.status}`
    let detail: string | undefined
    try {
      const p = await res.json()
      title = p.title ?? title
      detail = p.detail
    } catch {
      /* not JSON — the status stands */
    }
    throw new ApiError(res.status, title, detail)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') u.set(k, String(v))
  }
  const s = u.toString()
  return s ? `?${s}` : ''
}

export const api = {
  /**
   * `from`/`to` are inclusive calendar days. Without them the server picks the
   * window itself — the stretch ending today — which is one window, and Trends
   * needs several: the one being looked at, the one before it, and any earlier
   * one the reader steps back to. `range` still travels either way, because that
   * is what sets the bucket width.
   */
  summary: (range: Range, metrics: string[], tz?: string, from?: string, to?: string) =>
    req<SummaryResponse>(`/summary${qs({ range, metrics: metrics.join(','), tz, from, to })}`),

  // A sibling of summary rather than a flag on it: the usual range is computed
  // over a 60-day window of its own, whichever window the chart happens to show.
  //
  // ⚠️ Give it the same `from`/`to` as the chart. The server anchors its 60-day
  // reference window at the END of the period asked for, not at today — so when
  // you walk back, your usual range walks with you. Without them, a month in
  // 2024 would be told it was "above your usual" meaning above what is usual for
  // you *now*: a comparison across two years wearing the words of one.
  baseline: (
    range: BaselineRange,
    metrics: string[],
    tz?: string,
    from?: string,
    to?: string,
  ) =>
    req<BaselineResponse>(`/baseline${qs({ range, metrics: metrics.join(','), tz, from, to })}`),

  activity: (from?: string, to?: string, tz?: string) =>
    req<ActivitySummary[]>(`/activity${qs({ from, to, tz })}`),

  workouts: (limit = 50, cursor?: string) =>
    req<WorkoutPage>(`/workouts${qs({ limit, cursor })}`),

  /** One session, with the `metadata` object the recording app wrote — which is
   * where indoor/outdoor, the weather and the laps live (`WorkoutMetadata.swift`). */
  workout: (id: string) => req<Workout>(`/workouts/${encodeURIComponent(id)}`),

  /** A session's GPS route. A separate call on purpose: a three-hour hike is
   * points on the order of ten thousand, and no list should drag that along. */
  workoutRoute: (id: string) =>
    req<WorkoutRoute>(`/workouts/${encodeURIComponent(id)}/route`),

  /**
   * Raw samples of ONE type in a window.
   *
   * ⚠️ The parameter is `data_type`, not `type`. It is also **required** — the
   * server refuses an unfiltered scan of the hypertable — so it is a positional
   * argument here rather than an option.
   *
   * `from`/`to` are instants, not calendar days, and the window is half-open
   * `[from, to)`.
   */
  samples: (dataType: string, from?: string, to?: string, limit = 2000, cursor?: string) =>
    req<SamplePage>(`/samples${qs({ data_type: dataType, from, to, limit, cursor })}`),

  sleep: (from?: string, to?: string, tz?: string) =>
    req<SleepSegment[]>(`/sleep${qs({ from, to, tz })}`),

  coverage: (from?: string, to?: string, tz?: string) =>
    req<CoverageResponse>(`/coverage${qs({ from, to, tz })}`),

  /** The ingest queue: backlog, dead letters, drain rate. The page polls it. */
  ingestStatus: () => req<IngestStatus>('/ingest/status'),
  /**
   * Moves dead-lettered batches back onto the ingest queue.
   *
   * ⚠️ The web's one write, and it is not a write of health data: it asks the
   * server to put batches the phone ALREADY sent back in line. Nothing here
   * creates, edits or deletes a measurement — the read-only rule (docs/06) is
   * about the data, and the data is untouched. Without `max` the server moves
   * every batch waiting when the call starts, at most 1000.
   */
  redriveDeadLetters: (max?: number) =>
    req<IngestRedriveResult>('/ingest/dead-letter/redrive', {
      method: 'POST',
      ...(max != null
        ? { body: JSON.stringify({ max }), headers: { 'Content-Type': 'application/json' } }
        : {}),
    }),

  goals: () => req<Goal[]>('/goals'),

  devices: () => req<Device[]>('/devices'),

  settings: () => req<Settings>('/settings'),

  me: () => req<{ id?: string; display_name?: string }>('/me'),

  /**
   * Rule-based observations. **An empty list is a complete answer**, not a
   * failure: every rule has a data minimum, and until it is met the rule stays
   * out rather than inventing something (openapi.yaml, `/insights`).
   */
  insights: () => req<Insight[]>('/insights'),

  /** Earned badges, newest first. The web only ever reads this list. */
  achievements: () => req<Achievement[]>('/achievements'),
  /** The monthly step challenge. `month` is `YYYY-MM`; without it, the month the
   * time zone is in right now. */
  challenge: (month?: string, tz?: string) => req<Challenge>(`/challenge${qs({ month, tz })}`),

  /**
   * Seconds at or above heart-rate zone 3 for every workout that started in
   * `[from, to)` (instants), and the measured maximum they rest on. The server
   * runs the phone's `WorkoutIntensity` rules so the page does not walk
   * `/samples` once per workout.
   *
   * ⚠️ A 404 is version skew — an older server without the route — and the page
   * has to say so rather than show an error (`isApiTooOld`).
   */
  workoutIntensity: (from: string, to: string) =>
    req<WorkoutIntensity>(`/workout-intensity${qs({ from, to })}`),
}

/** The browser's time zone — for the timezone-aware aggregation (docs/03 §6.1). */
export function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
