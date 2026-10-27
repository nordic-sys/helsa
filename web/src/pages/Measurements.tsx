// Measurements — the web's copy of the phone's Health tab card grid.
//
// The phone's Health tab is two bespoke sections (sleep, nutrition) and one
// generic card grid per catalog group. The web already had the two bespoke ones
// as pages; this is the rest: every catalog group outside nutrition, one card
// per metric, plus the two cards a grid must not lay out loose — blood pressure
// as a pair and the five gait series on one axis. The rules behind the grid
// live in `lib/measurements.ts`, `lib/bloodPressure.ts` and `lib/gait.ts`; this
// file only draws them.
//
// # What a card says, and where each piece comes from
//
//  - **The headline** — `GET /v1/latest`, one call for the whole page. An
//    averaged type shows its latest reading at its own instant; a summed type
//    its latest day's merged total ("today so far" while that day is today).
//    The server picks which, from its own catalog. On an older server (404) the
//    card falls back to the last measured day of the 30-day `/summary` and the
//    page says so — the version-skew convention of the Ingest and Training pages.
//  - **The sparkline** — the 30-day daily `/summary` (the 7-day span is its last
//    week, so switching between them is free), or the 12-month monthly one.
//    Every bucket is drawn, measured or not; a gap is a gap, never a zero.
//  - **The usual range** — `GET /v1/baseline`, range `month`. Its 60-day
//    reference window is anchored at the end of the period, which is today for
//    both the 7- and the 30-day span, so one call serves both. It is a DAILY
//    band, so on the 12-month span (monthly buckets) it is not drawn, and the
//    card says why rather than leaving a hole.
//  - **The full chart** — a link to Trends with the metric preselected.
//
// # Request budget
//
// Availability (3, shared with every picker and cached), `/summary` 30 days (2
// chunks of 40 names), `/baseline` (2), `/latest` (1), the gait window (1) and
// the blood-pressure samples (2). The 12-month series (2 more) is only fetched
// when that span is chosen. Without `/latest` the headlines alone would have
// been one `/samples` call per metric — that is why the endpoint exists.

import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueries, useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import type { BaselineResponse, LatestResponse, LatestValue, MetricBaseline, Sample, SamplePage, SummaryResponse } from '../api/types'
import { Alert, Empty, ErrorState, Legend, Loading, Note, PageHead } from '../components/ui'
import { useI18n, type UiKey } from '../i18n'
import { bandOf, noBandReason, pickBaseline } from '../lib/baseline'
import {
  BLOOD_PRESSURE_KEYS,
  BP_OUTLIER,
  bpAbsence,
  bpAverage,
  daysBefore,
  detectUnusual,
  meanArterial,
  pairReadings,
  pulsePressure,
  readingsInWindow,
  type AxisDeviation,
} from '../lib/bloodPressure'
import { useFormat } from '../lib/format'
import {
  FALLS_KEY,
  GAIT_KEYS,
  GAIT_METRICS,
  GAIT_THRESHOLDS,
  addDays,
  fallDays,
  gaitSummary,
  isolatedDays,
  type DayPoint,
  type GaitSummary,
} from '../lib/gait'
import { isApiTooOld } from '../lib/ingest'
import {
  PAGE_WIRE_NAMES,
  SECTIONS,
  SPANS,
  cardGroups,
  daysOld,
  hasAnyData,
  headlineFromLatest,
  headlineFromSeries,
  isolatedKeys,
  outsideSpan,
  pickLatest,
  sparkPoints,
  yDomain,
  type Headline,
  type Span,
  type SparkPoint,
} from '../lib/measurements'
import { metricDef, pickSeries, readSeries, type MetricDef, type MetricGroupKey } from '../lib/metrics'
import { useAvailability } from '../lib/useAvailability'
import { useToday } from '../lib/useToday'
import { isoDay } from '../lib/window'
import '../styles/measurements.css'

const UPDATE_COMMAND = 'make prod-pull && make prod-up'

/** The same chunking as the availability probe: a hundred names in one query
 * string approaches the usual proxy limits. */
const CHUNK = 40
const CHUNKS: string[][] = []
for (let i = 0; i < PAGE_WIRE_NAMES.length; i += CHUNK) CHUNKS.push(PAGE_WIRE_NAMES.slice(i, i + CHUNK))

const SECTION_TITLE: Record<string, UiKey> = {
  activity: 'meas.section.activity',
  heart: 'meas.section.heart',
  respiratory: 'meas.section.respiratory',
  body: 'meas.section.body',
  mobility: 'meas.section.mobility',
  environment: 'meas.section.environment',
  other: 'meas.section.other',
}

