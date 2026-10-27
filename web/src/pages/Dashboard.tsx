// The landing page — the day, in bands.
//
// # What this page is arranged from
//
// The phone answered the same question first, and the answer is
// `HelsaKit/.../Dashboard/DashboardCard.swift`: twelve cards under four named
// headings, where the heading is "an editorial claim — this is something you are
// expected to touch today versus this is something to look at". The bands here
// are the phone's, in the phone's order, with the phone's own one-line
// explanations under them.
//
// ⚠️ **One of the four bands cannot exist here, and that is not an omission.**
// The phone's first band is "What today asks of you" — the journal, the water
// log, the event markings, the appointment sheet. All four are *writes* into
// HealthKit, and the phone is the only thing that can write (docs/03: there is
// no cloud API, the iPhone is the sole uploader). A read-only dashboard has
// nothing to put under that heading, so it does not draw the heading.
//
// # Why the cards are laid out across rather than one under another
//
// A phone shows one card at a time and pages through the rest; a browser shows
// the whole band at once. That is the web's one advantage over the app and it is
// the reason not to copy the app's five tabs — so each band is a grid, and the
// page ends where the day's information ends rather than 900 pixels down with
// the screen half empty.
//
// How MANY across is not decided here and is not decided anywhere: the bands are
// `.grid`, whose tracks are sized from the window (`global.css`). Two on a
// phone, three on a laptop, four on a desktop — the same cards, arranged by the
// room there is.
//
// # The rules every card here obeys
//
//   1. **A missing measurement is never a zero.** There is no `?? 0` on this
//      page. The one `?? 0` in the whole product is inside `Ring`, where an arc
//      has to have a length, and it is commented at the call site.
//   2. **No score, no grade, no verdict.** Counts, durations and the person's own
//      milestones. Nothing here says whether the day was good.
//   3. **Every card fails on its own.** The day's summary is the page's spine, so
//      a failure there is the page's failure — a missing token is exactly that
//      case, and one big explanation beats nine copies of it. Everything else
//      says what went wrong inside its own card and leaves the rest standing.

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Fragment } from 'react'
import { Link } from 'react-router-dom'
import { newestActivity } from '../lib/activity'
import { api, browserTz } from '../api/client'
import type { ApiError } from '../api/client'
import type { Device } from '../api/types'
import { ActivityIcon } from '../components/ActivityIcon'
import { Empty, ErrorState, Loading, PageHead, Ring } from '../components/ui'
import { useI18n } from '../i18n'
import { STAGE_COLOR, isoDaysAgo, useFormat } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'
import {
  ACHIEVEMENT_KIND_LABEL,
  badgeLabel,
  groupAchievements,
  periodLabel,
} from '../lib/achievements'
import { groupInsights } from '../lib/insights'
import { gaps, tally } from '../lib/coverage'
import { groupByNight } from '../lib/sleep'
import { etaMinutes, syncState, toneOf, isApiTooOld, type SyncState } from '../lib/ingest'
import { useIngestStatus } from '../lib/useIngestStatus'
import { durationMin, isIndoor } from '../lib/workouts'

/**
 * The four tiles, in the mockup's order.
 *
 * ⚠️ Heart rate's daily average gave way to HRV here, as the approved design
 * has it: an average of every beat since midnight is the least telling number
 * the day carries, and it is one click away on Trends, where each tile leads.
 */
const TODAY = ['stepCount', 'activeEnergy', 'restingHeartRate', 'hrv'].map(metricDef)
const TODAY_WIRE = TODAY.flatMap((d) => [d.key, ...d.aliases])

/** The window the completeness card asks about — the shortest the page offers. */
const COVERAGE_DAYS = 30

/** How many observations and medal families a summary card lists before it stops. */
const CARD_LIST_LIMIT = 3

/** How often the header pill and the sync card re-read the queue. */
const QUEUE_POLL_MS = 15_000

/** The stages the last-night card names, in the order the bar draws them. */
const NIGHT_STAGES = ['deep', 'core', 'rem', 'awake'] as const

