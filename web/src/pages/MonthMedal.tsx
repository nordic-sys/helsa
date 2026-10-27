// A closed month's medal, opened — the web's port of the phone's
// `HelsaKit/Sources/HelsaKit/Achievements/MonthMedalDetailView.swift`.
//
// # Why a page and not a panel beside the table
//
// The workouts list is the web's one master/detail, and its detail is ALSO a
// route of its own (`/workouts/:id`) — the panel is a wide-screen convenience
// on top of a URL. The medals page has five tables in a flow, not one list, so
// there is no column for a panel to stand in; a route with a back link is the
// same pattern without the convenience, and it keeps the property that matters:
// a month is a link somebody can bookmark.
//
// # What the page claims, and from where (the app's rule, kept)
//
// ⚠️ **The medal's own numbers are the truth, not today's.** The total, the
// per-day figure and the milestones come from the badge: it carries the
// thresholds that were in force when it was earned. Only the day-by-day grid is
// fetched — from `/challenge?month=`, whose `days` are the month day by day —
// because that is the one thing a medal does not store. If that read fails, the
// rest of the page stands.
//
// ⛔ The trail the phone draws is not ported, for the reason the challenge page
// gives: the picture is the phone's, and a second hand-drawn one here would be a
// second thing to keep in step with the milestones.

import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import type { Achievement } from '../api/types'
import { DayGrid } from '../components/DayGrid'
import { Card, Empty, ErrorState, Loading, Stat } from '../components/ui'
import { useI18n } from '../i18n'
import { badgeLabel } from '../lib/achievements'
import { makeDayGrid } from '../lib/dayGrid'
import { useFormat } from '../lib/format'
import {
  dailyGoal,
  daysInMonth,
  medalMilestones,
  monthDays,
  monthMedal,
  parseMonth,
  perDayOverMonth,
} from '../lib/monthMedal'
import { firstWeekday, isoDay } from '../lib/window'

