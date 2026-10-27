import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workout, WorkoutPage } from '../api/types'
import { I18nProvider } from '../i18n'
import Workouts from './Workouts'

const workouts = vi.fn<(limit?: number, cursor?: string) => Promise<WorkoutPage>>()

const workout = vi.fn<(id: string) => Promise<Workout>>()

vi.mock('../api/client', () => ({
  api: {
    workouts: (limit?: number, cursor?: string) => workouts(limit, cursor),
    workout: (id: string) => workout(id),
    workoutRoute: () => Promise.resolve({ points: [] }),
    samples: () => Promise.resolve({ items: [] }),
  },
  browserTz: () => 'Europe/Budapest',
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

/** Make `matchMedia` answer for the master/detail width — jsdom has none, and
 * without it the page takes the narrow layout, which is what most tests want. */
function setWide(wide: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: wide,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  })
}

/** ⚠️ A router, because each row's activity cell is now the link that opens the
 * session. Without one, `<Link>` throws on the null context and every test in
 * the file fails at once — which is what happened the moment the rows learned to
 * open. */
function show(path = '/workouts') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/workouts" element={<Workouts />} />
            <Route path="/workouts/:id" element={<p>detail page</p>} />
          </Routes>
          <Location />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

/** Prints the current URL, so a test can see where a click went. */
function Location() {
  const loc = useLocation()
  return <output data-testid="location">{loc.pathname + loc.search}</output>
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
  workout.mockReset()
  setWide(false)
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
    expect(await screen.findByText(/2 possible matching recordings of this session/i)).toBeInTheDocument()
    // One row for the session, with the ×2 mark on it.
    const list = screen.getByRole('region', { name: /workout list/i })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(within(list).getByText('×2')).toBeInTheDocument()
  })

  /** The row is the way in. Without it the detail page exists at a URL nothing
   * links to, which is the same as not existing. */
  it('opens the session it stands for', async () => {
    workouts.mockResolvedValue({ items: twice })
    show()
    const link = await screen.findByRole('link', { name: /running|futás/i })
    // ⚠️ The PRIMARY's id — the recording the row is showing. Linking to the
    // other one would open a page whose numbers do not match the row above it.
    expect(link).toHaveAttribute('href', expect.stringMatching(/^\/workouts\/id-\d+$/))
  })

  it('counts the doubled hour once in the month total', async () => {
    workouts.mockResolvedValue({ items: twice })
    show()
    const header = await screen.findByRole('button', { name: /august 2026|2026\. augusztus/i })
    expect(header.textContent).toMatch(/1 session/i)
    expect(header.textContent).toMatch(/1 h/i)
  })

  it('says which fields agree, and within what — never "identical"', async () => {
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
    expect(
      await screen.findByText(/duration, distance and energy agree within 0\.5%/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/identical/i)).not.toBeInTheDocument()
    // The duplicate grouping itself is named as an inference, with its rule.
    expect(screen.getByText(/look as if they arrived in Health more than once/)).toHaveTextContent(
      /at least 70% of their combined span/,
    )
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
    await userEvent.click(await screen.findByRole('button', { name: /type: all types/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /yoga/i }))
    expect(screen.getByText(/1 of 2 sessions/i)).toBeInTheDocument()
    const list = screen.getByRole('region', { name: /workout list/i })
    expect(within(list).queryByText(/^running$/i)).not.toBeInTheDocument()
    expect(within(list).getByText(/^yoga$/i)).toBeInTheDocument()
  })

  /**
   * ⛔ A missing measurement is never a zero. The yoga session has no distance at
   * all, so "at least 5 km" has nothing to fail it with — reading the absent
   * distance as 0 would drop it and answer the question wrongly.
   */
  it('does not hide a workout that cannot answer the filter', async () => {
    workouts.mockResolvedValue({ items: mixed })
    show()
    await screen.findByRole('region', { name: /workout list/i })
    await userEvent.click(screen.getByRole('button', { name: /more filters/i }))
    await userEvent.selectOptions(screen.getByLabelText(/distance at least/i), '5')
    expect(screen.getByText(/2 of 2 sessions/i)).toBeInTheDocument()
  })

  it('offers a way out of an empty result', async () => {
    workouts.mockResolvedValue({ items: mixed })
    show()
    await screen.findByRole('region', { name: /workout list/i })
    await userEvent.selectOptions(screen.getByLabelText(/lasting at least/i), '120')
    expect(screen.getByText(/no workout matches the filter/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /clear the filter/i }))
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
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
    const row = await screen.findByRole('link', { name: /swim/i })
    expect(row.querySelector('.wo-line')?.textContent).toBe('–')
    expect(within(row).queryByText(/^0/)).not.toBeInTheDocument()
    const header = screen.getByRole('button', { name: /august 2026|2026\. augusztus/i })
    expect(header.textContent).toMatch(/1 h/)
    expect(header.textContent).toMatch(/no end time/i)
  })
})

