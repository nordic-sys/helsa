// One session, opened — the web's answer to the phone's `WorkoutDetailView`.
//
// # The guiding principle, copied word for word from the phone
//
// **What is not there does not get shown.** No zero, no "—" standing in a frame
// of its own. A yoga session has no pace, a run from 2019 has no weather, a walk
// recorded with a phone in a pocket has no heart rate — and in every one of
// those the correct drawing of the absence is that the block IS NOT THERE. The
// metric grid is therefore a different length for every workout, and that is
// precisely the honest shape.
//
// # What the web does differently, and why
//
// * **The route is drawn, not mapped.** No tiles, from anybody: a request to a
//   third party on a page about where somebody ran is exactly the thing the
//   project's no-third-party posture forbids, and the phone's App Privacy answer
//   rests on the same rule. So the coordinates are projected into an SVG here.
//   The shape of a run is the information; the streets are not — and a scale bar
//   gives the shape its size back.
// * **The other recording is reachable.** On the phone the list hands this
//   screen its `others`; here they are a click away, because a URL can be one.
//
// # The one thing this page cannot say that the phone can
//
// ⚠️ The phone attributes each block separately — `ItemSourceFootnote` asks
// HealthKit who wrote the route and who wrote the heart rate. **The server does
// not carry that.** `Workout` has no source-device field in the contract at all,
// and only `Sample.source_device` survives the trip. So the footer says what it
// can and names what it cannot, rather than putting one confident badge in the
// header that would quietly claim all of it.