// What a section says when it is shown with nothing in it — each names a
// MUNDANE cause (the phone's `HealthSection.emptyDetail`), because an unexplained
// blank reads as a fault.
const SECTION_EMPTY: Record<string, UiKey> = {
  activity: 'meas.empty.activity',
  heart: 'meas.empty.heart',
  respiratory: 'meas.empty.respiratory',
  body: 'meas.empty.body',
  mobility: 'meas.empty.mobility',
  environment: 'meas.empty.environment',
  other: 'meas.empty.other',
}

/** Merge the chunked `/summary` answers into one metric map. */
function mergeSummaries(results: { data?: SummaryResponse }[]) {
  const out: NonNullable<SummaryResponse['metrics']> = {}
  for (const r of results) Object.assign(out, r.data?.metrics ?? {})
  return out
}

function mergeBaselines(results: { data?: BaselineResponse }[]) {
  const out: Record<string, MetricBaseline> = {}
  let minDays: number | undefined
  for (const r of results) {
    Object.assign(out, r.data?.metrics ?? {})
    minDays ??= r.data?.min_days
  }
  return { metrics: out, minDays: minDays ?? 14 }
}

/** Every page of a type's samples in `[from, to)`. Blood pressure is a few
 * readings a day at most, so one page is the normal case; the loop is a guard. */
async function allSamples(dataType: string, from: string, to: string): Promise<Sample[]> {
  const out: Sample[] = []
  let cursor: string | undefined
  for (let i = 0; i < 5; i++) {
    const page: SamplePage = await api.samples(dataType, from, to, 2000, cursor)
    out.push(...(page.items ?? []))
    if (!page.next_cursor) break
    cursor = page.next_cursor
  }
  return out
}

