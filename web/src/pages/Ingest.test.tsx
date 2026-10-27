import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestRedriveResult, IngestStatus } from '../api/types'
import { I18nProvider } from '../i18n'
import Ingest from './Ingest'

const status = vi.fn<() => Promise<IngestStatus>>()
const redrive = vi.fn<() => Promise<IngestRedriveResult>>()

vi.mock('../api/client', () => ({
  api: { ingestStatus: () => status(), redriveDeadLetters: () => redrive() },
}))

function show() {
  // English, so the assertions read the same wherever the test runs.
  localStorage.setItem('helsa.lang', 'en')
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Ingest />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const draining: IngestStatus = {
  checked_at: '2026-10-27T12:30:30Z',
  broker_reachable: true,
  queue: { name: 'helsa.ingest', ready: 4000, consumers: 1, in_flight_max: 8 },
  dead_letter: { name: 'helsa.ingest.dlq', ready: 0 },
  stats_reachable: true,
  worker: {
    started_at: '2026-10-27T11:30:00Z',
    last_batch_at: '2026-10-27T12:30:28Z',
    prefetch: 8,
    batches_since_start: 2400,
    items_since_start: 9000000,
    failed_since_start: 0,
  },
  throughput: {
    window_seconds: 630,
    batches: 1100,
    items: 4400000,
    failed: 0,
    batches_per_minute: 104.8,
    items_per_minute: 419047,
  },
  eta_seconds: 2296,
}

beforeEach(() => {
  status.mockReset()
  redrive.mockReset()
})

describe('draining', () => {
  it('says how long is left, and that it is an estimate', async () => {
    status.mockResolvedValue(draining)
    show()
    const eta = await screen.findByTestId('ingest-eta')
    expect(eta).toHaveTextContent(/about .*39 min/)
    // Labelled as an estimate, beside the figure and in the sentence under it.
    // …and scoped to the backlog as it stands: new uploads are not in it.
    expect(screen.getByText(/For the current backlog, if nothing more arrives — an estimate/)).toBeInTheDocument()
    expect(screen.getByText(/An estimate for the current backlog, if nothing more arrives/)).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/up to 8 in progress/)).toBeInTheDocument()
    expect(screen.getByTestId('ingest-waiting')).toHaveTextContent('4,000parts')
  })

  /**
   * ⛔ The status carries no size of the upload and no per-minute history, so
   * the page draws neither a progress bar against an invented total nor a chart
   * of minutes it was never told about.
   */
  it('draws no progress bar and no per-minute chart the API cannot back', async () => {
    status.mockResolvedValue(draining)
    show()
    await screen.findByTestId('ingest-eta')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByText(/per minute · last 30 minutes/i)).not.toBeInTheDocument()
  })
})

/**
 * ⛔ `ready: 0` is "nothing waiting for delivery". The worker may still be
 * writing what it took, so "nothing left to write" waits for 30 quiet seconds.
 */
