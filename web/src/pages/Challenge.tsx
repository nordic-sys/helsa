import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import type { Challenge as ChallengeData } from '../api/types'
import { Card, Empty, ErrorState, Loading, Note, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import { useFormat } from '../lib/format'

/**
 * The monthly challenge — the phone's challenge screen in numbers.
 *
 * ⛔ The trail the app draws is deliberately not ported: the picture is the
 * phone's, and a second hand-drawn one here would be a second thing to keep in
 * step with the milestones. What the web needs is the figures behind it.
 *
 * Two rules this page exists to respect, and both of them are easy to break by
 * accident:
 *
 *  1. **A missing measurement is not a zero.** Every derived number arrives
 *     optional, and the formatter prints a dash for `undefined`. There is no
 *     `?? 0` anywhere on this page — that is exactly the call-site slip that once
 *     turned "we did not measure this" into "you did nothing" (`ui.test.tsx`).
 *  2. **No score, no grade, no verdict.** Milestones and counts. The page never
 *     tells the reader whether their month was good.
 */

/** `YYYY-MM` for the browser's current month. */
function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** `YYYY-MM` shifted by whole months; the year rolls over on its own. */
function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + by, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function Challenge() {
  const tz = browserTz()
  const [month, setMonth] = useState(currentMonth)
  const { t } = useI18n()
  const f = useFormat()

  const q = useQuery({
    queryKey: ['challenge', month, tz],
    queryFn: () => api.challenge(month, tz),
  })

  // The month is not part of the payload's identity here — the switcher has to
  // stay on screen while the next month loads, or every step of it flashes the
  // whole page away.
  const atCurrentMonth = month >= currentMonth()

  return (
    <>
      <h1>{t('challenge.title')}</h1>
      <p className="subtle">{t('challenge.subtitle')}</p>

      <div className="controls">
        <button
          className="seg"
          aria-label={t('challenge.prevMonth')}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          ‹
        </button>
        <strong style={{ alignSelf: 'center' }}>{f.yearMonth(`${month}-01`)}</strong>
        <button
          className="seg"
          aria-label={t('challenge.nextMonth')}
          disabled={atCurrentMonth}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          ›
        </button>
      </div>

      {q.isPending ? (
        <Loading rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (
        <ChallengeBody c={q.data} />
      )}
    </>
  )
}

function ChallengeBody({ c }: { c: ChallengeData }) {
  const { t, tp } = useI18n()
  const f = useFormat()

  // A month nobody has walked yet has no days laid out at all — saying so is
  // better than an empty grid, which reads as a month of missed days.
  if (c.days.length === 0) {
    return <Empty title={t('challenge.notStarted')} />
  }

  const gaps = c.days.length - c.measured_days
  const hasData = c.steps != null

  return (
    <>
      <div className="grid grid-stats" style={{ marginBottom: 18 }}>
        <Stat
          label={t('challenge.steps')}
          value={f.num(c.steps)}
          color="var(--helsa-move)"
        />
        <Stat
          label={t('challenge.ofGoal')}
          // ⚠️ `percent` arrives on the 0…100 scale and the formatter wants a
          // ratio; `null` when it is absent, never a zero standing in for it.
          value={f.percent(c.percent != null ? c.percent / 100 : null, 0)}
          color="var(--helsa-fjord)"
        />
        <Stat
          label={t('challenge.stepsPerDay')}
          value={f.num(c.steps_per_day)}
          color="var(--helsa-nordlys)"
        />
        <Stat
          label={t('challenge.daysRemaining')}
          value={f.num(c.days_remaining)}
          color="var(--helsa-ember)"
        />
      </div>

      {!hasData && (
        <Empty title={t('challenge.empty.title')} hint={t('challenge.empty.hint')} />
      )}

      {/* ⚠️ The two goal cards, paired rather than stacked — and the streak has
          MOVED, from under the day chart to beside the milestones. That is the
          one reordering in this round, and the reason is that they answer the
          same question: the milestones say how far into the month's goal the
          walking has got, the streak says how many days in a row met the daily
          one. Both are short, both were full-width, and the chart between them
          is the detail underneath both. Nothing either of them says has changed. */}
      <div className="flow" style={{ marginBottom: 16 }}>
        <Card title={t('challenge.milestones.title')}>
          <Milestones c={c} />
        </Card>
        <Streak c={c} />
      </div>

      {c.thresholds_source === 'default' && (
        <Note title={t('challenge.source.title')}>{t('challenge.source.default')}</Note>
      )}

      <div>
        <Card title={t('challenge.days.title')}>
          {c.measured_days === 0 ? (
            <p className="subtle" style={{ margin: 0 }}>
              {t('challenge.days.empty')}
            </p>
          ) : (
            <>
              <div className="chart-sm">
                <ResponsiveContainer>
                  <BarChart
                    data={c.days.map((d) => ({
                      // ⚠️ `null`, not 0: recharts draws no bar for a null, and an
                      // empty slot is what a day with no measurement deserves.
                      day: d.day,
                      steps: d.steps ?? null,
                    }))}
                    margin={{ top: 8, right: 12, bottom: 4, left: -8 }}
                  >
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="day"
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
                      formatter={(v: number) => [f.num(v), t('challenge.steps')]}
                    />
                    <Bar
                      dataKey="steps"
                      name={t('challenge.steps')}
                      fill="var(--helsa-move)"
                      maxBarSize={38}
                      radius={[4, 4, 0, 0]}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {gaps > 0 && (
                <p className="subtle" style={{ margin: '10px 0 0' }}>
                  {tp('challenge.days.gaps', gaps)}
                </p>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  )
}

function Milestones({ c }: { c: ChallengeData }) {
  const { t } = useI18n()
  const f = useFormat()

  if (c.thresholds.length === 0) {
    return (
      <p className="subtle" style={{ margin: 0 }}>
        {t('challenge.milestones.empty')}
      </p>
    )
  }

  return (
    <>
      <p className="subtle" style={{ marginTop: 0 }}>
        {t('challenge.goalLabel', { steps: f.num(c.goal) })}
      </p>

      {/* The bar is drawn only where there is something to draw. A 0-width bar on
          a month we know nothing about would say the walking had not started. */}
      {c.percent != null && (
        <div
          className="split-bar"
          role="img"
          aria-label={f.percent(c.percent / 100, 0)}
          style={{ marginBottom: 14 }}
        >
          <div
            style={{
              width: `${Math.min(c.percent, 100)}%`,
              background: 'var(--helsa-move)',
            }}
          />
        </div>
      )}

      <div className="table-wrap" style={{ marginBottom: 12 }}>
        <table>
          <tbody>
            {c.thresholds.map((m) => (
              <tr key={m.steps}>
                <td>
                  <span
                    className="picker-dot"
                    style={{
                      background: m.reached ? 'var(--helsa-move)' : 'var(--surface-2)',
                    }}
                  />{' '}
                  {f.num(m.steps)}
                </td>
                <td className="num">{m.reached ? t('challenge.milestones.reached') : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {c.next_threshold != null && c.steps_to_next_threshold != null && (
        <p className="subtle" style={{ margin: 0 }}>
          {t('challenge.milestones.next', {
            steps: f.num(c.next_threshold),
            remaining: f.num(c.steps_to_next_threshold),
          })}
        </p>
      )}
      {c.complete && (
        <p className="subtle" style={{ margin: 0 }}>
          {t('challenge.complete')}
          {/* Said separately, because a percentage that stops at 100 would hide
              that the goal was passed twice over. */}
          {c.overshoot_steps != null && c.overshoot_steps > 0 && (
            <> {t('challenge.overshoot', { steps: f.num(c.overshoot_steps) })}</>
          )}
        </p>
      )}
      {c.thresholds_source === 'achievement' && (
        <p className="subtle" style={{ margin: '10px 0 0' }}>
          {t('challenge.source.achievement')}
        </p>
      )}
    </>
  )
}

function Streak({ c }: { c: ChallengeData }) {
  const { t, tp } = useI18n()
  const f = useFormat()
  const s = c.streak

  const broken =
    s.broken_by == null
      ? null
      : s.broken_by.reason === 'missed'
        ? t('challenge.streak.broken.missed', { date: f.date(s.broken_by.day) })
        : s.broken_by.reason === 'no_data'
          ? t('challenge.streak.broken.noData', { date: f.date(s.broken_by.day) })
          : t('challenge.streak.broken.startOfHistory')

  // No margin of its own: it is a cell of the `.flow` it now sits in.
  return (
    <Card title={t('challenge.streak.title')}>
      {s.daily_goal == null ? (
        <p className="subtle" style={{ margin: 0 }}>
          {t('challenge.streak.noGoal')}
        </p>
      ) : (
        <>
          <div className="grid grid-stats" style={{ marginBottom: 12 }}>
            <Stat
              label={t('challenge.streak.current')}
              value={
                s.length > 0
                  ? tp('challenge.streak.length', s.length)
                  : t('challenge.streak.none')
              }
              color="var(--helsa-fjord)"
            />
            <Stat
              label={t('challenge.streak.dailyGoal')}
              value={f.num(s.daily_goal)}
              color="var(--helsa-nordlys)"
            />
            <Stat
              label={t('challenge.streak.longest')}
              value={f.num(s.longest)}
              color="var(--helsa-move)"
            />
          </div>
          {broken && (
            <p className="subtle" style={{ margin: '0 0 6px' }}>
              {broken}
            </p>
          )}
          <p className="subtle" style={{ margin: 0 }}>
            {t('challenge.streak.window', {
              from: f.date(s.window_from),
              to: f.date(s.window_to),
            })}
          </p>
        </>
      )}

      {/* Always shown, whatever the number says: a streak that is quietly a
          lower bound is worse than none, because the reader takes it for the
          figure on their phone and concludes it broke. */}
      {s.missing_inputs.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <Note title={t('challenge.streak.lowerBound.title')}>
            {t('challenge.streak.lowerBound.body')}
          </Note>
        </div>
      )}
    </Card>
  )
}