export default function Measurements() {
  const { t, tx } = useI18n()
  const tz = browserTz()
  const today = useToday()
  const [span, setSpan] = useState<Span>('month')
  const [showAll, setShowAll] = useState(false)
  const availability = useAvailability()

  const month = useQueries({
    queries: CHUNKS.map((names, i) => ({
      queryKey: ['measurements', 'month', tz, today, i],
      queryFn: () => api.summary('month', names, tz),
      staleTime: 5 * 60_000,
    })),
  })
  const year = useQueries({
    queries: CHUNKS.map((names, i) => ({
      queryKey: ['measurements', 'year', tz, today, i],
      queryFn: () => api.summary('year', names, tz),
      staleTime: 5 * 60_000,
      enabled: span === 'year',
    })),
  })
  const baseline = useQueries({
    queries: CHUNKS.map((names, i) => ({
      queryKey: ['measurements', 'baseline', tz, today, i],
      queryFn: () => api.baseline('month', names, tz),
      staleTime: 5 * 60_000,
    })),
  })
  const latest = useQuery<LatestResponse>({
    queryKey: ['measurements', 'latest', tz],
    queryFn: () => api.latest(PAGE_WIRE_NAMES, tz),
    staleTime: 60_000,
  })

  const monthSig = month.map((r) => r.dataUpdatedAt).join(',')
  const yearSig = year.map((r) => r.dataUpdatedAt).join(',')
  const baseSig = baseline.map((r) => r.dataUpdatedAt).join(',')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const monthMetrics = useMemo(() => mergeSummaries(month), [monthSig])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const yearMetrics = useMemo(() => mergeSummaries(year), [yearSig])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const baselines = useMemo(() => mergeBaselines(baseline), [baseSig])

  // `/latest` answered → its headlines; 404 → the 30-day fallback, said aloud;
  // any other failure is shown as the error it is.
  const latestTooOld = latest.isError && isApiTooOld(latest.error)
  const latestMetrics = latest.data?.metrics

  const loading = month.some((r) => r.isLoading) || latest.isLoading || !availability.known
  const monthError = month.find((r) => r.isError)?.error
  const yearError = span === 'year' ? year.find((r) => r.isError)?.error : undefined

  const has = (def: MetricDef) => hasAnyData(def, availability.has, latestMetrics)
  const bpHas = BLOOD_PRESSURE_KEYS.some((k) => has(metricDef(k)))
  const gaitHas = GAIT_KEYS.some((k) => has(metricDef(k)))

  const sections = SECTIONS.map((group) => {
    const groups = cardGroups(group)
      .map((g) => ({ ...g, metrics: showAll ? g.metrics : g.metrics.filter(has) }))
      .filter((g) => g.metrics.length > 0)
    const withData = cardGroups(group).flatMap((g) => g.metrics).filter(has).length
    const total = cardGroups(group).flatMap((g) => g.metrics).length
    const bp = group === 'heart' && (showAll || bpHas)
    const gait = group === 'mobility' && (showAll || gaitHas)
    return { group, groups, withData, total, bp, gait }
  })
  const visible = sections.filter((s) => showAll || s.groups.length > 0 || s.bp || s.gait)

  let body: ReactNode
  if (monthError) {
    body = <ErrorState error={monthError} />
  } else if (latest.isError && !latestTooOld) {
    body = <ErrorState error={latest.error} />
  } else if (loading) {
    body = <Loading rows={6} />
  } else if (visible.length === 0) {
    body = <Empty title={t('meas.empty.title')} hint={t('meas.empty.hint')} />
  } else {
    body = visible.map((s) => (
      <SectionView
        key={s.group}
        group={s.group}
        groups={s.groups}
        withData={s.withData}
        total={s.total}
        showBp={s.bp}
        showGait={s.gait}
        span={span}
        today={today}
        monthMetrics={monthMetrics}
        yearMetrics={yearMetrics}
        yearLoading={span === 'year' && year.some((r) => r.isLoading)}
        baselines={baselines}
        latest={latestTooOld ? undefined : latestMetrics}
        fallback={latestTooOld}
        tz={tz}
      />
    ))
  }

  return (
    <>
      <PageHead title={t('meas.title')} subtitle={t('meas.subtitle')} />

      <div className="meas-controls">
        <div className="segmented" role="group" aria-label={t('meas.span.aria')}>
          {SPANS.map((s) => (
            <button key={s} type="button" className="seg" aria-pressed={span === s} onClick={() => setSpan(s)}>
              {t(`meas.span.${s}` as UiKey)}
            </button>
          ))}
        </div>
        <button type="button" className="seg" aria-pressed={showAll} onClick={() => setShowAll((v) => !v)}>
          {t('meas.showAll')}
        </button>
      </div>

      {!loading && visible.length > 1 && (
        <nav className="meas-jump" aria-label={t('meas.jump.aria')}>
          {visible.map((s) => (
            <a key={s.group} href={`#meas-${s.group}`} className="meas-jump-link">
              {t(SECTION_TITLE[s.group])}
            </a>
          ))}
        </nav>
      )}

      <p className="subtle meas-elsewhere">
        {tx('meas.elsewhere', {
          sleep: <Link to="/sleep">{t('nav.sleep')}</Link>,
          nutrition: <Link to="/nutrition">{t('nav.nutrition')}</Link>,
        })}
      </p>

      {latestTooOld && (
        <Alert tone="warn" title={t('ingest.apiOld.title')} live={false}>
          <p>{t('meas.latestOld')}</p>
          <code className="block">{UPDATE_COMMAND}</code>
          <p className="alert-tech">{t('ingest.apiOld.tech')}</p>
        </Alert>
      )}
      {yearError ? <ErrorState error={yearError} /> : null}

      {body}

      <p className="subtle meas-foot">{t('meas.foot', { tz })}</p>
    </>
  )
}

// --- A section --------------------------------------------------------------------

