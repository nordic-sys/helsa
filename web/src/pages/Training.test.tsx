import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import type { SummaryResponse, Workout, WorkoutIntensity, WorkoutPage } from '../api/types'
import { I18nProvider } from '../i18n'
import Training from './Training'

const workouts = vi.fn<() => Promise<WorkoutPage>>()
const intensity = vi.fn<(from: string, to: string) => Promise<WorkoutIntensity>>()
const summary = vi.fn<() => Promise<SummaryResponse>>()

vi.mock('../api/client', async (orig) => {
  const real = await orig<typeof import('../api/client')>()
  return {
    ApiError: real.ApiError,
    api: {
      workouts: () => workouts(),
      workoutIntensity: (from: string, to: string) => intensity(from, to),
      summary: () => summary(),
    },
    browserTz: () => 'Europe/Budapest',
  }
})

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Training />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const DAY = 86_400_000
function rec(id: string, daysAgo: number, minutes = 45, type = 'running'): Workout {
  const start = new Date(Date.now() - daysAgo * DAY)
  start.setHours(12, 0, 0, 0)
  return {
    id,
    source_uuid: id,
    activity_type: type,
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
  }
}

// One session recorded twice (a watch and an app), and one more a week earlier.
const history: Workout[] = [rec('watch', 7), rec('app', 7, 46), rec('older', 14)]

const withMaximum: WorkoutIntensity = {
  zone3_fraction: 0.7,
  lookback_days: 365,
  minimum_workouts: 5,
  max_gap_seconds: 60,
  maximum: { bpm: 182, workouts: 9, zone3_threshold_bpm: 127.4 },
  workouts: [
    { id: 'watch', seconds: 1200 },
    { id: 'app', seconds: 1300 },
    { id: 'older', seconds: null },
  ],
}

beforeEach(() => {
  workouts.mockReset()
  intensity.mockReset()
  summary.mockReset()
  workouts.mockResolvedValue({ items: history, next_cursor: null })
  intensity.mockResolvedValue(withMaximum)
  summary.mockResolvedValue({ metrics: {} })
})

describe('the weeks', () => {
  it('counts a double-recorded session once, over complete weeks only', async () => {
    show()
    // A year: 51 finished weeks + the current one. Two of them had a session —
    // three recordings, two sessions, two weeks.
    expect(await screen.findByText('2 of 51 weeks')).toBeInTheDocument()
    expect(screen.getByText(/in total, over 2 sessions/)).toBeInTheDocument()
  })

  it('draws a square per week, and 12 of them on the three-month span', async () => {
    const { container } = show()
    await screen.findByText('2 of 51 weeks')
    expect(container.querySelectorAll('.week-grid .week-cell')).toHaveLength(52)
    await userEvent.click(screen.getByRole('button', { name: '3 months' }))
    expect(container.querySelectorAll('.week-grid .week-cell')).toHaveLength(12)
  })

  it('asks the server for exactly the window it draws, as instants', async () => {
    show()
    await screen.findByText('2 of 51 weeks')
    const [from, to] = intensity.mock.calls[0]
    const days = (new Date(to).getTime() - new Date(from).getTime()) / DAY
    // 52 weeks; ±1 h for a DST change inside the year.
    expect(Math.abs(days - 52 * 7)).toBeLessThan(0.05)
  })
})

describe('zone 3 and above', () => {
  it('states the method next to the number, and the unmeasured session', async () => {
    show()
    expect(await screen.findByText(/at or above 127 bpm/)).toBeInTheDocument()
    expect(screen.getByText(/70 percent of 182 bpm/)).toBeInTheDocument()
    // The heart-rate window is said out loud, not implied.
    expect(screen.getByText(/matched to a workout by its time, not by a link/)).toBeInTheDocument()
    expect(screen.getByText('1 workout had no heart rate; it is left out of these minutes.')).toBeInTheDocument()
  })

  it('says there are no zones yet below the minimum, rather than drawing zeros', async () => {
    intensity.mockResolvedValue({ ...withMaximum, maximum: undefined, workouts: [] })
    show()
    expect(await screen.findByText(/Fewer than 5 workouts of the past year/)).toBeInTheDocument()
  })

  it('⚠️ explains a 404 as an older server, and the rest of the page still works', async () => {
    intensity.mockRejectedValue(new ApiError(404, 'Not Found'))
    show()
    expect(await screen.findByText('This server’s API is older than this web page')).toBeInTheDocument()
    expect(screen.getByText('make prod-pull && make prod-up')).toBeInTheDocument()
    expect(screen.getByText('2 of 51 weeks')).toBeInTheDocument()
  })
})

describe('resting heart rate and HRV', () => {
  it('says when there are not enough weeks to draw a trend', async () => {
    show()
    await screen.findByText('2 of 51 weeks')
    expect(screen.getAllByText('Not enough measurements.')).toHaveLength(2)
  })
})
