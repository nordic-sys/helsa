import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SleepSegment, SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import Sleep from './Sleep'

const sleep = vi.fn<(from?: string, to?: string) => Promise<SleepSegment[]>>()
const summary = vi.fn<() => Promise<SummaryResponse>>()

vi.mock('../api/client', () => ({
  api: {
    sleep: (from?: string, to?: string) => sleep(from, to),
    summary: () => summary(),
  },
  browserTz: () => 'Europe/Budapest',
}))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Sleep />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

/** One night: in bed from 23:00, four stages, awake at 07:00. `dayOffset` counts
 * backwards from today, so the fixtures land inside the window the page asks for. */
function night(dayOffset: number): SleepSegment[] {
  const base = new Date()
  base.setHours(0, 0, 0, 0)
  base.setDate(base.getDate() - dayOffset)
  const at = (h: number, m = 0) =>
    new Date(base.getTime() + (h * 60 + m) * 60000 - 60 * 60000).toISOString()
  return [
    { started_at: at(0), ended_at: at(8), stage: 'inBed' },
    { started_at: at(0, 20), ended_at: at(2), stage: 'deep' },
    { started_at: at(2), ended_at: at(4), stage: 'rem' },
    { started_at: at(4), ended_at: at(8), stage: 'core' },
  ]
}

beforeEach(() => {
  sleep.mockReset()
  summary.mockReset()
  summary.mockResolvedValue({ metrics: {} })
  sleep.mockResolvedValue([...night(0), ...night(1), ...night(2)])
})

/**
 * The page used to draw one full card per night — seven cards, 4721 pixels, the
 * night you woke up from the same size as last Tuesday.
 */
describe('one night in full, the rest as rows', () => {
  it('opens on the newest night', async () => {
    show()
    expect(await screen.findByText(/last night/i)).toBeInTheDocument()
  })

  it('draws exactly one detail card, however many nights there are', async () => {
    show()
    await screen.findByText(/last night/i)
    // The stage breakdown's own column heading appears once per detail card.
    expect(screen.getAllByText(/share of time asleep/i)).toHaveLength(1)
  })

  it('lists the other nights as one row each', async () => {
    show()
    await screen.findByText(/last night/i)
    const rows = screen.getAllByRole('button', { pressed: false }).filter((b) => b.className.includes('night-row'))
    expect(rows).toHaveLength(2)
  })

  it('moves a night into the detail card when its row is clicked', async () => {
    show()
    await screen.findByText(/last night/i)
    const rows = screen.getAllByRole('button').filter((b) => b.className.includes('night-row'))
    await userEvent.click(rows[2])
    // No longer "last night" — the card names the date of the night chosen.
    expect(screen.queryByText(/last night/i)).not.toBeInTheDocument()
    expect(rows[2]).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('walking back through the history', () => {
  it('asks the server for the stretch before this one', async () => {
    show()
    await screen.findByText(/last night/i)
    const first = sleep.mock.calls[0]
    await userEvent.click(screen.getByRole('button', { name: /earlier period/i }))
    const stepped = sleep.mock.calls.at(-1)
    // `to` is an ISO day, so string order is date order.
    expect(String(stepped?.[1]) < String(first?.[1])).toBe(true)
  })

  /** ⚠️ The nights after tonight have not happened, and an empty window of them
   * is indistinguishable from a sync that stopped. */
  it('cannot step past the present', async () => {
    show()
    await screen.findByText(/last night/i)
    expect(screen.getByRole('button', { name: /later period/i })).toBeDisabled()
  })
})

/** ⛔ A night nothing was recorded on is not a night of no sleep. */
describe('missing nights', () => {
  it('says how many of the window’s nights carry data', async () => {
    show()
    expect(await screen.findByText(/3 of the last 7 nights carry sleep data/i)).toBeInTheDocument()
  })

  it('shows the empty state rather than a page of zeros', async () => {
    sleep.mockResolvedValue([])
    show()
    expect(await screen.findByText(/no sleep data yet/i)).toBeInTheDocument()
  })
})