/** The page at `/achievements/:month`. */
export default function MonthMedal() {
  const { month = '' } = useParams()
  const { t } = useI18n()
  const f = useFormat()
  // The same key the medals list uses: opening a month from the list costs no
  // second request.
  const q = useQuery({ queryKey: ['achievements'], queryFn: () => api.achievements() })
  const parsed = parseMonth(month)
  const title = parsed ? f.monthYearLong(`${month}-01`) : month

  return (
    <>
      <p style={{ margin: '0 0 12px' }}>
        <Link className="linkish" to="/achievements">
          {t('achievements.month.back')}
        </Link>
      </p>
      {q.isLoading ? (
        <Loading rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : (() => {
          const medal = parsed ? monthMedal(q.data ?? [], month) : null
          if (!medal || !parsed) {
            return (
              <>
                <h1>{title}</h1>
                <Empty
                  title={t('achievements.month.notFound.title', { period: title })}
                  hint={t('achievements.month.notFound.hint')}
                />
              </>
            )
          }
          return <MedalBody medal={medal} month={month} year={parsed[0]} monthNo={parsed[1]} title={title} />
        })()}
    </>
  )
}

function MedalBody({
  medal,
  month,
  year,
  monthNo,
  title,
}: {
  medal: Achievement
  month: string
  year: number
  monthNo: number
  title: string
}) {
  const { t } = useI18n()
  const f = useFormat()
  const dayCount = daysInMonth(year, monthNo)
  const perDay = perDayOverMonth(medal.value, dayCount)
  const milestones = medalMilestones(medal)
  const reached = milestones?.filter((m) => m.reached).length ?? 0

  return (
    <>
      <h1>{title}</h1>
      <p className="subtle">{badgeLabel(medal, t)}</p>

      <div className="grid grid-stats" style={{ marginBottom: 18 }}>
        <Stat
          label={t('achievements.month.total')}
          value={f.num(medal.value)}
          missing={medal.value == null}
          color="var(--helsa-move)"
        />
        <Stat
          label={t('achievements.month.perDay')}
          value={f.num(perDay)}
          missing={perDay == null}
          color="var(--helsa-nordlys)"
        />
        {milestones && (
          <Stat
            label={t('achievements.month.milestonesReached')}
            value={`${reached}/${milestones.length}`}
            color="var(--helsa-fjord)"
          />
        )}
      </div>

      <div className="flow flow-wide" style={{ marginBottom: 16 }}>
        <DaysCard medal={medal} month={month} dayCount={dayCount} perDay={perDay} />

        {milestones ? (
          <Card title={t('achievements.month.milestones.title')}>
            <p className="subtle" style={{ marginTop: 0 }}>
              {t('challenge.goalLabel', { steps: f.num(Math.max(...milestones.map((m) => m.steps))) })}
            </p>
            <div className="table-wrap">
              <table>
                <tbody>
                  {milestones.map((m) => (
                    <tr key={m.steps}>
                      <td>
                        <span
                          className="picker-dot"
                          style={{
                            background: m.reached ? 'var(--helsa-move)' : 'var(--surface-2)',
                            border: '1px solid var(--border)',
                          }}
                        />{' '}
                        {f.num(m.steps)}
                      </td>
                      <td className="num">{m.reached ? t('achievements.thresholds.reached') : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          // ⚠️ A medal without a threshold snapshot cannot say which milestones
          // it passed. The page stays textual rather than inventing the list.
          <Card title={t('achievements.month.textOnly.title')}>
            <p className="subtle" style={{ margin: 0 }}>
              {t('achievements.month.textOnly.body')}
            </p>
          </Card>
        )}
      </div>

      <p className="subtle" style={{ margin: '0 0 4px' }}>
        {t('achievements.month.foot.locked')}
      </p>
      <p className="subtle" style={{ margin: 0 }}>
        {t('achievements.month.foot.fresh')}
      </p>
    </>
  )
}

/**
 * "Day by day" — the grid and the numbers that make sense of it, the app's
 * `MonthStepsCard` (`UI/Components/MonthStepGrid.swift`).
 *
 * ⚠️ **Two averages, both labelled.** The medal's total over the whole month,
 * and the measured days' own average. In a fully measured month they are the
 * same and only the first is printed; where they differ, the difference is the
 * point — it is how much of the month is missing, and hiding one would turn a
 * gap into a worse-looking month.
 */
function DaysCard({
  medal,
  month,
  dayCount,
  perDay,
}: {
  medal: Achievement
  month: string
  dayCount: number
  perDay: number | null
}) {
  const { t, tp, locale } = useI18n()
  const f = useFormat()
  const tz = browserTz()
  const q = useQuery({
    queryKey: ['challenge', month, tz],
    queryFn: () => api.challenge(month, tz),
  })
  const goal = dailyGoal(medal.thresholds, dayCount)

  let body
  if (q.isError) {
    const why = q.error instanceof Error ? q.error.message : String(q.error)
    body = (
      <p className="subtle" style={{ margin: 0 }} role="alert">
        {t('achievements.month.days.error', { error: why })}
      </p>
    )
  } else if (q.isPending) {
    // Before the first answer, "no day brought a measurement" would be a claim
    // about a month nobody has asked about yet.
    body = (
      <p className="subtle" style={{ margin: 0 }} role="status">
        {t('achievements.month.days.loading')}
      </p>
    )
  } else {
    const days = monthDays(q.data.days, month)
    const grid = makeDayGrid(days.days, firstWeekday(), locale)
    if (!grid || grid.isEmpty) {
      body = (
        <p className="subtle" style={{ margin: 0 }}>
          {t('achievements.month.days.empty')}
        </p>
      )
    } else {
      body = (
        <>
          <div className="subtle" style={{ margin: '0 0 12px', display: 'grid', gap: 3 }}>
            {perDay != null && <span>{t('achievements.month.days.perDay', { steps: f.num(perDay) })}</span>}
            {grid.gapCount > 0 && days.measuredAverage != null && (
              <span>
                {tp('achievements.month.days.measured', days.measuredCount, {
                  steps: f.num(days.measuredAverage),
                })}
              </span>
            )}
            {days.best && (
              <span>
                {t('achievements.month.days.best', {
                  day: f.date(isoDay(days.best.date)),
                  steps: f.num(days.best.steps),
                })}
              </span>
            )}
          </div>
          <DayGrid
            grid={grid}
            style={{
              format: (v) => f.num(v),
              spoken: (v) => t('achievements.month.steps', { steps: f.num(v) }),
              isHighlighted: goal != null ? (v) => goal > 0 && v >= goal : undefined,
              tint: 'var(--helsa-fjord)',
              highlightTint: 'var(--helsa-move)',
            }}
          />
          {goal != null && (
            <p className="subtle" style={{ margin: '8px 0 0' }}>
              {t('achievements.month.days.goal', { steps: f.num(goal) })}
            </p>
          )}
        </>
      )
    }
  }

  return <Card title={t('achievements.month.days.title')}>{body}</Card>
}
