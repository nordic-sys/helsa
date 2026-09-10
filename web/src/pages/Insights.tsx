import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Insight, InsightSeverity } from '../api/types'
import { Card, Empty, ErrorState, Loading } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { useFormat } from '../lib/format'
import { groupInsights, valueDigits, type InsightGroupKey } from '../lib/insights'

const KIND_LABEL: Record<InsightGroupKey, UiKey> = {
  anomaly: 'insights.kind.anomaly',
  trend: 'insights.kind.trend',
  correlation: 'insights.kind.correlation',
  pattern: 'insights.kind.pattern',
  other: 'insights.kind.other',
}

const KIND_ABOUT: Record<InsightGroupKey, UiKey> = {
  anomaly: 'insights.kind.anomaly.about',
  trend: 'insights.kind.trend.about',
  correlation: 'insights.kind.correlation.about',
  pattern: 'insights.kind.pattern.about',
  other: 'insights.kind.other.about',
}

const SEVERITY_LABEL: Record<InsightSeverity, UiKey> = {
  notice: 'insights.severity.notice',
  info: 'insights.severity.info',
}

/**
 * ⚠️ Deliberately not a red and a green. `severity` says how much attention the
 * server thinks a statement is worth, and an alarm colour would turn that into a
 * verdict about the person — which is the one thing this product does not do.
 * `ember` is the same colour the interface already uses for "read this carefully"
 * (`Note`), and `fjord` is the neutral one.
 */
const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  notice: 'var(--helsa-ember)',
  info: 'var(--helsa-fjord)',
}

export default function Insights() {
  const q = useQuery({ queryKey: ['insights'], queryFn: () => api.insights() })
  const { t } = useI18n()

  if (q.isLoading) return <Loading rows={2} />
  if (q.isError) return <ErrorState error={q.error} />

  const groups = groupInsights(q.data ?? [])

  return (
    <>
      <h1>{t('insights.title')}</h1>
      <p className="subtle">{t('insights.subtitle')}</p>

      {groups.length === 0 ? (
        <Empty title={t('insights.empty.title')} hint={t('insights.empty.hint')} />
      ) : (
        <>
          <p className="subtle" style={{ marginBottom: 16 }}>
            {t('insights.serverLanguage')}
          </p>

          {groups.map((group) => (
            <div key={group.key} style={{ marginBottom: 16 }}>
              <Card title={t(KIND_LABEL[group.key])}>
                <p className="subtle" style={{ margin: '-2px 0 4px' }}>
                  {t(KIND_ABOUT[group.key])}
                </p>
                {group.items.map((insight, i) => (
                  <Observation
                    key={insight.id ?? `${group.key}-${i}`}
                    insight={insight}
                    first={i === 0}
                  />
                ))}
              </Card>
            </div>
          ))}
        </>
      )}
    </>
  )
}

/**
 * One observation.
 *
 * ⚠️ `lang="hu"` on the two sentences is not a stray literal, it is the honest
 * markup: the schema states outright that the server's wording is Hungarian,
 * because that is the only language this server has ever spoken. The document's
 * `lang` follows the interface switch, so without this a screen reader would
 * read a Hungarian sentence with English pronunciation rules on an English page.
 */
function Observation({ insight, first }: { insight: Insight; first: boolean }) {
  const { t, tMetric } = useI18n()
  const f = useFormat()

  const severity = insight.severity
  const color = severity ? SEVERITY_COLOR[severity] : 'var(--text-dim)'
  // The sentence is the server's. An empty one is not filled in with a guess —
  // the rule that fired is named instead, which is at least true.
  const title = insight.title?.trim()
  const detail = insight.detail?.trim()
  const values = Object.entries(insight.values ?? {})

  return (
    <article
      style={{
        borderTop: first ? 'none' : '1px solid var(--border)',
        paddingTop: first ? 8 : 14,
        paddingBottom: 4,
      }}
    >
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span
          className="picker-dot"
          style={{ background: color, marginTop: 7, flex: '0 0 auto' }}
          aria-hidden="true"
        />
        <div style={{ minWidth: 0 }}>
          {title ? (
            <strong lang="hu">{title}</strong>
          ) : (
            <strong className="subtle">
              {insight.rule ? <code>{insight.rule}</code> : t('insights.unnamed')}
            </strong>
          )}

          {detail && (
            <p className="subtle" lang="hu" style={{ margin: '4px 0 0' }}>
              {detail}
            </p>
          )}

          <p className="subtle" style={{ margin: '8px 0 0', fontSize: 13 }}>
            {insight.metric && (
              <>
                <strong style={{ color, fontWeight: 600 }}>{tMetric(insight.metric)}</strong>
                {' · '}
              </>
            )}
            {severity && <>{t(SEVERITY_LABEL[severity])} · </>}
            {t('insights.generatedAt', { when: f.relative(insight.generated_at) })}
          </p>

          {/* The rule's own working. It only arrives from a server new enough to
              send it, and it is numbers — so it needs no translating and states
              nothing the sentence above did not. */}
          {values.length > 0 && (
            <details style={{ marginTop: 10 }}>
              <summary className="subtle" style={{ cursor: 'pointer' }}>
                {t('insights.values.summary')}
              </summary>
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead>
                    <tr>
                      <th>{insight.rule ?? t('insights.values.summary')}</th>
                      <th>{t('insights.col.value')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.map(([key, v]) => (
                      <tr key={key}>
                        <td>
                          <code>{key}</code>
                        </td>
                        <td className="num">{f.fmt(v, valueDigits(v))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="subtle" style={{ margin: '8px 0 0' }}>
                {t('insights.values.note')}
              </p>
            </details>
          )}
        </div>
      </div>
    </article>
  )
}
