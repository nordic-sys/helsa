import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'

const mockSummary = vi.fn()
const mockSettings = vi.fn()
const mockLatest = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    summary: (...args: unknown[]) => mockSummary(...args),
    settings: (...args: unknown[]) => mockSettings(...args),
    latest: (...args: unknown[]) => mockLatest(...args),
  },
  browserTz: () => 'UTC',
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const { default: NutritionPage } = await import('./Nutrition')

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <NutritionPage />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

/** A week with water on three of its days. */
const week = {
  metrics: {
    dietaryWater: {
      agg: 'sum',
      unit: 'mL',
      total: 6500,
      buckets: [
        { t: '2026-10-21T00:00:00Z', v: 2500 },
        { t: '2026-10-22T00:00:00Z', v: 1500 },
        { t: '2026-10-23T00:00:00Z', v: 2500 },
      ],
    },
  },
}

beforeEach(() => {
  mockSummary.mockReset().mockResolvedValue(week)
  mockSettings.mockReset()
  mockLatest.mockReset()
})

describe('water against the goal set on the phone', () => {
  it('counts the days that reached the chosen goal, out of the days with water logged', async () => {
    mockSettings.mockResolvedValue({ hydration: { goal_ml: 2000 } })
    show()
    expect(await screen.findByText(/Your daily goal, as set on the phone: 2,000/)).toBeInTheDocument()
    expect(screen.getByText(/reached on 2 of the 3 days with water logged/)).toBeInTheDocument()
    expect(mockLatest).not.toHaveBeenCalled()
  })

  /** An older phone or server: said as such, never "no goal". */
  it('says when the phone has not sent a water goal', async () => {
    mockSettings.mockResolvedValue({})
    show()
    expect(await screen.findByText(/has not sent a water goal to this server yet/)).toBeInTheDocument()
  })

  /** No goal of their own: the phone's suggestion, labelled as one. */
  it('labels a body-mass suggestion as a suggestion', async () => {
    mockSettings.mockResolvedValue({ hydration: {} })
    mockLatest.mockResolvedValue({ tz: 'UTC', metrics: { bodyMass: { agg: 'avg', unit: 'kg', value: 68.4, ts: '', day: '' } } })
    show()
    expect(await screen.findByText(/Suggested daily amount: 2,300/)).toBeInTheDocument()
    expect(screen.getByText(/not medical advice/)).toBeInTheDocument()
  })
})