export default function Dashboard() {
  const tz = browserTz()
  const { t } = useI18n()
  const f = useFormat()

  const summary = useQuery({
    queryKey: ['summary', 'day', tz],
    queryFn: () => api.summary('day', TODAY_WIRE, tz),
  })

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.devices() })
  const ingest = useIngestStatus(QUEUE_POLL_MS)

  if (summary.isLoading) return <Loading />
  if (summary.isError) return <ErrorState error={summary.error} />

  const metrics = summary.data?.metrics ?? {}

  // The most recent device heartbeat: this is what says whether data is still
  // arriving at all.
  const lastSeen = devices.data
    ?.map((d) => d.last_seen_at)
    .filter(Boolean)
    .sort()
    .at(-1)

  const hasAny = Object.values(metrics).some((m) => (m.buckets?.length ?? 0) > 0 || m.total != null)

  return (
    <>
      <PageHead
        title={t('dashboard.title')}
        subtitle={
          <>
            {f.date(summary.data?.from)} · {t('dashboard.tz', { tz: summary.data?.tz ?? tz })}
            {lastSeen ? ` · ${t('dashboard.lastSync', { when: f.relative(lastSeen) })}` : ''}
          </>
        }
        aside={<SyncPill query={ingest} />}
      />

      {!hasAny && (
        <div style={{ marginBottom: 24 }}>
          <Empty title={t('dashboard.empty.title')} hint={t('dashboard.empty.hint')} />
        </div>
      )}

      <Band id="band-today" title={t('today.band.today')} hint={t('today.band.today.hint')}>
        <div className="grid grid-4">
          {TODAY.map((def) => (
            <TodayTile key={def.key} metricKey={def.key} metrics={metrics} />
          ))}
        </div>
        <div className="grid grid-3">
          <RingsCard tz={tz} />
          <LatestWorkoutCard />
          <LastNightCard tz={tz} />
        </div>
      </Band>

      <Band id="band-long" title={t('nav.group.longView')} hint={t('today.band.longView.hint')}>
        <div className="grid grid-3">
          <ChallengeCard tz={tz} />
          <ObservationsCard />
          <MedalsCard />
        </div>
      </Band>

      <Band id="band-status" title={t('nav.group.status')} hint={t('today.band.status.hint')}>
        <div className="grid grid-2">
          <SyncCard devicesQuery={devices} ingest={ingest} />
          <CoverageCard tz={tz} />
        </div>
      </Band>
    </>
  )
}

// --- The frame -------------------------------------------------------------

/**
 * One band: a heading, the sentence saying what the heading claims, and the
 * cards. The explanation line is what stops "The long view" from being three
 * words nobody can act on.
 */
function Band({
  id,
  title,
  hint,
  children,
}: {
  id: string
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <section className="band" aria-labelledby={id}>
      <header className="band-header">
        <h2 className="band-title" id={id}>
          {title}
        </h2>
        <p className="band-hint">{hint}</p>
      </header>
      {children}
    </section>
  )
}

/**
 * A card that IS the link to the page it summarises — one thing to click, named
 * by its title. Nothing inside it may be interactive (a link in a link is
 * invalid and unreachable by keyboard), and nothing inside it is.
 */
function LinkCard({ to, title, children }: { to: string; title: string; children: ReactNode }) {
  return (
    <Link className="card" to={to}>
      <h3 className="card-title">{title}</h3>
      {children}
    </Link>
  )
}

