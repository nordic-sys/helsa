import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Achievement } from '../api/types'
import { Card, Empty, ErrorState, Legend, Loading } from '../components/ui'
import { useI18n } from '../i18n'
import type { I18n } from '../i18n'
import { useFormat, type Formatters } from '../lib/format'
import {
  ACHIEVEMENT_KIND_LABEL as KIND_LABEL,
  badgeLabel,
  groupAchievements,
  periodLabel,
  reachedThresholds,
} from '../lib/achievements'

const THRESHOLD_REACHED = 'var(--helsa-move)'
const THRESHOLD_MISSED = 'var(--surface-2)'

export default function Achievements() {
  const q = useQuery({ queryKey: ['achievements'], queryFn: () => api.achievements() })
  const { t, tp } = useI18n()

  if (q.isLoading) return <Loading rows={2} />
  if (q.isError) return <ErrorState error={q.error} />

  const items = q.data ?? []
  const groups = groupAchievements(items)

  return (
    <>
      <h1>{t('achievements.title')}</h1>
      <p className="subtle">{t('achievements.subtitle')}</p>

      {groups.length === 0 ? (
        <Empty title={t('achievements.empty.title')} hint={t('achievements.empty.hint')} />
      ) : (
        <>
          <p className="subtle" style={{ marginBottom: 16 }}>
            {tp('achievements.total', items.length)}
          </p>

          {/* Each family is a table of four or five short columns — a badge, a
              month, a figure, a date. Down a single 1300px column those columns
              drift so far apart that reading one row is a sweep of the head;
              side by side they are a table again. `flow-wide` and not `flow`,
              because five columns need more than 380px before the table starts
              scrolling inside its own card. */}
          <div className="flow flow-wide">
            {groups.map((group) => (
              <Card key={group.key} title={t(KIND_LABEL[group.key])}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('achievements.col.badge')}</th>
                        <th>{t('achievements.col.period')}</th>
                        <th>{t('achievements.col.value')}</th>
                        {group.hasThresholds && <th>{t('achievements.col.thresholds')}</th>}
                        <th>{t('achievements.col.earned')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((a, i) => (
                        <Row
                          key={a.id ?? `${group.key}-${i}`}
                          achievement={a}
                          showThresholds={group.hasThresholds}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>

                {group.hasThresholds && (
                  <>
                    <Legend
                      items={[
                        {
                          label: t('achievements.thresholds.reached'),
                          color: THRESHOLD_REACHED,
                        },
                        { label: t('achievements.thresholds.missed'), color: THRESHOLD_MISSED },
                      ]}
                    />
                    <p className="subtle" style={{ margin: '10px 0 0' }}>
                      {t('achievements.thresholds.note')}
                    </p>
                  </>
                )}
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Row({
  achievement: a,
  showThresholds,
}: {
  achievement: Achievement
  showThresholds: boolean
}) {
  const { t, tp } = useI18n()
  const f = useFormat()

  return (
    <tr>
      <td>{badgeLabel(a, t)}</td>
      <td>{periodLabel(a.period, f)}</td>
      <td className="num">{valueLabel(a, f, tp)}</td>
      {showThresholds && (
        <td>{a.thresholds?.length ? <Thresholds achievement={a} /> : '–'}</td>
      )}
      <td>{f.dateTime(a.earned_at)}</td>
    </tr>
  )
}

/**
 * The thresholds that were in force, with the ones this value had reached filled
 * in. Two numbers compared, nothing more: no count, no ranking, no "level 4 of
 * 6" — the medal itself is the statement, and it was already earned.
 */
function Thresholds({ achievement: a }: { achievement: Achievement }) {
  const { t } = useI18n()
  const f = useFormat()
  const split = reachedThresholds(a)

  // ⚠️ No value means we cannot say which thresholds it passed. Six hollow dots
  // would say it passed none of them, which is a claim about the data we do not
  // have.
  if (!split) return <>–</>

  const list = (ns: number[]) =>
    ns.length ? ns.map((n) => f.num(n)).join(', ') : t('achievements.thresholds.none')

  return (
    <span
      role="img"
      aria-label={t('achievements.thresholds.aria', {
        all: list(a.thresholds ?? []),
        reached: list(split.reached),
      })}
      style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}
    >
      {(a.thresholds ?? []).map((threshold, i) => (
        <span
          key={i}
          className="picker-dot"
          title={f.num(threshold)}
          style={{
            background: a.value! >= threshold ? THRESHOLD_REACHED : THRESHOLD_MISSED,
            border: '1px solid var(--border)',
          }}
        />
      ))}
    </span>
  )
}

/**
 * The figure as it stood when the medal was earned.
 *
 * ⚠️ Never `?? 0`. A badge that arrived without a value is a badge whose figure
 * we do not know, which is not the same as a badge worth nothing.
 */
function valueLabel(a: Achievement, f: Formatters, tp: I18n['tp']): string {
  if (a.value == null) return '–'
  // A streak is counted in months, and the unit dictionary has no word for that
  // token — the plural pair does the job, and inflects properly in English.
  if (a.unit === 'month') return tp('achievements.months', a.value)
  const unit = f.unit(a.unit)
  return unit ? `${f.num(a.value)} ${unit}` : f.num(a.value)
}
