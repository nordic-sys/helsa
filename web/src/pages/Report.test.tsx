// The health summary — the wiring around `lib/report.ts`.
//
// The arithmetic is pinned in `lib/report.test.ts`; here it is what the page
// asks for and what it says: daily buckets for the period and a year's
// baseline, no baseline request for a year-long report, a failed baseline that
// changes the honesty block's day count, the two sections the server cannot
// fill said in words, and the Print button that stands in for the PDF export.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import { en } from '../i18n/en'
import Report from './Report'

type SummaryArgs = [string, string[], string?, string?, string?]
const summaryCalls: SummaryArgs[] = []
let baselineFails = false

/** Daily buckets from `from` to `to`, steps 8000 a day before the last 30 days
 * and 10 000 inside them; resting heart rate 60 throughout. */
function daily(from: string, to: string, metrics: string[]): SummaryResponse {
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  const end = new Date(ty, tm - 1, td + 1).getTime()
  const recent = new Date(ty, tm - 1, td - 29).getTime()
  const out: SummaryResponse['metrics'] = {}
  for (const m of metrics) {
    if (m !== 'stepCount' && m !== 'restingHeartRate') continue
    const buckets = []
    for (let d = new Date(fy, fm - 1, fd); d.getTime() < end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
      if (m === 'stepCount') buckets.push({ t: d.toISOString(), v: d.getTime() >= recent ? 10_000 : 8000 })
      else buckets.push({ t: d.toISOString(), avg: 60, min: 55, max: 66 })
    }
    out[m] = { agg: m === 'stepCount' ? 'sum' : 'avg', unit: m === 'stepCount' ? 'count' : 'count/min', buckets }
  }
  return { metrics: out }
}

vi.mock('../api/client', () => ({
  api: {
    summary: (...args: SummaryArgs) => {
      summaryCalls.push(args)
      const [, metrics, , from, to] = args
      // The availability probe asks without a window — answer it empty.
      if (!from || !to) return Promise.resolve({ metrics: {} })
      // The baseline is the longer of the two windows the page asks for.
      const days = (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1
      if (baselineFails && days > 300 && summaryCalls.filter((c) => c[3]).length > 1) {
        return Promise.reject(new Error('down'))
      }
      return Promise.resolve(daily(from, to, metrics))
    },
    workouts: () => Promise.resolve({ items: [], next_cursor: null }),
  },
  browserTz: () => 'Europe/Budapest',
}))

function show(path = '/report') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[path]}>
          <Report />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

/** The calls with a window — the period and the baseline, not the availability probe. */
const windowed = () => summaryCalls.filter((c) => c[3] && c[4])

