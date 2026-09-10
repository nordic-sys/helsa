import type {
  Achievement,
  ActivitySummary,
  BaselineRange,
  BaselineResponse,
  Challenge,
  CoverageResponse,
  Device,
  Goal,
  Insight,
  Range,
  Settings,
  SleepSegment,
  SummaryResponse,
  WorkoutPage,
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
  summary: (range: Range, metrics: string[], tz?: string) =>
    req<SummaryResponse>(`/summary${qs({ range, metrics: metrics.join(','), tz })}`),

  // A sibling of summary rather than a flag on it: the usual range is computed
  // over a 60-day window of its own, whichever window the chart happens to show.
  baseline: (range: BaselineRange, metrics: string[], tz?: string) =>
    req<BaselineResponse>(`/baseline${qs({ range, metrics: metrics.join(','), tz })}`),

  activity: (from?: string, to?: string, tz?: string) =>
    req<ActivitySummary[]>(`/activity${qs({ from, to, tz })}`),

  workouts: (limit = 50, cursor?: string) =>
    req<WorkoutPage>(`/workouts${qs({ limit, cursor })}`),

  sleep: (from?: string, to?: string, tz?: string) =>
    req<SleepSegment[]>(`/sleep${qs({ from, to, tz })}`),

  coverage: (from?: string, to?: string, tz?: string) =>
    req<CoverageResponse>(`/coverage${qs({ from, to, tz })}`),

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
}

/** The browser's time zone — for the timezone-aware aggregation (docs/03 §6.1). */
export function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
