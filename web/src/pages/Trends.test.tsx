// The Trends page's period controls.
//
// What is worth pinning here is not the chart — jsdom gives the container no
// size, so recharts draws nothing — but the WINDOW: which one the page opens on,
// which one it asks the server for, and what the stepper says it is showing. Those
// three have to agree, and they are the part a reader would notice going wrong.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaselineResponse, SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import Trends from './Trends'

type SummaryArgs = [string, string[], string?, string?, string?]

const calls: SummaryArgs[] = []

/** A bucket a day across whatever window was asked for, so the page has data. */
function fakeSummary(from?: string, to?: string): SummaryResponse {
  const buckets: { t: string; v: number }[] = []
  if (from && to) {
    const day = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T00:00:00`)
    while (day <= end) {
      buckets.push({ t: new Date(day).toISOString(), v: 10_000 })
      day.setDate(day.getDate() + 1)
    }
  }
  return {
    from,
    to,
    metrics: { stepCount: { agg: 'sum', unit: 'count', buckets, total: buckets.length * 10_000 } },
  }
}

vi.mock('../api/client', () => ({
  api: {
    summary: (...args: SummaryArgs) => {
      calls.push(args)
      return Promise.resolve(fakeSummary(args[3], args[4]))
    },
    baseline: (): Promise<BaselineResponse> => Promise.resolve({ min_days: 14, metrics: {} }),
  },
  browserTz: () => 'Europe/Budapest',
}))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Trends />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

/** The windows the page asked the CHART for, ignoring the availability probe and
 * the comparison — those go out with other ranges or other metric lists. */
function chartWindows(range: string) {
  return calls
    .filter((c) => c[0] === range && c[1][0] === 'stepCount' && c[1].length <= 2)
    .map((c) => `${c[3]}..${c[4]}`)
}

beforeEach(() => {
  calls.length = 0
  vi.useFakeTimers({ shouldAdvanceTime: true })
  // A Thursday, so the rolling week and the calendar week are visibly different.
  vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the Trends period stepper', () => {
  it('opens on a rolling window and says which days it covers', async () => {
    show()
    expect(await screen.findByText('The last 7 days')).toBeInTheDocument()
    expect(screen.getByText('Sep 4, 2026 – Sep 10, 2026')).toBeInTheDocument()
    await waitFor(() => expect(chartWindows('week')).toContain('2026-09-04..2026-09-10'))
  })

  it('stops going forward at the present, and offers the way back once you leave it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await screen.findByText('The last 7 days')

    const forward = screen.getByRole('button', { name: 'Later period' })
    // ⚠️ Next week has not happened, and an empty chart of it is indistinguishable
    // from a sync that stopped.
    expect(forward).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Back to now' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Earlier period' }))
    expect(await screen.findByText('Aug 28, 2026 – Sep 3, 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Later period' })).toBeEnabled()
    await waitFor(() => expect(chartWindows('week')).toContain('2026-08-28..2026-09-03'))

    await user.click(screen.getByRole('button', { name: 'Back to now' }))
    expect(await screen.findByText('Sep 4, 2026 – Sep 10, 2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Later period' })).toBeDisabled()
  })

  it('returns to the present when the width changes', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await screen.findByText('The last 7 days')
    await user.click(screen.getByRole('button', { name: 'Earlier period' }))
    await screen.findByText('Aug 28, 2026 – Sep 3, 2026')

    // Three windows back is not the same distance on two different widths, and a
    // month opened four steps into the past is not what "Month" was asked for.
    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByText('The last 30 days')).toBeInTheDocument()
    expect(screen.getByText('Aug 12, 2026 – Sep 10, 2026')).toBeInTheDocument()
  })

  it('names the level a tap on the chart would open', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    // ⚠️ A month's bars are days, and the hint has to say week anyway.
    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(
      await screen.findByText(/Tap the chart to open the week around that point/),
    ).toBeInTheDocument()

    // Nothing is finer than an hour, so the day view offers no drill at all.
    await user.click(screen.getByRole('button', { name: 'Day' }))
    await screen.findByText('Today, hour by hour')
    expect(screen.queryByText(/Tap the chart/)).not.toBeInTheDocument()
  })

  it('compares against the previous window of the same length', async () => {
    show()
    await screen.findByText('The last 7 days')
    await waitFor(() =>
      expect(chartWindows('week')).toEqual(
        expect.arrayContaining(['2026-08-28..2026-09-03', '2026-09-04..2026-09-10']),
      ),
    )
    expect(
      await screen.findByText(/The previous period \(Aug 28, 2026 – Sep 3, 2026\)/),
    ).toBeInTheDocument()
  })
})
