import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '../i18n'
import type { Challenge as ChallengeData } from '../api/types'

const mockChallenge = vi.fn()

vi.mock('../api/client', () => ({
  api: { challenge: (...args: unknown[]) => mockChallenge(...args) },
  browserTz: () => 'UTC',
  // `ui.tsx` imports this to recognise a 401; the mock has to carry it too.
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

// recharts measures its container with a ResizeObserver, which jsdom does not
// implement — without this the whole render throws before a single assertion.
// The stub is enough: at zero size the chart draws nothing, and nothing here is
// an assertion about the chart.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const { default: ChallengePage } = await import('./Challenge')

/** A September that is fully measured, against the factory milestone row. */
function fixture(over: Partial<ChallengeData> = {}): ChallengeData {
  return {
    month: '2026-09',
    tz: 'UTC',
    days_in_month: 30,
    days_elapsed: 9,
    days_remaining: 21,
    measured_days: 10,
    complete: false,
    steps: 100_000,
    steps_per_day: 11_111,
    percent: 50,
    goal: 200_000,
    remaining_steps: 100_000,
    overshoot_steps: 0,
    next_threshold: 150_000,
    steps_to_next_threshold: 50_000,
    thresholds: [
      { steps: 100_000, reached: true },
      { steps: 150_000, reached: false },
      { steps: 200_000, reached: false },
    ],
    thresholds_source: 'achievement',
    days: Array.from({ length: 10 }, (_, i) => ({
      day: `2026-09-${String(i + 1).padStart(2, '0')}`,
      steps: 10_000,
    })),
    streak: {
      daily_goal: 6_667,
      length: 8,
      active_days: 8,
      longest: 12,
      window_from: '2026-06-13',
      window_to: '2026-09-10',
      missing_inputs: ['illness_days', 'chosen_rest_days'],
    },
    ...over,
  }
}

function show(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>{node}</I18nProvider>
    </QueryClientProvider>,
  )
}

// The language is not pinned here: this runner has no `localStorage`, so
// `detectLang` falls through to the browser preference, which jsdom reports as
// en-US. The assertions below are English on purpose.
beforeEach(() => {
  mockChallenge.mockReset()
})

describe('the monthly challenge page', () => {
  /**
   * ⚠️ docs/25 K13: the card on the phone showed the step count CLIPPED to the
   * goal, so somebody who had walked 200 000 against a 100 000 goal was told
   * 100 000. The percentage is what stops at 100 — the figure never does.
   */
  it('shows the steps as measured, past the goal', async () => {
    mockChallenge.mockResolvedValue(
      fixture({
        steps: 200_000,
        goal: 100_000,
        percent: 100,
        complete: true,
        remaining_steps: 0,
        overshoot_steps: 100_000,
        next_threshold: undefined,
        steps_to_next_threshold: undefined,
        thresholds: [{ steps: 100_000, reached: true }],
      }),
    )
    show(<ChallengePage />)

    expect(await screen.findByText('200,000')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
    // And the overshoot is stated, rather than swallowed by the clamp.
    expect(screen.getByText(/100,000 steps past the goal/)).toBeInTheDocument()
  })

  /**
   * The rule the whole product is built on: a missing measurement is not a zero.
   * A month nobody has synced yet must not report that not a step was taken.
   */
  it('never turns a month with no measurement into a zero', async () => {
    mockChallenge.mockResolvedValue(
      fixture({
        steps: undefined,
        steps_per_day: undefined,
        percent: undefined,
        remaining_steps: undefined,
        overshoot_steps: undefined,
        steps_to_next_threshold: undefined,
        measured_days: 0,
        thresholds: [
          { steps: 100_000, reached: false },
          { steps: 200_000, reached: false },
        ],
        days: [{ day: '2026-09-01' }],
      }),
    )
    show(<ChallengePage />)

    expect(await screen.findByText(/No measurement from this month yet/)).toBeInTheDocument()
    expect(screen.getAllByText('–').length).toBeGreaterThan(0)
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })

  /**
   * The streak here is a lower bound on the phone's, and the page has to say so
   * — otherwise the reader takes a shorter number for the same number and
   * concludes their streak broke.
   */
  it('says what the server could not see about the streak', async () => {
    mockChallenge.mockResolvedValue(fixture())
    show(<ChallengePage />)

    expect(await screen.findByText('8-day streak')).toBeInTheDocument()
    expect(screen.getByText(/The phone knows more than this/)).toBeInTheDocument()
    expect(screen.getByText(/never break a streak/)).toBeInTheDocument()
  })

  /** A month that has not begun is not a month of missed days. */
  it('does not draw an empty grid for a month that has not happened', async () => {
    mockChallenge.mockResolvedValue(fixture({ days: [], measured_days: 0, steps: undefined }))
    show(<ChallengePage />)

    expect(await screen.findByText(/This month has not begun yet/)).toBeInTheDocument()
  })
})
