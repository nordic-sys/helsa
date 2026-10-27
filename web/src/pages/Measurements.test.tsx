import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { BaselineResponse, LatestResponse, MetricSeries, SamplePage, SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import { isoDaysAgo } from '../lib/format'
import Measurements from './Measurements'

const summary = vi.fn<(range: string, names: string[], tz?: string, from?: string, to?: string) => Promise<SummaryResponse>>()
const baseline = vi.fn<() => Promise<BaselineResponse>>()
const latest = vi.fn<(names: string[]) => Promise<LatestResponse>>()
const samples = vi.fn<(dataType: string) => Promise<SamplePage>>()

vi.mock('../api/client', async (orig) => {
  const real = await orig<typeof import('../api/client')>()
  return {
    ApiError: real.ApiError,
    api: {
      summary: (range: string, names: string[], tz?: string, from?: string, to?: string) => summary(range, names, tz, from, to),
      baseline: () => baseline(),
      latest: (names: string[]) => latest(names),
      samples: (dataType: string) => samples(dataType),
    },
    browserTz: () => 'Europe/Budapest',
  }
})

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <I18nProvider>
          <Measurements />
        </I18nProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const today = isoDaysAgo(0)
const dayStart = (daysAgo: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - daysAgo)
  return d
}

/** Resting heart rate on the last ten days, as a year probe and a 30-day series. */
function series(range: string, names: string[]): Record<string, MetricSeries> {
  const out: Record<string, MetricSeries> = {}
  if (names.includes('restingHeartRate')) {
    out.restingHeartRate =
      range === 'year'
        ? { agg: 'avg', unit: 'count/min', buckets: [{ t: dayStart(0).toISOString(), avg: 55 }] }
        : {
            agg: 'avg',
            unit: 'count/min',
            buckets: Array.from({ length: 10 }, (_, i) => ({ t: dayStart(9 - i).toISOString(), avg: 54 + (i % 3) })),
          }
  }
  if (names.includes('bodyMass') && range === 'year') {
    out.bodyMass = { agg: 'avg', unit: 'kg', buckets: [{ t: dayStart(60).toISOString(), avg: 82 }] }
  }
  return out
}

const latestOk: LatestResponse = {
  tz: 'Europe/Budapest',
  metrics: {
    restingHeartRate: { agg: 'avg', unit: 'count/min', ts: new Date().toISOString(), day: today, value: 54 },
    // Weighed two months ago: in the year probe, outside the 30-day span.
    bodyMass: { agg: 'avg', unit: 'kg', ts: dayStart(60).toISOString(), day: isoDaysAgo(60), value: 82.4 },
  },
}

beforeEach(() => {
  summary.mockReset()
  baseline.mockReset()
  latest.mockReset()
  samples.mockReset()
  summary.mockImplementation(async (range, names) => ({ metrics: series(range, names) }))
  baseline.mockResolvedValue({
    min_days: 14,
    metrics: { restingHeartRate: { agg: 'avg', day_count: 41, mean: 55, sd: 2, low: 53, high: 57 } },
  })
  latest.mockResolvedValue(latestOk)
  samples.mockResolvedValue({ items: [], next_cursor: null })
})

describe('the grid', () => {
  it('leads a card with the latest reading, its time, and the person’s usual range', async () => {
    show()
    const card = (await screen.findByRole('heading', { name: 'Resting heart rate' })).closest('article') as HTMLElement
    expect(within(card).getByText('54')).toBeInTheDocument()
    expect(within(card).getByText(/^Latest reading ·/)).toBeInTheDocument()
    expect(within(card).getByText(/Your usual: 53–57/)).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Full chart in Trends/ })).toHaveAttribute('href', '/trends?metric=restingHeartRate')
  })

  it('asks /latest once for the whole page, not once per metric', async () => {
    show()
    await screen.findByRole('heading', { name: 'Resting heart rate' })
    expect(latest).toHaveBeenCalledTimes(1)
    expect(samples.mock.calls.every(([t]) => t.startsWith('bloodPressure'))).toBe(true)
  })

  it('shows only measurements with data until asked for all', async () => {
    show()
    await screen.findByRole('heading', { name: 'Resting heart rate' })
    expect(screen.queryByRole('heading', { name: 'VO₂ max' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Environment' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Also show measurements without data' }))
    expect(screen.getByRole('heading', { name: 'Environment' })).toBeInTheDocument()
    const vo2 = screen.getAllByRole('heading', { level: 4 }).find((h) => /VO/.test(h.textContent ?? ''))
    expect(vo2?.closest('article')).toHaveTextContent('Nothing has reached the server')
  })

  it('says a latest value is older than the span instead of passing it off as current', async () => {
    show()
    const card = (await screen.findByRole('heading', { name: 'Body mass' })).closest('article') as HTMLElement
    expect(within(card).getByText('82.4')).toBeInTheDocument()
    expect(within(card).getByText(/Nothing in this span — the latest is from/)).toBeInTheDocument()
  })

  it('points to the pages that own sleep and nutrition rather than copying them', async () => {
    show()
    await screen.findByRole('heading', { name: 'Resting heart rate' })
    expect(screen.getByRole('link', { name: 'Sleep' })).toHaveAttribute('href', '/sleep')
    expect(screen.getByRole('link', { name: 'Nutrition' })).toHaveAttribute('href', '/nutrition')
  })

  it('explains why there is no band on the 12-month span', async () => {
    show()
    await screen.findByRole('heading', { name: 'Resting heart rate' })
    await userEvent.click(screen.getByRole('button', { name: '12 months' }))
    const card = screen.getByRole('heading', { name: 'Resting heart rate' }).closest('article') as HTMLElement
    expect(await within(card).findByText(/drawn on the 7- and 30-day spans only/)).toBeInTheDocument()
    expect(summary.mock.calls.some(([range]) => range === 'year')).toBe(true)
  })
})