describe('nothing waiting', () => {
  const empty = (lastBatch: string): IngestStatus => ({
    ...draining,
    queue: { name: 'helsa.ingest', ready: 0, consumers: 1, in_flight_max: 8 },
    worker: { ...draining.worker!, last_batch_at: lastBatch },
    eta_seconds: undefined,
  })

  it('does not claim everything is written while a part finished seconds ago', async () => {
    status.mockResolvedValue(empty('2026-10-27T12:30:28Z'))
    show()
    expect(await screen.findByText(/may still be finishing up to 8 parts/)).toBeInTheDocument()
    expect(screen.getByText('Nothing waiting for delivery')).toBeInTheDocument()
    expect(screen.queryByText(/Nothing left to write/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says nothing is left to write once nothing has finished for 30 seconds', async () => {
    status.mockResolvedValue(empty('2026-10-27T12:29:30Z'))
    show()
    expect(await screen.findByText(/Nothing left to write/)).toBeInTheDocument()
    expect(screen.queryByText(/may still be finishing/)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('nobody consuming', () => {
  it('is an alert, not slowness, and carries no estimate', async () => {
    status.mockResolvedValue({
      ...draining,
      queue: { name: 'helsa.ingest', ready: 3000, consumers: 0, in_flight_max: 0 },
      eta_seconds: undefined,
    })
    show()
    expect(await screen.findByRole('alert')).toHaveTextContent(/nothing is writing them/)
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
  })
})

describe('stalled', () => {
  it('names a rate that is only an old average as not moving, not "working"', async () => {
    status.mockResolvedValue({
      ...draining,
      worker: { ...draining.worker!, last_batch_at: '2026-10-27T12:21:30Z' },
    })
    show()
    expect(await screen.findByText(/the last one finished .* nothing has finished since/)).toBeInTheDocument()
    expect(screen.queryByText('Working')).not.toBeInTheDocument()
    expect(screen.getByText('Nothing finished recently')).toBeInTheDocument()
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
  })

  it('says nothing finished in the window, and gives no estimate', async () => {
    status.mockResolvedValue({
      ...draining,
      throughput: { window_seconds: 630, batches: 0, items: 0, failed: 0 },
      eta_seconds: undefined,
    })
    show()
    expect(await screen.findByText(/none finished in the last 11 minutes/)).toBeInTheDocument()
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
  })
})

describe('the dead-letter queue', () => {
  it('is loud when it holds anything', async () => {
    status.mockResolvedValue({ ...draining, dead_letter: { name: 'helsa.ingest.dlq', ready: 1 } })
    show()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/1 part could not be written and is set aside/)
    expect(alert).toHaveTextContent(/helsa\.ingest\.dlq/)
    expect(alert).toHaveTextContent(/docker compose logs worker/)
    expect(alert).toHaveTextContent(/Full resync/)
    expect(screen.getByTestId('ingest-dlq')).toHaveTextContent('1')
  })
})

/**
 * ⛔ The rule the page exists to keep: a broker that cannot be asked is not an
 * empty queue. No queue tile, no zero, and the reason on screen.
 */
describe('RabbitMQ unreachable', () => {
  it('says the depth is unknown and never draws a zero for it', async () => {
    status.mockResolvedValue({
      checked_at: '2026-10-27T12:30:30Z',
      broker_reachable: false,
      broker_error: 'rabbitmq connection closed',
      stats_reachable: true,
      throughput: { window_seconds: 630, batches: 0, items: 0, failed: 0 },
    })
    show()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/The queue cannot be read right now/)
    expect(alert).toHaveTextContent(/not zero, none/)
    expect(alert).toHaveTextContent(/rabbitmq connection closed/)
    expect(screen.queryByTestId('ingest-waiting')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ingest-dlq')).not.toBeInTheDocument()
    expect(screen.queryByText(/Nothing is waiting/)).not.toBeInTheDocument()
  })
})

describe('the worker counters unreachable', () => {
  it('keeps the exact depth and says the rest is unknown', async () => {
    status.mockResolvedValue({
      ...draining,
      stats_reachable: false,
      worker: undefined,
      throughput: undefined,
      eta_seconds: undefined,
      queue: { name: 'helsa.ingest', ready: 4000, consumers: 1 },
    })
    show()
    expect(await screen.findByText('The worker’s counters cannot be read')).toBeInTheDocument()
    expect(screen.getByText('4,000')).toBeInTheDocument()
    // Unknown is not stalled: no "not moving" headline for a rate nobody could read.
    expect(screen.getByText('Rate unknown')).toBeInTheDocument()
    expect(screen.queryByText('Not moving')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
  })
})

describe('the API itself unreachable', () => {
  it('shows the error state rather than an empty queue', async () => {
    status.mockRejectedValue(new Error('Failed to fetch'))
    show()
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument()
    expect(screen.queryByTestId('ingest-waiting')).not.toBeInTheDocument()
  })
})

/**
 * Version skew: the web image landed before the backend image, so a route the
 * page needs answers 404 while the rest of the API works. A bare "HTTP 404"
 * sends the reader looking for a broken link; the page names the cause and the
 * command that fixes it.
 */
describe('a server older than the page', () => {
  it('says the API is older, and how to update it, instead of a bare 404', async () => {
    status.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }))
    show()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/older than this web page/)
    expect(alert).toHaveTextContent('make prod-pull && make prod-up')
    expect(screen.queryByText('HTTP 404')).not.toBeInTheDocument()
  })

  it('in Hungarian too', async () => {
    status.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }))
    localStorage.setItem('helsa.lang', 'hu')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <I18nProvider>
          <Ingest />
        </I18nProvider>
      </QueryClientProvider>,
    )
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/régebbi, mint ez a weboldal/)
    expect(alert).toHaveTextContent('make prod-pull && make prod-up')
  })

  it('hides the retry button when the retry endpoint is missing, and says why', async () => {
    status.mockResolvedValue({ ...draining, dead_letter: { name: 'helsa.ingest.dlq', ready: 2 } })
    redrive.mockRejectedValue(Object.assign(new Error('HTTP 404'), { status: 404 }))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/needs a newer server API/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /set-aside parts/ })).not.toBeInTheDocument()
  })
})