/**
 * The wide layout: the list on the left, the opened session on the right, and a
 * row is a button that selects rather than a link that leaves.
 */
describe('master and detail on a wide screen', () => {
  const two = () => [
    w({ activity_type: 'running', started_at: iso(2026, 8, 5, 18), ended_at: iso(2026, 8, 5, 19) }),
    w({ activity_type: 'yoga', started_at: iso(2026, 8, 3, 18), ended_at: iso(2026, 8, 3, 18, 40) }),
  ]

  it('opens the newest session beside the list without being asked', async () => {
    setWide(true)
    workouts.mockResolvedValue({ items: two() })
    workout.mockImplementation(async (id) => two().find((x) => x.id === id) ?? two()[0])
    show()
    const detail = await screen.findByRole('article', { name: /selected workout/i })
    expect(await within(detail).findByRole('heading', { level: 2, name: /running/i })).toBeInTheDocument()
    const newest = screen.getByRole('button', { name: /running/i })
    expect(newest).toHaveAttribute('aria-pressed', 'true')
  })

  it('selects a session by its row, marks it, and keeps the choice in the URL', async () => {
    setWide(true)
    workouts.mockResolvedValue({ items: two() })
    workout.mockImplementation(async (id) => {
      seq = 0
      return two().find((x) => x.id === id) as Workout
    })
    show()
    const yoga = await screen.findByRole('button', { name: /yoga/i })
    expect(yoga).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(yoga)
    expect(yoga).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /running/i })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('location').textContent).toBe('/workouts?w=id-2')
    const detail = screen.getByRole('article', { name: /selected workout/i })
    expect(await within(detail).findByRole('heading', { level: 2, name: /yoga/i })).toBeInTheDocument()
  })

  it('honours a selection that arrives in the URL', async () => {
    setWide(true)
    workouts.mockResolvedValue({ items: two() })
    workout.mockResolvedValue({ ...two()[1], id: 'id-2' })
    show('/workouts?w=id-2')
    expect(await screen.findByRole('button', { name: /yoga/i })).toHaveAttribute('aria-pressed', 'true')
    expect(workout).toHaveBeenCalledWith('id-2')
  })

  it('opens the session page for a selection in the URL on a narrow screen', async () => {
    // The Today card links `/workouts?w=…`; below 1100px there is no panel.
    workouts.mockResolvedValue({ items: two() })
    show('/workouts?w=id-2')
    expect(await screen.findByText('detail page')).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/workouts/id-2')
  })

  it('keeps rows as links to the session page on a narrow screen', async () => {
    workouts.mockResolvedValue({ items: two() })
    show()
    const link = await screen.findByRole('link', { name: /running/i })
    await userEvent.click(link)
    expect(screen.getByTestId('location').textContent).toMatch(/^\/workouts\/id-\d+$/)
    expect(screen.queryByRole('article', { name: /selected workout/i })).not.toBeInTheDocument()
  })
})

describe('keyboard and screen reader', () => {
  it('returns focus to the type button when Escape closes the list', async () => {
    workouts.mockResolvedValue({
      items: [
        w({ activity_type: 'running', started_at: iso(2026, 8, 5, 18), ended_at: iso(2026, 8, 5, 19) }),
        w({ activity_type: 'yoga', started_at: iso(2026, 8, 3, 18), ended_at: iso(2026, 8, 3, 18, 40) }),
      ],
    })
    show()
    const button = await screen.findByRole('button', { name: /^Type:|^Típus:/ })
    await userEvent.click(button)
    const box = screen.getAllByRole('checkbox')[0]
    box.focus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('names a month by everything it shows — the hours and the caveat included', async () => {
    workouts.mockResolvedValue({
      items: [
        w({ started_at: iso(2026, 8, 5, 18), ended_at: iso(2026, 8, 5, 19) }),
        w({ started_at: iso(2026, 8, 7, 18) }), // no end time
      ],
    })
    show()
    const month = await screen.findByRole('button', { name: /august 2026|2026\. augusztus/i })
    expect(month).not.toHaveAttribute('aria-label')
    expect(month).toHaveAccessibleName(/1 h|1 ó/)
    expect(month).toHaveAccessibleName(/no end time, outside the total|befejezés/i)
  })
})
