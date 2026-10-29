import type {
  Achievement,
  ActivitySummary,
  BaselineRange,
  BaselineResponse,
  Challenge,
  CoverageResponse,
  AccountEvent,
  CodeIssued,
  CodePurpose,
  Device,
  Goal,
  IngestRedriveResult,
  IngestStatus,
  Insight,
  JournalResponse,
  LatestResponse,
  MePatch,
  Member,
  MemberCreate,
  MemberPatch,
  Range,
  Settings,
  SamplePage,
  SleepSegment,
  SummaryResponse,
  TokenInfo,
  User,
  Workout,
  WorkoutPage,
  WorkoutRoute,
  WorkoutIntensity,
} from './types'

// # How the web is let in (docs/36 §3.4, the review §9 C10–C12, A5, A7)
//
// **Only by the session cookie.** A browser signs in with a one-time code
// (`POST /v1/auth/web/login`), and the server answers with `helsa_session` —
// httpOnly, so no script here can read it, and Path=/v1, so it travels with
// every call below and with nothing else. `fetch` carries it because the API is
// same-origin (`credentials: 'same-origin'`), never from the HTTP cache (`cache: 'no-store'`).
//
// ⛔ **No bearer header, ever.** Until the household the web kept a year-long
// device token in `localStorage` and sent it as `Authorization: Bearer`. That
// token is gone (`takeLegacyToken` deletes it on load, with no transition
// period — A5), and the server refuses a request carrying both a bearer and the
// cookie (400, C11): "which one wins" is exactly the question that ends with one
// person's browser acting as another. `client.test.ts` pins that no request
// sends one.
//
// ⚠️ **A 401 is an identity change.** Whatever the page was showing belonged to
// a session that is over, so the session layer (`session.tsx`) is told through
// `setUnauthorizedHandler`, empties the whole query cache and shows the sign-in
// page (A7, C12). The two requests whose 401 means something else — redeeming a
// code ("not accepted") and the first look at who is signed in ("nobody yet") —
// pass `quiet: true`.

/** Where the old web kept the device token. Read only to delete it. */
export const LEGACY_TOKEN_KEY = 'helsa.device_token'

/**
 * Deletes a device token left in this browser by an older web, and says whether
 * there was one — so the page can explain once why it is asking for a code now.
 */
export function takeLegacyToken(): boolean {
  try {
    if (localStorage.getItem(LEGACY_TOKEN_KEY) == null) return false
    localStorage.removeItem(LEGACY_TOKEN_KEY)
    return true
  } catch {
    return false // storage blocked: there is nothing to delete either
  }
}

let onUnauthorized: (() => void) | null = null

/** The session layer's hook for "the server no longer knows this browser". */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn
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

type ReqInit = Omit<RequestInit, 'body'> & {
  /** A JSON body; sets the Content-Type the server insists on for a cookie write (C10). */
  json?: unknown
  /** A 401 here is an answer, not the end of the session (see the top of the file). */
  quiet?: boolean
}

async function req<T>(path: string, init: ReqInit = {}): Promise<T> {
  const { json, quiet, ...rest } = init
  const headers = new Headers(rest.headers)
  headers.set('Accept', 'application/json')
  if (json !== undefined) headers.set('Content-Type', 'application/json')

  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    credentials: 'same-origin',
    // Never from the browser's HTTP cache: the URLs are the same for everybody on
    // this server, and a kept answer would be the previous person's (§10.4, S10).
    cache: 'no-store',
  })

  if (!res.ok) throw await problemOf(res, quiet)
  if (res.status === 204 || res.status === 202) return undefined as T
  return (await res.json()) as T
}