const parked = (over: Partial<IngestStatus['dead_letter']> = {}): IngestStatus => ({
  ...draining,
  dead_letter: { name: 'helsa.ingest.dlq', ready: 2, ...over },
})

const failure = (over: Partial<NonNullable<NonNullable<IngestStatus['dead_letter']>['recent_failures']>[number]> = {}) => ({
  batch_id: '0b3c2f2e-1111-4a4a-9c9c-222222222222',
  failed_at: '2026-10-27T12:20:00Z',
  error: 'write samples: ERROR: value too long for type "…" (SQLSTATE 22001)',
  items: 1840,
  samples: 1838,
  workouts: 2,
  sleep_segments: 0,
  activity_summaries: 0,
  deletions: 0,
  redriven: 0,
  ...over,
})

describe('retrying set-aside parts', () => {
  it('asks first, says why it is safe, and reports exactly what moved', async () => {
    status.mockResolvedValue(parked())
    redrive.mockResolvedValue({ moved: 2, remaining: 0, max_redriven: 1, repeated: 0 })
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    expect(redrive).not.toHaveBeenCalled()
    expect(screen.getByText(/Retry 2 parts\? Writing is idempotent/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Moved 2 back to the queue · 0 still set aside')).toBeInTheDocument()
    expect(redrive).toHaveBeenCalledTimes(1)
    // …and the status is read again straight away.
    await waitFor(() => expect(status.mock.calls.length).toBeGreaterThan(1))
  })

  it('can be cancelled without calling the server', async () => {
    status.mockResolvedValue(parked())
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(redrive).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retry 2 set-aside parts' })).toBeInTheDocument()
  })

  it('is disabled while it runs', async () => {
    status.mockResolvedValue(parked())
    let finish: (r: IngestRedriveResult) => void = () => {}
    redrive.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('button', { name: 'Retrying…' })).toBeDisabled()
    finish({ moved: 2, remaining: 0, max_redriven: 1, repeated: 0 })
    expect(await screen.findByText(/Moved 2 back/)).toBeInTheDocument()
  })

  it('never reads an absent remaining count as zero', async () => {
    status.mockResolvedValue(parked())
    redrive.mockResolvedValue({ moved: 1, max_redriven: 1, repeated: 0 })
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const result = await screen.findByTestId('redrive-result')
    expect(result).toHaveTextContent(/could not be read/)
    expect(result).not.toHaveTextContent(/0 still set aside/)
  })

  it('reports a run that stopped part-way as a partial success, with the reason', async () => {
    status.mockResolvedValue(parked())
    redrive.mockResolvedValue({
      moved: 1,
      remaining: 1,
      max_redriven: 3,
      repeated: 1,
      stopped_early: 'publish not confirmed',
    })
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const result = await screen.findByTestId('redrive-result')
    expect(result).toHaveTextContent('Moved 1 back to the queue · 1 still set aside')
    expect(result).toHaveTextContent(/stopped part-way: publish not confirmed/)
    // The backend counts the NEW redrive count (≥ 3): third retry or later, not
    // "failed after 3 retries" — that would be one retry too many.
    expect(result).toHaveTextContent(/now on its third retry or later/)
    expect(result).not.toHaveTextContent(/after 3 or more retries/)
    expect(result).toHaveTextContent(/includes only the parts confirmed moved/)
  })

  it('states the per-call limit, and offers only 1,000 of a larger queue', async () => {
    status.mockResolvedValue(parked({ ready: 2500 }))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 1,000 of 2,500 set-aside parts' }))
    expect(screen.getByText(/One retry moves at most 1,000 parts/)).toBeInTheDocument()
  })

  it('does not promise when the worker picks the parts up', async () => {
    status.mockResolvedValue(parked())
    redrive.mockResolvedValue({ moved: 2, remaining: 0, max_redriven: 1, repeated: 0 })
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const result = await screen.findByTestId('redrive-result')
    expect(result).not.toHaveTextContent(/within seconds/)
    expect(result).toHaveTextContent(/depends on the worker and the backlog/)
  })

  it('keeps its result after the retry empties the set-aside queue', async () => {
    status.mockResolvedValueOnce(parked())
    status.mockResolvedValue({ ...draining, dead_letter: { name: 'helsa.ingest.dlq', ready: 0 } })
    redrive.mockResolvedValue({ moved: 2, remaining: 0, max_redriven: 1, repeated: 0 })
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    // The re-read status has an empty dead-letter queue: the alert goes…
    await waitFor(() => expect(screen.queryByRole('button', { name: /set-aside parts/ })).not.toBeInTheDocument())
    // …and the result, in its live region, stays.
    const region = screen.getByTestId('redrive-region')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(within(region).getByText('Moved 2 back to the queue · 0 still set aside')).toBeInTheDocument()
  })

  it('says the outcome is unknown — not "did not run" — when the answer was lost', async () => {
    status.mockResolvedValue(parked())
    redrive.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    redrive.mockRejectedValueOnce(Object.assign(new Error('Bad Gateway'), { status: 502 }))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/whether the retry ran is not known \(Failed to fetch\)/)).toBeInTheDocument()
    expect(screen.queryByText(/did not run/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/whether the retry ran is not known \(Bad Gateway\)/)).toBeInTheDocument()
  })

  it('says nothing moved when the server refused the request', async () => {
    status.mockResolvedValue(parked())
    redrive.mockRejectedValue(Object.assign(new Error('Bad Request'), { status: 400, detail: 'max must be between 1 and 1000' }))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/refused the retry, so nothing was moved: max must be/)).toBeInTheDocument()
  })

  it('returns focus to the retry button when the question is cancelled', async () => {
    status.mockResolvedValue(parked())
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry 2 set-aside parts' })).toHaveFocus())
  })

  it('says a retry is already running on a 409, and that nothing moved on a 503', async () => {
    status.mockResolvedValue(parked())
    redrive.mockRejectedValueOnce(Object.assign(new Error('Conflict'), { status: 409 }))
    redrive.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status: 503 }))
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/already running/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry 2 set-aside parts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(/nothing was moved/)).toBeInTheDocument()
  })
})

