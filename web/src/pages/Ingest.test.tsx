import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngestStatus } from '../api/types'
import { I18nProvider } from '../i18n'
import Ingest from './Ingest'

const status = vi.fn<() => Promise<IngestStatus>>()

vi.mock('../api/client', () => ({
  api: { ingestStatus: () => status() },
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
})

describe('draining', () => {
  it('says how long is left, and that it is an estimate', async () => {
    status.mockResolvedValue(draining)
    show()
    const eta = await screen.findByTestId('ingest-eta')
    expect(eta).toHaveTextContent(/About .*39 min.* left/)
    expect(eta).toHaveTextContent(/estimate/i)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(/up to 8 in progress/)).toBeInTheDocument()
  })
})

describe('idle', () => {
  it('has no estimate and no alarm', async () => {
    status.mockResolvedValue({
      ...draining,
      queue: { name: 'helsa.ingest', ready: 0, consumers: 1, in_flight_max: 8 },
      throughput: { window_seconds: 630, batches: 0, items: 0, failed: 0 },
      eta_seconds: undefined,
    })
    show()
    expect(await screen.findByText(/Nothing is waiting/)).toBeInTheDocument()
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
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
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nobody is consuming/)
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
  })
})

describe('stalled', () => {
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
    expect(alert).toHaveTextContent(/1 batch was not written/)
    expect(alert).toHaveTextContent(/helsa\.ingest\.dlq/)
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
    expect(alert).toHaveTextContent(/RabbitMQ cannot be reached/)
    expect(alert).toHaveTextContent(/unknown — not zero/)
    expect(alert).toHaveTextContent(/rabbitmq connection closed/)
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
    expect(screen.queryByText('Dead-letter queue')).not.toBeInTheDocument()
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
    expect(await screen.findByText(/counters cannot be read/)).toBeInTheDocument()
    expect(screen.getByText('4,000')).toBeInTheDocument()
    expect(screen.queryByTestId('ingest-eta')).not.toBeInTheDocument()
  })
})

describe('the API itself unreachable', () => {
  it('shows the error state rather than an empty queue', async () => {
    status.mockRejectedValue(new Error('Failed to fetch'))
    show()
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument()
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
  })
})
