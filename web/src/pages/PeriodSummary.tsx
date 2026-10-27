// "The year in numbers" — one named period at once: the four totals, the nights,
// the workouts and the medals, with how much of the period carried data and how
// far the period has got.
//
// The web's copy of the phone's `PeriodSummaryView` + `PeriodSummaryViewModel`
// (`HelsaKit/Sources/HelsaKit/Summary/`, `UI/Screens/PeriodSummaryView.swift`).
// The rules live in `lib/periodSummary.ts`; this file only lays them out.
//
// # What the wide screen buys
//
// The phone stacks the sections and draws the totals as a list. Here the four
// totals stand side by side, each with its own strip of months under it — the
// whole period, future months included, so a running year is visibly eight
// bars of twelve rather than eight bars stretched to the full width. That strip
// is the coverage made visible: an unmeasured month is a gap, not a short bar.
//
// # What each failure takes down
//
// The same rule as the phone (and as Trends): only the period's own `/summary`
// is an error state — without it there is nothing to show. The comparison, the
// nights, the workouts and the medals are each their own request, and each one
// that fails says so in its own place while the rest stands.

import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts'
import { api, browserTz } from '../api/client'
import type { Achievement, Workout } from '../api/types'
import { PeriodStepper } from '../components/PeriodStepper'
import { Card, Empty, ErrorState, Loading, PageHead } from '../components/ui'
import { useI18n, type UiKey } from '../i18n'
import { ACHIEVEMENT_KIND_LABEL, badgeLabel, groupKey, periodLabel } from '../lib/achievements'
import { useFormat, type Formatters } from '../lib/format'
import { metricDef } from '../lib/metrics'
import {
  HEADLINE_KEYS,
  belongs,
  canStepForward,
  comparisonIsEmpty,
  comparisonWindow,
  containing,
  coverageState,
  fullPeriodWindow,
  metricSummary,
  nextPeriod,
  periodId,
  periodMeasurement,
  periodValue,
  periodWindow,
  previousPeriod,
  rangeOf,
  signedPeriodMeasurement,
  sleepQueryWindow,
  sleepSummary,
  workoutSummary,
  type PeriodCoverage,
  type PeriodMetric,
  type PeriodUnit,
  type PeriodWindow,
  type SummaryPeriod,
} from '../lib/periodSummary'
import { useToday } from '../lib/useToday'
import { bucketKey, bucketStarts } from '../lib/window'
import { useWorkoutHistory } from '../lib/workoutHistory'
import '../styles/summary.css'

/**
 * `?p=2026` / `?p=2026-08` — the period is in the address, so a summary is a
 * link. Anything unreadable, or a period in the future, falls back to the year
 * we are in rather than to a blank page.
 */
export function parsePeriod(raw: string | null, now: Date): SummaryPeriod {
  const m = raw ? /^(\d{4})(?:-(\d{2}))?$/.exec(raw) : null
  if (m) {
    const year = Number(m[1])
    const month = m[2] ? Number(m[2]) : null
    const p: SummaryPeriod | null =
      month == null ? { unit: 'year', year } : month >= 1 && month <= 12 ? { unit: 'month', year, month } : null
    if (p && periodWindow(p, now).extent.kind !== 'notStarted') return p
  }
  return containing(now, 'year')
}