describe('why parts were set aside', () => {
  it('puts the plain reading first and the worker\'s raw message in a disclosure', async () => {
    status.mockResolvedValue(parked({ ready: 1, recent_failures: [failure()] }))
    show()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText(/refused what was in it/)).toBeInTheDocument()
    const raw = within(alert).getByText(/SQLSTATE 22001/)
    expect(raw.closest('details')).not.toBeNull()
    expect(alert).toHaveTextContent(/1,840 items \(1,838 samples, 2 workouts\)/)
  })

  it('lists the log as a log, without claiming which entries are still set aside', async () => {
    // Three logged failures, one retry that moved one: nothing says which two remain.
    status.mockResolvedValue(
      parked({
        ready: 2,
        recent_failures: [
          failure({ batch_id: undefined, failed_at: '2026-10-27T12:25:00Z' }),
          failure({ batch_id: undefined, failed_at: '2026-10-27T12:00:00Z' }),
          failure({ batch_id: undefined, failed_at: '2026-10-27T11:00:00Z' }),
        ],
        last_redrive: { at: '2026-10-27T12:10:00Z', moved: 1 },
      }),
    )
    show()
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('Recent failures — a log, not the queue')).toBeInTheDocument()
    expect(alert).toHaveTextContent(/does not say which parts are set aside now/)
    expect(within(alert).getAllByText(/refused what was in it/)).toHaveLength(3)
    expect(alert).toHaveTextContent(/Last retry finished .*: 1 moved back/)
    expect(alert).not.toHaveTextContent(/moved back by it/)
    expect(alert).not.toHaveTextContent(/reason not recorded/)
  })

  it('says when a part has failed again after three or more retries', async () => {
    // `redriven` is the count BEFORE that failure: 3 retries, then it failed again.
    status.mockResolvedValue(parked({ ready: 1, recent_failures: [failure({ redriven: 3 })] }))
    show()
    expect(await screen.findByText('Failed again after 3 retries')).toBeInTheDocument()
  })
})
