import { Suspense, lazy, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import { Card, Empty, ErrorState, Loading, Note, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { useFormat } from '../lib/format'
import {
  journeyLines,
  journeyProgress,
  loadCatalogue,
  local,
  projectJourney,
  routeById,
  travelledFrom,
  type JourneyRoute,
} from '../lib/journey'
import { attributionKey, mapSourceUsable, mapSupported, readMapSource } from '../lib/routeMap'
import { useToday } from '../lib/useToday'

// The basemap is the workout page's, loaded the same lazy way — see the header
// of `components/RouteMap.tsx`.
const RouteMap = lazy(() => import('../components/RouteMap'))

const MAP_W = 640
const MAP_H = 360

/**
 * The virtual journey — the phone's journey screen, read off the server.
 *
 * The phone decides which route and from which day, and uploads exactly that
 * (`/v1/settings` → `journey`, app 1.0 (7) on). The route is drawn from the web's
 * generated copy of the app's catalogue, and the distance is `/summary`'s from
 * the start day to today — the same request the phone's `JourneyViewModel`
 * makes, answered by the server instead of HealthKit.
 *
 * Three states this page refuses to blur, because each is a different sentence:
 *
 *  1. **The phone has not said** (no `journey` block): an older app or server.
 *     Not "no journey" — we do not know that.
 *  2. **No journey running** (an empty block): the phone said so.
 *  3. **A route this page does not know**: the app is newer than the dashboard.
 *     The id is shown, and nothing is drawn rather than something wrong.
 *
 * And the two rules from the phone: no measurement is not zero, and the
 * percentage divides by the PUBLISHED length (`lib/journey.ts`).
 *
 * ⚠️ The source note carries the track's OpenStreetMap credit (ODbL). It is not
 * optional decoration: it is printed whenever the route is.
 */
export default function Journey() {
  const { t } = useI18n()

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.settings() })
  const catalogue = useQuery({
    queryKey: ['journeyCatalogue'],
    queryFn: loadCatalogue,
    staleTime: Infinity,
  })

  const body = (() => {
    if (settings.isPending || catalogue.isPending) return <Loading rows={3} />
    if (settings.isError) return <ErrorState error={settings.error} />
    if (catalogue.isError) return <ErrorState error={catalogue.error} />
    const block = settings.data.journey
    if (block == null) {
      return <Empty title={t('journey.unknown.title')} hint={t('journey.unknown.hint')} />
    }
    if (block.route_id == null || block.started_on == null) {
      return <Empty title={t('journey.none.title')} hint={t('journey.none.hint')} />
    }
    const route = routeById(catalogue.data.routes, block.route_id)
    if (!route) {
      return (
        <Note title={t('journey.unknownRoute.title')}>
          {t('journey.unknownRoute.body', { id: block.route_id })}
        </Note>
      )
    }
    return <JourneyBody route={route} startedOn={block.started_on} />
  })()

  return (
    <>
      <h1>{t('journey.title')}</h1>
      <p className="subtle">{t('journey.subtitle')}</p>
      {body}
    </>
  )
}

function movementKey(metric: string): UiKey {
  return metric === 'distanceCycling' ? 'journey.movement.cycling' : 'journey.movement.walking'
}

