import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout, WorkoutPage } from '../api/types'
import { I18nProvider } from '../i18n'
import Workouts from './Workouts'

const workouts = vi.fn<(limit?: number, cursor?: string) => Promise<WorkoutPage>>()

vi.mock('../api/client', () => ({
  api: { workouts: (limit?: number, cursor?: string) => workouts(limit, cursor) },
  browserTz: () => 'Europe/Budapest',
}))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Workouts />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

let seq = 0
function w(partial: Partial<Workout> & { started_at: string }): Workout {
  seq += 1
  return { id: `id-${seq}`, activity_type: 'running', ...partial }
}

function iso(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString()
}

beforeEach(() => {
  seq = 0
  workouts.mockReset()
})

/**
 * ⚠️ The page used to ask for one page and draw it as if it were the history. A
 * filter over a truncated list does not show less — it answers wrongly, and
 * nobody can tell that from the answer.
 */
describe('the whole history, not the first page', () => {
  it('follows the cursor to the end', async () => {
    workouts.mockImplementation(async (_limit, cursor) =>
      cursor
        ? { items: [w({ started_at: iso(2026, 6, 2, 7), ended_at: iso(2026, 6, 2, 8) })] }
        : {
            items: [w({ started_at: iso(2026, 8, 2, 7), ended_at: iso(2026, 8, 2, 8) })],
            next_cursor: 'page-2',
          },
    )
    show()
    // The month that only exists on the second page is on screen.
    expect(await screen.findByText(/june 2026|2026\. június/i)).toBeInTheDocument()
    expect(workouts).toHaveBeenCalledTimes(2)
  })

  it('says so while the older months are still arriving', async () => {
    workouts.mockImplementation(
      async () =>
        new Promise<WorkoutPage>((resolve) =>
          setTimeout(
            () =>
              resolve({
                items: [w({ started_at: iso(2026, 8, 2, 7), ended_at: iso(2026, 8, 2, 8) })],
                next_cursor: 'more',
              }),
            0,
          ),
        ),
    )
    show()
    expect(await screen.findByText(/still loading the history/i)).toBeInTheDocument()
  })
})

/**
 * ⚠️ The rule the two surfaces must agree on. If the web shows two rows where
 * the phone shows one, they disagree about how many times somebody ran — and
 * about how many hours the month held.
 */
describe('one session, one row', () => {
  const twice = [
    w({
      started_at: iso(2026, 8, 3, 18, 0),
      ended_at: iso(2026, 8, 3, 19, 0),
      total_distance_m: 10000,
    }),
    w({ started_at: iso(2026, 8, 3, 18, 2), ended_at: iso(2026, 8, 3, 19, 2) }),
  ]

  it('folds two recordings of one session and says what it did', async () => {
    workouts.mockResolvedValue({ items: twice })
    show()
    expect(await screen.findByText(/2 recordings of this session/i)).toBeInTheDocument()
    // One data row, one caption row, one header row.
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3)
  })

  it('counts the doubled hour once in the month total', async () => {
    workouts.mockResolvedValue({ items: twice })
    show()
    const header = await screen.findByRole('button', { name: /august 2026|2026\. augusztus/i })
    expect(header.textContent).toMatch(/1 session/i)
    expect(header.textContent).toMatch(/1 h/i)
  })

  it('distinguishes identical numbers from differing ones', async () => {
    workouts.mockResolvedValue({
      items: [
        w({
          started_at: iso(2026, 8, 3, 18, 0),
          ended_at: iso(2026, 8, 3, 19, 0),
          total_distance_m: 10000,
        }),
        w({
          started_at: iso(2026, 8, 3, 18, 0),
          ended_at: iso(2026, 8, 3, 19, 0),
          total_distance_m: 10000,
        }),
      ],
    })
    show()
    expect(await screen.findByText(/the numbers are identical/i)).toBeInTheDocument()
  })
})

