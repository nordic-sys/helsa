// The Trends page's period controls.
//
// What is worth pinning here is not the chart — jsdom gives the container no
// size, so recharts draws nothing — but the WINDOW: which one the page opens on,
// which one it asks the server for, and what the stepper says it is showing. Those
// three have to agree, and they are the part a reader would notice going wrong.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BaselineResponse, SummaryResponse } from '../api/types'
import { MemoryRouter } from 'react-router-dom'
import { I18nProvider } from '../i18n'
import Trends from './Trends'

type SummaryArgs = [string, string[], string?, string?, string?]

const calls: SummaryArgs[] = []

/** What one day of a window holds — a test can make two windows differ. */
let dayValue: (from?: string) => number = () => 10_000

/** Which days of a window carry a measurement — a test can leave gaps. */
let measuredDay: (from: string | undefined, index: number) => boolean = () => true

/** Ranges whose chart request never answers — to hold a placeholder on screen. */
let holdRange: (range: string) => boolean = () => false

/** What the usual-range endpoint answers. */
let baselineAnswer: BaselineResponse = { min_days: 14, metrics: {} }

/** A bucket a day across whatever window was asked for, so the page has data. */
function fakeSummary(from?: string, to?: string): SummaryResponse {
  const buckets: { t: string; v: number }[] = []
  if (from && to) {
    const day = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T00:00:00`)
    let i = 0
    while (day <= end) {
      if (measuredDay(from, i)) buckets.push({ t: new Date(day).toISOString(), v: dayValue(from) })
      day.setDate(day.getDate() + 1)
      i += 1
    }
  }
  return {
    from,
    to,
    metrics: { stepCount: { agg: 'sum', unit: 'count', buckets, total: buckets.length * dayValue(from) } },
  }
}

vi.mock('../api/client', () => ({
  api: {
    summary: (...args: SummaryArgs) => {
      calls.push(args)
      if (holdRange(args[0])) return new Promise(() => {})
      return Promise.resolve(fakeSummary(args[3], args[4]))
    },
    baseline: (): Promise<BaselineResponse> => Promise.resolve(baselineAnswer),
  },
  browserTz: () => 'Europe/Budapest',
}))

function show(path = '/trends') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[path]}>
          <Trends />
        </MemoryRouter>
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
  dayValue = () => 10_000
  measuredDay = () => true
  holdRange = () => false
  baselineAnswer = { min_days: 14, metrics: {} }
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

describe('the redesigned chart card', () => {
  it('opens on the metric the URL names — the Today tiles link that way', async () => {
    show('/trends?metric=activeEnergy')
    await screen.findByText('The last 7 days')
    await waitFor(() =>
      expect(calls.some((c) => c[0] === 'week' && c[1][0] === 'activeEnergy')).toBe(true),
    )
  })

  it('falls back to steps for a name it does not know', async () => {
    show('/trends?metric=notAMetric')
    await waitFor(() => expect(chartWindows('week').length).toBeGreaterThan(0))
  })

  it('shows the total AND the average of the measured days', async () => {
    show()
    // Seven days at 10,000 each.
    expect(await screen.findByText('70,000')).toBeInTheDocument()
    const perDay = screen.getByText('A day · over 7 measured days')
    expect(perDay.parentElement).toHaveTextContent('10,000')
  })

  it('headlines the change as a signed absolute delta, with the previous window under it', async () => {
    dayValue = (from) => (from === '2026-09-04' ? 12_000 : 10_000)
    show()
    // 84,000 this week against 70,000 the week before.
    expect(await screen.findByText('+14,000')).toBeInTheDocument()
    expect(
      screen.getByText(/^\+20% · The previous period \(Aug 28, 2026 – Sep 3, 2026\): 70,000$/),
    ).toBeInTheDocument()
  })

  it('explains, without naming any device, how overlapping sources are counted', async () => {
    show()
    const title = await screen.findByText('Where these numbers come from')
    const card = title.closest('.card') as HTMLElement
    expect(card.textContent).toMatch(/counts once: the largest of them wins/)
    expect(card.textContent).not.toMatch(/watch|iphone|garmin|oura/i)
  })

  it('offers the period as a segmented control with the state on the buttons', async () => {
    show()
    const group = await screen.findByRole('group', { name: 'Period' })
    expect(group.querySelector('[aria-pressed="true"]')).toHaveTextContent('Week')
  })
})

/**
 * ⛔ A comparison of totals is a comparison of behaviour only when both periods
 * were measured alike. One measured day against seven is a sync gap, not a fall.
 */
describe('the comparison and measurement coverage', () => {
  it('shows how many days each period was measured on', async () => {
    show()
    expect(await screen.findByTestId('compare-coverage')).toHaveTextContent(
      'Measured on 7 of 7 days; the previous period on 7 of 7.',
    )
  })

  it('withholds a summed delta when the coverage differs a lot', async () => {
    // This week fully measured; the week before only on its first day.
    measuredDay = (from, i) => from !== '2026-08-28' || i === 0
    show()
    expect(await screen.findByTestId('compare-withheld')).toHaveTextContent(/Not compared/)
    expect(screen.getByTestId('compare-coverage')).toHaveTextContent('the previous period on 1 of 7')
    expect(screen.queryByText('+60,000')).not.toBeInTheDocument()
    expect(screen.queryByText(/^[+−]\d+% · /)).not.toBeInTheDocument()
  })
})

/** Two reasons for no band, and they are opposite statements. */
describe('no usual range', () => {
  it('says "not enough measured days" only when there are not enough', async () => {
    baselineAnswer = { min_days: 14, metrics: { stepCount: { day_count: 9 } } }
    show()
    expect(await screen.findByTestId('usual-none')).toHaveTextContent('Not enough measured days yet for a usual range (9/14)')
  })

  it('says the reference never varied when 60 days carried one value', async () => {
    baselineAnswer = { min_days: 14, metrics: { stepCount: { day_count: 60, mean: 5000, sd: 0 } } }
    show()
    const note = await screen.findByTestId('usual-none')
    expect(note).toHaveTextContent(/all 60 measured days of the reference carried the same value \(5,000\)/)
    expect(note).not.toHaveTextContent(/Not enough/)
  })
})

/**
 * The chart's numbers, reachable without a mouse: a table of every bucket, and
 * where the chart drills, each period a button.
 */
describe('the chart without a mouse', () => {
  it('lists every bucket — a day nobody measured as "not measured", not 0', async () => {
    measuredDay = (from, i) => from !== '2026-09-04' || i !== 2
    show()
    const table = await screen.findByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(8) // header + 7 days
    expect(within(table).getByText('not measured')).toBeInTheDocument()
  })

  it('opens a period from the keyboard, as a tap on the chart would', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await screen.findByText('The last 7 days')
    await user.click(screen.getByText('The numbers behind the chart'))
    const open = await screen.findByRole('button', { name: /^Open Sep 8, 2026/ })
    open.focus()
    await user.keyboard('{Enter}')
    // The week drills to that day, hour by hour.
    await waitFor(() => expect(chartWindows('day')).toContain('2026-09-08..2026-09-08'))
  })

  it('does not drill from a chart that is about to be replaced (the displayed range rules)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await screen.findByText('The last 7 days')
    await screen.findByRole('button', { name: /^Open Sep 8, 2026/ })
    // Year is chosen; its data never arrives, so the week stays on screen…
    holdRange = (r) => r === 'year'
    await user.click(screen.getByRole('button', { name: 'Year' }))
    // …and its days are no longer drill targets: a tap would have drilled from
    // Year (to a month), not from the week that is visible.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Open Sep 8, 2026/ })).not.toBeInTheDocument())
    expect(within(screen.getByRole('table')).getByText('Sep 8, 2026')).toBeInTheDocument()
  })

  it('says a new period is loading without fading the chart', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    show()
    await screen.findByRole('table')
    holdRange = (r) => r === 'year'
    await user.click(screen.getByRole('button', { name: 'Year' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Loading the new period…')
    const chart = document.querySelector('.chart') as HTMLElement
    expect(chart.style.opacity).toBe('')
    expect(chart).toHaveAttribute('aria-busy', 'true')
  })
})
