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
import { Card, Empty, ErrorState, Loading, Ring, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import { isoDaysAgo, useFormat } from '../lib/format'
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

const TODAY = ['stepCount', 'activeEnergy', 'heartRate', 'restingHeartRate'].map(metricDef)
const TODAY_WIRE = TODAY.flatMap((d) => [d.key, ...d.aliases])

/** The window the completeness card asks about — the shortest the page offers. */
const COVERAGE_DAYS = 30

/** How many observations and medal families a summary card lists before it stops. */
const CARD_LIST_LIMIT = 3

export default function Dashboard() {
  const tz = browserTz()
  const { t, tMetric } = useI18n()
  const f = useFormat()

  const summary = useQuery({
    queryKey: ['summary', 'day', tz],
    queryFn: () => api.summary('day', TODAY_WIRE, tz),
  })

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.devices() })

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
      <h1>{t('dashboard.title')}</h1>
      <p className="subtle">
        {f.date(summary.data?.from)} · {t('dashboard.tz', { tz: summary.data?.tz ?? tz })}
        {lastSeen ? ` · ${t('dashboard.lastSync', { when: f.relative(lastSeen) })}` : ''}
      </p>

      {!hasAny && (
        <div style={{ marginBottom: 18 }}>
          <Empty title={t('dashboard.empty.title')} hint={t('dashboard.empty.hint')} />
        </div>
      )}

      <Band title={t('today.band.today')} hint={t('today.band.today.hint')}>
        {/* Four figures with a label each: `grid-stats` rather than `grid`,
            because a tile that is a word and a number does not need a card's
            width — which is what gives a phone two of them across instead of
            one, and a wide screen four instead of four with a gap. */}
        <div className="grid grid-stats">
          {TODAY.map((def) => {
            // For a summed metric, the sum of today's hourly buckets; for an
            // averaged one, their daily average — readSeries handles the
            // difference, not the card.
            const r = readSeries(def, pickSeries(def, metrics))
            return (
              <Stat
                key={def.key}
                label={tMetric(def.key)}
                value={f.fmt(r.total, def.digits)}
                unit={f.unit(r.unit)}
                color={def.color}
              />
            )
          })}
        </div>
        <div className="grid grid-wide">
          <RingsCard tz={tz} />
          <LatestWorkoutCard />
          <LastNightCard tz={tz} />
        </div>
      </Band>

      <Band title={t('nav.group.longView')} hint={t('today.band.longView.hint')}>
        <div className="grid grid-wide">
          <ChallengeCard tz={tz} />
          <ObservationsCard />
          <MedalsCard />
        </div>
      </Band>

      <Band title={t('nav.group.status')} hint={t('today.band.status.hint')}>
        <div className="grid grid-wide">
          <SyncCard query={devices} />
          <CoverageCard tz={tz} />
        </div>
      </Band>
    </>
  )
}

// --- The frame -------------------------------------------------------------

/**
 * One band: a heading, the sentence saying what the heading claims, and the
 * cards.
 *
 * The explanation line is not decoration. On the phone it appears on the
 * customisation screen, where a person deciding whether to switch a card off has
 * to know what the band is for; here it is what stops "The long view" from being
 * three words nobody can act on.
 */
