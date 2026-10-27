// The year in numbers — the windows it asks for and what it says about them.
//
// The arithmetic is pinned in `lib/periodSummary.test.ts`; here it is the
// wiring: the running year cut at today, the comparison cut to the same
// stretch, the nights asked from the day before, and each failing part saying
// so in its own place while the rest stands.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Achievement, SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import { en } from '../i18n/en'
import PeriodSummary, { parsePeriod } from './PeriodSummary'

type SummaryArgs = [string, string[], string?, string?, string?]
const summaryCalls: SummaryArgs[] = []
const sleepCalls: [string?, string?][] = []
let sleepFails = false
let previousMonths = 8

function monthly(from: string, months: number): SummaryResponse {
  const y = Number(from.slice(0, 4))
  const buckets = Array.from({ length: months }, (_, i) => ({ t: new Date(y, i, 1).toISOString(), v: 250_000 }))
  return { metrics: { stepCount: { agg: 'sum', unit: 'count', buckets } } }
}

vi.mock('../api/client', () => ({
  api: {
    summary: (...args: SummaryArgs) => {
      summaryCalls.push(args)
      const from = args[3] ?? '2026-01-01'
      return Promise.resolve(monthly(from, from.startsWith('2026') ? 8 : previousMonths))
    },
    sleep: (from?: string, to?: string) => {
      sleepCalls.push([from, to])
      return sleepFails ? Promise.reject(new Error('down')) : Promise.resolve([])
    },
    workouts: () => Promise.resolve({ items: [], next_cursor: null }),
    achievements: (): Promise<Achievement[]> =>
      Promise.resolve([
        { id: 'a', kind: 'month', code: 'complete', period: '2026-03', value: 1 },
        { id: 'b', kind: 'month', code: 'complete', period: '2025-03', value: 1 },
      ]),
  },
  browserTz: () => 'Europe/Budapest',
}))

function show(path = '/period') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[path]}>
          <PeriodSummary />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.setItem('helsa.lang', 'en')
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 7, 13, 12) })
})
afterEach(() => {
  summaryCalls.length = 0
  sleepCalls.length = 0
  sleepFails = false
  previousMonths = 8
  vi.useRealTimers()
})

describe('the year in numbers', () => {
  it('cuts the running year at today and compares it with the same stretch of last year', async () => {
    show()
    await screen.findByTestId('compare-matched')
    const windows = summaryCalls.map((c) => [c[0], c[3], c[4]])
    expect(windows).toContainEqual(['year', '2026-01-01', '2026-08-13'])
    expect(windows).toContainEqual(['year', '2025-01-01', '2025-08-13'])
    expect(screen.getByTestId('period-extent')).toHaveTextContent('2026 is still running')
  })

  it('asks for the nights from the day before the year, so New Year’s night is not lost', async () => {
    show()
    await screen.findByTestId('compare-matched')
    expect(sleepCalls[0]).toEqual(['2025-12-31', '2026-08-13'])
  })

  it('says a failed sleep read is a read that failed, not a period without sleep', async () => {
    sleepFails = true
    show()
    expect(await screen.findByText(en.ui['period.sleep.notLoaded'])).toBeInTheDocument()
    // …and the totals still stand.
    expect(screen.getAllByText(/All 8 elapsed months have data/).length).toBeGreaterThan(0)
  })

  it('withholds a summed comparison when the shares measured differ wildly', async () => {
    previousMonths = 2 // 2 of 8 against 8 of 8
    show()
    expect((await screen.findAllByTestId('compare-withheld')).length).toBeGreaterThan(0)
  })

  it('lists only the medals of the period', async () => {
    show()
    await screen.findByTestId('compare-matched')
    expect(await screen.findByText('Mar 2026')).toBeInTheDocument()
    expect(screen.queryByText('Mar 2025')).toBeNull()
  })

  it('a closed month is compared with the whole month before it', async () => {
    show('/period?p=2026-07')
    await screen.findAllByText(/elapsed days/)
    const windows = summaryCalls.map((c) => [c[0], c[3], c[4]])
    expect(windows).toContainEqual(['month', '2026-07-01', '2026-07-31'])
    expect(windows).toContainEqual(['month', '2026-06-01', '2026-06-30'])
  })

  it('switching to Month lands on the month the year has reached', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await screen.findByTestId('compare-matched')
    await user.click(screen.getByRole('button', { name: en.ui['period.unit.month'] }))
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('August 2026')
  })
})

describe('the period in the address', () => {
  const now = new Date(2026, 7, 13)
  it('reads a year or a month, and falls back to this year for anything else', () => {
    expect(parsePeriod('2024', now)).toEqual({ unit: 'year', year: 2024 })
    expect(parsePeriod('2024-02', now)).toEqual({ unit: 'month', year: 2024, month: 2 })
    expect(parsePeriod('2024-13', now)).toEqual({ unit: 'year', year: 2026 })
    expect(parsePeriod('nonsense', now)).toEqual({ unit: 'year', year: 2026 })
    // A period that has not started has nothing to show — not even a zero.
    expect(parsePeriod('2027', now)).toEqual({ unit: 'year', year: 2026 })
    expect(parsePeriod(null, now)).toEqual({ unit: 'year', year: 2026 })
  })
})
