// Sleep: one night in full, and the nights behind it as a list you can walk.
//
// # What was wrong with it
//
// Seven nights, seven full cards, 4721 pixels — and the card at the bottom was
// the same size as the card at the top, although one of them is the night the
// person woke up from and the other is last Tuesday. Asking for thirty nights
// made it four times worse. There was also no way back: the window always ended
// today, so anything older than thirty nights did not exist on this page.
//
// # The shape it has now
//
// The phone's, adapted to a screen with more room
// (`HelsaKit/Sources/HelsaKit/Health/UI/SleepSectionView.swift`): it **opens on
// one night in full** — the newest in the window — and the rest of the period is
// a list of one-line rows underneath, each with its own hypnogram strip. Click a
// row, or a bar on the chart, and that night moves into the detail card.
//
// ⚠️ The detail card is **not** a modal or a separate route. A night is only
// interesting next to its neighbours — "is this a bad night or a bad week" is
// the question — and a dialog would put the answer behind a dismissal.
//
// The period stepper is the one from Trends, unchanged: back and forward through
// 7- or 30-night stretches, and forward stops at the present.

import { useMemo, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, browserTz } from '../api/client'
import type { Range } from '../api/types'
import { PeriodStepper } from '../components/PeriodStepper'
import { Card, Empty, ErrorState, Legend, Loading, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import { STAGE_CHART, STAGE_COLOR, STAGE_ORDER, useFormat } from '../lib/format'
import { metricDef, pickSeries, readSeries } from '../lib/metrics'
import { averages, groupByNight, segmentMinutes, sliceMinutes, type Night } from '../lib/sleep'
import { rollingWindow } from '../lib/window'

/** The two window lengths, in the vocabulary the window code already speaks:
 * a `week` is seven nights, a `month` is thirty. */
const WINDOWS: { range: Range; nights: number }[] = [
  { range: 'week', nights: 7 },
  { range: 'month', nights: 30 },
]

/** The physiological metrics measured during the sleep window (docs/23 §5). */
const PHYSIO = [
  'restingHeartRate',
  'hrv',
  'respiratoryRate',
  'appleSleepingWristTemperature',
  'oxygenSaturation',
].map(metricDef)

export default function Sleep() {
  const tz = browserTz()
  const [range, setRange] = useState<Range>('week')
  /** Which window is on screen. `0` = the one ending today, `-1` = the stretch
   * before it. ⚠️ Never positive — the nights after tonight have not happened. */
  const [offset, setOffset] = useState(0)
  /** Which night the detail card is showing. `null` = "the newest one in this
   * window", which is what the page opens on and what it falls back to whenever
   * the window moves out from under the choice. */
  const [chosen, setChosen] = useState<string | null>(null)
  const { t, tp, tx, tMetric } = useI18n()
  const f = useFormat()

  const win = useMemo(() => rollingWindow(range, offset, new Date()), [range, offset])
  const nightCount = WINDOWS.find((w) => w.range === range)?.nights ?? 7

  const q = useQuery({
    queryKey: ['sleep', win.from, win.to, tz],
    queryFn: () => api.sleep(win.from, win.to, tz),
    // Stepping backwards keeps the previous window on screen until the new one
    // lands, so the page does not collapse to a skeleton on every click.
    placeholderData: keepPreviousData,
  })

  const physio = useQuery({
    queryKey: ['sleep-physio', range, win.from, win.to, tz],
    queryFn: () =>
      api.summary(
        range,
        PHYSIO.flatMap((d) => [d.key, ...d.aliases]),
        tz,
        win.from,
        win.to,
      ),
  })

  const nights = useMemo(() => groupByNight(q.data ?? []), [q.data])

  if (q.isLoading) return <Loading rows={2} />
  if (q.isError) return <ErrorState error={q.error} />

  const avg = averages(nights)
  // ⚠️ Resolved here rather than stored, so a stale key simply falls back to the
  // newest night. Storing the resolution would mean a window step could leave
  // the card pointing at a night that is no longer in the list.
  const selected = nights.find((n) => n.startedAt === chosen) ?? nights[0]

  // Only the stages that actually occur make it onto the chart.
  const presentStages = STAGE_ORDER.filter((s) => nights.some((n) => (n.stages[s] ?? 0) > 0))
  const chart = [...nights].reverse().map((n) => ({
    startedAt: n.startedAt,
    key: n.key,
    ...Object.fromEntries(presentStages.map((s) => [s, n.stages[s] ?? 0])),
  }))

  const physioCards = PHYSIO.map((def) => ({
    def,
    r: readSeries(def, pickSeries(def, physio.data?.metrics)),
  })).filter((x) => x.r.hasData)

  return (
    <>
      <h1>{t('sleep.title')}</h1>
      <p className="subtle">
        {tx('sleep.subtitle', { derived: <strong>{t('sleep.subtitle.derived')}</strong> })}
      </p>

      <div className="controls">
        {WINDOWS.map((w) => (
          <button
            key={w.range}
            className="seg"
            aria-pressed={range === w.range}
            onClick={() => {
              setRange(w.range)
              // ⚠️ Back to the present on a length change. Offsets are counted in
              // windows, so "-3" means three weeks ago on one setting and three
              // months ago on the other — the same number, a different place.
              setOffset(0)
            }}
          >
            {tp('sleep.window', w.nights)}
          </button>
        ))}
      </div>

      <PeriodStepper
        window={win}
        range={range}
        canStepForward={offset < 0}
        isBrowsing={offset < 0}
        onBack={() => setOffset((o) => o - 1)}
        onForward={() => setOffset((o) => Math.min(0, o + 1))}
        onNow={() => setOffset(0)}
      />

      {nights.length === 0 ? (
        <Empty title={t('sleep.empty.title')} hint={t('sleep.empty.hint')} />
      ) : (
        <>
          <div className="grid grid-stats" style={{ marginBottom: 18 }}>
            <Stat
              label={tp('sleep.avgSleep', avg.nights)}
              value={f.duration(avg.asleepMin)}
              color="var(--helsa-nordlys)"
            />
            <Stat
              label={t('sleep.efficiency')}
              value={f.percent(avg.efficiency, 0)}
              color="var(--helsa-fjord)"
            />
            <Stat
              label={t('sleep.awakeningsPerNight')}
              value={f.fmt(avg.awakenings, 1)}
              color="var(--helsa-ember)"
            />
            <Stat
              label={t('sleep.deepRemShare')}
              value={f.percent(avg.deepRemShare, 0)}
              color="var(--helsa-nordlys)"
            />
          </div>

          {selected && <NightCard night={selected} isLatest={selected === nights[0]} />}

          {/* The rest of the period. One row a night, newest first — and the
              rows are buttons, because a row that changes what the card above
              shows is a control, whatever it looks like. */}
          {nights.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <Card title={tp('sleep.nights.title', nights.length)}>
                <div className="night-list">
                  {nights.map((n) => (
                    <NightRow
                      key={n.startedAt}
                      night={n}
                      selected={n === selected}
                      onSelect={() => setChosen(n.startedAt)}
                    />
                  ))}
                </div>
                <p className="subtle" style={{ margin: '10px 0 0' }}>
                  {t('sleep.nights.hint')}
                </p>
              </Card>
            </div>
          )}

          {chart.length > 1 && (
            <div style={{ marginBottom: 16 }}>
              <Card title={t('sleep.stagesChart')}>
                <div className="chart-sm">
                  <ResponsiveContainer>
                    <BarChart
                      data={chart}
                      margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
                      onClick={(state: unknown) => {
                        const key = tappedNight(state)
                        if (key) setChosen(key)
                      }}
                    >
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                      {/* ⚠️ The axis is keyed on the night's own day — the day
                          you woke up — and NOT on the moment the session
                          started. A night that began at 23:40 starts on the day
                          before it belongs to, so the axis used to show two
                          "Sep 4" and no "Sep 10", while the list beside it named
                          the nights correctly. Same nights, two different sets
                          of labels. */}
                      <XAxis
                        dataKey="key"
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        tickFormatter={(v: string) => f.monthDay(v)}
                      />
                      <YAxis
                        tick={{ fill: 'var(--text-dim)', fontSize: 12 }}
                        stroke="var(--border)"
                        width={54}
                        tickFormatter={(v: number) => f.fmt(v, 0)}
                      />
                      <Tooltip
                        contentStyle={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          borderRadius: 10,
                          color: 'var(--text)',
                        }}
                        labelStyle={{ color: 'var(--text-dim)' }}
                        labelFormatter={(v: string) => f.date(v)}
                        formatter={(v: number, name: string) => [f.duration(v), name]}
                      />
                      {presentStages.map((s, i) => (
                        <Bar
                          key={s}
                          dataKey={s}
                          name={f.stageName(s)}
                          stackId="stage"
                          fill={STAGE_CHART[s]?.fill ?? 'var(--surface-2)'}
                          fillOpacity={STAGE_CHART[s]?.opacity ?? 1}
                          stroke="var(--surface)"
                          strokeWidth={1.5}
                          maxBarSize={38}
                          radius={i === presentStages.length - 1 ? [4, 4, 0, 0] : undefined}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <Legend
                  items={presentStages.map((s) => ({
                    label: f.stageName(s),
                    color: STAGE_COLOR[s] ?? 'var(--surface-2)',
                  }))}
                />
                <p className="subtle" style={{ margin: '10px 0 0' }}>
                  {t('sleep.stagesChart.hint')}
                </p>
              </Card>
            </div>
          )}

          {physioCards.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <Card title={t('sleep.physio.title')}>
                <div className="grid grid-stats">
                  {physioCards.map(({ def, r }) => (
                    <Stat
                      key={def.key}
                      label={tMetric(def.key)}
                      value={f.fmt(r.total, def.digits)}
                      unit={f.unit(r.unit)}
                      color={def.color}
                    />
                  ))}
                </div>
                <p className="subtle" style={{ margin: '12px 0 0' }}>
                  {tx('sleep.physio.note', { insights: <code>insights</code> })}
                </p>
              </Card>
            </div>
          )}
          {nights.length < nightCount && (
            <p className="subtle">{tp('sleep.gap', nightCount, { nights: nights.length })}</p>
          )}
        </>
      )}
    </>
  )
}

/**
 * Which night a click on the chart landed on.
 *
 * The parameter is `unknown` on purpose: recharts' click-state type lives behind
 * a deep internal import path, and a structural read of the one field we need is
 * both narrower and more stable than pinning that path (the same reasoning as
 * `Trends.tappedBucket`).
 */
function tappedNight(state: unknown): string | null {
  const payload = (state as { activePayload?: { payload?: { startedAt?: unknown } }[] } | null)
    ?.activePayload
  const startedAt = payload?.[0]?.payload?.startedAt
  return typeof startedAt === 'string' ? startedAt : null
}

/** The bar under a night: how the stages ran, in proportion. It is the one thing
 * that makes a one-line row worth reading, because two nights of equal length can
 * look completely different here. */
function Hypnogram({ night, height = 26 }: { night: Night; height?: number }) {
  const f = useFormat()
  const { t } = useI18n()
  const span = night.inBedMin || 1
  return (
    <div
      className="hypnogram"
      style={{ height }}
      role="img"
      aria-label={t('sleep.night.aria', { date: f.date(night.key) })}
    >
      {night.slices.map((s, i) => (
        <div
          key={i}
          title={`${f.stageName(s.stage)} · ${f.duration(sliceMinutes(s))}`}
          style={{
            width: `${(sliceMinutes(s) / span) * 100}%`,
            background: STAGE_COLOR[s.stage] ?? 'var(--surface-2)',
          }}
        />
      ))}
    </div>
  )
}

function NightRow({
  night,
  selected,
  onSelect,
}: {
  night: Night
  selected: boolean
  onSelect: () => void
}) {
  const f = useFormat()
  const { t } = useI18n()
  return (
    <button type="button" className="night-row" aria-pressed={selected} onClick={onSelect}>
      <span className="night-date">{f.date(night.key)}</span>
      <span className="night-length num">{f.duration(night.asleepMin)}</span>
      <Hypnogram night={night} height={14} />
      <span className="night-eff num subtle">{f.percent(night.efficiency, 0)}</span>
      <span className="night-wakes num subtle" title={t('sleep.awakenings')}>
        {f.num(night.awakenings)}×
      </span>
    </button>
  )
}

function NightCard({ night, isLatest }: { night: Night; isLatest: boolean }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const stages = STAGE_ORDER.filter((s) => (night.stages[s] ?? 0) > 0)
  const day = f.date(night.key)

  return (
    <div style={{ marginBottom: 16 }}>
      <Card
        title={
          isLatest
            ? t('sleep.night.latest', { date: day, duration: f.duration(night.asleepMin) })
            : t('sleep.night.title', { date: day, duration: f.duration(night.asleepMin) })
        }
      >
        <Hypnogram night={night} />

        {/* Without this the question "why is the total not the sum of the
            stages?" would go unanswered — and the answer is not an error. */}
        {night.overlapMin >= 1 && (
          <p className="subtle" style={{ marginTop: 8, marginBottom: 12 }}>
            {t('sleep.overlap', { duration: f.duration(night.overlapMin) })}
          </p>
        )}

        {/* The night's own two tables — six figures about the night, and the
            stages it was made of. Side by side when there is room for them: they
            are two short tables about one night, and stacking them put the
            stages a screenful below the night they belong to on a laptop. The
            hypnogram above stays across the full card, because a proportional
            bar squeezed to half a card stops being readable. */}
        <div className="flow" style={{ marginTop: 12, marginBottom: 12 }}>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <td>{t('sleep.inBed')}</td>
                <td className="num">{f.duration(night.inBedMin)}</td>
                <td>{t('sleep.efficiencyShort')}</td>
                <td className="num">{f.percent(night.efficiency, 0)}</td>
              </tr>
              <tr>
                <td>{t('sleep.onset')}</td>
                <td className="num">{f.time(night.onset)}</td>
                <td>{t('sleep.wakeUp')}</td>
                <td className="num">{f.time(night.wakeUp)}</td>
              </tr>
              <tr>
                <td>{t('sleep.awakenings')}</td>
                <td className="num">{f.num(night.awakenings)}</td>
                <td>{t('sleep.deepRem')}</td>
                <td className="num">
                  {f.percent(
                    night.asleepMin > 0
                      ? ((night.stages.deep ?? 0) + (night.stages.rem ?? 0)) / night.asleepMin
                      : null,
                    0,
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('sleep.col.stage')}</th>
                <th>{t('sleep.col.length')}</th>
                <th>{t('sleep.col.shareOfSleep')}</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s}>
                  <td>
                    <span
                      className="picker-dot"
                      style={{ background: STAGE_COLOR[s] ?? 'var(--surface-2)' }}
                    />{' '}
                    {f.stageName(s)}
                  </td>
                  <td className="num">{f.duration(night.stages[s])}</td>
                  <td className="num">
                    {s === 'awake' || s === 'inBed'
                      ? '–'
                      : f.percent(
                          night.asleepMin > 0 ? night.stages[s]! / night.asleepMin : null,
                          0,
                        )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="subtle" style={{ cursor: 'pointer' }}>
            {tp('sleep.raw', night.segments.length)}
          </summary>
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table>
              <thead>
                <tr>
                  <th>{t('sleep.col.stage')}</th>
                  <th>{t('sleep.col.start')}</th>
                  <th>{t('sleep.col.end')}</th>
                  <th>{t('sleep.col.length')}</th>
                </tr>
              </thead>
              <tbody>
                {night.segments.map((s, i) => (
                  <tr key={i}>
                    <td>{f.stageName(s.stage)}</td>
                    <td className="num">{f.time(s.started_at)}</td>
                    <td className="num">{f.time(s.ended_at)}</td>
                    <td className="num">{f.duration(segmentMinutes(s))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>
    </div>
  )
}
