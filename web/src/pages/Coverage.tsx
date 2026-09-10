// Data completeness — "which of my measurements are actually arriving, and who
// writes them".
//
// The page exists because a metric can go silent without a single error message.
// Nothing turns red, the charts keep drawing, and a series that used to arrive
// every day simply stops. Read as a chart, that looks like "you did nothing".
//
// ⚠️ **Two rules that are not style preferences.**
//
//  1. **No scores, grades or verdicts.** "52 of 120 types brought data" is a
//     fact; "your data quality is 43%" is a score, and a score invites you to
//     improve the number rather than to look at which row went quiet. There is a
//     percentage nowhere on this page on purpose.
//  2. **A missing measurement is never a zero.** The server leaves the field out
//     rather than sending 0, and this page prints a dash rather than filling it
//     back in. "0 days measured" claims we looked at every day and found nothing.
//
// And the honesty note at the top is not decoration: this page answers a NARROWER
// question than the app's completeness screen, because permissions never reach
// the server. Saying so is the feature.

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import type { CoverageSource, CoverageState, CoverageType } from '../api/types'
import { Card, Empty, ErrorState, Loading, Note } from '../components/ui'
import { useI18n } from '../i18n'
import type { UiKey } from '../i18n'
import { isoDaysAgo, useFormat } from '../lib/format'
import { cadenceWord, gaps, groupKey, sections, tally } from '../lib/coverage'

/** The same dash the formatter uses for "this has not arrived". */
const DASH = '–'

const WINDOWS: { days: number; label: UiKey }[] = [
  { days: 30, label: 'coverage.window.30' },
  { days: 90, label: 'coverage.window.90' },
  { days: 365, label: 'coverage.window.365' },
]

/**
 * The colour of a state.
 *
 * ⚠️ `never_arrived` is deliberately NOT red. Most of the catalogue's 120 types
 * have no sensor behind them for any given person, so the great majority of this
 * page is empty rows — colouring them as faults would drown the two or three that
 * are actually worth looking at, and would tell somebody with a phone and no
 * chest strap that sixty-eight things are wrong with them.
 */
const STATE_COLOR: Record<CoverageState, string> = {
  measured: 'var(--helsa-move)',
  outside_window: 'var(--helsa-ember)',
  never_arrived: 'var(--text-dim)',
}

const STATE_LABEL: Record<CoverageState, UiKey> = {
  measured: 'coverage.state.measured',
  outside_window: 'coverage.state.outside_window',
  never_arrived: 'coverage.state.never_arrived',
}

/** From today back `days` days, as the ISO dates the endpoint takes. */
function windowDates(days: number): { from: string; to: string } {
  return { from: isoDaysAgo(days - 1), to: isoDaysAgo(0) }
}

function Sources({ sources }: { sources?: CoverageSource[] }) {
  const { t } = useI18n()
  if (!sources || sources.length === 0) return <>{DASH}</>
  return (
    <>
      {sources.map((s, i) => {
        // ⚠️ A missing device means "the upload did not say", and nothing else.
        // Calling it the phone would be false for exactly the imported samples
        // where the hardware matters most (`Provenance/SampleProvenance.swift`).
        const device = s.device
          ? t(`coverage.device.${s.device}` as UiKey)
          : t('coverage.device.unknown')
        return (
          <span className="cov-source" key={`${s.bundle_id ?? '?'}-${i}`}>
            <code>{s.bundle_id ?? DASH}</code>
            <em title={s.device ? undefined : t('coverage.device.unknownTitle')}>{device}</em>
          </span>
        )
      })}
    </>
  )
}

function Row({ row }: { row: CoverageType }) {
  const { t, tMetric } = useI18n()
  const f = useFormat()
  const state = row.state ?? 'never_arrived'

  return (
    <tr>
      {/* A row header, not a plain cell: that is what makes a screen reader
          announce "Steps · There is data" rather than six loose values. */}
      <th scope="row" className="cov-metric">
        {tMetric(row.data_type ?? '')}
        {row.in_catalog === false && (
          <span className="cov-flag" title={t('coverage.notInCatalogTitle')}>
            {t('coverage.notInCatalog')}
          </span>
        )}
      </th>
      <td>
        <span className="cov-dot" style={{ background: STATE_COLOR[state] }} aria-hidden />
        {t(STATE_LABEL[state])}
      </td>
      {/* ⛔ No `?? 0` anywhere in these three cells. An absent count is an absent
          count — see the file header. */}
      <td className="num">{row.measured_days == null ? DASH : f.num(row.measured_days)}</td>
      <td className="num">{row.sample_count == null ? DASH : f.num(row.sample_count)}</td>
      <td>{row.last_day ? f.date(row.last_day) : DASH}</td>
      <td>
        <Sources sources={row.sources} />
      </td>
    </tr>
  )
}

