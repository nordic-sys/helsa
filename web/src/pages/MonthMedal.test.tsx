// A monthly medal, opened: the row is a door, the page tells the medal's own
// numbers, and the day grid is the only thing fetched.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Achievement, Challenge } from '../api/types'
import { I18nProvider } from '../i18n'
import Achievements from './Achievements'
import MonthMedal from './MonthMedal'

let medals: Achievement[] = []
let challenge: () => Promise<Challenge> = () => new Promise(() => {})
const challengeCalls: unknown[][] = []

vi.mock('../api/client', () => ({
  api: {
    achievements: () => Promise.resolve(medals),
    challenge: (...args: unknown[]) => {
      challengeCalls.push(args)
      return challenge()
    },
  },
  browserTz: () => 'Europe/Budapest',
  ApiError: class ApiError extends Error {},
}))

const AUGUST: Achievement = {
  id: 'm1',
  kind: 'month',
  code: 'complete',
  period: '2026-08',
  // ⚠️ Deliberately NOT the sum of the days below: the medal's number is the
  // truth on this page, and a page that re-added the days would show 4 000.
  value: 124_000,
  thresholds: [20_000, 35_000, 70_000, 100_000],
  earned_at: '2026-09-01T00:05:00Z',
}

function augustChallenge(): Challenge {
  return {
    month: '2026-08',
    tz: 'Europe/Budapest',
    days_in_month: 31,
    days_elapsed: 31,
    days_remaining: 0,
    measured_days: 2,
    complete: true,
    thresholds: [],
    thresholds_source: 'achievement',
    days: Array.from({ length: 31 }, (_, i) => ({
      day: `2026-08-${String(i + 1).padStart(2, '0')}`,
      ...(i === 0 ? { steps: 1000 } : i === 2 ? { steps: 3000 } : {}),
    })),
    streak: { length: 0, active_days: 0, longest: 0, window_from: '2026-08-01', window_to: '2026-08-31', missing_inputs: [] },
  } as Challenge
}

function show(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/achievements" element={<Achievements />} />
            <Route path="/achievements/:month" element={<MonthMedal />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  medals = [AUGUST, { id: 'r1', kind: 'record', code: 'best-month', period: '2026-08', value: 124_000 }]
  challenge = () => Promise.resolve(augustChallenge())
  challengeCalls.length = 0
})

describe('the medals list', () => {
  it('turns a monthly medal’s period into a link, and leaves other families plain', async () => {
    show('/achievements')
    const link = await screen.findByRole('link', { name: /open aug 2026/i })
    expect(link).toHaveAttribute('href', '/achievements/2026-08')
    // The record carries the same period, but there is no month behind a record.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  it('opens the month from the list', async () => {
    show('/achievements')
    await userEvent.click(await screen.findByRole('link', { name: /open aug 2026/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /august 2026/i })).toBeInTheDocument()
  })
})

describe('the month page', () => {
  it("states the medal's own total and its whole-month average, not a re-added one", async () => {
    show('/achievements/2026-08')
    await screen.findByRole('heading', { level: 1, name: /august 2026/i })
    expect(screen.getByText('124,000')).toBeInTheDocument()
    // 124 000 / 31 days = 4 000 — the whole month, not the two measured days.
    expect(screen.getByText('4,000')).toBeInTheDocument()
    expect(screen.getByText('4/4')).toBeInTheDocument()
  })

  it('asks the challenge for exactly this month, for the grid', async () => {
    show('/achievements/2026-08')
    await screen.findByText(/steps a day on average over the whole month/i)
    expect(challengeCalls[0]).toEqual(['2026-08', 'Europe/Budapest'])
  })

  it('draws the days, says what is missing, and names both averages', async () => {
    show('/achievements/2026-08')
    const grid = await screen.findByRole('list', { name: /day by day/i })
    const cells = within(grid).getAllByRole('listitem')
    expect(cells).toHaveLength(31)
    // An unmeasured day is named as one, not drawn as zero.
    expect(cells[1]).toHaveAccessibleName(/no data/)
    expect(cells[0]).toHaveAccessibleName(/1,000 steps/)
    expect(screen.getByText(/29 days brought no measurement/)).toBeInTheDocument()
    expect(screen.getByText(/2,000 a day counting only the 2 days that were measured/)).toBeInTheDocument()
    expect(screen.getByText(/strongest day: .*3,000 steps/i)).toBeInTheDocument()
    // 100 000 / 31 → 3 226 a day; no day reached it, and the note says what solid means.
    expect(screen.getByText(/daily target of 3,226 steps/)).toBeInTheDocument()
  })

  it('keeps the medal on screen when the day breakdown fails', async () => {
    challenge = () => Promise.reject(new Error('boom'))
    show('/achievements/2026-08')
    expect(await screen.findByText(/daily breakdown did not load: boom/i)).toBeInTheDocument()
    expect(screen.getByText('124,000')).toBeInTheDocument()
  })

  it('stays textual for a medal that kept no milestones', async () => {
    medals = [{ ...AUGUST, thresholds: undefined }]
    show('/achievements/2026-08')
    expect(await screen.findByText(/did not keep the milestones/i)).toBeInTheDocument()
    expect(screen.queryByText(/daily target/)).not.toBeInTheDocument()
  })

  it('says so when the month has no medal, with the way back', async () => {
    show('/achievements/2025-01')
    expect(await screen.findByText(/no monthly medal for january 2025/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /all medals/i })).toHaveAttribute('href', '/achievements')
  })
})