describe('an older server', () => {
  it('falls back to the last measured day, and says why', async () => {
    latest.mockRejectedValue(new ApiError(404, 'Not Found'))
    show()
    expect(await screen.findByText('This server’s API is older than this web page')).toBeInTheDocument()
    const card = screen.getByRole('heading', { name: 'Resting heart rate' }).closest('article') as HTMLElement
    // The last bucket of the fixture: i = 9 → 54 + 0.
    expect(within(card).getByText(/^Average on /)).toBeInTheDocument()
  })
})

describe('blood pressure', () => {
  const withBp = (sys: { ts: string; value: number }[], dia: { ts: string; value: number }[]) => {
    latest.mockResolvedValue({
      ...latestOk,
      metrics: {
        ...latestOk.metrics,
        bloodPressureSystolic: { agg: 'avg', ts: new Date().toISOString(), day: today, value: 128 },
      },
    })
    samples.mockImplementation(async (t) => ({ items: t === 'bloodPressureSystolic' ? sys : dia, next_cursor: null }))
  }

  it('shows the two values as one reading', async () => {
    const at = new Date(Date.now() - 3_600_000).toISOString()
    withBp([{ ts: at, value: 128 }], [{ ts: at, value: 82 }])
    show()
    const card = (await screen.findByRole('heading', { name: 'Blood pressure' })).closest('article') as HTMLElement
    expect(await within(card).findByText('128/82')).toBeInTheDocument()
    expect(within(card).getByText(/at least 15 of them — now there are 1/)).toBeInTheDocument()
  })

  it('shows no number when only one half arrived', async () => {
    withBp([{ ts: new Date().toISOString(), value: 128 }], [])
    show()
    const card = (await screen.findByRole('heading', { name: 'Blood pressure' })).closest('article') as HTMLElement
    expect(await within(card).findByText('Incomplete blood pressure reading')).toBeInTheDocument()
    expect(within(card).queryByText(/128/)).not.toBeInTheDocument()
  })

  it('lists a reading that stands out against the person’s own', async () => {
    const sys = []
    const dia = []
    for (let i = 1; i <= 20; i++) {
      const ts = new Date(dayStart(i).getTime() + 8 * 3_600_000).toISOString()
      sys.push({ ts, value: 118 + (i % 2 ? 3 : -3) })
      dia.push({ ts, value: 76 + (i % 2 ? 3 : -3) })
    }
    const spike = new Date(Date.now() - 60_000).toISOString()
    sys.push({ ts: spike, value: 152 })
    dia.push({ ts: spike, value: 97 })
    withBp(sys, dia)
    show()
    const card = (await screen.findByRole('heading', { name: 'Blood pressure' })).closest('article') as HTMLElement
    expect(await within(card).findByText(/the upper value is \d+ mmHg higher than usual/)).toBeInTheDocument()
    expect(within(card).getByText(/never with a clinical limit/)).toBeInTheDocument()
  })
})

describe('walking and gait', () => {
  it('stays silent with too little data, and says that silence is not "fine"', async () => {
    latest.mockResolvedValue({
      ...latestOk,
      metrics: { ...latestOk.metrics, walkingSpeed: { agg: 'avg', ts: new Date().toISOString(), day: today, value: 1.2 } },
    })
    show()
    const card = (await screen.findByRole('heading', { name: /^Walking — the five measurements/ })).closest('article') as HTMLElement
    expect(await within(card).findAllByText('Not enough measured days')).toHaveLength(5)
    expect(within(card).getAllByText(/we have not looked/).length).toBeGreaterThan(0)
    // The steadiness notifications never reach the server — said, not hidden.
    expect(within(card).getByText(/the phone does not upload/)).toBeInTheDocument()
    // The five series are on the gait card, not loose cards in the grid.
    expect(screen.getAllByRole('heading', { name: 'Walking speed' })).toHaveLength(1)
  })
})
