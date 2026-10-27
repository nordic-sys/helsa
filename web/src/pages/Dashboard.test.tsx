// The Today page's two rules, pinned.
//
// The page is now nine cards over three bands, and every one of them reads a
// different endpoint. That is nine new chances to print a zero where nothing was
// measured, and nine new chances for one endpoint's bad day to take the whole
// landing page with it — so those are the two things the tests are about. The
// arrangement is not tested: a screenshot says more about a layout than an
// assertion can, and a test that pins the order of the cards would only make
// rearranging them expensive.

import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider, detectLang } from '../i18n'
import { en } from '../i18n/en'
import { hu } from '../i18n/hu'

const dict = detectLang() === 'hu' ? hu : en

const mock = {
  summary: vi.fn(),
  activity: vi.fn(),
  workouts: vi.fn(),
  sleep: vi.fn(),
  challenge: vi.fn(),
  insights: vi.fn(),
  achievements: vi.fn(),
  coverage: vi.fn(),
  devices: vi.fn(),
  ingestStatus: vi.fn(),
}

vi.mock('../api/client', () => ({
  api: new Proxy(
    {},
    {
      get:
        (_t, name: string) =>
        (...args: unknown[]) =>
          (mock as Record<string, (...a: unknown[]) => unknown>)[name](...args),
    },
  ),
  browserTz: () => 'UTC',
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

const { default: Dashboard } = await import('./Dashboard')

function show(node: ReactNode) {
  return render(
    <I18nProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

const idle = {
  checked_at: '2026-09-10T12:00:00Z',
  broker_reachable: true,
  queue: { name: 'helsa.ingest', ready: 0, consumers: 1, in_flight_max: 8 },
  dead_letter: { name: 'helsa.ingest.dlq', ready: 0 },
  stats_reachable: true,
  // Nothing finished for minutes: the quiet period that lets "up to date" be said.
  worker: { started_at: '2026-09-10T08:00:00Z', last_batch_at: '2026-09-10T11:50:00Z' },
}

/** Every endpoint answers, and every answer is "nothing arrived". */
function allEmpty() {
  mock.summary.mockResolvedValue({ from: '2026-09-10', tz: 'UTC', metrics: {} })
  mock.activity.mockResolvedValue([])
  mock.workouts.mockResolvedValue({ items: [] })
  mock.sleep.mockResolvedValue([])
  mock.insights.mockResolvedValue([])
  mock.achievements.mockResolvedValue([])
  mock.devices.mockResolvedValue([])
  mock.coverage.mockResolvedValue({ days: 30, types: [] })
  mock.ingestStatus.mockResolvedValue(idle)
  mock.challenge.mockResolvedValue({
    month: '2026-09',
    tz: 'UTC',
    days_in_month: 30,
    days_elapsed: 10,
    days_remaining: 20,
    measured_days: 0,
    complete: false,
    thresholds: [],
    days: [],
    streak: {
      length: 0,
      active_days: 0,
      longest: 0,
      window_from: '2026-09-01',
      window_to: '2026-09-10',
      missing_inputs: [],
    },
  })
}

beforeEach(() => {
  for (const fn of Object.values(mock)) fn.mockReset()
})

describe('a day nothing was measured on', () => {
  /**
   * ⚠️ **The rule the whole product is built on.** On a health screen "0 kcal"
   * is read in half a second as a statement about the person: that they moved
   * not at all. Nobody measured that. Every derived number on this page arrives
   * optional, and the page's job is not to undo the backend's care with a `?? 0`
   * on the last metre.
   */
  it('never prints a zero for a measurement that did not arrive', async () => {
    allEmpty()
    show(<Dashboard />)

    // The challenge card: `steps`, `percent` and `steps_per_day` are all absent
    // above, which is what "not one day measured yet" looks like on the wire.
    // Waiting on a label from the card's BODY, not on its heading — the heading
    // is drawn while the request is still in flight.
    const label = await screen.findByText(dict.ui['challenge.ofGoal'])
    const card = label.closest('.card') as HTMLElement
    expect(within(card).queryByText('0')).not.toBeInTheDocument()
    expect(within(card).queryByText('0%')).not.toBeInTheDocument()
    expect(within(card).getAllByText('–').length).toBeGreaterThan(0)
  })

  it('says so where there is nothing, rather than drawing an empty figure', async () => {
    allEmpty()
    show(<Dashboard />)

    expect(await screen.findByText(dict.ui['today.workout.empty'])).toBeInTheDocument()
    expect(await screen.findByText(dict.ui['today.sleep.empty'])).toBeInTheDocument()
    expect(await screen.findByText(dict.ui['settings.devices.empty'])).toBeInTheDocument()
  })
})

describe('one endpoint having a bad day', () => {
  /**
   * The landing page reads nine endpoints. Before the bands it read three, and a
   * failure in any of them blanked the page — which was survivable at three and
   * is not at nine. Only the day's summary is the page's spine now; the rest of
   * the cards carry their own bad news.
   */
  it('costs one card, not the page', async () => {
    allEmpty()
    mock.insights.mockRejectedValue(Object.assign(new Error('Query failed'), { status: 500 }))
    show(<Dashboard />)

    expect(await screen.findByText(/Query failed/)).toBeInTheDocument()
    // The neighbouring cards in the same band are still there.
    expect(screen.getByRole('link', { name: /Monthly challenge|Havi kihívás/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Medals|Érmek/ })).toBeInTheDocument()
  })

  it('does blank the page when the summary itself fails — a missing token is that case', async () => {
    allEmpty()
    mock.summary.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    show(<Dashboard />)

    expect(await screen.findByText(dict.ui['error.noToken.title'])).toBeInTheDocument()
    expect(screen.queryByText(dict.ui['today.band.today'])).not.toBeInTheDocument()
  })
})

describe('the bands', () => {
  it('draws the three the web can fill, and not the one it cannot', async () => {
    allEmpty()
    show(<Dashboard />)

    expect(await screen.findByText(dict.ui['today.band.today'])).toBeInTheDocument()
    expect(screen.getByText(dict.ui['nav.group.longView'])).toBeInTheDocument()
    expect(screen.getByText(dict.ui['nav.group.status'])).toBeInTheDocument()

    // ⚠️ The app's first band is "What today asks of you" — the journal, the
    // water log, the markings. All of them are writes into HealthKit, and only
    // the phone can write. A read-only dashboard has nothing to put under that
    // heading, so it must not draw one.
    expect(screen.queryByText(/asks of you|kér tőled/i)).not.toBeInTheDocument()
  })
})

/**
 * The header pill reads the QUEUE, not the phone. The phone reports "synced" the
 * moment it has handed the data over, while the server may be writing it for
 * another half hour — so "up to date" may only appear when nothing is waiting.
 */
describe('the header pill', () => {
  const pill = async () => {
    const el = await screen.findByText(
      (_, node) => node?.classList?.contains('pill') ?? false,
    )
    return el as HTMLElement
  }

  it('says "up to date" only when the queue is idle, and links to the queue page', async () => {
    allEmpty()
    show(<Dashboard />)
    const p = await pill()
    expect(p).toHaveAttribute('data-state', 'upToDate')
    expect(p).toHaveTextContent(dict.ui['today.pill.upToDate'])
    expect(p).toHaveAttribute('href', '/ingest')
  })

  it('says batches are waiting, with the estimate, while the worker writes them', async () => {
    allEmpty()
    mock.ingestStatus.mockResolvedValue({
      ...idle,
      queue: { name: 'helsa.ingest', ready: 1417, consumers: 1 },
      worker: { started_at: '2026-09-10T08:00:00Z', last_batch_at: '2026-09-10T11:59:58Z' },
      throughput: { window_seconds: 600, batches: 990, items: 1, failed: 0, batches_per_minute: 99 },
      eta_seconds: 840,
    })
    show(<Dashboard />)
    const p = await pill()
    expect(p).toHaveAttribute('data-state', 'writing')
    expect(p.className).toContain('pill--busy')
    expect(p).not.toHaveTextContent(dict.ui['today.pill.upToDate'])
    expect(p.textContent).toMatch(/14 min|14 p/)
  })

  it('says "nothing waiting", not "up to date", while the worker may still be finishing', async () => {
    allEmpty()
    mock.ingestStatus.mockResolvedValue({
      ...idle,
      worker: { started_at: '2026-09-10T08:00:00Z', last_batch_at: '2026-09-10T11:59:55Z' },
    })
    show(<Dashboard />)
    const p = await pill()
    expect(p).toHaveAttribute('data-state', 'settling')
    expect(p).not.toHaveTextContent(dict.ui['today.pill.upToDate'])
    expect(p).toHaveTextContent(dict.ui['today.pill.settling'].replace('{n}', '8'))
  })

  it('turns red when parts were set aside, even on an empty queue', async () => {
    allEmpty()
    mock.ingestStatus.mockResolvedValue({ ...idle, dead_letter: { name: 'dlq', ready: 2 } })
    show(<Dashboard />)
    const p = await pill()
    expect(p).toHaveAttribute('data-state', 'setAside')
    expect(p.className).toContain('pill--error')
  })

  it('says it cannot read the queue rather than claiming anything', async () => {
    allEmpty()
    mock.ingestStatus.mockResolvedValue({ ...idle, broker_reachable: false, queue: undefined, dead_letter: undefined })
    show(<Dashboard />)
    const p = await pill()
    expect(p).toHaveAttribute('data-state', 'unknown')
    expect(p.className).toContain('pill--stalled')
  })

  it('names an older server rather than printing a bare 404', async () => {
    allEmpty()
    mock.ingestStatus.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
    show(<Dashboard />)
    expect(await screen.findByText(dict.ui['today.pill.apiOld'], { selector: '.pill' })).toBeInTheDocument()
    expect(screen.queryByText(/HTTP 404/)).not.toBeInTheDocument()
  })
})

/**
 * A device heartbeat is not an upload, and nothing ties it to the queue: the
 * card says "last seen", and the backlog is the whole queue's, not "parts of it".
 */
describe('the sync card', () => {
  it('says when a device was last seen, and speaks of the queue as a whole', async () => {
    allEmpty()
    mock.devices.mockResolvedValue([{ id: 'd1', name: 'iPhone', platform: 'ios', last_seen_at: new Date().toISOString() }])
    mock.ingestStatus.mockResolvedValue({
      ...idle,
      queue: { name: 'helsa.ingest', ready: 1417, consumers: 1 },
      worker: { started_at: '2026-09-10T08:00:00Z', last_batch_at: '2026-09-10T11:59:58Z' },
      throughput: { window_seconds: 600, batches: 990, items: 1, failed: 0, batches_per_minute: 99 },
      eta_seconds: 840,
    })
    show(<Dashboard />)
    const card = (await screen.findByRole('heading', { name: dict.ui['today.sync.title'] })).closest('a')!
    const lead = dict.ui['today.sync.lastSeen'].split('{when}')[0]
    expect(await within(card).findByText((t) => t.startsWith(lead))).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/uploaded|feltöltés/)
    expect(card.textContent).toMatch(/if nothing more arrives|ha nem érkezik több/)
  })
})

describe('the tiles', () => {
  it('draws a dimmed dash, not a zero, for a metric with no measurement today', async () => {
    allEmpty()
    show(<Dashboard />)
    const notes = await screen.findAllByText(dict.ui['today.tile.notMeasured'])
    expect(notes).toHaveLength(4)
    for (const note of notes) {
      const tile = note.closest('a') as HTMLElement
      expect(tile.getAttribute('href')).toMatch(/^\/trends\?metric=/)
      expect(within(tile).queryByText('0')).not.toBeInTheDocument()
      expect(tile.querySelector('.stat.is-missing')).not.toBeNull()
    }
  })
})