/** Label-and-figure pairs. */
function Rows({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="kv">
      {items.map((it) => (
        <Fragment key={it.label}>
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

/**
 * What a card shows while it is loading, when it failed, and when the answer is
 * "nothing arrived".
 *
 * ⚠️ The failure is one line rather than the full `ErrorState`. A 401 takes the
 * whole page (see the file header), so anything reaching here is one endpoint
 * having a bad day.
 */
function CardState({
  query,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<unknown>
  isEmpty: boolean
  empty: ReactNode
  children: ReactNode
}) {
  const { t } = useI18n()
  if (query.isPending) return <div className="skeleton" style={{ height: 72 }} />
  if (query.isError) {
    const e = query.error as ApiError
    return (
      <p className="subtle" style={{ margin: 0 }}>
        {t('today.cardError', { reason: e?.message ?? t('error.generic.title') })}
      </p>
    )
  }
  return <>{isEmpty ? empty : children}</>
}

/** The sentence a card prints instead of numbers it does not have. */
function Nothing({ children }: { children: ReactNode }) {
  return (
    <p className="subtle" style={{ margin: 0 }}>
      {children}
    </p>
  )
}

// --- The header pill: the queue in one sentence ----------------------------

/**
 * The queue, said once at the top of the page.
 *
 * ⚠️ **"Up to date" only when it is.** The phone reports "synced" the moment it
 * has HANDED the data over; the server may still be writing it for half an hour,
 * and every page reads short until it is done. So the pill reads the queue, not
 * the phone: while parts wait it says so and how long the estimate is, and it
 * links to the page that explains. It says nothing at all before the first
 * reading or when the request failed — no pill is better than a guessed one.
 */
export function SyncPill({ query }: { query: UseQueryResult<import('../api/types').IngestStatus> }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  if (query.isError) {
    // A 404 is a server older than this page — worth one quiet line, since the
    // queue page explains what to do.
    return isApiTooOld(query.error) ? (
      <Link className="pill pill--stalled" to="/ingest">
        <span className="dot" aria-hidden="true" />
        {t('today.pill.apiOld')}
      </Link>
    ) : null
  }
  const s = query.data
  if (!s) return null
  const state = syncState(s)
  const eta = etaMinutes(s)
  const text: Record<SyncState, string> = {
    upToDate: t('today.pill.upToDate'),
    writing:
      eta != null
        ? t('today.pill.writingEta', { duration: f.duration(eta) })
        : t('today.pill.writing'),
    stalled: t('today.pill.stalled'),
    noConsumer: t('today.pill.noConsumer'),
    setAside: tp('today.pill.setAside', s.dead_letter?.ready ?? 0),
    unknown: t('today.pill.unknown'),
  }
  return (
    <Link className={`pill pill--${toneOf(state)}`} to="/ingest" data-state={state}>
      <span className="dot" aria-hidden="true" />
      {text[state]}
    </Link>
  )
}

// --- Band 1: today, about you ----------------------------------------------

/**
 * One of the four figures: a dot in the metric's colour, the number in text
 * colour, and one line under it. ⛔ No progress bar — there is no honest
 * denominator for "steps today" — and a dash, dimmed, when nothing arrived.
 * The whole tile opens Trends on this metric.
 */
function TodayTile({
  metricKey,
  metrics,
}: {
  metricKey: string
  metrics: Parameters<typeof pickSeries>[1]
}) {
  const { t, tMetric } = useI18n()
  const f = useFormat()
  const def = metricDef(metricKey)
  // For a summed metric, the sum of today's hourly buckets; for an averaged one,
  // their daily average — readSeries handles the difference, not the tile.
  const r = readSeries(def, pickSeries(def, metrics))
  const missing = r.total == null
  const unit = f.unit(r.unit)
  return (
    <Link
      className="card stat-card stat-big"
      to={`/trends?metric=${encodeURIComponent(def.key)}`}
    >
      <h3 className="card-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="dot" aria-hidden="true" style={{ background: def.color }} />
        {tMetric(def.key)}
      </h3>
      <div className={`stat${missing ? ' is-missing' : ''}`}>
        {f.fmt(r.total, def.digits)}
        {!missing && unit ? <small>{unit}</small> : null}
      </div>
      <p className="stat-note">
        {missing
          ? t('today.tile.notMeasured')
          : r.effectiveAgg === 'avg'
            ? t('today.tile.average')
            : t('today.tile.soFar')}
      </p>
    </Link>
  )
}

function RingsCard({ tz }: { tz: string }) {
  const { t } = useI18n()
  const f = useFormat()
  const q = useQuery({
    queryKey: ['activity', 'today', tz],
    queryFn: () => api.activity(undefined, undefined, tz),
  })

  // ⚠️ NOT `at(-1)`: the query asks for a window, and its newest entry is not
  // necessarily today's — see `newestActivity`.
  const newest = newestActivity(q.data)
  const rings = newest?.summary

  return (
    <article className="card">
      <h3 className="card-title">{t('dashboard.rings.title')}</h3>
      <CardState
        query={q}
        isEmpty={!rings}
        empty={<Nothing>{t('dashboard.rings.empty.hint')}</Nothing>}
      >
        {/* When the newest summary is older than today, the card says which day
            it is for instead of quietly implying this morning. */}
        {newest && !newest.isToday && newest.summary.day ? (
          <p className="subtle" style={{ margin: '-6px 0 10px' }}>
            {f.date(newest.summary.day)}
          </p>
        ) : null}
        <div className="rings">
          <Ring
            label={t('dashboard.rings.move')}
            value={rings?.active_energy}
            goal={rings?.active_energy_goal}
            unit="kcal"
            color="var(--helsa-ember)"
            size={64}
          />
          <Ring
            label={t('dashboard.rings.exercise')}
            value={rings?.exercise_minutes}
            goal={rings?.exercise_goal}
            unit={t('unit.minShort')}
            color="var(--helsa-move)"
            size={64}
          />
          <Ring
            label={t('dashboard.rings.stand')}
            value={rings?.stand_hours}
            goal={rings?.stand_goal}
            unit={t('unit.hourShort')}
            color="var(--helsa-fjord)"
            size={64}
          />
        </div>
      </CardState>
    </article>
  )
}

function LatestWorkoutCard() {
  const { t } = useI18n()
  const f = useFormat()
  // A key of its own: the Workouts page keeps the whole history under
  // `['workouts', …]` and this needs one row.
  const q = useQuery({ queryKey: ['workouts', 'latest'], queryFn: () => api.workouts(1) })
  const w = q.data?.items?.[0]
  const indoor = w ? isIndoor(w) : null
  const minutes = w ? durationMin(w) : null

  const facts: string[] = []
  if (w) {
    if (minutes != null) facts.push(f.duration(minutes))
    if (w.total_distance_m != null && w.total_distance_m > 0) facts.push(f.km(w.total_distance_m))
    if (w.total_energy_kcal != null && w.total_energy_kcal > 0)
      facts.push(`${f.num(w.total_energy_kcal)} kcal`)
    if (w.avg_heart_rate != null && w.avg_heart_rate > 0)
      facts.push(`${f.num(w.avg_heart_rate)} ${t('unit.bpm')}`)
  }

  return (
    <LinkCard to={w?.id ? `/workouts?w=${encodeURIComponent(w.id)}` : '/workouts'} title={t('today.workout.title')}>
      <CardState query={q} isEmpty={!w} empty={<Nothing>{t('today.workout.empty')}</Nothing>}>
        {w && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            <span className="wo-icon wo-icon-lg">
              <ActivityIcon type={w.activity_type} size={24} />
            </span>
            <span className="wo-text">
              <strong style={{ fontWeight: 600, fontSize: 16 }}>{f.activityName(w.activity_type)}</strong>
              {/* ⚠️ Only what was measured; a missing figure is left out of
                  the line rather than printed as a dash in a sentence. */}
              <span className="wo-line">{facts.length > 0 ? facts.join(' · ') : '–'}</span>
              <span className="wo-date">
                {f.dateTime(w.started_at)}
                {indoor !== null &&
                  ` · ${t(indoor ? 'workouts.place.indoor' : 'workouts.place.outdoor').toLowerCase()}`}
              </span>
            </span>
          </div>
        )}
      </CardState>
    </LinkCard>
  )
}

function LastNightCard({ tz }: { tz: string }) {
  const { t, tStage } = useI18n()
  const f = useFormat()
  // Two days back, not one: a night is identified by the morning it ends on, and
  // asking only for today would miss every segment written before midnight.
  const q = useQuery({
    queryKey: ['sleep', 'lastNight', tz],
    queryFn: () => api.sleep(isoDaysAgo(2), isoDaysAgo(0), tz),
  })
  // `groupByNight` returns the sessions newest first.
  const night = groupByNight(q.data ?? [])[0]
  // Only the stages the night actually carries: an "Asleep (unspecified)" night
  // from an older watch has no deep/core/REM, and four zero-width segments with
  // "0 min" under them would be four claims nobody measured.
  const stages = night
    ? NIGHT_STAGES.filter((k) => (night.stages[k] ?? 0) > 0)
    : []
  const unstaged = night ? (night.stages.asleep ?? 0) : 0

  return (
    <LinkCard to="/sleep" title={t('today.sleep.title')}>
      <CardState query={q} isEmpty={!night} empty={<Nothing>{t('today.sleep.empty')}</Nothing>}>
        {night && (
          <>
            <p className="card-headline">
              {f.duration(night.asleepMin)}
              <small>{t('today.sleep.asleep')}</small>
            </p>
            <p className="subtle" style={{ margin: '0 0 10px' }}>
              {f.date(night.key)}
            </p>
            {stages.length > 0 && (
              <>
                <div className="hypnogram" style={{ height: 10, marginBottom: 10 }} aria-hidden="true">
                  {stages.map((k) => (
                    <span key={k} style={{ flex: night.stages[k], background: STAGE_COLOR[k] }} />
                  ))}
                </div>
                <ul className="stage-list">
                  {stages.map((k) => (
                    <li key={k}>
                      <span className="swatch" aria-hidden="true" style={{ background: STAGE_COLOR[k] }} />
                      {tStage(k)} {f.duration(night.stages[k])}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {stages.length === 0 && unstaged > 0 && (
              <p className="subtle" style={{ margin: 0 }}>
                {t('today.sleep.noStages')}
              </p>
            )}
          </>
        )}
      </CardState>
    </LinkCard>
  )
}

// --- Band 2: the long view -------------------------------------------------

function ChallengeCard({ tz }: { tz: string }) {
  const { t } = useI18n()
  const f = useFormat()
  const q = useQuery({
    queryKey: ['challenge', 'current', tz],
    queryFn: () => api.challenge(undefined, tz),
  })
  const c = q.data
  // ⚠️ `steps` is absent — not zero — until one day of the month has been
  // measured. The card says so rather than printing a month of nothing walked.
  const hasData = c?.steps != null
  const reached = c?.thresholds.filter((m) => m.reached).length ?? 0
  const allReached = c != null && c.thresholds.length > 0 && reached === c.thresholds.length

  return (
    <LinkCard to="/challenge" title={t('nav.challenge')}>
      <CardState query={q} isEmpty={!c} empty={<Nothing>{t('challenge.notStarted')}</Nothing>}>
        {c && (
          <>
            <p className="card-headline" style={{ color: hasData ? 'var(--move-text)' : undefined }}>
              {f.num(c.steps)}
              {hasData && <small>{t('today.challenge.steps')}</small>}
            </p>
            <p className="subtle" style={{ margin: '0 0 10px' }}>
              {f.yearMonth(`${c.month}-01`)}
            </p>
            {/* A bar only where the API sent the share itself — the percentage is
                the server's, and it is absent before the first measured day. */}
            {c.percent != null && (
              <div
                className="bar"
                role="img"
                aria-label={`${t('challenge.ofGoal')}: ${f.percent(c.percent / 100, 0)}`}
                style={{ marginBottom: 10 }}
              >
                <span
                  style={{
                    width: `${Math.min(100, Math.max(0, c.percent))}%`,
                    background: 'var(--helsa-move)',
                  }}
                />
              </div>
            )}
            <Rows
              items={[
                {
                  label: t('challenge.ofGoal'),
                  // `percent` arrives on the 0…100 scale and the formatter wants
                  // a ratio; `null` when absent, never a zero standing in.
                  value: f.percent(c.percent != null ? c.percent / 100 : null, 0),
                },
                { label: t('challenge.stepsPerDay'), value: f.num(c.steps_per_day) },
                { label: t('challenge.daysRemaining'), value: f.num(c.days_remaining) },
              ]}
            />
            <p className="subtle" style={{ margin: '10px 0 0' }}>
              {c.goal != null && `${t('challenge.goalLabel', { steps: f.num(c.goal) })} · `}
              {!hasData
                ? t('challenge.empty.title')
                : allReached
                  ? t('today.challenge.allMilestones', { n: c.thresholds.length })
                  : c.complete
                    ? t('challenge.complete')
                    : c.next_threshold != null && c.steps_to_next_threshold != null
                      ? t('challenge.milestones.next', {
                          steps: f.num(c.next_threshold),
                          remaining: f.num(c.steps_to_next_threshold),
                        })
                      : null}
            </p>
          </>
        )}
      </CardState>
    </LinkCard>
  )
}

function ObservationsCard() {
  const { t, tp, tMetric } = useI18n()
  const q = useQuery({ queryKey: ['insights'], queryFn: () => api.insights() })

  // `groupInsights` already ranks them: the families that can be news today
  // first, and within each the server's own severity before recency.
  const ordered = groupInsights(q.data ?? []).flatMap((g) => g.items)
  const first = ordered[0]
  const shown = ordered.slice(1, CARD_LIST_LIMIT)
  const rest = ordered.length - 1 - shown.length

  return (
    <LinkCard to="/insights" title={t('nav.insights')}>
      <CardState
        query={q}
        isEmpty={ordered.length === 0}
        empty={<Nothing>{t('insights.empty.title')}</Nothing>}
      >
        {first && (
          <p className="card-lead">
            {/* ⚠️ `lang="hu"` is honest markup: the schema states that these
                sentences are the server's, and this server speaks Hungarian. */}
            {first.title?.trim() ? <span lang="hu">{first.title}</span> : t('insights.unnamed')}
            {first.metric && (
              <span className="subtle" style={{ fontWeight: 400, fontSize: 14 }}>
                {' '}
                · {tMetric(first.metric)}
              </span>
            )}
          </p>
        )}
        {shown.length > 0 && (
          <ul className="card-list">
            {shown.map((insight, i) => (
              <li key={insight.id ?? i}>
                {insight.title?.trim() ? (
                  <span lang="hu">{insight.title}</span>
                ) : (
                  <span className="subtle">{t('insights.unnamed')}</span>
                )}
                {insight.metric && <span className="subtle"> · {tMetric(insight.metric)}</span>}
              </li>
            ))}
          </ul>
        )}
        {rest > 0 && (
          <p className="subtle" style={{ margin: '8px 0 0' }}>
            {tp('today.insights.more', rest)}
          </p>
        )}
        <p className="subtle" style={{ margin: '8px 0 0' }}>
          {t('today.insights.serverLanguage')}
        </p>
      </CardState>
    </LinkCard>
  )
}

function MedalsCard() {
  const { t, tp } = useI18n()
  const f = useFormat()
  const q = useQuery({ queryKey: ['achievements'], queryFn: () => api.achievements() })

  const items = q.data ?? []
  const groups = groupAchievements(items)
  // The newest badge of each family is that family's first row; the newest
  // overall is the newest of those.
  const newest = groups
    .map((g) => g.items[0])
    .filter((a) => a?.earned_at)
    .sort((a, b) => (b.earned_at ?? '').localeCompare(a.earned_at ?? ''))[0]

  return (
    <LinkCard to="/achievements" title={t('nav.achievements')}>
      <CardState
        query={q}
        isEmpty={items.length === 0}
        empty={<Nothing>{t('achievements.empty.title')}</Nothing>}
      >
        <p className="card-headline">
          {f.num(items.length)}
          <small>{tp('today.medals.earned', items.length)}</small>
        </p>
        {newest && (
          <p className="subtle" style={{ margin: '4px 0 10px' }}>
            {/* ⚠️ A milestone has no period — it was crossed once — so the
                sentence has two forms rather than one ending in a dash. */}
            {newest.period
              ? t('today.medals.newest', {
                  badge: badgeLabel(newest, t),
                  period: periodLabel(newest.period, f),
                })
              : t('today.medals.newest.noPeriod', { badge: badgeLabel(newest, t) })}
          </p>
        )}
        <Rows
          items={groups.slice(0, CARD_LIST_LIMIT).map((g) => ({
            label: t(ACHIEVEMENT_KIND_LABEL[g.key]),
            value: f.num(g.items.length),
          }))}
        />
      </CardState>
    </LinkCard>
  )
}

// --- Band 3: status --------------------------------------------------------

/**
 * Sync — the phone's last upload AND what the server still has to write of it.
 *
 * ⚠️ These are two halves of one question and the card used to answer only the
 * first: "the iPhone uploaded four minutes ago" reads as "everything is in" while
 * the worker has an hour of it still to write. So the card leads to the queue
 * page, and its last line is the queue's state.
 */
function SyncCard({
  devicesQuery,
  ingest,
}: {
  devicesQuery: UseQueryResult<Device[]>
  ingest: UseQueryResult<import('../api/types').IngestStatus>
}) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const devices = devicesQuery.data ?? []
  const newest = [...devices]
    .filter((d) => d.last_seen_at)
    .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''))[0]
  const name = (d: Device) => d.name ?? d.model ?? d.platform ?? '–'

  const s = ingest.data
  const state = s ? syncState(s) : undefined
  const eta = s ? etaMinutes(s) : undefined
  const tone = state ? toneOf(state) : undefined
  const waiting = s?.queue?.ready ?? 0

  let queueLine: string | null = null
  if (ingest.isError) queueLine = isApiTooOld(ingest.error) ? t('today.pill.apiOld') : null
  else if (state === 'writing')
    queueLine =
      eta != null
        ? tp('today.sync.writingEta', waiting, { n: f.num(waiting), duration: f.duration(eta) })
        : tp('today.sync.writing', waiting, { n: f.num(waiting) })
  else if (state === 'stalled' || state === 'noConsumer')
    queueLine = tp('today.sync.stuck', waiting, { n: f.num(waiting) })
  else if (state === 'setAside') queueLine = tp('today.pill.setAside', s?.dead_letter?.ready ?? 0)
  else if (state === 'unknown') queueLine = t('today.pill.unknown')
  else if (state === 'upToDate') queueLine = t('today.sync.allWritten')

  return (
    <LinkCard to="/ingest" title={t('today.sync.title')}>
      <CardState
        query={devicesQuery}
        isEmpty={devices.length === 0}
        empty={<Nothing>{t('settings.devices.empty')}</Nothing>}
      >
        {newest && (
          <p className="card-lead">
            {t('today.sync.uploaded', { device: name(newest), when: f.relative(newest.last_seen_at) })}
          </p>
        )}
        {queueLine && (
          <p
            className={`${tone && tone !== 'ok' ? `tone-${tone}` : 'subtle'}`}
            style={{ margin: '0 0 10px', fontSize: 13 }}
          >
            {queueLine}
          </p>
        )}
        {devices.length > 1 && (
          <Rows
            items={devices.map((d) => ({
              label: name(d),
              value: f.relative(d.last_seen_at),
            }))}
          />
        )}
        <p className="subtle" style={{ margin: '10px 0 0' }}>
          {t('settings.system.browserTz')}: {browserTz()}
        </p>
      </CardState>
    </LinkCard>
  )
}

function CoverageCard({ tz }: { tz: string }) {
  const { t, tp, tMetric } = useI18n()
  const from = isoDaysAgo(COVERAGE_DAYS - 1)
  const to = isoDaysAgo(0)
  // The same key shape the Completeness page uses, so arriving there from here
  // costs no second request.
  const q = useQuery({
    queryKey: ['coverage', from, to, tz],
    queryFn: () => api.coverage(from, to, tz),
  })

  const counts = tally(q.data)
  const broken = gaps(q.data?.types ?? [])

  return (
    <LinkCard to="/coverage" title={t('coverage.title')}>
      <CardState
        query={q}
        isEmpty={counts.total === 0}
        empty={<Nothing>{t('coverage.empty.title')}</Nothing>}
      >
        {broken.length > 0 ? (
          <>
            <p className="card-lead">{tp('today.coverage.gaps', broken.length)}</p>
            <ul className="card-list" style={{ marginBottom: 8 }}>
              {broken.slice(0, CARD_LIST_LIMIT).map((row) => (
                <li key={row.data_type}>
                  {tMetric(row.data_type ?? '')}
                  <span className="subtle">
                    {' · '}
                    {tp('coverage.gaps.silent', row.gap?.silent_days ?? 0)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="card-lead">{t('today.coverage.noGaps')}</p>
        )}
        {/* ⛔ Two counts and no percentage, on purpose. "52 of 120 types brought
            data" is a fact; the same thing as 43% is a score. */}
        <p className="subtle" style={{ margin: 0 }}>
          {t('coverage.headline', {
            measured: counts.measured,
            total: counts.total,
            days: q.data?.days ?? COVERAGE_DAYS,
          })}
        </p>
      </CardState>
    </LinkCard>
  )
}