beforeEach(() => {
  localStorage.setItem('helsa.lang', 'en')
  summaryCalls.length = 0
  baselineFails = false
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 27, 9, 12))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the health summary page', () => {
  it('asks for daily buckets over 90 days and a year-long baseline ending the same day', async () => {
    show()
    await screen.findByTestId('report-sheet')
    const calls = windowed()
    expect(calls.every((c) => c[0] === 'month')).toBe(true)
    expect(calls.map((c) => [c[3], c[4]])).toEqual(
      expect.arrayContaining([
        ['2026-07-30', '2026-10-27'],
        ['2025-10-28', '2026-10-27'],
      ]),
    )
    expect(screen.getByTestId('report-period')).toHaveTextContent('90 days')
  })

  it('a year-long report asks for no baseline of its own', async () => {
    show('/report?d=365')
    await screen.findByTestId('report-sheet')
    expect(windowed()).toHaveLength(1)
  })

  it('opens with what changed, both numbers printed', async () => {
    show('/report?d=30&m=stepCount,restingHeartRate')
    const block = await screen.findByTestId('report-changes')
    expect(block).toHaveTextContent(en.ui['report.changes.title'])
    expect(block).toHaveTextContent('Steps: 8,000 → 10,000 steps (+25%)')
    // The heart rate did not move, so it takes no line.
    expect(block).not.toHaveTextContent('Resting heart rate')
  })

  it('says in words what the server cannot show, rather than leaving it out', async () => {
    show()
    expect(await screen.findByTestId('report-journal')).toHaveTextContent(en.ui['report.journal.body'])
    expect(screen.getByTestId('report-events')).toHaveTextContent(en.ui['report.events.body'])
  })

  it('an unmeasured metric is "no measurement" and named, never a zero', async () => {
    show('/report?m=stepCount,bodyMass')
    const row = await screen.findByTestId('report-row-bodyMass')
    expect(row).toHaveTextContent(en.ui['report.noMeasurement'])
    expect(row).toHaveTextContent(en.ui['report.usual.none'])
    expect(row).toHaveTextContent('0 / 90')
    expect(screen.getByText(/No measurement in this period: Body mass\./)).toBeInTheDocument()
  })

  it('carries the honesty block, the medical line and the source-merge note', async () => {
    show()
    const foot = await screen.findByTestId('report-foot')
    expect(foot).toHaveTextContent(en.ui['report.prov.notMedical'])
    expect(foot).toHaveTextContent('from the last 365 days')
    expect(screen.getByTestId('report-sources')).toHaveTextContent(en.ui['trends.sources.body'])
  })

  it('a failed baseline does not claim a 365-day usual range', async () => {
    baselineFails = true
    show()
    const foot = await screen.findByTestId('report-foot')
    expect(foot).toHaveTextContent('from the last 90 days')
    expect(screen.getByText(en.ui['report.baselineFailed'])).toBeInTheDocument()
  })

  it('the period picker moves the window it asks for and the period it prints', async () => {
    const user = userEvent.setup()
    show()
    await screen.findByTestId('report-sheet')
    await user.click(screen.getByRole('button', { name: en.ui['report.days.30'] }))
    await vi.waitFor(() => expect(screen.getByTestId('report-period')).toHaveTextContent('· 30 days'))
    expect(windowed().some((c) => c[3] === '2026-09-28' && c[4] === '2026-10-27')).toBe(true)
  })

  it('removing every measurement asks for one instead of restoring the default', async () => {
    const user = userEvent.setup()
    show('/report?m=stepCount')
    await screen.findByTestId('report-sheet')
    await user.click(screen.getByRole('button', { name: 'Remove Steps' }))
    expect(await screen.findByText(en.ui['report.metrics.none'])).toBeInTheDocument()
    expect(screen.queryByTestId('report-sheet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: en.ui['report.print'] })).toBeDisabled()
  })

  it('a measurement can be added from the catalog', async () => {
    const user = userEvent.setup()
    show('/report?m=stepCount')
    await screen.findByTestId('report-sheet')
    await user.selectOptions(screen.getByRole('combobox', { name: en.ui['report.metrics.add'] }), 'restingHeartRate')
    expect(await screen.findByTestId('report-row-restingHeartRate')).toBeInTheDocument()
  })

  it('the Print button opens the browser print dialog — the PDF export', async () => {
    const user = userEvent.setup()
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    show()
    await screen.findByTestId('report-sheet')
    await user.click(screen.getByRole('button', { name: en.ui['report.print'] }))
    expect(print).toHaveBeenCalledOnce()
    print.mockRestore()
  })

  it('names the saved PDF impersonally while printing, and puts the title back after', async () => {
    show()
    await screen.findByTestId('report-sheet')
    document.title = 'Helsa'
    window.dispatchEvent(new Event('beforeprint'))
    expect(document.title).toBe('helsa-summary-2026-10-27')
    window.dispatchEvent(new Event('afterprint'))
    expect(document.title).toBe('Helsa')
  })

  it('an empty workout history is said, not drawn as an empty table', async () => {
    show()
    const section = await screen.findByTestId('report-workouts')
    expect(await within(section).findByText(en.ui['report.workouts.none'])).toBeInTheDocument()
    expect(within(section).queryByRole('table')).not.toBeInTheDocument()
  })
})