import { Suspense, lazy, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { ApiError, api } from '../api/client'
import type { Sample, Workout } from '../api/types'
import { Card, Empty, ErrorState, Loading, Note, Stat } from '../components/ui'
import { useI18n, type UiKey } from '../i18n'
import { useFormat, type Formatters } from '../lib/format'
import { durationMin, groupSessions, startMs, type WorkoutGroup } from '../lib/workouts'
import { useWorkoutHistory } from '../lib/workoutHistory'
import {
  clock,
  downsample,
  heartRateAxis,
  heartRateSeries,
  isIndoor,
  lapsFrom,
  paceOf,
  poolLengthM,
  projectRoute,
  routeTrack,
  scaleBar,
  weatherFrom,
  workoutMinutes,
  type Lap,
} from '../lib/workoutDetail'
import { attributionKey, mapSourceUsable, mapSupported, readMapSource } from '../lib/routeMap'

// ⚠️ Lazy, and the gate in front of it matters as much as the import: MapLibre is
// bigger than everything else on this page put together, and it is wanted on one
// card, sometimes. See the header of `components/RouteMap.tsx`.
const RouteMap = lazy(() => import('../components/RouteMap'))

/** How far either side of the session the neighbour walk has to reach. A day is
 * generous for a five-minute duplicate tolerance, and it is the walk's ONLY stop
 * condition — being generous costs one page. */
const NEIGHBOUR_MARGIN_MS = 24 * 60 * 60 * 1000

/** How many `/samples` pages the heart-rate read will follow.
 *
 * ⚠️ A three-hour ride at five-second intervals is over 2000 samples, which is
 * one full page — so following the cursor is not an optimisation, it is the
 * difference between a curve that stops two thirds of the way through and one
 * that does not. The ceiling is the same guard as the history walk's: a cursor
 * that never terminates. */
const MAX_SAMPLE_PAGES = 6

/** The chart cannot show more columns than this, and a `<path>` of thousands of
 * segments is waste. Averaged down, not sampled down — see `downsample`. */
const HR_BUCKETS = 240

const ROUTE_W = 900
const ROUTE_H = 380

export default function WorkoutDetail() {
  const { id = '' } = useParams()
  const { t } = useI18n()
  const f = useFormat()

  const detail = useQuery({
    queryKey: ['workout', id],
    queryFn: () => api.workout(id),
    enabled: id !== '',
  })

  const w = detail.data
  const minutes = workoutMinutes(w)
  const metadata = w?.metadata

  if (detail.isLoading) return <Loading rows={2} />
  // ⚠️ A 404 is not an error state. The request worked and the answer was "there
  // is no such session" — a stale bookmark, a link from another server, a
  // recording deleted in Health. Wording it as a failure sends the reader
  // looking for a fault that is not there.
  if ((detail.error as ApiError | undefined)?.status === 404 || (!detail.isError && !w)) {
    return (
      <>
        <BackLink />
        <Empty title={t('workout.missing.title')} hint={t('workout.missing.hint')} />
      </>
    )
  }
  if (detail.isError) return <ErrorState error={detail.error} />
  if (!w) return <Loading rows={2} />

  const indoor = isIndoor(metadata)
  const pace = paceOf(w.activity_type, w.total_distance_m, minutes)
  const pool = poolLengthM(metadata)
  const laps = lapsFrom(metadata)
  const weather = weatherFrom(metadata)

  return (
    <>
      <BackLink />
      <h1>{f.activityName(w.activity_type)}</h1>
      <p className="subtle">
        {dateRange(w, f)}
        {/* ⚠️ Only printed when HealthKit actually said so. A missing flag does
            NOT mean open sky — it means the recording app never wrote one. */}
        {indoor !== null && ` · ${t(indoor ? 'workouts.place.indoor' : 'workouts.place.outdoor')}`}
      </p>

      {/* ⚠️ These cards used to sit flush against one another — no wrapper had a
          margin, so five bordered boxes shared their edges and read as one. The
          space is the stack's now.

          What is wide and what flows: the route and the pulse curve are drawings
          and keep the page's width; the laps are a six-column table and keep it
          too. The weather and the source are label-and-value lists about ten
          words long, so they pair up as soon as two fit. */}
      <div className="sections">
        <DuplicateSection workout={w} />

        <MetricGrid workout={w} minutes={minutes} pace={pace} poolM={pool} />
        <RouteSection id={id} distanceM={w.total_distance_m} />
        <HeartRateSection workout={w} />
        {laps.length > 0 && <LapsSection laps={laps} />}

        <div className="flow">
          {weather && <WeatherSection weather={weather} />}
          <SourceSection workout={w} />
        </div>
      </div>
    </>
  )
}

function BackLink() {
  const { t } = useI18n()
  return (
    <p style={{ margin: '0 0 4px' }}>
      <Link className="linkish" to="/workouts">
        {t('workout.back')}
      </Link>
    </p>
  )
}

/**
 * "11 August 2026 · 18:12–18:44".
 *
 * Two cases get their own shape, both copied from the phone's `WorkoutDisplay`:
 * a session with **no end** does not get an invented closing time, and one that
 * **crosses midnight** prints the date on the closing side too — otherwise a
 * 23:40–00:20 run reads as if time had run backwards.
 */
function dateRange(w: Workout, f: Formatters): string {
  const day = f.date(w.started_at)
  const from = f.time(w.started_at)
  if (!w.ended_at) return `${day} · ${from}…`
  const sameDay = new Date(w.started_at ?? 0).toDateString() === new Date(w.ended_at).toDateString()
  return sameDay
    ? `${day} · ${from}–${f.time(w.ended_at)}`
    : `${day} ${from} – ${f.date(w.ended_at)} ${f.time(w.ended_at)}`
}

// --- The numbers -------------------------------------------------------------

function MetricGrid({
  workout,
  minutes,
  pace,
  poolM,
}: {
  workout: Workout
  minutes?: number
  pace?: ReturnType<typeof paceOf>
  poolM?: number
}) {
  const { t } = useI18n()
  const f = useFormat()

  // Only what IS there. Every condition below is `!= null` plus `> 0`, the same
  // pair the phone uses: a zero distance on a strength session is HealthKit
  // filling a field in, not a measurement of standing still.
  const cards: { key: string; label: string; value: string; unit?: string; color?: string }[] = []
  if (minutes != null)
    cards.push({ key: 'time', label: t('workout.metric.time'), value: f.duration(minutes) })
  if (workout.total_distance_m != null && workout.total_distance_m > 0)
    cards.push({
      key: 'distance',
      label: t('workout.metric.distance'),
      value: f.km(workout.total_distance_m),
      color: 'var(--helsa-move)',
    })
  if (workout.total_energy_kcal != null && workout.total_energy_kcal > 0)
    cards.push({
      key: 'energy',
      label: t('workout.metric.energy'),
      value: f.num(workout.total_energy_kcal),
      unit: 'kcal',
      color: 'var(--helsa-ember)',
    })
  if (pace)
    cards.push(
      pace.kind === 'speed'
        ? {
            key: 'pace',
            label: t('workout.metric.speed'),
            value: f.num1(pace.kmh),
            unit: t('unit.kmh'),
          }
        : {
            key: 'pace',
            label: t('workout.metric.pace'),
            value: clock(pace.seconds),
            unit: pace.kind === 'perKilometer' ? t('unit.perKm') : t('unit.per100m'),
          },
    )
  if (workout.avg_heart_rate != null && workout.avg_heart_rate > 0)
    cards.push({
      key: 'avgHr',
      label: t('workout.metric.avgHr'),
      value: f.num(workout.avg_heart_rate),
      unit: t('unit.bpm'),
      color: 'var(--helsa-pulse)',
    })
  if (workout.max_heart_rate != null && workout.max_heart_rate > 0)
    cards.push({
      key: 'maxHr',
      label: t('workout.metric.maxHr'),
      value: f.num(workout.max_heart_rate),
      unit: t('unit.bpm'),
      color: 'var(--helsa-pulse)',
    })
  if (poolM != null)
    cards.push({
      key: 'pool',
      label: t('workout.metric.pool'),
      value: f.num(poolM),
      unit: 'm',
      color: 'var(--helsa-nordlys)',
    })

  if (cards.length === 0) {
    return <Empty title={t('workout.metric.none.title')} hint={t('workout.metric.none.hint')} />
  }

  return (
    <div className="grid grid-stats">
      {cards.map((c) => (
        <Stat key={c.key} label={c.label} value={c.value} unit={c.unit} color={c.color} />
      ))}
    </div>
  )
}

// --- The route ---------------------------------------------------------------

function RouteSection({ id, distanceM }: { id: string; distanceM?: number }) {
  const { t, tp } = useI18n()
  const f = useFormat()

  const q = useQuery({
    queryKey: ['workoutRoute', id],
    queryFn: () => api.workoutRoute(id),
    enabled: id !== '',
  })

  const track = useMemo(() => routeTrack(q.data?.points), [q.data])
  const projected = useMemo(() => projectRoute(track, ROUTE_W, ROUTE_H), [track])
  const bar = projected ? scaleBar(projected.metresPerPixel, ROUTE_W) : undefined

  // ⚠️ **Off unless somebody chose otherwise**, and that is the whole design: a
  // map under a GPS trace is a privacy decision belonging to the reader, so the
  // default state of this card is the one it has always had. `readMapSource` is a
  // localStorage read, cheap enough to do on render and correct after a change on
  // the Settings page without any plumbing between the two.
  const source = readMapSource()
  const chosen = mapSourceUsable(source)

  // The gate has three parts and all three are needed: a chosen source, a browser
  // that can draw WebGL, and no earlier failure. Any of them missing means the
  // map-less drawing — which is the SAME drawing, not a degraded one.
  const [mapFailed, setMapFailed] = useState(false)
  const canDrawMap = mapSupported()
  const showMap = Boolean(projected && chosen && canDrawMap && !mapFailed)

  if (q.isLoading) {
    return (
      <Card title={t('workout.route.title')}>
        <p className="subtle">{t('workout.route.loading')}</p>
      </Card>
    )
  }
  if (q.isError) {
    return (
      <Card title={t('workout.route.title')}>
        {/* ⚠️ A failed request is NOT missing data, and it must not be worded as
            if the workout had no route. */}
        <Note title={t('workout.route.failed.title')}>{t('workout.route.failed.body')}</Note>
      </Card>
    )
  }
  if (!projected) {
    return (
      <Card title={t('workout.route.title')}>
        {/* An empty route is a full answer: an indoor session has no GPS trace. */}
        <p className="subtle">{t('workout.route.none')}</p>
      </Card>
    )
  }

  return (
    <Card title={t('workout.route.title')}>
      {/* The map goes BEHIND the drawing, in the same box, at the same scale.
          The frame is what holds the two together: the SVG sets the height (it
          has the viewBox), the map fills the frame absolutely, and the drawing
          stacks on top of it. Remove the map and the SVG is unchanged. */}
      <div className={`route-frame${showMap ? ' route-frame--mapped' : ''}`}>
        {showMap && projected && (
          <Suspense fallback={null}>
            <RouteMap
              source={source}
              projected={projected}
              viewBoxWidth={ROUTE_W}
              onFailed={() => setMapFailed(true)}
            />
          </Suspense>
        )}
        <svg
          className="route"
          viewBox={`0 0 ${ROUTE_W} ${ROUTE_H}`}
          role="img"
          aria-label={t('workout.route.aria', {
            points: track.points.length,
            length: f.km(distanceM ?? track.drawnLengthM),
          })}
        >
          <path
            d={projected.d}
            fill="none"
            stroke="var(--helsa-fjord)"
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* ⚠️ In a loop the two markers land on TOP of each other and the upper
              one hides the lower: the reader sees one flag and cannot tell which.
              One marker saying both is more information, not less. */}
          {track.closedLoop ? (
            <Endpoint x={projected.start.x} y={projected.start.y} color="var(--helsa-fjord)" />
          ) : (
            <>
              <Endpoint x={projected.start.x} y={projected.start.y} color="var(--helsa-move)" />
              <Endpoint x={projected.finish.x} y={projected.finish.y} color="var(--helsa-ember)" />
            </>
          )}
          {bar && (
            <g className="route-scale">
              <line
                x1={16}
                y1={ROUTE_H - 16}
                x2={16 + bar.pixels}
                y2={ROUTE_H - 16}
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
              />
              <text x={16} y={ROUTE_H - 26} fontSize={16}>
                {f.km(bar.metres)}
              </text>
            </g>
          )}
        </svg>
        {/* ⚠️ OpenStreetMap's licence and OpenMapTiles' both ask for a VISIBLE
            credit, and this is the only honest place for it. It is our own text,
            not a string fetched with the tiles and not MapLibre's own control —
            an attribution that arrived over the network would be one more thing
            the page asks somebody else for. */}
        {showMap && <p className="route-attrib">{t(attributionKey(source.format))}</p>}
      </div>

      <p className="legend" style={{ marginTop: 8 }}>
        <span className="legend-item">
          <span
            className="swatch"
            style={{ background: track.closedLoop ? 'var(--helsa-fjord)' : 'var(--helsa-move)' }}
          />
          {t(track.closedLoop ? 'workout.route.startFinish' : 'workout.route.start')}
        </span>
        {!track.closedLoop && (
          <span className="legend-item">
            <span className="swatch" style={{ background: 'var(--helsa-ember)' }} />
            {t('workout.route.finish')}
          </span>
        )}
      </p>

      {/* If we dropped fixes we say so. Silently drawing a shorter line would
          conceal that the measurement is incomplete. */}
      {track.droppedCount > 0 && (
        <p className="subtle" style={{ marginTop: 6 }}>
          {tp('workout.route.dropped', track.droppedCount)}
        </p>
      )}
      {/* ⚠️ THREE states, not two, and the third was nearly missed: a browser
          with no WebGL, or a map that failed to start, is NOT the same thing as
          nobody having chosen a map — and telling somebody "no map is switched
          on" when they plainly switched one on is exactly the kind of
          confidently wrong sentence this page exists not to write. A reader who
          is not told why the map is missing reads it as a fault; a reader told
          the wrong reason goes looking in the wrong place. */}
      <p className="subtle" style={{ marginTop: 6 }}>
        {t(
          showMap
            ? source.mode === 'own'
              ? 'workout.route.viaOwn'
              : 'workout.route.viaPublic'
            : chosen
              ? 'workout.route.mapUndrawable'
              : 'workout.route.noTiles',
        )}
      </p>
    </Card>
  )
}