function Band({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  const id = `band-${title.replace(/\W+/g, '-').toLowerCase()}`
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

/** A card whose heading is the way to the page it summarises. */
function LinkCard({ to, title, children }: { to: string; title: string; children: ReactNode }) {
  return (
    <div className="card">
      <h2>
        <Link className="card-link" to={to}>
          {title}
          <span aria-hidden="true"> →</span>
        </Link>
      </h2>
      {children}
    </div>
  )
}

/** Label-and-figure pairs — the shape most of these cards want. */
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
 * having a bad day, and nine dashed boxes with the same paragraph in them would
 * bury the cards that did load.
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
  if (query.isPending) return <div className="skeleton" style={{ height: 96 }} />
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

// --- Band 1: today, about you ----------------------------------------------

function RingsCard({ tz }: { tz: string }) {
  const { t } = useI18n()
  const f = useFormat()
  const q = useQuery({
    queryKey: ['activity', 'today', tz],
    queryFn: () => api.activity(undefined, undefined, tz),
  })

  // ⚠️ NOT `at(-1)`: the query asks for a window, and its newest entry is not
  // necessarily today's. Presenting a three-day-old summary under a heading that
  // says "Today" is a true number under a false claim — see `newestActivity`.
  const newest = newestActivity(q.data)
  const rings = newest?.summary

  return (
    <Card title={t('dashboard.rings.title')}>
      <CardState
        query={q}
        isEmpty={!rings}
        empty={
          <Empty
            title={t('dashboard.rings.empty.title')}
            hint={t('dashboard.rings.empty.hint')}
          />
        }
      >
        {/* When the newest summary is older than today, the card says which day
            it is for instead of quietly implying this morning. */}
        {newest && !newest.isToday && newest.summary.day ? (
          <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 8 }}>
            {f.date(newest.summary.day)}
          </div>
        ) : null}
        <div className="rings">
          <Ring
            label={t('dashboard.rings.move')}
            value={rings?.active_energy}
            goal={rings?.active_energy_goal}
            unit="kcal"
            color="var(--helsa-ember)"
            size={92}
          />
          <Ring
            label={t('dashboard.rings.exercise')}
            value={rings?.exercise_minutes}
            goal={rings?.exercise_goal}
            unit={t('unit.minShort')}
            color="var(--helsa-move)"
            size={92}
          />
          <Ring
            label={t('dashboard.rings.stand')}
            value={rings?.stand_hours}
            goal={rings?.stand_goal}
            unit={t('unit.hourShort')}
            color="var(--helsa-fjord)"
            size={92}
          />
        </div>
      </CardState>
    </Card>
  )
}

function LatestWorkoutCard() {
  const { t } = useI18n()
  const f = useFormat()
  // A key of its own: the Workouts page keeps a hundred rows under `['workouts']`
  // and this needs one. Sharing the key would make whichever screen loaded second
  // re-render off the other one's page size.
  const q = useQuery({ queryKey: ['workouts', 'latest'], queryFn: () => api.workouts(1) })
  const w = q.data?.items?.[0]

  return (
    <LinkCard to="/workouts" title={t('today.workout.title')}>
      <CardState query={q} isEmpty={!w} empty={<Nothing>{t('today.workout.empty')}</Nothing>}>
        {w && (
          <>
            <p className="card-headline">{f.activityName(w.activity_type)}</p>
            <p className="subtle" style={{ margin: '0 0 10px' }}>
              {f.dateTime(w.started_at)}
            </p>
            <Rows
              items={[
                {
                  label: t('workouts.col.duration'),
                  value: f.durationBetween(w.started_at, w.ended_at),
                },
                {
                  label: t('workouts.col.energy'),
                  value: w.total_energy_kcal == null ? '–' : `${f.num(w.total_energy_kcal)} kcal`,
                },
                { label: t('workouts.col.distance'), value: f.km(w.total_distance_m) },
                { label: t('workouts.col.avgHr'), value: f.num(w.avg_heart_rate) },
              ]}
            />
          </>
        )}
      </CardState>
    </LinkCard>
  )
}

