/**
 * Fixture API for photographing the server web (the dashboard) for this site.
 *
 * Not real data — an invented person, deterministic apart from "today". It
 * answers the read endpoints the dashboard calls, so the web can be run with
 * Vite against it and captured headless, without a backend and without ever
 * pointing a camera at a server that holds real measurements.
 *
 *   node site/scripts/web-fixture-api.mjs                     # :18291
 *   cd web && HELSA_API=http://127.0.0.1:18291 npx vite --port 5191
 *   # in the browser: localStorage['helsa.device_token'] = 'demo-token'
 *
 * Knobs, by request (handy from the capture script):
 *   GET /__lang?l=hu       (kept for older capture scripts; the web words observations itself now)
 *   GET /__fallback?on=1   add an observation whose rule no web build knows (the server-sentence fallback)
 *   GET /__notoday?on=1    nothing for today yet (the first-sync picture)
 *   GET /__mode?m=dlq      the sync queue in another state: idle | noworker | dlq | down
 *
 * The pictures it produced are listed in site/SCREENSHOTS.md.
 */
import http from 'node:http'
let mode = 'draining'
let lang = 'en'
let noToday = false
let fallback = false
const now = new Date()
const iso = (d) => d.toISOString()
const day = (n) => { const d = new Date(now); d.setDate(d.getDate() - n); return d }
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function rnd(seed) { let x = Math.sin(seed) * 10000; return x - Math.floor(x) }
const BASE = { stepCount: [10500, 'count', 'sum', 4000], activeEnergy: [520, 'kcal', 'sum', 200], restingHeartRate: [56, 'count/min', 'avg', 4], heartRate: [72, 'count/min', 'avg', 8], hrv: [48, 'ms', 'avg', 10], distanceWalkingRunning: [7800, 'm', 'sum', 3000], flightsClimbed: [12, 'count', 'sum', 6], bodyMass: [78.4, 'kg', 'avg', 0.4] }
function summary(q) {
  const range = q.get('range'), names = (q.get('metrics') || '').split(',')
  let from = q.get('from') ? new Date(q.get('from') + 'T00:00:00') : day(range === 'year' ? 365 : range === 'month' ? 29 : range === 'week' ? 6 : 0)
  let to = q.get('to') ? new Date(q.get('to') + 'T00:00:00') : new Date(ymd(now) + 'T00:00:00')
  const metrics = {}
  for (const n of names) {
    const b = BASE[n]; if (!b) continue
    const [mean, unit, agg, sd] = b
    const buckets = []
    if (range === 'day') {
      for (let h = 0; h <= Math.min(now.getHours(), 23); h++) {
        const t = new Date(ymd(to) + 'T00:00:00'); t.setHours(h)
        if (n === 'hrv' ) continue
        const v = agg === 'sum' ? Math.round(mean / 16 * (h < 7 ? 0.05 : 1 + rnd(h) )) : mean + (rnd(h) - 0.5) * sd
        buckets.push(agg === 'sum' ? { t: iso(t), v } : { t: iso(t), avg: v, min: v - 3, max: v + 5 })
      }
    } else if (range === 'year') {
      const d = new Date(from.getFullYear(), from.getMonth(), 1)
      while (d <= to) { const v = agg === 'sum' ? Math.round(mean * 30 * (0.8 + rnd(d.getMonth()) * 0.4)) : mean + (rnd(d.getMonth()) - 0.5) * sd; buckets.push(agg === 'sum' ? { t: iso(d), v } : { t: iso(d), avg: v, min: v - sd, max: v + sd }); d.setMonth(d.getMonth() + 1) }
    } else {
      const d = new Date(from)
      while (d <= to) { const s = d.getDate() + d.getMonth() * 31 + n.length; if (rnd(s) > 0.06) { const v = agg === 'sum' ? Math.round(mean + (rnd(s * 3) - 0.5) * 2 * sd) : +(mean + (rnd(s * 3) - 0.5) * sd).toFixed(1); buckets.push(agg === 'sum' ? { t: iso(d), v } : { t: iso(d), avg: v, min: v - sd / 2, max: v + sd / 2 }) } d.setDate(d.getDate() + 1) }
    }
    metrics[n] = { agg, unit, buckets }
  }
  return { range, from: ymd(from), to: ymd(to), tz: 'Europe/Budapest', metrics }
}
function baseline(q) {
  const names = (q.get('metrics') || '').split(','), metrics = {}
  for (const n of names) { const b = BASE[n]; if (!b) continue; const [mean, unit, agg, sd] = b; metrics[n] = { agg, unit, day_count: 55, mean, sd: sd * 0.6, low: mean - sd * 0.6, high: mean + sd * 0.6, period_value: mean * 1.08, standing: 'above' } }
  return { min_days: 14, metrics }
}
const TYPES = ['hiking', 'running', 'traditionalStrengthTraining', 'cycling', 'yoga', 'walking', 'running', 'swimming']
const workouts = []
for (let i = 0; i < 40; i++) {
  const t = TYPES[i % TYPES.length]; const s = day(Math.floor(i * 2.6) + 1); s.setHours(8 + (i * 5) % 11, (i * 13) % 60, 0, 0)
  const min = [283, 32, 55, 92, 30, 46, 42, 38][i % 8]; const e = new Date(s.getTime() + min * 60000)
  const outdoor = !['traditionalStrengthTraining', 'yoga', 'swimming'].includes(t)
  workouts.push({ id: `w${i}`, source_uuid: `uuid-${i}`, activity_type: t, started_at: iso(s), ended_at: iso(e), total_energy_kcal: Math.round(min * 6.5), total_distance_m: outdoor ? Math.round(min * 140) : undefined, avg_heart_rate: 100 + (i * 7) % 50, max_heart_rate: 140 + (i * 3) % 30, metadata: { indoor: !outdoor, ...(i === 0 ? { weather: { temperature_c: 14, humidity_pct: 68, condition: 2 } } : {}) } })
}
// a duplicate of w0
workouts.splice(1, 0, { ...workouts[0], id: 'w0b', source_uuid: 'uuid-0b', started_at: iso(new Date(new Date(workouts[0].started_at).getTime() + 60000)), total_energy_kcal: 1742 })
function route() { const pts = []; for (let i = 0; i < 200; i++) { const a = i / 200 * Math.PI * 1.8; pts.push({ ts: iso(new Date(now.getTime() + i * 60000)), lat: 47.5 + Math.sin(a) * 0.02 + Math.sin(i / 7) * 0.002, lon: 19.0 + Math.cos(a) * 0.03, accuracy_m: 5 }) } return { points: pts } }
function hr(q) { const from = new Date(q.get('from')), to = new Date(q.get('to')); const items = []; for (let t = from.getTime(); t < to.getTime(); t += 30000) { const k = (t - from.getTime()) / 60000; items.push({ ts: iso(new Date(t)), data_type: 'heartRate', value: Math.round(110 + 30 * Math.sin(k / 20) + 8 * rnd(k)), unit: 'count/min', source_device: 'watch' }) } return { items } }
function sleep() {
  const out = []
  const seq = [['core', 40], ['deep', 50], ['core', 60], ['rem', 30], ['awake', 8], ['core', 70], ['deep', 28], ['rem', 35], ['core', 45], ['awake', 10], ['rem', 30], ['core', 30]]
  for (let n = 0; n < 4; n++) { const st = new Date(ymd(day(n)) + 'T00:00:00'); st.setHours(-1, 20 + n * 7); let t = st.getTime(); for (const [s, m] of seq) { out.push({ started_at: iso(new Date(t)), ended_at: iso(new Date(t + m * 60000)), stage: s }); t += m * 60000 } }
  // a nap today at 14:00 — the newest session
  const nap = new Date(ymd(now) + 'T14:00:00'); out.push({ started_at: iso(nap), ended_at: iso(new Date(nap.getTime() + 25 * 60000)), stage: 'core' }, { started_at: iso(new Date(nap.getTime() + 25 * 60000)), ended_at: iso(new Date(nap.getTime() + 50 * 60000)), stage: 'deep' })
  return out
}
function ingest() {
  const b = { checked_at: iso(new Date()), broker_reachable: true, queue: { name: 'helsa.ingest', ready: 1417, consumers: 1, in_flight_max: 8 }, dead_letter: { name: 'helsa.ingest.dlq', ready: 0 }, stats_reachable: true, worker: { started_at: iso(new Date(Date.now() - 2.5 * 3600e3)), last_batch_at: iso(new Date(Date.now() - 2000)), prefetch: 8, batches_since_start: 3958, items_since_start: 3900000, failed_since_start: 0 }, throughput: { window_seconds: 600, batches: 990, items: 1900000, failed: 0, batches_per_minute: 99, items_per_minute: 190000 }, eta_seconds: 860 }
  if (mode === 'idle') return { ...b, queue: { ...b.queue, ready: 0 }, throughput: { window_seconds: 600, batches: 0, items: 0, failed: 0 }, eta_seconds: undefined }
  if (mode === 'noworker') return { ...b, queue: { ...b.queue, consumers: 0, in_flight_max: 0 }, eta_seconds: undefined, throughput: { window_seconds: 600, batches: 0, items: 0, failed: 0 } }
  if (mode === 'dlq') return { ...b, queue: { ...b.queue, ready: 0 }, eta_seconds: undefined, throughput: { window_seconds: 600, batches: 0, items: 0, failed: 0 }, dead_letter: { name: 'helsa.ingest.dlq', ready: 3, recent_failures: [{ batch_id: '7d1e2c55-3a1b-4f0e-9a57-0c9b3c2d1e11', failed_at: iso(new Date(Date.now() - 180e3)), error: 'write samples: ERROR: value too long for type character varying(#) (SQLSTATE 22001)', items: 1840, samples: 1838, workouts: 2, sleep_segments: 0, activity_summaries: 0, deletions: 0, redriven: 3 }, { batch_id: '1a2b3c4d-0000-4000-8000-123456789abc', failed_at: iso(new Date(Date.now() - 600e3)), error: 'begin tx: dial tcp #.#.#.#:#: connect: connection refused', items: 2000, samples: 2000, workouts: 0, sleep_segments: 0, activity_summaries: 0, deletions: 0, redriven: 0 }] } }
  if (mode === 'down') return { checked_at: iso(new Date()), broker_reachable: false, broker_error: 'dial tcp 172.18.0.4:5672: connect: connection refused', stats_reachable: true, throughput: b.throughput }
  return b
}
const challenge = () => ({ month: ymd(now).slice(0, 7), tz: 'Europe/Budapest', days_in_month: 31, days_elapsed: now.getDate() - 1, days_remaining: 31 - now.getDate() + 1, steps: 254627, steps_per_day: 9793, measured_days: 26, goal: 200000, percent: 100, complete: true, thresholds: [25000, 50000, 75000, 100000, 150000, 200000].map((s) => ({ steps: s, reached: true })), thresholds_source: 'default', days: [], streak: { length: 12, active_days: 12, longest: 18, window_from: ymd(day(30)), window_to: ymd(now), missing_inputs: [] } })

