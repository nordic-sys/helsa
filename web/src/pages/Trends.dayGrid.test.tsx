// Trends' two additions from the phone: the weekday grid under the chart, and
// the body-mass trend card. What is pinned is WHERE each appears — the grid only
// over daily buckets, the trend card only for body mass — because both fail
// silently when they appear in the wrong place.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import Trends from './Trends'

/** Which days of a window carry a value (index from the window's first day). */
let measured: (i: number) => boolean = () => true

/** One avg bucket a day, sliding 0.2 kg/week down from 80 kg — or steps. */
function fakeSummary(range: string, names: string[], from?: string, to?: string): SummaryResponse {
  const isWeight = names.includes('bodyMass')
  const buckets: { t: string; avg?: number; v?: number }[] = []
  if (from && to) {
    const day = new Date(`${from}T00:00:00`)
    const end = new Date(`${to}T00:00:00`)
    let i = 0
    while (day <= end) {
      if (measured(i)) {
        if (range === 'year') {
          if (day.getDate() === 1) buckets.push({ t: day.toISOString(), avg: 80 })
        } else if (range === 'day') {
          // hourly buckets: one at noon is enough
          buckets.push({ t: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 12).toISOString(), avg: 80 })
        } else {
          buckets.push(
            isWeight
              ? { t: day.toISOString(), avg: 80 - i * (0.2 / 7) }
              : { t: day.toISOString(), v: 8000 + i },
          )
        }
      }
      day.setDate(day.getDate() + 1)
      i += 1
    }
  }
  const key = isWeight ? 'bodyMass' : 'stepCount'
  return {
    from,
    to,
    metrics: { [key]: { agg: isWeight ? 'avg' : 'sum', unit: isWeight ? 'kg' : 'count', buckets } },
  }
}

vi.mock('../api/client', () => ({
  api: {
    summary: (range: string, names: string[], _tz?: string, from?: string, to?: string) =>
      Promise.resolve(fakeSummary(range, names, from, to)),
    baseline: () => Promise.resolve({ min_days: 14, metrics: {} }),
  },
  browserTz: () => 'Europe/Budapest',
}))

function show(path: string) {
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

beforeEach(() => {
  measured = () => true
})

describe('the weekday grid', () => {
  it('lays the week out day by day, a cell per day', async () => {
    show('/trends?metric=stepCount')
    const grid = await screen.findByRole('list', { name: /day by day/i })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(7)
  })

  it('keeps an unmeasured day an empty cell, and says how many there are', async () => {
    measured = (i) => i !== 2
    show('/trends?metric=stepCount')
    const grid = await screen.findByRole('list', { name: /day by day/i })
    const cells = within(grid).getAllByRole('listitem')
    expect(cells[2]).toHaveAccessibleName(/no data/)
    expect(screen.getByText(/1 day brought no measurement/)).toBeInTheDocument()
  })

  it('appears for the month too, and never over hours or months', async () => {
    show('/trends?metric=stepCount')
    await screen.findByRole('list', { name: /day by day/i })

    await userEvent.click(screen.getByRole('button', { name: 'Month' }))
    const grid = await screen.findByRole('list', { name: /day by day/i })
    expect(within(grid).getAllByRole('listitem')).toHaveLength(30)

    await userEvent.click(screen.getByRole('button', { name: 'Day' }))
    await screen.findByText(/today, hour by hour/i)
    expect(screen.queryByRole('list', { name: /day by day/i })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Year' }))
    await screen.findByText(/the last 12 months/i)
    expect(screen.queryByRole('list', { name: /day by day/i })).not.toBeInTheDocument()
  })
})

describe('the body-mass trend card', () => {
  it('is not there for steps', async () => {
    show('/trends?metric=stepCount')
    await screen.findByRole('list', { name: /day by day/i })
    expect(screen.queryByText('Trend line')).not.toBeInTheDocument()
  })

  it('states the weekly rate of the trend over a month of weighings', async () => {
    show('/trends?metric=bodyMass')
    await screen.findByRole('list', { name: /day by day/i })
    await userEvent.click(screen.getByRole('button', { name: 'Month' }))
    const rate = await screen.findByTestId('weight-rate')
    // Falling, signed with a real minus, two decimals, per week.
    expect(rate.textContent).toMatch(/^−0\.\d\d kg\/week$/)
    expect(screen.getByText(/not the difference between readings/i)).toBeInTheDocument()
    // The line is named in the legend, so it is not taken for a second measurement.
    expect(screen.getByText(/weighted moving average/i)).toBeInTheDocument()
  })

  it('says why there is no line over a week: seven days are shorter than the minimum span', async () => {
    show('/trends?metric=bodyMass')
    const why = await screen.findByTestId('weight-shortfall')
    expect(why).toHaveTextContent('The readings span 6 days; the trend line needs at least 14.')
  })

  it('sends the yearly view to the month, in the app’s words', async () => {
    show('/trends?metric=bodyMass')
    await screen.findByTestId('weight-shortfall')
    await userEvent.click(screen.getByRole('button', { name: 'Year' }))
    await screen.findByText(/monthly averages — a trend line says nothing new/i)
  })
})