function LastNightCard({ tz }: { tz: string }) {
  const { t } = useI18n()
  const f = useFormat()
  // Two days back, not one: a night is identified by the morning it ends on, and
  // asking only for today would miss every segment written before midnight.
  const q = useQuery({
    queryKey: ['sleep', 'lastNight', tz],
    queryFn: () => api.sleep(isoDaysAgo(2), isoDaysAgo(0), tz),
  })
  // `groupByNight` returns the sessions newest first.
  const night = groupByNight(q.data ?? [])[0]

  return (
    <LinkCard to="/sleep" title={t('today.sleep.title')}>
      <CardState query={q} isEmpty={!night} empty={<Nothing>{t('today.sleep.empty')}</Nothing>}>
        {night && (
          <>
            <p className="card-headline">{f.duration(night.asleepMin)}</p>
            <p className="subtle" style={{ margin: '0 0 10px' }}>
              {f.date(night.key)}
            </p>
            <Rows
              items={[
                { label: t('sleep.inBed'), value: f.duration(night.inBedMin) },
                { label: t('sleep.efficiencyShort'), value: f.percent(night.efficiency) },
                { label: t('sleep.awakenings'), value: f.num(night.awakenings) },
              ]}
            />
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

  return (
    <LinkCard to="/challenge" title={t('nav.challenge')}>
      <CardState query={q} isEmpty={!c} empty={<Nothing>{t('challenge.notStarted')}</Nothing>}>
        {c && (
          <>
            <p className="card-headline" style={{ color: 'var(--helsa-move)' }}>
              {f.num(c.steps)}
            </p>
            <p className="subtle" style={{ margin: '0 0 10px' }}>
              {f.yearMonth(`${c.month}-01`)}
            </p>
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
            {!hasData && (
              <p className="subtle" style={{ margin: '10px 0 0' }}>
                {t('challenge.empty.title')}
              </p>
            )}
            {c.complete ? (
              <p className="subtle" style={{ margin: '10px 0 0' }}>
                {t('challenge.complete')}
              </p>
            ) : c.next_threshold != null && c.steps_to_next_threshold != null ? (
              <p className="subtle" style={{ margin: '10px 0 0' }}>
                {t('challenge.milestones.next', {
                  steps: f.num(c.next_threshold),
                  remaining: f.num(c.steps_to_next_threshold),
                })}
              </p>
            ) : null}
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
  // first, and within each the server's own severity before recency. Flattening
  // that order is what makes "the first three" mean something.
  const ordered = groupInsights(q.data ?? []).flatMap((g) => g.items)
  const shown = ordered.slice(0, CARD_LIST_LIMIT)
  const rest = ordered.length - shown.length

  return (
    <LinkCard to="/insights" title={t('nav.insights')}>
      <CardState
        query={q}
        isEmpty={ordered.length === 0}
        empty={<Nothing>{t('insights.empty.title')}</Nothing>}
      >
        <ul className="card-list">
          {shown.map((insight, i) => (
            <li key={insight.id ?? i}>
              {/* ⚠️ `lang="hu"` is honest markup, not a stray literal: the
                  schema states that these sentences are the server's and this
                  server speaks Hungarian. Without it a screen reader would read
                  them with English pronunciation on an English page. */}
              {insight.title?.trim() ? (
                <span lang="hu">{insight.title}</span>
              ) : (
                <span className="subtle">{t('insights.unnamed')}</span>
              )}
              {insight.metric && <span className="subtle"> · {tMetric(insight.metric)}</span>}
            </li>
          ))}
        </ul>
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
  // The newest badge of each family is that family's first row (the lib sorts
  // them, tie-breaks included); the newest overall is the newest of those.
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
        <p className="card-headline">{tp('achievements.total', items.length)}</p>
        <Rows
          items={groups.slice(0, CARD_LIST_LIMIT).map((g) => ({
            label: t(ACHIEVEMENT_KIND_LABEL[g.key]),
            value: f.num(g.items.length),
          }))}
        />
        {newest && (
          <p className="subtle" style={{ margin: '10px 0 0' }}>
            {/* ⚠️ A milestone has no period — it was crossed once, not in a
                month — so the sentence has two forms rather than one ending in a
                dash. A dash means "we do not know"; there is nothing to know. */}
            {newest.period
              ? t('today.medals.newest', {
                  badge: badgeLabel(newest, t),
                  period: periodLabel(newest.period, f),
                })
              : t('today.medals.newest.noPeriod', { badge: badgeLabel(newest, t) })}
          </p>
        )}
      </CardState>
    </LinkCard>
  )
}

// --- Band 3: status --------------------------------------------------------

function SyncCard({ query }: { query: UseQueryResult<Device[]> }) {
  const { t } = useI18n()
  const f = useFormat()
  const devices = query.data ?? []

  return (
    <LinkCard to="/settings" title={t('today.sync.title')}>
      <CardState
        query={query}
        isEmpty={devices.length === 0}
        empty={<Nothing>{t('settings.devices.empty')}</Nothing>}
      >
        <Rows
          items={devices.map((d) => ({
            label: d.name ?? d.model ?? d.platform ?? '–',
            value: f.relative(d.last_seen_at),
          }))}
        />
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
        {/* ⛔ Two counts and no percentage, on purpose. "52 of 120 types brought
            data" is a fact; the same thing as 43% is a score, and a score invites
            improving the number instead of looking at which row went quiet. */}
        <p className="cov-headline" style={{ margin: '0 0 10px' }}>
          {t('coverage.headline', {
            measured: counts.measured,
            total: counts.total,
            days: q.data?.days ?? COVERAGE_DAYS,
          })}
        </p>
        {broken.length > 0 ? (
          <>
            <p className="subtle" style={{ margin: 0 }}>
              {tp('today.coverage.gaps', broken.length)}
            </p>
            <ul className="card-list">
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
          <p className="subtle" style={{ margin: 0 }}>
            {t('today.coverage.noGaps')}
          </p>
        )}
      </CardState>
    </LinkCard>
  )
}