describe('months', () => {
  /** 25 sessions over two months: too many to leave open. */
  const long = Array.from({ length: 25 }, (_, i) =>
    w({
      started_at: iso(2026, i < 13 ? 7 : 8, (i % 13) + 1, 7),
      ended_at: iso(2026, i < 13 ? 7 : 8, (i % 13) + 1, 8),
    }),
  )

  it('opens the newest month and closes the rest, so the newest workout is visible', async () => {
    workouts.mockResolvedValue({ items: long })
    show()
    const august = await screen.findByRole('button', { name: /august 2026|2026\. augusztus/i })
    const july = screen.getByRole('button', { name: /july 2026|2026\. július/i })
    expect(august).toHaveAttribute('aria-expanded', 'true')
    expect(july).toHaveAttribute('aria-expanded', 'false')
  })

  it('a closed month still says how much it holds', async () => {
    workouts.mockResolvedValue({ items: long })
    show()
    const july = await screen.findByRole('button', { name: /july 2026|2026\. július/i })
    expect(july.textContent).toMatch(/13 sessions/i)
    expect(july.textContent).toMatch(/13 h/i)
  })

  it('opens a month when its header is clicked', async () => {
    workouts.mockResolvedValue({ items: long })
    show()
    const july = await screen.findByRole('button', { name: /july 2026|2026\. július/i })
    await userEvent.click(july)
    expect(july).toHaveAttribute('aria-expanded', 'true')
  })

  it('leaves a short history open entirely', async () => {
    workouts.mockResolvedValue({
      items: [
        w({ started_at: iso(2026, 8, 3, 18), ended_at: iso(2026, 8, 3, 19) }),
        w({ started_at: iso(2026, 7, 3, 18), ended_at: iso(2026, 7, 3, 19) }),
      ],
    })
    show()
    const july = await screen.findByRole('button', { name: /july 2026|2026\. július/i })
    expect(july).toHaveAttribute('aria-expanded', 'true')
  })
})

describe('the filter', () => {
  const mixed = [
    w({
      activity_type: 'running',
      started_at: iso(2026, 8, 3, 18),
      ended_at: iso(2026, 8, 3, 19),
      total_distance_m: 10000,
    }),
    w({ activity_type: 'yoga', started_at: iso(2026, 8, 4, 18), ended_at: iso(2026, 8, 4, 18, 40) }),
  ]

  it('narrows the list and says how much of it is left', async () => {
    workouts.mockResolvedValue({ items: mixed })
    show()
    await userEvent.click(await screen.findByRole('button', { name: /^yoga$/i }))
    expect(screen.getByText(/1 of 2 sessions/i)).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).queryByText(/^running$/i)).not.toBeInTheDocument()
  })

  /**
   * ⛔ A missing measurement is never a zero. The yoga session has no distance at
   * all, so "at least 5 km" has nothing to fail it with — reading the absent
   * distance as 0 would drop it and answer the question wrongly.
   */
  it('does not hide a workout that cannot answer the filter', async () => {
    workouts.mockResolvedValue({ items: mixed })
    show()
    await screen.findByRole('table')
    await userEvent.selectOptions(screen.getByLabelText(/distance at least/i), '5')
    expect(screen.getByText(/2 of 2 sessions/i)).toBeInTheDocument()
  })

  it('offers a way out of an empty result', async () => {
    workouts.mockResolvedValue({ items: mixed })
    show()
    await screen.findByRole('table')
    await userEvent.selectOptions(screen.getByLabelText(/lasting at least/i), '120')
    expect(screen.getByText(/no workout matches the filter/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /clear the filter/i }))
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

/** ⛔ A workout with no end time did not last no time. */
describe('a recording with no end', () => {
  it('prints a dash rather than a zero, and stays out of the total', async () => {
    workouts.mockResolvedValue({
      items: [
        w({ activity_type: 'swimming', started_at: iso(2026, 8, 3, 18) }),
        w({ started_at: iso(2026, 8, 4, 18), ended_at: iso(2026, 8, 4, 19) }),
      ],
    })
    show()
    const row = await screen.findByRole('row', { name: /swim/i })
    expect(within(row).getAllByRole('cell')[2]).toHaveTextContent('–')
    expect(within(row).queryByText('0')).not.toBeInTheDocument()
    const header = screen.getByRole('button', { name: /august 2026|2026\. augusztus/i })
    expect(header.textContent).toMatch(/1 h/)
    expect(header.textContent).toMatch(/no end time/i)
  })
})