/** The metrics that used to arrive in a rhythm and have stopped. */
function Gaps({ rows }: { rows: CoverageType[] }) {
  const { t, tp, tMetric } = useI18n()
  const f = useFormat()
  if (rows.length === 0) return null

  return (
    <Card title={t('coverage.gaps.title')}>
      <p className="subtle" style={{ marginTop: 0 }}>
        {t('coverage.gaps.body')}
      </p>
      <ul className="cov-gaps">
        {rows.map((row) => {
          const word = cadenceWord(row.gap?.typical_interval_days)
          const cadence = word
            ? t(`coverage.cadence.${word.key}` as UiKey, word.key === 'everyNDays' ? { n: word.n } : undefined)
            : null
          return (
            <li key={row.data_type}>
              <strong>{tMetric(row.data_type ?? '')}</strong>
              <span> — {tp('coverage.gaps.silent', row.gap?.silent_days ?? 0)}</span>
              {cadence && <span className="subtle"> · {t('coverage.gaps.cadence', { cadence })}</span>}
              {row.last_day && <span className="subtle"> · {f.date(row.last_day)}</span>}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

export default function Coverage() {
  const tz = browserTz()
  const [days, setDays] = useState(365)
  const { t, tGroup } = useI18n()
  const f = useFormat()

  const { from, to } = windowDates(days)
  const q = useQuery({
    queryKey: ['coverage', from, to, tz],
    queryFn: () => api.coverage(from, to, tz),
  })

  const types = q.data?.types ?? []
  const counts = tally(q.data)
  const groups = sections(types)
  const broken = gaps(types)

  return (
    <>
      <h1>{t('coverage.title')}</h1>
      <p className="subtle">{t('coverage.subtitle')}</p>

      <div className="controls" role="group" aria-label={t('coverage.window.aria')}>
        {WINDOWS.map((w) => (
          <button
            key={w.days}
            className="seg"
            aria-pressed={days === w.days}
            onClick={() => setDays(w.days)}
          >
            {t(w.label)}
          </button>
        ))}
      </div>

      <Note title={t('coverage.limits.title')}>{t('coverage.limits.body')}</Note>

      {q.isLoading ? (
        <Loading rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} />
      ) : counts.total === 0 ? (
        <Empty title={t('coverage.empty.title')} hint={t('coverage.empty.hint')} />
      ) : (
        <>
          <p className="cov-headline">
            {t('coverage.headline', {
              measured: f.num(counts.measured),
              total: f.num(counts.total),
              days: f.num(q.data?.days ?? days),
            })}
          </p>

          {/* ⚠️ The group cards used to be laid out with no space between them at
              all — nine tables sharing a border, so the page read as one table
              with headings dropped into it. `.sections` is where the space comes
              from now, rather than a `marginBottom` this page never had. */}
          <div className="sections">
            <Gaps rows={broken} />

            {/* Six columns, one of them a list of source bundles: these stay the
                full width of the page. Two of them side by side would each be
                scrolling sideways inside their own card, which is denser only in
                the sense that less of it is visible. */}
            {groups.map((section) => (
              <Card
                key={section.group}
                title={`${tGroup(groupKey(section.group))} · ${t('coverage.group.count', {
                  measured: f.num(section.measured),
                  total: f.num(section.total),
                })}`}
              >
                {section.measured === 0 && (
                  <p className="subtle" style={{ marginTop: 0 }}>
                    {t('coverage.group.empty')}
                  </p>
                )}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('coverage.col.metric')}</th>
                        <th>{t('coverage.col.state')}</th>
                        <th>{t('coverage.col.days')}</th>
                        <th>{t('coverage.col.samples')}</th>
                        <th>{t('coverage.col.last')}</th>
                        <th>{t('coverage.col.sources')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {section.rows.map((row) => (
                        <Row key={row.data_type} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  )
}