function journal(q) {
  const tz = 'Europe/Budapest', entries = []
  const tags = [['work'], ['family', 'friends'], ['partner'], ['work', 'weather'], [], ['friends'], ['family']]
  for (let n = 0; n < 30; n++) {
    if (n % 9 === 4) continue
    const d = day(n); d.setHours(21, 10, 0, 0)
    const v = [0.6, 0.2, 0.9, -0.3, 0.4, 0.1, 0.7, -0.6][n % 8]
    entries.push({ source_uuid: `m${n}`, data_type: 'stateOfMind', started_at: iso(d), ended_at: iso(d), valence: v, mood_kind: 'daily_mood', associations: tags[n % 7] })
  }
  for (const [n, k, val] of [[12, 'soreThroat', 2], [12, 'fatigue', 3], [11, 'coughing', 3], [11, 'fever', 2], [10, 'coughing', 2], [9, 'fatigue', 2], [3, 'headache', 2]]) {
    const d = day(n); d.setHours(9, 0, 0, 0)
    entries.push({ source_uuid: `s${n}${k}`, data_type: k, started_at: iso(d), ended_at: iso(d), value: val })
  }
  const ev = day(1); ev.setHours(18, 49, 0, 0)
  entries.push({ source_uuid: 'e1', data_type: 'highHeartRateEvent', started_at: iso(ev), ended_at: iso(ev) })
  const key = `highHeartRate:${Math.round(ev.getTime() / 1000)}`
  entries.push({ source_uuid: 'e1m', data_type: 'rapidPoundingOrFlutteringHeartbeat', started_at: iso(ev), ended_at: iso(ev), value: 2, event_key: key })
  entries.push({ source_uuid: 'e1f', data_type: 'rapidPoundingOrFlutteringHeartbeat', started_at: iso(ev), ended_at: iso(ev), value: 1, event_key: key, follow_up_hours: 24 })
  const ev2 = day(6); ev2.setHours(20, 24, 0, 0)
  entries.push({ source_uuid: 'e2', data_type: 'environmentalAudioExposureEvent', started_at: iso(ev2), ended_at: iso(ev2), audio_level_dbaspl: 92 })
  return { tz, from: q.get('from'), to: q.get('to'), entries, total: entries.length, last_received_at: iso(new Date(Date.now() - 20 * 60e3)) }
}
function latest(q) {
  const metrics = {}
  for (const n of (q.get('metrics') || '').split(',')) { const b = BASE[n]; if (!b) continue; metrics[n] = { value: b[0], unit: b[1], at: iso(new Date(Date.now() - 3600e3)), day: ymd(now), agg: b[2] } }
  return { tz: 'Europe/Budapest', metrics }
}
const routes = {
  '/v1/journal': journal, '/v1/latest': latest,
  '/v1/summary': (q) => { const r = summary(q); if (noToday && q.get('range') === 'day') for (const k in r.metrics) r.metrics[k].buckets = []; return r }, '/v1/baseline': baseline,
  '/v1/activity': () => [{ day: ymd(noToday ? day(1) : now), active_energy: 412, active_energy_goal: 600, exercise_minutes: 26, exercise_goal: 30, stand_hours: 9, stand_goal: 12 }],
  '/v1/workouts': (q) => ({ items: workouts.slice(0, Number(q.get('limit') || 50)), next_cursor: null }),
  '/v1/samples': hr, '/v1/sleep': sleep,
  '/v1/coverage': () => ({ days: 30, types: Object.keys(BASE).map((k) => ({ data_type: k, in_catalog: true, state: 'measured', measured_days: 29, sample_count: 999, last_day: ymd(now), sources: [{ device: 'watch' }] })).concat([{ data_type: 'oxygenSaturation', in_catalog: true, state: 'went_quiet', measured_days: 3, gap: { silent_days: 9 } }]) }),
  '/v1/ingest/status': ingest,
  '/v1/devices': () => [{ id: 'd1', platform: 'ios', model: 'iPhone', name: 'iPhone', last_seen_at: iso(new Date(Date.now() - 4 * 60e3)) }],
  '/v1/settings': () => ({ time_zone: 'Europe/Budapest', locale: 'en', unit_system: 'metric' }),
  '/v1/goals': () => [{ metric: 'stepCount', target_value: 10000, source: 'healthkit' }],
  '/v1/me': () => ({ id: 'u1', display_name: 'Demo' }),
  // Real rule ids and the value sets the shared vectors pin: the web words these
  // itself, in its own language. `title`/`detail` are the server's Hungarian
  // fallback, as on the wire. `/__fallback?on=1` adds a rule no web build knows,
  // which is the one case that fallback is printed.
  '/v1/insights': () => [
    { id: `steps-sleep-correlation:${ymd(now)}`, rule: 'steps-sleep-correlation', kind: 'correlation', metric: 'stepCount', values: { r: 0.58, pairs: 46 }, title: 'A mozgalmasabb napokat hosszabb alvás követi', severity: 'info', generated_at: iso(now) },
    { id: `resting-hr-elevated:${ymd(now)}`, rule: 'resting-hr-elevated', kind: 'anomaly', metric: 'restingHeartRate', values: { recent: 61.3, baseline: 56.2, deviation: 2.4, baselineDays: 27 }, title: 'A nyugalmi pulzusod 3 napja a szokásos fölött', severity: 'notice', generated_at: iso(now) },
    { id: `steps-weekly-trend:${ymd(now)}`, rule: 'steps-weekly-trend', kind: 'trend', metric: 'stepCount', values: { current: 11840, previous: 9620, changePct: 23.1, currentDays: 7, previousDays: 7 }, title: 'A napi lépésszámod 23%-kal több, mint az előző héten', severity: 'info', generated_at: iso(now) },
    { id: `sleep-midpoint-weekend:${ymd(now)}`, rule: 'sleep-midpoint-weekend', kind: 'pattern', metric: 'sleepDuration', values: { free: 1712, work: 1638, delta: 74, freeCount: 8, workCount: 19 }, title: 'Az alvásod közepe hétvégén 74 perccel később van, mint hétköznap', severity: 'info', generated_at: iso(now) },
    ...(fallback ? [{ id: `hydration-streak:${ymd(now)}`, rule: 'hydration-streak', kind: 'pattern', metric: 'dietaryWater', values: { days: 9 }, title: 'Kilenc napja minden nap rögzítettél vizet', detail: 'Ezt a szabályt a webes felület még nem ismeri, ezért a szerver magyar mondata jelenik meg.', severity: 'info', generated_at: iso(now) }] : []),
  ],
  '/v1/achievements': () => Array.from({ length: 23 }, (_, i) => ({ id: `a${i}`, kind: i % 3 ? 'month' : 'milestone', code: 'challenge', period: i % 3 ? ymd(day(30 * i)).slice(0, 7) : undefined, value: 200000, earned_at: iso(day(30 * i + 1)) })),
  '/v1/challenge': challenge,
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/__notoday') { noToday = u.searchParams.get('on') === '1'; mode = noToday ? 'idle' : 'draining'; res.end(String(noToday)); return }
  if (u.pathname === '/__fallback') { fallback = u.searchParams.get('on') === '1'; res.end(String(fallback)); return }
  if (u.pathname === '/__lang') { lang = u.searchParams.get('l'); res.end(lang); return }
  if (u.pathname === '/__mode') { mode = u.searchParams.get('m'); res.end(mode); return }
  let body
  if (req.method === 'POST' && u.pathname === '/v1/ingest/dead-letter/redrive') body = { moved: 3, remaining: 0, max_redriven: 4, repeated: 1 }
  else if (/^\/v1\/workouts\/[^/]+\/route$/.test(u.pathname)) body = route()
  else if (/^\/v1\/workouts\/[^/]+$/.test(u.pathname)) body = workouts.find((w) => w.id === u.pathname.split('/')[3])
  else if (routes[u.pathname]) body = routes[u.pathname](u.searchParams)
  if (body === undefined) { res.writeHead(404, { 'content-type': 'application/problem+json' }); res.end(JSON.stringify({ title: 'Not Found' })); return }
  res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body))
}).listen(18291, () => console.log('mock on 18291'))