function Endpoint({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={9} fill={color} />
      {/* The white ring is what keeps the marker visible where the line doubles
          back over itself. */}
      <circle cx={x} cy={y} r={9} fill="none" stroke="var(--surface)" strokeWidth={3} />
    </g>
  )
}

// --- The heart-rate curve ----------------------------------------------------

async function loadHeartRate(from: string, to: string): Promise<{ items: Sample[]; more: boolean }> {
  const items: Sample[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_SAMPLE_PAGES; page += 1) {
    const res = await api.samples('heartRate', from, to, 2000, cursor)
    items.push(...(res.items ?? []))
    cursor = res.next_cursor ?? undefined
    if (!cursor) return { items, more: false }
  }
  return { items, more: true }
}

function HeartRateSection({ workout }: { workout: Workout }) {
  const { t } = useI18n()
  const f = useFormat()
  const from = workout.started_at
  const to = workout.ended_at

  const q = useQuery({
    queryKey: ['heartRate', from, to],
    queryFn: () => loadHeartRate(from as string, to as string),
    enabled: Boolean(from && to),
  })

  const series = useMemo(
    () => heartRateSeries(q.data?.items, from, to),
    [q.data, from, to],
  )
  const axis = heartRateAxis(series)
  const data = useMemo(() => downsample(series.points, HR_BUCKETS), [series])

  // ⚠️ A recording with no end has no window to read the samples over, and
  // asking for one open-ended would drag in every beat since. That is a fact
  // about the recording, so it is said rather than left blank.
  if (!from || !to) {
    return (
      <Card title={t('workout.hr.title')}>
        <p className="subtle">{t('workout.hr.noWindow')}</p>
      </Card>
    )
  }
  if (q.isLoading) {
    return (
      <Card title={t('workout.hr.title')}>
        <p className="subtle">{t('workout.hr.loading')}</p>
      </Card>
    )
  }
  if (q.isError) {
    return (
      <Card title={t('workout.hr.title')}>
        <Note title={t('workout.hr.failed.title')}>{t('workout.hr.failed.body')}</Note>
      </Card>
    )
  }
  if (!axis || series.isEmpty) {
    return (
      <Card title={t('workout.hr.title')}>
        {/* ⚠️ Not a flat line at the bottom of the axis. A curve at 0 bpm would
            claim we measured the heart rate and found it stopped. */}
        <p className="subtle">
          {t(series.hasAnySample ? 'workout.hr.single' : 'workout.hr.none')}
        </p>
      </Card>
    )
  }

  const start = new Date(from).getTime()
  const end = new Date(to).getTime()

  return (
    <Card title={t('workout.hr.title')}>
      <div className="chart-sm">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <defs>
              <linearGradient id="hrFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--helsa-pulse)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--helsa-pulse)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[start, end]}
              tickFormatter={(ms: number) => f.duration((ms - start) / 60000)}
              tick={{ fontSize: 12, fill: 'var(--text-dim)' }}
              stroke="var(--border)"
              // ⚠️ Left to itself recharts put a tick at every third minute — 20
              // labels across an hour, which is a grey stripe rather than an
              // axis. The gap is in pixels, so it holds at any width.
              minTickGap={56}
            />
            {/* ⚠️ The domain is NOT `[0, max]`. A curve between 120 and 165 drawn
                from zero is a flat strip, and every session then looks alike. */}
            <YAxis
              domain={[axis.lower, axis.upper]}
              tick={{ fontSize: 12, fill: 'var(--text-dim)' }}
              stroke="var(--border)"
              width={44}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                color: 'var(--text)',
              }}
              labelFormatter={(ms: number) => f.duration((Number(ms) - start) / 60000)}
              formatter={(v: number) => [`${f.num(v)} ${t('unit.bpm')}`, t('workout.hr.title')]}
            />
            {series.average != null && (
              <ReferenceLine
                y={series.average}
                stroke="var(--helsa-pulse)"
                strokeDasharray="4 4"
                strokeOpacity={0.6}
              />
            )}
            <Area
              dataKey="bpm"
              type="monotone"
              stroke="var(--helsa-pulse)"
              strokeWidth={2}
              fill="url(#hrFill)"
              isAnimationActive={false}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ⚠️ These three come from the RAW series, never from the drawn one:
          downsampling averages, so it shaves the real peak off, and a label that
          says less than what happened is worse than no label. */}
      <div className="legend" style={{ marginTop: 8 }}>
        <span className="legend-item">
          {t('workout.hr.average')}
          <strong style={{ color: 'var(--helsa-pulse)' }}>{f.num(series.average)}</strong>
        </span>
        <span className="legend-item">
          {t('workout.hr.peak')}
          <strong style={{ color: 'var(--helsa-pulse)' }}>{f.num(series.max)}</strong>
        </span>
        <span className="legend-item">
          {t('workout.hr.lowest')}
          <strong style={{ color: 'var(--helsa-pulse)' }}>{f.num(series.min)}</strong>
        </span>
      </div>

      {/* ⚠️ Said where it matters: the curve is read out of the session's TIME
          WINDOW, not out of the workout row. When the recording carries no
          heart-rate summary of its own, the numbers under the chart come from
          samples something else wrote — true, and misleading if left unsaid,
          because they sit under this session's heading. */}
      {workout.avg_heart_rate == null && (
        <p className="subtle" style={{ marginTop: 6 }}>
          {t('workout.hr.fromWindow')}
        </p>
      )}
      {q.data?.more && (
        <p className="subtle" style={{ marginTop: 6 }}>
          {t('workout.hr.truncated')}
        </p>
      )}
    </Card>
  )
}