export default function PeriodSummary() {
  const tz = browserTz()
  const { t, tp, tMetric } = useI18n()
  const f = useFormat()
  // ⚠️ The clock is a dependency: a page left open past midnight must move on
  // (see `useToday`), and "is this period still running" depends on it.
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const period = useMemo(() => parsePeriod(params.get('p'), new Date()), [params, today])

  const win = useMemo(() => periodWindow(period, new Date()), [period, today])
  const cmp = useMemo(() => comparisonWindow(win), [win])
  const range = rangeOf(period)
  const isCurrent = periodId(period) === periodId(containing(new Date(), period.unit))

  function go(p: SummaryPeriod) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.set('p', periodId(p))
        return next
      },
      { replace: true },
    )
  }

  /**
   * Switching year ↔ month keeps the point in time (`select(unit:)` on the
   * phone): from the year 2026 to the month the summary's last day is in, and
   * from a month to its own year.
   */
  function selectUnit(unit: PeriodUnit) {
    if (unit === period.unit) return
    go(containing(new Date(win.end - 86_400_000), unit))
  }

  // --- The reads ------------------------------------------------------------

  /** The period and its comparison travel together, with the windows they
   * belong to — so a slow answer can never be drawn under a newer heading. */
  const q = useQuery({
    queryKey: ['period', tz, range, win.from, win.to, cmp.from, cmp.to],
    queryFn: async () => {
      const names = HEADLINE_KEYS.flatMap((k) => {
        const d = metricDef(k)
        return [d.key, ...d.aliases]
      })
      const [current, previous] = await Promise.all([
        api.summary(range, names, tz, win.from, win.to),
        // ⚠️ A failed comparison must NOT take the summary down: it is a bonus,
        // the period itself is the page.
        api.summary(range, names, tz, cmp.from, cmp.to).then(
          (d) => d,
          () => null,
        ),
      ])
      return { win, cmp, current, previous }
    },
    placeholderData: keepPreviousData,
  })

  const sleepWin = sleepQueryWindow(win)
  const sleepQ = useQuery({
    queryKey: ['period-sleep', tz, sleepWin.from, sleepWin.to],
    queryFn: () => api.sleep(sleepWin.from, sleepWin.to, tz),
  })

  // Shares its cache with the Workouts page — opening the summary after the
  // list costs nothing — and walks back only as far as this period's start.
  const history = useWorkoutHistory(win.start)

  const medalsQ = useQuery({ queryKey: ['achievements'], queryFn: api.achievements })

  // --- What is on screen ------------------------------------------------------

  const drawnWin = q.data?.win ?? win
  const drawnCmp = q.data?.cmp ?? cmp
  const metrics = useMemo<PeriodMetric[]>(
    () =>
      q.data
        ? HEADLINE_KEYS.map((k) =>
            metricSummary(metricDef(k), q.data.win, q.data.cmp, q.data.current, q.data.previous),
          )
        : [],
    [q.data],
  )
  const sleep = useMemo(() => (sleepQ.data ? sleepSummary(sleepQ.data, win) : null), [sleepQ.data, win])
  const workouts = useMemo(() => workoutSummary(history.items, win), [history.items, win])
  const medals = useMemo(
    () => (medalsQ.data ?? []).filter((a) => belongs(a, period)),
    [medalsQ.data, period],
  )

  const measured = metrics.filter((m) => m.series.hasData)
  const unmeasured = metrics.filter((m) => !m.series.hasData)
  const anyData =
    measured.length > 0 || (sleep?.nights ?? 0) > 0 || workouts.sessions > 0 || medals.length > 0
  const title =
    period.unit === 'year'
      ? t('period.title.year', { year: period.year })
      : t('period.title.month', { month: f.monthYearLong(win.from) })
  const prevName = periodName(drawnCmp.period, f)

  return (
    <>
      <PageHead
        title={title}
        subtitle={t('period.subtitle')}
        aside={
          <div className="segmented" role="group" aria-label={t('period.unitAria')}>
            {(['year', 'month'] as const).map((u) => (
              <button
                key={u}
                type="button"
                className="seg"
                aria-pressed={period.unit === u}
                onClick={() => selectUnit(u)}
              >
                {t(`period.unit.${u}`)}
              </button>
            ))}
          </div>
        }
      />

      <div className="period-head">
        <PeriodStepper
          window={win}
          range={range}
          canStepForward={canStepForward(period, new Date())}
          isBrowsing={!isCurrent}
          onBack={() => go(previousPeriod(period))}
          onForward={() => canStepForward(period, new Date()) && go(nextPeriod(period))}
          onNow={() => go(containing(new Date(), period.unit))}
        />
        {/* ⚠️ The sentence the title hides. "2026" over seven and a half months
            is the most believable lie this page could tell. */}
        {win.extent.kind === 'running' && (
          <p className="subtle period-extent" data-testid="period-extent">
            {t(`period.extent.running.${period.unit}`, {
              period: periodName(period, f),
              through: f.date(win.extent.through),
            })}
          </p>
        )}
      </div>

      {q.isLoading ? (
        <Loading rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <div className="sections">
          {!anyData && !sleepQ.isLoading && !history.isLoading && (
            <Empty title={t('period.empty.title')} hint={t('period.empty.hint')} />
          )}

          {/* The four totals, side by side. */}
          <p className="chart-status" role="status">
            {q.isFetching ? t('trends.loading') : ''}
          </p>
          <div className="grid grid-4 period-totals" aria-busy={q.isFetching || undefined}>
            {metrics.map((m) => (
              <MetricCard key={m.def.key} m={m} win={drawnWin} prevName={prevName} />
            ))}
          </div>

          {/* What the comparison is against. ⚠️ Said once, under the four, rather
              than four times: the cut is the same for every metric. */}
          {q.data?.previous == null ? (
            <p className="subtle" style={{ margin: 0 }}>
              {t('period.compare.notLoaded')}
            </p>
          ) : comparisonIsEmpty(metrics) ? (
            <p className="subtle" style={{ margin: 0 }} data-testid="compare-empty">
              {t('period.compare.emptyPeriod', { period: prevName })}
            </p>
          ) : drawnCmp.extent.kind === 'matched' ? (
            <p className="subtle" style={{ margin: 0 }} data-testid="compare-matched">
              {t('period.compare.matched', {
                period: prevName,
                from: f.date(drawnCmp.from),
                to: f.date(drawnCmp.to),
              })}
            </p>
          ) : null}

          {unmeasured.length > 0 && measured.length > 0 && (
            <p className="subtle" style={{ margin: 0 }}>
              {t('period.noDataFor', { list: unmeasured.map((m) => tMetric(m.def.key)).join(', ') })}
            </p>
          )}

          <div className="flow flow-wide">
            <Peaks metrics={measured} period={period} sleep={sleep} longest={workouts.longest} farthest={workouts.farthest} />

            <Card title={t('period.sleep.title')}>
              {sleepQ.isLoading ? (
                <Loading rows={1} />
              ) : sleepQ.isError || !sleep ? (
                // ⚠️ Not loaded is not "no nights": we could not look.
                <p className="subtle" style={{ margin: 0 }}>
                  {t('period.sleep.notLoaded')}
                </p>
              ) : sleep.nights === 0 ? (
                <p className="subtle" style={{ margin: 0 }}>
                  {t('period.sleep.none')}
                </p>
              ) : (
                <>
                  <dl className="kv">
                    <dt>{t('period.sleep.average')}</dt>
                    <dd className="num">{f.duration(sleep.averageMin)}</dd>
                    <dt>{t('period.sleep.nights')}</dt>
                    <dd className="num">{f.num(sleep.nights)}</dd>
                    <dt>{t('period.sleep.total')}</dt>
                    <dd className="num">{f.duration(sleep.totalMin)}</dd>
                  </dl>
                  <p className="subtle" style={{ margin: '8px 0 0' }}>
                    <CoverageLine c={sleep.coverage} /> {t('period.sleep.overMeasured')}
                  </p>
                </>
              )}
              <p style={{ margin: '8px 0 0' }}>
                <Link className="linkish" to="/sleep">
                  {t('period.sleep.open')}
                </Link>
              </p>
            </Card>

            <Card title={t('period.workouts.title')}>
              {history.isLoading ? (
                <Loading rows={1} />
              ) : history.isError ? (
                <p className="subtle" style={{ margin: 0 }}>
                  {t('period.workouts.notLoaded')}
                </p>
              ) : workouts.sessions === 0 && history.complete ? (
                <p className="subtle" style={{ margin: 0 }}>
                  {t('period.workouts.none')}
                </p>
              ) : (
                <>
                  <dl className="kv">
                    <dt>{t('period.workouts.count')}</dt>
                    <dd className="num">{f.num(workouts.sessions)}</dd>
                    <dt>{t('period.workouts.time')}</dt>
                    <dd className="num">{workouts.durationKnown > 0 ? f.duration(workouts.durationMin) : '–'}</dd>
                    <dt>{t('period.workouts.distance')}</dt>
                    <dd className="num">{f.km(workouts.distanceM)}</dd>
                  </dl>
                  {workouts.activities.length > 0 && (
                    <ul className="period-activities">
                      {workouts.activities.slice(0, 5).map((a) => (
                        <li key={a.type}>
                          <span>{f.activityName(a.type)}</span>
                          <span className="num">{f.num(a.count)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {workouts.sessions - workouts.durationKnown > 0 && (
                    <p className="subtle" style={{ margin: '8px 0 0' }}>
                      {tp('period.workouts.noEnd', workouts.sessions - workouts.durationKnown)}
                    </p>
                  )}
                  {workouts.extraRecordings > 0 && (
                    <p className="subtle" style={{ margin: '8px 0 0' }}>
                      {tp('period.workouts.folded', workouts.extraRecordings)}
                    </p>
                  )}
                </>
              )}
              {/* ⚠️ A count from half a history is a LOWER BOUND, and says so. */}
              {history.stillLoading && (
                <p className="subtle" style={{ margin: '8px 0 0' }}>
                  {t('period.workouts.loading')}
                </p>
              )}
              {history.capped && (
                <p className="subtle" style={{ margin: '8px 0 0' }} data-testid="workouts-capped">
                  {t('period.workouts.capped')}
                </p>
              )}
              <p style={{ margin: '8px 0 0' }}>
                <Link className="linkish" to="/workouts">
                  {t('period.workouts.open')}
                </Link>
              </p>
            </Card>

            <Card title={t('period.medals.title')}>
              {medalsQ.isLoading ? (
                <Loading rows={1} />
              ) : medalsQ.isError ? (
                <p className="subtle" style={{ margin: 0 }}>
                  {t('period.medals.notLoaded')}
                </p>
              ) : medals.length === 0 ? (
                <p className="subtle" style={{ margin: 0 }}>
                  {t('period.medals.none')}
                </p>
              ) : (
                <ul className="period-medals">
                  {medals.map((a) => (
                    <MedalRow key={a.id ?? `${a.kind}-${a.code}-${a.period}`} a={a} />
                  ))}
                </ul>
              )}
              <p className="subtle" style={{ margin: '8px 0 0' }}>
                {t('period.medals.onlyPeriod')}
              </p>
            </Card>

            {/* Where the summed numbers come from — the same card, word for word,
                as Trends: the four totals are all summed, all source-merged. */}
            <Card title={t('trends.sources.title')}>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--text-2)' }}>{t('trends.sources.body')}</p>
            </Card>
          </div>
          <p className="subtle" style={{ margin: 0 }}>
            {t('period.toYears')}{' '}
            <Link className="linkish" to="/years">
              {t('nav.years')}
            </Link>
          </p>
        </div>
      )}
    </>
  )
}

/** "2026" / "August 2026" — what a sentence calls the period. */
function periodName(p: SummaryPeriod, f: Formatters): string {
  return p.unit === 'year' ? String(p.year) : f.monthYearLong(`${periodId(p)}-01`)
}

/** The phone's four coverage sentences (`PeriodCoverage.sentence`). */
function CoverageLine({ c }: { c: PeriodCoverage }) {
  const { t } = useI18n()
  const state = coverageState(c)
  if (state === 'nothingElapsed') return <>{t('period.coverage.nothingElapsed')}</>
  return <>{t(`period.coverage.${state}.${c.unit}` as UiKey, { measured: c.measured, elapsed: c.elapsed })}</>
}

function MetricCard({ m, win, prevName }: { m: PeriodMetric; win: PeriodWindow; prevName: string }) {
  const { t, tMetric } = useI18n()
  const f = useFormat()
  const range = rangeOf(win.period)
  const unit = m.series.unit
  const total = m.series.total != null ? periodValue(m.series.total, unit, m.def.digits, f) : null

  /**
   * Every bucket of the WHOLE period — the future ones included, as empty. An
   * unmeasured month is a gap in the strip, never a bar of zero.
   */
  const bars = useMemo(
    () =>
      bucketStarts(fullPeriodWindow(win), range).map((ms) => ({
        ms,
        t: new Date(ms).toISOString(),
        value: m.byBucket.get(bucketKey(ms, range)) ?? null,
      })),
    [m.byBucket, win, range],
  )

  return (
    <section className="card stat-card period-metric" aria-label={tMetric(m.def.key)}>
      <h2>
        <span className="dot" aria-hidden="true" style={{ background: m.def.color }} />
        {tMetric(m.def.key)}
      </h2>
      <div className={`stat${total ? '' : ' is-missing'}`}>
        {total ? total.value : '–'}
        {total?.unit ? <small>{total.unit}</small> : null}
      </div>
      {m.perBucket != null && (
        <p className="stat-note">
          {range === 'year' ? t('trends.perMonth', { n: m.coverage.measured }) : t('trends.perDay', { n: m.coverage.measured })}
          {': '}
          <strong className="num">{periodMeasurement(m.perBucket, unit, m.def.digits, f)}</strong>
        </p>
      )}
      <p className="stat-note">
        <CoverageLine c={m.coverage} />
      </p>

      <div className="period-strip" aria-hidden="true">
        <ResponsiveContainer>
          <BarChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="t" hide />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              contentStyle={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 10,
                color: 'var(--text)',
              }}
              itemStyle={{ color: 'var(--text)' }}
              labelFormatter={(v: string) => (range === 'year' ? f.yearMonth(v) : f.date(v))}
              formatter={(v: unknown) => [
                typeof v === 'number' ? periodMeasurement(v, unit, m.def.digits, f) : t('trends.table.notMeasured'),
                tMetric(m.def.key),
              ]}
            />
            <Bar dataKey="value" fill={m.def.color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <Compare m={m} prevName={prevName} />
    </section>
  )
}

function Compare({ m, prevName }: { m: PeriodMetric; prevName: string }) {
  const { t } = useI18n()
  const f = useFormat()
  const unit = m.series.unit
  const c = m.comparison
  if (!m.series.hasData) return null
  if (c.kind === 'none') {
    // ⚠️ Not "−100%": two windows, one of which we know nothing about.
    return <p className="stat-note period-compare">{t('period.compare.none', { period: prevName })}</p>
  }
  if (c.kind === 'withheld') {
    return (
      <p className="stat-note period-compare" data-testid="compare-withheld">
        {t('period.compare.withheld', {
          period: prevName,
          value: periodMeasurement(c.previous, unit, m.def.digits, f),
        })}
      </p>
    )
  }
  const percent = c.ratio == null ? null : Math.round(c.ratio * 100)
  return (
    <div className="period-compare">
      <p className="stat-note">
        <strong className="num">
          {c.delta === 0 ? t('trends.compare.unchanged') : signedPeriodMeasurement(c.delta, unit, m.def.digits, f)}
        </strong>
        {percent != null && c.delta !== 0 && ` (${percent > 0 ? '+' : percent < 0 ? '−' : ''}${Math.abs(percent)}%)`}
        {' · '}
        {t('period.compare.previous', { period: prevName, value: periodMeasurement(c.previous, unit, m.def.digits, f) })}
      </p>
      {!c.even && m.previousCoverage && (
        <p className="stat-note" data-testid="compare-caveat">
          {t(`period.compare.caveat.${m.coverage.unit}`, {
            now: m.coverage.measured,
            then: m.previousCoverage.measured,
          })}
        </p>
      )}
    </div>
  )
}

function Peaks({
  metrics,
  period,
  sleep,
  longest,
  farthest,
}: {
  metrics: PeriodMetric[]
  period: SummaryPeriod
  sleep: ReturnType<typeof sleepSummary> | null
  longest: Workout | null
  farthest: Workout | null
}) {
  const { t, tMetric } = useI18n()
  const f = useFormat()
  const rows: { label: string; when: string; value: string; to?: string }[] = []
  for (const m of metrics) {
    if (!m.peak) continue
    rows.push({
      label: t(`period.peaks.best.${period.unit}`, { metric: tMetric(m.def.key) }),
      when: period.unit === 'year' ? f.monthYearLong(m.peak.t) : f.date(m.peak.t),
      value: periodMeasurement(m.peak.value, m.series.unit, m.def.digits, f),
    })
  }
  if (sleep?.longest) {
    rows.push({ label: t('period.peaks.sleep'), when: f.date(sleep.longest.key), value: f.duration(sleep.longest.min) })
  }
  if (longest) {
    rows.push({
      label: t('period.peaks.workout'),
      when: `${f.activityName(longest.activity_type)} · ${f.date(longest.started_at)}`,
      value: f.durationBetween(longest.started_at, longest.ended_at),
      to: longest.id ? `/workouts/${longest.id}` : undefined,
    })
  }
  if (farthest) {
    rows.push({
      label: t('period.peaks.distance'),
      when: `${f.activityName(farthest.activity_type)} · ${f.date(farthest.started_at)}`,
      value: f.km(farthest.total_distance_m),
      to: farthest.id ? `/workouts/${farthest.id}` : undefined,
    })
  }
  if (rows.length === 0) return null
  return (
    <Card title={t('period.peaks.title')}>
      <ul className="period-peaks">
        {rows.map((r) => (
          <li key={r.label}>
            <span className="period-peak-label">{r.label}</span>
            <span className="subtle period-peak-when">{r.to ? <Link to={r.to}>{r.when}</Link> : r.when}</span>
            <span className="num period-peak-value">{r.value}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function MedalRow({ a }: { a: Achievement }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  // ⚠️ Never `?? 0`: a badge without a value has a figure we do not know.
  const value =
    a.value == null
      ? null
      : a.unit === 'month'
        ? tp('achievements.months', a.value)
        : `${f.num(a.value)}${f.unit(a.unit) ? ` ${f.unit(a.unit)}` : ''}`
  return (
    <li>
      <span>
        <strong>{t(ACHIEVEMENT_KIND_LABEL[groupKey(a)])}</strong> · {badgeLabel(a, t)}
      </span>
      <span className="subtle">{periodLabel(a.period, f)}</span>
      {value && <span className="num">{value}</span>}
    </li>
  )
}
