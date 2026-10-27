// Year by year — what the page asks the server for, and what it may claim.
//
// The rules themselves are pinned in `lib/longView.test.ts`. What is worth
// pinning here is the wiring: ONE request for every year, the choice surviving
// a reload, and a span printed from what was found.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import { en } from '../i18n/en'
import { RECOMMENDED, SELECTION_KEY } from '../lib/longView'
import YearByYear from './YearByYear'

type SummaryArgs = [string, string[], string?, string?, string?]
const calls: SummaryArgs[] = []

/** Steps for the whole of 2024 and 2025, and two months of the oldest year. */
function answer(_range: string, metrics: string[]): SummaryResponse {
  const out: SummaryResponse['metrics'] = {}
  for (const m of metrics) out[m] = { agg: 'sum', unit: 'count', buckets: [] }
  const months = (y: number, n: number) =>
    Array.from({ length: n }, (_, i) => ({ t: new Date(y, i, 1).toISOString(), v: 200_000 + y }))
  out.stepCount = {
    agg: 'sum',
    unit: 'count',
    buckets: [...months(2022, 2), ...months(2024, 12), ...months(2025, 12)],
  }
  return { metrics: out }
}

vi.mock('../api/client', () => ({
  api: {
    summary: (...args: SummaryArgs) => {
      calls.push(args)
      return Promise.resolve(answer(args[0], args[1]))
    },
  },
  browserTz: () => 'Europe/Budapest',
}))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/years']}>
          <YearByYear />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('helsa.lang', 'en')
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date(2026, 7, 27, 12) })
})
afterEach(() => {
  calls.length = 0
  vi.useRealTimers()
})

/** The year-by-year requests, ignoring the availability probe (no `from`). */
const yearCalls = () => calls.filter((c) => c[3] != null)

describe('year by year', () => {
  it('asks ONCE for every year, in monthly buckets, from January of the oldest year to today', async () => {
    show()
    await screen.findByTestId('years-span')
    expect(yearCalls()).toHaveLength(1)
    const [range, metrics, , from, to] = yearCalls()[0]
    expect(range).toBe('year')
    expect(from).toBe('2022-01-01')
    expect(to).toBe('2026-08-27')
    // The recommendation, aliases included.
    for (const k of RECOMMENDED) expect(metrics).toContain(k)
    expect(metrics).toContain('activeEnergyBurned')
  })

  it('prints the span it FOUND — two months of 2022 are not a year', async () => {
    show()
    expect(await screen.findByTestId('years-span')).toHaveTextContent('2024–2025')
    // Not 2026 either: nothing was measured in it. It still gets a column —
    // the year we are in never silently vanishes — but not a place in the span.
    expect(screen.queryByRole('columnheader', { name: '2022' })).toBeNull()
    expect(screen.getByRole('columnheader', { name: /2026/ })).toBeInTheDocument()
  })

  it('lists the chosen measurements that have no data at all, rather than drawing empty rows', async () => {
    show()
    expect(await screen.findByTestId('years-without')).toHaveTextContent(en.metric.bodyMass)
    expect(screen.getAllByRole('row')).toHaveLength(2) // header + steps
  })

  it('keeps the choice in this browser, and asks again for what was chosen', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await screen.findByTestId('years-span')
    await user.click(screen.getByRole('button', { name: en.ui['years.picker.clear'] }))
    expect(JSON.parse(localStorage.getItem(SELECTION_KEY)!)).toEqual([])
    expect(screen.getByText(en.ui['years.none.title'])).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: en.ui['years.picker.recommended'] }))
    await waitFor(() => expect(JSON.parse(localStorage.getItem(SELECTION_KEY)!)).toHaveLength(RECOMMENDED.length))
  })

  it('opens on a stored choice', async () => {
    localStorage.setItem(SELECTION_KEY, JSON.stringify(['vo2Max']))
    show()
    await screen.findByTestId('years-span').catch(() => null)
    await waitFor(() => expect(yearCalls().length).toBeGreaterThan(0))
    expect(yearCalls()[0][1]).toEqual(['vo2Max'])
  })
})