// --- Laps --------------------------------------------------------------------

function LapsSection({ laps }: { laps: Lap[] }) {
  const { t } = useI18n()
  const f = useFormat()
  return (
    <Card title={t('workout.laps.title')}>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{t('workout.laps.col.index')}</th>
              <th>{t('workouts.col.type')}</th>
              <th>{t('workouts.col.duration')}</th>
              <th>{t('workouts.col.distance')}</th>
              <th>{t('workouts.col.energy')}</th>
              <th>{t('workouts.col.avgHr')}</th>
              <th>{t('workouts.col.maxHr')}</th>
            </tr>
          </thead>
          <tbody>
            {laps.map((lap) => (
              <tr key={lap.index}>
                <td className="num">{lap.index + 1}</td>
                <td>{f.activityName(lap.activityType)}</td>
                <td className="num">{f.duration(lap.durationMin)}</td>
                <td className="num">{f.km(lap.distanceM)}</td>
                <td className="num">
                  {lap.energyKcal == null ? '–' : `${f.num(lap.energyKcal)} kcal`}
                </td>
                <td className="num">{f.num(lap.avgHeartRate)}</td>
                <td className="num">{f.num(lap.maxHeartRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Said here rather than left to be noticed: the phone drops a lone lap on
          purpose, so a session the reader knows was segmented into one shows no
          table at all. */}
      <p className="subtle" style={{ marginTop: 8 }}>
        {t('workout.laps.note')}
      </p>
    </Card>
  )
}

// --- Weather -----------------------------------------------------------------

function WeatherSection({ weather }: { weather: ReturnType<typeof weatherFrom> }) {
  const { t } = useI18n()
  const f = useFormat()
  if (!weather) return null
  return (
    <Card title={t('workout.weather.title')}>
      <dl className="kv">
        {weather.condition && (
          <>
            <dt>{t('workout.weather.condition')}</dt>
            <dd>{t(`weather.${weather.condition}` as UiKey)}</dd>
          </>
        )}
        {weather.temperatureC != null && (
          <>
            <dt>{t('workout.weather.temperature')}</dt>
            <dd>{`${f.num1(weather.temperatureC)} °C`}</dd>
          </>
        )}
        {/* ⚠️ A humidity over 100 never gets here — `humidityPercent` drops it
            rather than clamping, because the rows carrying the phone's old
            3 000% bug are already stored on people's servers. An absent number
            is honest; 100% would be a measurement we invented. */}
        {weather.humidityPercent != null && (
          <>
            <dt>{t('workout.weather.humidity')}</dt>
            <dd>{`${f.num(weather.humidityPercent)}%`}</dd>
          </>
        )}
      </dl>
    </Card>
  )
}

// --- The same session, recorded twice ----------------------------------------
//
// # What this page does about a folded row, and why it says so out loud
//
// `/workouts` shows ONE row for a session two devices recorded, so opening that
// row could easily show one recording's numbers and never mention the other —
// which is the failure worth preventing here. It does not happen: the page shows
// **the recording you opened**, whole and unmixed, and this section says that in
// as many words, then puts the other recordings' numbers underneath with a link
// to each.
//
// ⚠️ Nothing is averaged, reconciled or preferred. Two devices measuring the
// same half hour disagree, and which of them to believe is a judgement only the
// person can make — the page puts the numbers side by side and says nothing
// about which is right. That is the phone's position (`WorkoutDetailView`), and
// `ADR-0007` is where its line is drawn.

function DuplicateSection({ workout }: { workout: Workout }) {
  const { t, tp } = useI18n()

  // Only as far back as this session needs. Sharing the key with the list means
  // arriving from a row costs nothing at all — the pages are already cached.
  const start = startMs(workout)
  const history = useWorkoutHistory(Number.isNaN(start) ? undefined : start - NEIGHBOUR_MARGIN_MS)

  const group = useMemo<WorkoutGroup | undefined>(() => {
    const mine = workout.id
    if (!mine) return undefined
    // The opened recording is put in itself, in case the walk has not reached
    // its page yet — without it the fold would be computed over a list that does
    // not contain the session at all.
    const pool = history.items.some((w) => w.id === mine)
      ? history.items
      : [...history.items, workout]
    return groupSessions(pool).find(
      (g) => g.primary.id === mine || g.others.some((o) => o.id === mine),
    )
  }, [history.items, workout])

  if (!group || group.count < 2) {
    // Nothing is said while the walk is still going: a session that turns out to
    // be singly recorded should not have flashed a caveat about duplicates.
    return history.stillLoading && !history.isLoading ? (
      <p className="subtle" style={{ marginBottom: 12 }}>
        {t('workout.dup.checking')}
      </p>
    ) : null
  }

  const others = [group.primary, ...group.others].filter((o) => o.id !== workout.id)
  const secondary = group.primary.id !== workout.id

  // The stack above supplies the space; nothing here carries its own.
  return (
    <Card title={t('workout.dup.title')}>
      <p className="subtle" style={{ marginTop: 0 }}>
        {tp('workout.dup.body', group.count)}
      </p>
      {/* The sentence that makes the fold safe to open: everything above is
          ONE recording's, and the page never mixes the two. */}
      <p className="subtle">{t('workout.dup.thisOnly')}</p>
      {secondary && <p className="subtle">{t('workout.dup.secondary')}</p>}

      <div className="dup-list">
        {others.map((o) => (
          <OtherRecording key={o.id} workout={o} isListed={o.id === group.primary.id} />
        ))}
      </div>

      {/* ⚠️ Stated rather than acted on. Deleting a duplicate would mean
          writing to somebody's Health data on a guess about which device to
          trust — `ADR-0007` is where the app's line is. */}
      <p className="subtle" style={{ marginBottom: 0 }}>
        {t('workout.dup.keep')}
      </p>
    </Card>
  )
}

function OtherRecording({ workout, isListed }: { workout: Workout; isListed: boolean }) {
  const { t } = useI18n()
  const f = useFormat()

  const facts: string[] = []
  const min = durationMin(workout)
  if (min != null) facts.push(f.duration(min))
  if (workout.total_distance_m != null && workout.total_distance_m > 0)
    facts.push(f.km(workout.total_distance_m))
  if (workout.avg_heart_rate != null && workout.avg_heart_rate > 0)
    facts.push(`${f.num(workout.avg_heart_rate)} ${t('unit.bpm')}`)
  if (workout.total_energy_kcal != null && workout.total_energy_kcal > 0)
    facts.push(`${f.num(workout.total_energy_kcal)} kcal`)

  return (
    <div className="dup-row">
      <Link className="row-link" to={`/workouts/${workout.id ?? ''}`}>
        {f.dateTime(workout.started_at)}
        {workout.ended_at ? `–${f.time(workout.ended_at)}` : ''}
      </Link>
      <span className="subtle">
        {/* ⚠️ Not a row of dashes. A recording that measured nothing says so in a
            sentence, because a line of "–" reads as a rendering failure. */}
        {facts.length > 0 ? facts.join(' · ') : t('workout.dup.noMeasurement')}
      </span>
      {isListed && <span className="dup-badge">{t('workout.dup.listed')}</span>}
    </div>
  )
}

// --- Where it came from ------------------------------------------------------

function SourceSection({ workout }: { workout: Workout }) {
  const { t } = useI18n()
  const q = useQuery({
    queryKey: ['heartRate', workout.started_at, workout.ended_at],
    queryFn: () => loadHeartRate(workout.started_at as string, workout.ended_at as string),
    enabled: Boolean(workout.started_at && workout.ended_at),
  })

  const devices = useMemo(() => {
    const seen = new Set<string>()
    for (const s of q.data?.items ?? []) {
      if (s.data_type === 'heartRate' && s.source_device) seen.add(s.source_device)
    }
    return [...seen].sort()
  }, [q.data])

  return (
    <Card title={t('workout.source.title')}>
      <dl className="kv">
        {devices.length > 0 && (
          <>
            <dt>{t('workout.hr.title')}</dt>
            {/* ⚠️ Anything the contract does not name is printed as it arrived,
                not run through `t()`. A missing key would come back `undefined`
                and take the interpolator down with it. */}
            <dd>
              {devices
                .map((d) => (d === 'watch' || d === 'iphone' ? t(`device.${d}`) : d))
                .join(' · ')}
            </dd>
          </>
        )}
        {workout.source_uuid && (
          <>
            <dt>{t('workout.source.uuid')}</dt>
            <dd>
              <code>{workout.source_uuid}</code>
            </dd>
          </>
        )}
      </dl>
      {/* ⚠️ The gap, named rather than papered over. On the phone each block is
          attributed separately out of HealthKit; the contract carries a source
          device on samples only, so nothing here can say which app recorded the
          session itself or wrote the route. */}
      <p className="subtle" style={{ marginBottom: 0 }}>
        {t('workout.source.gap')}
      </p>
    </Card>
  )
}