function SectionView(props: {
  group: MetricGroupKey
  groups: { title: UiKey | null; metrics: MetricDef[] }[]
  withData: number
  total: number
  showBp: boolean
  showGait: boolean
  span: Span
  today: string
  monthMetrics: NonNullable<SummaryResponse['metrics']>
  yearMetrics: NonNullable<SummaryResponse['metrics']>
  yearLoading: boolean
  baselines: { metrics: Record<string, MetricBaseline>; minDays: number }
  latest?: Record<string, LatestValue>
  fallback: boolean
  tz: string
}) {
  const { t } = useI18n()
  const { group, groups, showBp, showGait } = props
  const empty = groups.length === 0 && !showBp && !showGait
  return (
    <section className="meas-section" id={`meas-${group}`} aria-labelledby={`meas-${group}-h`}>
      <header className="meas-section-head">
        <h2 id={`meas-${group}-h`}>{t(SECTION_TITLE[group])}</h2>
        <span className="subtle">{t('meas.section.count', { n: props.withData, m: props.total })}</span>
      </header>
      {showBp && <BloodPressureCard latest={props.latest} today={props.today} />}
      {showGait && <GaitCard today={props.today} tz={props.tz} />}
      {empty ? (
        <Note title={t('meas.empty.section')}>{t(SECTION_EMPTY[group])}</Note>
      ) : (
        groups.map((g, i) => (
          <div key={g.title ?? `g${i}`} className="meas-group">
            {g.title && <h3 className="meas-group-title">{t(g.title)}</h3>}
            <div className="grid meas-grid">
              {g.metrics.map((def) => (
                <MetricCard
                  key={def.key}
                  def={def}
                  span={props.span}
                  today={props.today}
                  month={props.monthMetrics}
                  year={props.yearMetrics}
                  yearLoading={props.yearLoading}
                  baseline={pickBaseline(def, props.baselines.metrics)}
                  minDays={props.baselines.minDays}
                  latest={props.latest}
                  fallback={props.fallback}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  )
}

// --- A metric card --------------------------------------------------------------

function useDayAgo() {
  const { locale } = useI18n()
  return useMemo(() => {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    return (day: string, today: string) => rtf.format(-daysOld(day, today), 'day')
  }, [locale])
}

function MetricCard({
  def,
  span,
  today,
  month,
  year,
  yearLoading,
  baseline,
  minDays,
  latest,
  fallback,
}: {
  def: MetricDef
  span: Span
  today: string
  month: NonNullable<SummaryResponse['metrics']>
  year: NonNullable<SummaryResponse['metrics']>
  yearLoading: boolean
  baseline?: MetricBaseline
  minDays: number
  latest?: Record<string, LatestValue>
  fallback: boolean
}) {
  const { t, tMetric, tUnit } = useI18n()
  const f = useFormat()
  const dayAgo = useDayAgo()

  const monthRead = readSeries(def, pickSeries(def, month))
  const read = span === 'year' ? readSeries(def, pickSeries(def, year)) : monthRead
  const lv = pickLatest(def, latest)
  const headline: Headline = fallback ? headlineFromSeries(monthRead, today) : headlineFromLatest(lv, today)
  const unit = tUnit(lv?.unit || monthRead.unit || def.unit)
  const points = sparkPoints(read, span, today)
  const band = span === 'year' ? null : bandOf(baseline)
  const agg = read.hasData ? read.effectiveAgg : def.agg
  const stale = outsideSpan(headline, span, today)

  let figure: ReactNode = <span className="is-missing">–</span>
  let when: ReactNode = t('meas.head.none')
  switch (headline.kind) {
    case 'sample':
      figure = f.fmt(headline.value, def.digits)
      when = t('meas.head.sample', { when: f.dateTime(headline.at), ago: f.relative(headline.at) })
      break
    case 'dayTotal':
      figure = f.fmt(headline.value, def.digits)
      when = headline.partial
        ? t('meas.head.todaySoFar')
        : t('meas.head.dayTotal', { date: f.date(headline.day), ago: dayAgo(headline.day, today) })
      break
    case 'noFigure':
      when = t('meas.head.noFigure', { when: f.dateTime(headline.at) })
      break
    case 'bucket':
      figure = f.fmt(headline.value, def.digits)
      when =
        headline.agg === 'sum'
          ? headline.partial
            ? t('meas.head.todaySoFar')
            : t('meas.head.dayTotal', { date: f.date(headline.day), ago: dayAgo(headline.day, today) })
          : t('meas.head.dayAverage', { date: f.date(headline.day), ago: dayAgo(headline.day, today) })
      break
  }

  let usual: ReactNode = null
  if (span === 'year') {
    usual = t('meas.usual.year')
  } else if (band) {
    usual = t(agg === 'sum' ? 'meas.usual.bandSum' : 'meas.usual.band', {
      low: f.fmt(band.low, def.digits),
      high: f.fmt(band.high, def.digits),
      unit,
      n: baseline?.day_count ?? 0,
    })
  } else if (baseline || read.hasData) {
    const reason = noBandReason(baseline, minDays)
    if (reason === 'notEnough') usual = t('meas.usual.notEnough', { n: baseline?.day_count ?? 0, min: minDays })
    else if (reason === 'noVariation') usual = t('meas.usual.noVariation')
  }

  const hasFigure = headline.kind !== 'none' && headline.kind !== 'noFigure'
  return (
    <article className={`card card-sm meas-card${headline.kind === 'none' ? ' is-empty' : ''}`}>
      <h4 className="meas-card-title">
        <span className="dot" aria-hidden="true" style={{ background: def.color }} />
        {tMetric(def.key)}
      </h4>
      <div className="card-headline meas-figure">
        {figure}
        {hasFigure && unit ? <small>{unit}</small> : null}
      </div>
      <p className="meas-when">{when}</p>
      {span === 'year' && yearLoading ? (
        <div className="meas-spark skeleton" aria-hidden="true" />
      ) : (
        <Sparkline
          points={points}
          band={band}
          agg={agg}
          color={def.color}
          label={t('meas.spark.aria', { metric: tMetric(def.key), span: t(`meas.span.${span}` as UiKey) })}
        />
      )}
      {stale && headline.kind !== 'none' && (
        <p className="meas-stale">{t('meas.stale', { ago: dayAgo(headline.day, today) })}</p>
      )}
      {usual && <p className="meas-usual">{usual}</p>}
      {read.degraded && <p className="meas-usual">{t('meas.degraded')}</p>}
      <Link className="meas-trends" to={`/trends?metric=${encodeURIComponent(def.key)}`}>
        {t('meas.toTrends')}
        <span className="sr-only"> — {tMetric(def.key)}</span>
      </Link>
    </article>
  )
}

/**
 * The span at a glance: bars for a summed metric (a day is an amount), a line
 * for an averaged one (a day is a level). Either way a missing bucket is drawn
 * as nothing — no bar, a break in the line — and a lone measured point between
 * two gaps is a dot, or it would vanish.
 */
function Sparkline({
  points,
  band,
  agg,
  color,
  label,
}: {
  points: SparkPoint[]
  band: { low: number; high: number } | null
  agg: 'sum' | 'avg'
  color: string
  label: string
}) {
  const domain = yDomain(points, band, agg)
  const measured = points.some((p) => p.value != null)
  if (!measured || !domain) return <div className="meas-spark is-blank" aria-hidden="true" />
  const isolated = isolatedKeys(points)
  const bandArea = band ? (
    <ReferenceArea y1={band.low} y2={band.high} fill="var(--accent)" fillOpacity={0.12} stroke="none" ifOverflow="hidden" />
  ) : null
  return (
    <div className="meas-spark" role="img" aria-label={label}>
      <ResponsiveContainer>
        {agg === 'sum' ? (
          <BarChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
            <YAxis hide domain={domain} />
            <XAxis dataKey="key" hide />
            {bandArea}
            <Bar dataKey="value" fill={color} isAnimationActive={false} radius={[2, 2, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <YAxis hide domain={domain} />
            <XAxis dataKey="key" hide />
            {bandArea}
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              connectNulls={false}
              isAnimationActive={false}
              dot={(p: { cx?: number; cy?: number; payload?: SparkPoint; index?: number }) =>
                p.payload && isolated.has(p.payload.key) && p.cx != null && p.cy != null ? (
                  <circle key={`d${p.index}`} cx={p.cx} cy={p.cy} r={2.5} fill={color} />
                ) : (
                  <g key={`d${p.index}`} />
                )
              }
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}

// --- Blood pressure ---------------------------------------------------------------

function BloodPressureCard({ latest, today }: { latest?: Record<string, LatestValue>; today: string }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  // The window is fixed per day: a `Date.now()` in the key would refetch on
  // every render. 90 days is the outlier rule's baseline, so one read serves both
  // the card and the rule.
  const { from, to } = useMemo(() => {
    const [y, m, d] = today.split('-').map(Number)
    const end = new Date(y, m - 1, d + 1)
    return { from: daysBefore(end, BP_OUTLIER.baselineDays + 1).toISOString(), to: end.toISOString() }
  }, [today])
  const q = useQuery({
    queryKey: ['measurements', 'bp', from, to],
    queryFn: async () => {
      const [sys, dia] = await Promise.all([
        allSamples(BLOOD_PRESSURE_KEYS[0], from, to),
        allSamples(BLOOD_PRESSURE_KEYS[1], from, to),
      ])
      return { sys, dia }
    },
    staleTime: 5 * 60_000,
  })

  const unit = t('meas.bp.unit')
  let body: ReactNode
  if (q.isLoading) {
    body = <div className="skeleton" style={{ height: 120 }} />
  } else if (q.isError) {
    body = <ErrorState error={q.error} />
  } else {
    const sys = q.data?.sys ?? []
    const dia = q.data?.dia ?? []
    const readings = pairReadings(sys, dia)
    const absence = bpAbsence(readings, sys.length > 0, dia.length > 0)
    const lastSys = latest?.[BLOOD_PRESSURE_KEYS[0]]
    const lastDia = latest?.[BLOOD_PRESSURE_KEYS[1]]
    const lastEver = [lastSys, lastDia].filter((v): v is LatestValue => v != null).sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))[0]

    if (absence === 'bothMissing') {
      body = lastEver ? (
        <p className="card-lead">{t('meas.bp.older', { when: f.date(lastEver.day) })}</p>
      ) : (
        <>
          <p className="card-lead">{t('meas.bp.none.title')}</p>
          <p className="meas-note">{t('meas.bp.none.body')}</p>
        </>
      )
    } else if (absence === 'systolicOnly' || absence === 'diastolicOnly') {
      const upper = t('meas.bp.upper')
      const lower = t('meas.bp.lower')
      body = (
        <>
          <p className="card-lead">{t('meas.bp.half.title')}</p>
          <p className="meas-note">
            {t('meas.bp.half.body', {
              present: absence === 'systolicOnly' ? upper : lower,
              missing: absence === 'systolicOnly' ? lower : upper,
            })}
          </p>
        </>
      )
    } else if (absence === 'noPairedReading') {
      body = (
        <>
          <p className="card-lead">{t('meas.bp.noPair.title')}</p>
          <p className="meas-note">{t('meas.bp.noPair.body')}</p>
        </>
      )
    } else {
      const last = readings[readings.length - 1]
      const avg = bpAverage(readings)
      const now = new Date()
      const unusual = detectUnusual(readings, now)
      const inWindow = readingsInWindow(readings, now)
      const pair = (r: { systolic: number; diastolic: number }) => `${f.num(r.systolic)}/${f.num(r.diastolic)}`
      const unusualMs = new Set(unusual.map((u) => u.reading.ms))
      const chart = readings.map((r) => ({
        x: r.ms,
        sys: r.systolic,
        dia: r.diastolic,
        odd: unusualMs.has(r.ms) ? r.systolic : null,
      }))
      body = (
        <div className="meas-bp">
          <div>
            <div className="card-headline" style={{ color: 'var(--pulse-text)' }}>
              {pair(last)}
              <small>{unit}</small>
            </div>
            <p className="meas-when">
              {t('meas.bp.latest', { when: f.dateTime(last.at), ago: f.relative(last.at) })}
            </p>
            <dl className="meas-bp-stats">
              <div>
                <dt>{t('meas.bp.average')}</dt>
                <dd>{avg ? `${pair(avg)} ${unit}` : '–'}</dd>
              </div>
              <div>
                <dt>{t('meas.bp.pulsePressure')}</dt>
                <dd>
                  {f.num(pulsePressure(last))} {unit}
                </dd>
              </div>
              <div>
                <dt>{t('meas.bp.map')}</dt>
                <dd>
                  {f.num(meanArterial(last))} {unit}
                </dd>
              </div>
            </dl>
          </div>
          <div>
            {readings.length > 1 && (
              <>
                <div className="meas-bp-chart" role="img" aria-label={t('meas.bp.chart.aria')}>
                  <ResponsiveContainer>
                    <ComposedChart data={chart} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        tickFormatter={(v: number) => f.monthDay(new Date(v).toISOString())}
                        minTickGap={32}
                      />
                      <YAxis tick={{ fill: 'var(--text-dim)', fontSize: 12 }} stroke="var(--border)" width={44} domain={['auto', 'auto']} />
                      <Line dataKey="sys" stroke="var(--helsa-pulse)" strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false} />
                      <Line dataKey="dia" stroke="var(--helsa-fjord)" strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false} />
                      <Scatter dataKey="odd" fill="none" stroke="var(--text)" strokeWidth={1.5} shape="circle" isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <Legend
                  items={[
                    { label: t('meas.bp.systolic'), color: 'var(--helsa-pulse)' },
                    { label: t('meas.bp.diastolic'), color: 'var(--helsa-fjord)' },
                  ]}
                />
              </>
            )}
          </div>
          <div className="meas-bp-wide">
            <h4 className="meas-subhead">{t('meas.bp.unusual.title')}</h4>
            {inWindow <= BP_OUTLIER.minBaselineReadings ? (
              <p className="meas-note">
                {t('meas.bp.unusual.notEnough', { min: BP_OUTLIER.minBaselineReadings + 1, n: inWindow })}
              </p>
            ) : unusual.length === 0 ? (
              <p className="meas-note">{t('meas.bp.unusual.none', { n: inWindow })}</p>
            ) : (
              <ul className="meas-bp-unusual">
                {[...unusual].reverse().map((u) => (
                  <li key={u.reading.ms}>
                    <strong>
                      {f.dateTime(u.reading.at)} — {pair(u.reading)} {unit}
                    </strong>
                    <span>
                      {t('meas.bp.unusual.lead')}
                      {u.deviations.map((d) => axisText(t, d)).join(', ')}.
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="meas-note">
              {tp('meas.bp.count', readings.length)} {t('meas.bp.unusual.rule')}
            </p>
            <p className="meas-note">{t('meas.bp.mapNote')}</p>
          </div>
        </div>
      )
    }
  }

  return (
    <article className="card meas-wide" aria-labelledby="meas-bp-title">
      <h3 id="meas-bp-title" className="meas-wide-title">
        {t('meas.bp.title')}
      </h3>
      {body}
    </article>
  )
}

function axisText(t: (k: UiKey, p?: Record<string, string | number>) => string, d: AxisDeviation): string {
  return t('meas.bp.unusual.axis', {
    axis: t(d.axis === 'systolic' ? 'meas.bp.axis.systolic' : 'meas.bp.axis.diastolic'),
    amount: Math.round(Math.abs(d.delta)),
    direction: t(d.isAbove ? 'meas.bp.higher' : 'meas.bp.lowerWord'),
    usual: Math.round(d.baseline),
  })
}

// --- Walking and gait -------------------------------------------------------------

function GaitCard({ today, tz }: { today: string; tz: string }) {
  const { t, tp } = useI18n()
  const from = addDays(today, -GAIT_THRESHOLDS.historyDays)
  const q = useQuery({
    queryKey: ['measurements', 'gait', tz, today],
    // `month` for daily buckets; `from` stretches the window to the five weeks
    // the two comparison windows need.
    queryFn: () => api.summary('month', [...GAIT_KEYS, FALLS_KEY], tz, from, today),
    staleTime: 5 * 60_000,
  })

  let body: ReactNode
  if (q.isLoading) body = <div className="skeleton" style={{ height: 200 }} />
  else if (q.isError) body = <ErrorState error={q.error} />
  else {
    const metrics = q.data?.metrics ?? {}
    const daily = (key: string): DayPoint[] =>
      readSeries(metricDef(key), pickSeries(metricDef(key), metrics))
        .points.filter((p) => p.value != null && p.t)
        .map((p) => ({ day: isoDay(new Date(p.t)), value: p.value as number }))
    const summaries = GAIT_METRICS.map((m) => gaitSummary(m, daily(m.key), today))
    const falls = fallDays(daily(FALLS_KEY), from, today)
    const domain: [number, number] = [dayMs(from), dayMs(today)]
    body = (
      <>
        <p className="meas-note">{t('meas.gait.lead')}</p>
        <Legend
          items={[
            { label: t('meas.gait.legend.band'), color: 'color-mix(in srgb, var(--accent) 25%, transparent)' },
            { label: t('meas.gait.legend.mean'), color: 'var(--text-dim)' },
            ...(falls.length > 0 ? [{ label: t('meas.gait.legend.fall'), color: 'var(--text-dim)' }] : []),
          ]}
        />
        <div className="meas-gait-rows">
          {summaries.map((s) => (
            <GaitRow key={s.metric.key} summary={s} falls={falls} domain={domain} today={today} />
          ))}
        </div>
        {falls.length > 0 ? (
          <p className="meas-note">
            {tp('meas.gait.falls', falls.reduce((n, p) => n + p.value, 0))} {t('meas.gait.fallsNote')}
          </p>
        ) : (
          <p className="meas-note">{t('meas.gait.noFalls', { n: GAIT_THRESHOLDS.historyDays })}</p>
        )}
        <ul className="meas-gait-notes">
          <li>{t('meas.gait.steadinessEvents')}</li>
          <li>{t('meas.gait.apple')}</li>
          <li>{t('meas.gait.description')}</li>
        </ul>
      </>
    )
  }
  return (
    <article className="card meas-wide" aria-labelledby="meas-gait-title">
      <h3 id="meas-gait-title" className="meas-wide-title">
        {t('meas.gait.title')}
      </h3>
      {body}
    </article>
  )
}

/** Local midnight of a `YYYY-MM-DD`, as a chart coordinate. */
function dayMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).getTime()
}

function GaitRow({
  summary,
  falls,
  domain,
  today,
}: {
  summary: GaitSummary
  falls: DayPoint[]
  domain: [number, number]
  today: string
}) {
  const { t, tMetric } = useI18n()
  const f = useFormat()
  const m = summary.metric
  const level = (v: number) => `${f.fmt(v, m.decimals)} ${m.unit}`
  const delta = (v: number) => `${f.fmt(v, m.decimals)}${t(`meas.gait.delta.${m.deltaUnit}` as UiKey)}`
  const c = summary.change
  const headline =
    c.kind === 'notEnoughData'
      ? t('meas.gait.notEnough')
      : c.kind === 'notComparable'
        ? t('meas.gait.notComparable')
        : c.kind === 'unchanged'
          ? t('meas.gait.unchanged')
          : t('meas.gait.moved', {
              delta: delta(Math.abs(c.recent - c.baseline)),
              direction: t(c.direction === 'up' ? 'meas.bp.higher' : 'meas.bp.lowerWord'),
              n: GAIT_THRESHOLDS.baselineDays,
            })
  const detail =
    c.kind === 'notEnoughData'
      ? t('meas.gait.detail.notEnough', {
          recentDays: GAIT_THRESHOLDS.recentDays,
          recent: c.recentDays,
          baselineDays: GAIT_THRESHOLDS.baselineDays,
          baseline: c.baselineDays,
          minRecent: GAIT_THRESHOLDS.minRecentDays,
          minBaseline: GAIT_THRESHOLDS.minBaselineDays,
        })
      : c.kind === 'notComparable'
        ? t('meas.gait.detail.notComparable')
        : t(c.kind === 'unchanged' ? 'meas.gait.detail.unchanged' : 'meas.gait.detail.moved', {
            recentDays: GAIT_THRESHOLDS.recentDays,
            recent: level(c.recent),
            baselineDays: GAIT_THRESHOLDS.baselineDays,
            baseline: level(c.baseline),
          })

  // Every day of the window, so a missing day breaks the line rather than being
  // bridged; lone days get a dot.
  const byDay = new Map(summary.points.map((p) => [p.day, p.value]))
  const isolated = isolatedDays(summary.points)
  const data: { x: number; v: number | null; lone: number | null }[] = []
  for (let d = addDays(today, -GAIT_THRESHOLDS.historyDays); d <= today; d = addDays(d, 1)) {
    const v = byDay.get(d) ?? null
    data.push({ x: dayMs(d), v, lone: v != null && isolated.has(d) ? v : null })
  }
  const values = summary.points.map((p) => p.value)
  if (summary.band) values.push(summary.band.low, summary.band.high)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1

  return (
    <div className={`meas-gait-row${c.kind === 'moved' ? ' has-moved' : ''}`}>
      <div className="meas-gait-text">
        <h4 className="meas-card-title" title={t(`meas.gait.explain.${m.key}` as UiKey)}>
          {tMetric(m.key)}
        </h4>
        <p className="meas-gait-latest">
          {summary.latest
            ? t('meas.gait.latest', { value: level(summary.latest.value), date: f.date(summary.latest.day) })
            : t('meas.gait.nothing', { n: GAIT_THRESHOLDS.historyDays })}
        </p>
        <p className="meas-gait-headline">{headline}</p>
        <p className="meas-note">{detail}</p>
        {summary.band && (
          <p className="meas-note">
            {t('meas.gait.band', { low: level(summary.band.low), high: level(summary.band.high), n: summary.band.days })}
          </p>
        )}
        <Link className="meas-trends" to={`/trends?metric=${encodeURIComponent(m.key)}`}>
          {t('meas.toTrends')}
          <span className="sr-only"> — {tMetric(m.key)}</span>
        </Link>
      </div>
      <div
        className="meas-gait-chart"
        role="img"
        aria-label={t('meas.gait.chart.aria', { metric: tMetric(m.key), n: GAIT_THRESHOLDS.historyDays })}
      >
        {summary.points.length === 0 ? null : (
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="x"
                type="number"
                scale="time"
                domain={domain}
                tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                stroke="var(--border)"
                tickFormatter={(v: number) => f.monthDay(new Date(v).toISOString())}
                minTickGap={28}
              />
              <YAxis
                tick={{ fill: 'var(--text-dim)', fontSize: 11 }}
                stroke="var(--border)"
                width={44}
                domain={[lo - pad, hi + pad]}
                tickFormatter={(v: number) => f.fmt(v, m.decimals)}
                tickCount={3}
              />
              {summary.band && (
                <ReferenceArea
                  y1={summary.band.low}
                  y2={summary.band.high}
                  fill="var(--accent)"
                  fillOpacity={0.12}
                  stroke="none"
                  ifOverflow="hidden"
                />
              )}
              {summary.band && (
                <ReferenceLine y={summary.band.mean} stroke="var(--text-dim)" strokeDasharray="4 3" ifOverflow="hidden" />
              )}
              {falls.map((p) => (
                <ReferenceLine key={p.day} x={dayMs(p.day)} stroke="var(--text-dim)" strokeDasharray="2 3" />
              ))}
              <Line dataKey="v" stroke="var(--helsa-nordlys)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
              <Scatter dataKey="lone" fill="var(--helsa-nordlys)" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