/** The backend returns RFC 9457 problem+json; if it does not, do not fall over. */
async function problemOf(res: Response, quiet?: boolean): Promise<ApiError> {
  let title = `HTTP ${res.status}`
  let detail: string | undefined
  try {
    const p = await res.json()
    title = p.title ?? title
    detail = p.detail
  } catch {
    /* not JSON — the status stands */
  }
  if (res.status === 401 && !quiet) onUnauthorized?.()
  return new ApiError(res.status, title, detail)
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
      ...(max != null ? { json: { max } } : {}),
    }),

  goals: () => req<Goal[]>('/goals'),

  devices: () => req<Device[]>('/devices'),

  settings: () => req<Settings>('/settings'),

  // --- Who is signed in, and their account (docs/36 §5.6) -------------------

  /** `quiet`: on the first look, a 401 means "nobody is signed in yet", not
   * "a session just ended" — the session layer tells the two apart. */
  me: (opts: { quiet?: boolean } = {}) => req<User>('/me', { quiet: opts.quiet }),
  /** Only `ha_publish` from the web: the person's own switch (C25). */
  patchMe: (body: MePatch) => req<User>('/me', { method: 'PATCH', json: body }),
  /** 202: the account is disabled at once and its deletion queued. The handle is
   * the confirmation; the last admin is refused (409). */
  deleteMe: (handle: string) => req<void>('/me', { method: 'DELETE', json: { handle } }),
  myTokens: () => req<TokenInfo[]>('/me/tokens'),
  revokeMyToken: (id: string) =>
    req<void>(`/me/tokens/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** A code for the caller's own next phone (15 minutes). */
  myDeviceCode: () => req<CodeIssued>('/me/enrolment-codes', { method: 'POST' }),
  /** A code for the caller's own next browser (10 minutes). */
  myLoginCode: () => req<CodeIssued>('/me/login-codes', { method: 'POST' }),
  myEvents: () => req<AccountEvent[]>('/me/events'),

  // --- Signing in and out -------------------------------------------------

  /** 204 and the cookie, or ONE 401 for every way a code can be wrong (C7), or a
   * 429 when too many tries were made. `quiet`: that 401 is about the code. */
  webLogin: (code: string) =>
    req<void>('/auth/web/login', { method: 'POST', json: { code }, quiet: true }),
  webLogout: () => req<void>('/auth/web/logout', { method: 'POST', quiet: true }),

  // --- The household, for an admin (docs/36 §5.3–§5.4) ----------------------
  // Account metadata only: nothing here returns a member's health data, and the
  // database holds the admin to that too (docs/36 §10).

  members: () => req<Member[]>('/admin/users'),
  addMember: (body: MemberCreate) => req<Member>('/admin/users', { method: 'POST', json: body }),
  member: (id: string) => req<Member>(`/admin/users/${encodeURIComponent(id)}`),
  /** Role, disable / re-enable. Disabling is not revoking (A8); a change that
   * would leave no enabled admin is a 409. */
  patchMember: (id: string, body: MemberPatch) =>
    req<Member>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', json: body }),
  deleteMember: (id: string, handle: string) =>
    req<void>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', json: { handle } }),
  memberTokens: (id: string) => req<TokenInfo[]>(`/admin/users/${encodeURIComponent(id)}/tokens`),
  revokeMemberToken: (id: string, tokenId: string) =>
    req<void>(
      `/admin/users/${encodeURIComponent(id)}/tokens/${encodeURIComponent(tokenId)}`,
      { method: 'DELETE' },
    ),
  memberEvents: (id: string) => req<AccountEvent[]>(`/admin/users/${encodeURIComponent(id)}/events`),
  /**
   * A code for a member — ⚠️ only one with no live device or session: a member
   * who has one asks for their own, so an admin cannot quietly become them
   * (C2). Otherwise 409, which the page explains.
   */
  memberCode: (id: string, purpose: CodePurpose) =>
    req<CodeIssued>(`/admin/users/${encodeURIComponent(id)}/codes`, {
      method: 'POST',
      json: { purpose },
    }),

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

  /**
   * The newest measurement of each named type, in one call — what the
   * Measurements page's cards lead with. An averaged type comes back with its
   * latest sample, a summed type with its latest day's merged total; a type
   * that never arrived is absent from the map.
   *
   * ⚠️ A 404 is version skew (an older server without the route): the page falls
   * back to the last measured day of its 30-day window and says so
   * (`isApiTooOld`). At most 200 names.
   */
  latest: (metrics: string[], tz?: string) =>
    req<LatestResponse>(`/latest${qs({ metrics: metrics.join(','), tz })}`),

  /**
   * The phone's journal and events in a window of days (`to` included) —
   * moods, symptoms, the heart-rate and other alerts. Only there if the phone's
   * opt-in sync sent them: `last_received_at` absent means it never did.
   *
   * ⚠️ A 404 is version skew (a server older than the endpoint), not an empty
   * journal — the page says so (`isApiTooOld`).
   */
  journal: (from: string, to: string, tz?: string) =>
    req<JournalResponse>(`/journal${qs({ from, to, tz })}`),

  /** Deletes every journal entry from the server. Health on the phone is
   * untouched; if the phone's switch is still on, its next sync sends them again. */
  deleteJournal: () => req<{ deleted: number }>('/journal', { method: 'DELETE' }),

  /**
   * `POST /export` — the file itself, streamed. See `exportFile` below.
   *
   * ⚠️ Like the redrive above, a POST that writes nothing: it reads the data out.
   */
  exportFile: (body: ExportRequest, opts: ExportOptions = {}) => exportFile(body, opts),
}

/** The body of `POST /export` (openapi.yaml `ExportRequest`). `pdf` is in the
 * contract but answers 501, so the web's type does not offer it. */
export type ExportRequest = {
  format: 'csv' | 'json'
  /** Empty or absent = every metric. */
  metrics?: string[]
  /** Calendar days in the user's time zone; `to` is included. */
  from?: string
  to?: string
}

export type ExportOptions = {
  signal?: AbortSignal
  /** Bytes received so far — the only progress there is: the server streams
   * without a Content-Length, because it does not know the size either. */
  onProgress?: (bytes: number) => void
}

export type ExportedFile = {
  blob: Blob
  /** The raw `Content-Disposition` header; `lib/exportFile.filenameFrom` reads it. */
  disposition: string | null
  bytes: number
}

/**
 * The export, read as it arrives.
 *
 * A separate path from `req` because the answer is a FILE, not JSON — and
 * because a large history takes a while, the body is read chunk by chunk so the
 * page can say how much has arrived. Same auth as every other call: the session
 * cookie, and nothing else.
 *
 * ⚠️ A non-200 is a problem+json like everywhere else (400 for a bad window).
 * But once the server has sent 200 it is streaming and can no longer change the
 * status: an export that breaks off on the server arrives as a 200 with a short
 * body. Checking for that is the caller's job (`lib/exportFile.ts`), because only
 * it knows the format.
 */
async function exportFile(body: ExportRequest, opts: ExportOptions): Promise<ExportedFile> {
  const res = await fetch(`${BASE}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    // Never from the browser's HTTP cache: the URLs are the same for everybody on
    // this server, and a kept answer would be the previous person's (§10.4, S10).
    cache: 'no-store',
    signal: opts.signal,
  })
  if (!res.ok) throw await problemOf(res)

  const type = res.headers.get('Content-Type') ?? 'application/octet-stream'
  const disposition = res.headers.get('Content-Disposition')
  const chunks: BlobPart[] = []
  let bytes = 0
  const reader = res.body?.getReader()
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      bytes += value.byteLength
      opts.onProgress?.(bytes)
    }
  } else {
    // No stream to read (an old engine, a test double): the whole body at once.
    const whole = await res.blob()
    chunks.push(whole)
    bytes = whole.size
    opts.onProgress?.(bytes)
  }
  return { blob: new Blob(chunks, { type }), disposition, bytes }
}

/** The browser's time zone — for the timezone-aware aggregation (docs/03 §6.1). */
export function browserTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}