function JourneyBody({ route, startedOn }: { route: JourneyRoute; startedOn: string }) {
  const { t, lang } = useI18n()
  const f = useFormat()
  const tz = browserTz()
  const today = useToday()
  // A start day after today (a phone whose clock was ahead, or a plan) has
  // nothing to sum yet; asking the server for a window that ends before it begins
  // would be an error dressed as a measurement.
  const notStarted = startedOn > today

  const q = useQuery({
    queryKey: ['journey', route.id, startedOn, today, tz],
    // `year` is the bucket width, not the window — monthly buckets for one total,
    // exactly as the phone asks (`JourneyViewModel.load`).
    queryFn: () => api.summary('year', route.distance_metrics, tz, startedOn, today),
    enabled: !notStarted,
  })

  const travelled = notStarted ? undefined : travelledFrom(q.data?.metrics, route.distance_metrics)
  const progress = journeyProgress(route, travelled)
  // Keyed on what the lines depend on, not on the progress object (a new one each
  // render): the Appalachian Trail decodes to thousands of points.
  const { fraction, hasData } = progress
  const lines = useMemo(() => journeyLines(journeyProgress(route, hasData ? fraction * route.total_m : undefined)), [route, fraction, hasData])
  const movement = route.distance_metrics.map((m) => t(movementKey(m))).join(' + ')

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        {/* The route's name is the page's subject, not a card label — so it is
            set as one, not in the small muted style of a card heading. */}
        <p style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 650, color: 'var(--text)' }}>
          {local(route.name, lang)}
        </p>
        <p className="subtle" style={{ margin: 0 }}>
          {local(route.subtitle, lang)}
        </p>
        <p className="subtle" style={{ margin: '6px 0 0' }}>
          {t('journey.since', { date: f.date(startedOn), movement })}
        </p>
      </div>

      {q.isError ? (
        <ErrorState error={q.error} />
      ) : q.isPending && !notStarted ? (
        <Loading rows={2} />
      ) : (
        <>
          <div className="grid grid-stats" style={{ marginBottom: 18 }}>
            <Stat label={t('journey.travelled')} value={f.km(progress.hasData ? progress.travelledM : null)} color="var(--helsa-move)" />
            <Stat
              label={t('journey.ofRoute')}
              value={f.percent(progress.hasData ? progress.fraction : null, 0)}
              color="var(--helsa-fjord)"
            />
            <Stat label={t('journey.remaining')} value={f.km(progress.hasData ? progress.remainingM : null)} color="var(--helsa-nordlys)" />
            <Stat label={t('journey.length')} value={f.km(route.total_m)} color="var(--helsa-ember)" />
          </div>

          {notStarted ? (
            <Empty title={t('journey.notStarted', { date: f.date(startedOn) })} />
          ) : !progress.hasData ? (
            <Empty title={t('journey.noData.title')} hint={t('journey.noData.hint')} />
          ) : (
            <div className="split-bar" role="img" aria-label={f.percent(progress.fraction, 0)} style={{ marginBottom: 14 }}>
              <div style={{ width: `${progress.fraction * 100}%`, background: 'var(--helsa-move)' }} />
            </div>
          )}

          {progress.complete && (
            <p className="subtle">
              {t('journey.complete')}
              {progress.overshootM > 0 && <> {t('journey.overshoot', { km: f.km(progress.overshootM) })}</>}
            </p>
          )}
          {!progress.complete && progress.hasData && progress.next && progress.toNextM != null && (
            <p className="subtle">
              {t('journey.next', { name: local(progress.next.name, lang), km: f.km(progress.toNextM) })}
            </p>
          )}

          <div className="flow" style={{ marginBottom: 16 }}>
            <JourneyMap lines={lines} />
            <Card title={t('journey.milestones')}>
              <div className="table-wrap">
                <table>
                  <tbody>
                    {route.waypoints.map((w) => {
                      const reached = progress.hasData && progress.effectiveM >= w.m
                      return (
                        <tr key={`${w.name.en}@${w.m}`}>
                          <td>
                            <span
                              className="picker-dot"
                              style={{ background: reached ? 'var(--helsa-move)' : 'var(--surface-2)' }}
                            />{' '}
                            {local(w.name, lang)}
                          </td>
                          <td className="num">{f.km(w.m)}</td>
                          <td className="num">{reached ? t('journey.reached') : '–'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}

      {/* ⚠️ The licence obligation lives in this paragraph: for a route with a
          track, `source_note` ends with the OpenStreetMap credit. */}
      <p className="subtle" style={{ fontSize: 13 }}>
        {local(route.source_note, lang)}{' '}
        {route.source_url && (
          <a href={route.source_url} target="_blank" rel="noreferrer noopener">
            {t('journey.openSource')}
          </a>
        )}
      </p>
      <p className="subtle" style={{ fontSize: 13 }}>
        {t('journey.serverNote')}
      </p>
    </>
  )
}

function JourneyMap({ lines }: { lines: ReturnType<typeof journeyLines> }) {
  const { t } = useI18n()
  const frame = useMemo(() => projectJourney(lines.whole, MAP_W, MAP_H), [lines.whole])
  const source = readMapSource()
  const chosen = mapSourceUsable(source)
  const [mapFailed, setMapFailed] = useState(false)
  const showMap = Boolean(frame && chosen && mapSupported() && !mapFailed)

  if (!frame) return null
  const here = lines.here ? frame.point(lines.here) : undefined
  const start = frame.projected.start
  const finish = frame.projected.finish

  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title" style={{ margin: 0 }}>
          {t('journey.map')}
        </h2>
        {!chosen && (
          <Link to="/settings" style={{ fontSize: 13, fontWeight: 500 }}>
            {t('workout.route.toSettings')}
          </Link>
        )}
      </div>
      <div className={`route-frame${showMap ? ' route-frame--mapped' : ''}`}>
        {showMap && (
          <Suspense fallback={null}>
            <RouteMap
              source={source}
              projected={frame.projected}
              viewBoxWidth={MAP_W}
              onFailed={() => setMapFailed(true)}
            />
          </Suspense>
        )}
        <svg className="route" viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label={t('journey.mapAria')}>
          <path
            d={frame.path(lines.remaining)}
            fill="none"
            stroke="var(--text-dim)"
            strokeOpacity={0.55}
            strokeWidth={4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={lines.isTrack ? undefined : '6 6'}
          />
          {lines.travelled.length > 1 && (
            <path
              d={frame.path(lines.travelled)}
              fill="none"
              stroke="var(--helsa-move)"
              strokeWidth={6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          <circle cx={start.x} cy={start.y} r={6} fill="var(--helsa-fjord)" />
          <circle cx={finish.x} cy={finish.y} r={6} fill="var(--helsa-ember)" />
          {here && (
            <g>
              <circle cx={here.x} cy={here.y} r={10} fill="var(--surface)" stroke="var(--helsa-move)" strokeWidth={4} />
              <title>{t('journey.here')}</title>
            </g>
          )}
        </svg>
        {showMap && <p className="route-attrib">{t(attributionKey(source.format))}</p>}
      </div>
      <p className="subtle" style={{ margin: '8px 0 0', fontSize: 13 }}>
        {lines.isTrack ? t('journey.trackNote') : t('journey.sketchNote')}
      </p>
    </section>
  )
}
