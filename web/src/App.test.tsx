// The queue badge on the sidebar — the one piece of the frame that reads data.
//
// What is pinned: the colour follows severity (busy / stalled / error), the
// number is the one that needs a person (the dead-letter count outranks the
// backlog), an unreadable queue is a "?" and never a 0, and nothing at all is
// drawn when the queue is idle or the request itself failed.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { IngestStatus } from './api/types'
import { I18nProvider } from './i18n'

const ingestStatus = vi.fn<() => Promise<IngestStatus>>()

vi.mock('./api/client', () => ({
  api: new Proxy(
    {},
    {
      get: (_t, name: string) =>
        name === 'ingestStatus' ? () => ingestStatus() : () => new Promise(() => {}),
    },
  ),
  browserTz: () => 'Europe/Budapest',
  getToken: () => null,
  setToken: () => {},
  clearToken: () => {},
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

const { default: App } = await import('./App')

function show() {
  localStorage.setItem('helsa.lang', 'en')
  return render(
    <I18nProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/settings']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

const status = (over: Partial<IngestStatus> = {}): IngestStatus => ({
  checked_at: '2026-10-27T12:00:00Z',
  broker_reachable: true,
  queue: { name: 'helsa.ingest', ready: 1417, consumers: 1 },
  dead_letter: { name: 'helsa.ingest.dlq', ready: 0 },
  stats_reachable: true,
  throughput: { window_seconds: 600, batches: 990, items: 1, failed: 0, batches_per_minute: 99 },
  eta_seconds: 840,
  ...over,
})

async function queueLink() {
  const nav = screen.getByRole('navigation')
  return within(nav).findByRole('link', { name: /^Sync queue/ })
}

// Braces, not an arrow returning the mock: vitest calls a function returned
// from `beforeEach` as the test's cleanup hook — which called the mock again.
beforeEach(() => {
  ingestStatus.mockReset()
})

describe('the queue badge', () => {
  it('is teal and counts the waiting parts while the worker drains them', async () => {
    ingestStatus.mockResolvedValue(status())
    show()
    const link = await queueLink()
    const badge = await within(link).findByText('1,417')
    expect(badge.closest('.badge')).toHaveAttribute('data-tone', 'busy')
    expect(link).toHaveAccessibleName(/1,417 parts waiting to be written/)
  })

  it('is amber when parts wait and no worker is connected', async () => {
    ingestStatus.mockResolvedValue(status({ queue: { name: 'q', ready: 12, consumers: 0 } }))
    show()
    const link = await queueLink()
    expect((await within(link).findByText('12')).closest('.badge')).toHaveAttribute('data-tone', 'stalled')
  })

  it('is red and shows the set-aside count, not the backlog', async () => {
    ingestStatus.mockResolvedValue(status({ dead_letter: { name: 'dlq', ready: 3 } }))
    show()
    const link = await queueLink()
    const badge = (await within(link).findByText(/^3 !$/)).closest('.badge')
    expect(badge).toHaveAttribute('data-tone', 'error')
    expect(within(link).queryByText('1,417')).not.toBeInTheDocument()
    expect(link).toHaveAccessibleName(/3 parts set aside/)
  })

  it('is a "?" — not a 0 — when the server cannot reach its queue', async () => {
    ingestStatus.mockResolvedValue(
      status({ broker_reachable: false, queue: undefined, dead_letter: undefined }),
    )
    show()
    const link = await queueLink()
    expect(await within(link).findByText('?')).toBeInTheDocument()
    expect(within(link).queryByText('0')).not.toBeInTheDocument()
  })

  it('is absent when nothing waits', async () => {
    ingestStatus.mockResolvedValue(status({ queue: { name: 'q', ready: 0, consumers: 1 }, eta_seconds: undefined }))
    show()
    await screen.findByRole('link', { name: 'Sync queue' })
    expect(document.querySelector('.badge')).toBeNull()
  })

  it('is absent when the request itself failed — that is not a reading', async () => {
    ingestStatus.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
    show()
    await screen.findByRole('link', { name: 'Sync queue' })
    expect(document.querySelector('.badge')).toBeNull()
  })

  it('marks the current page and puts host and time zone in the footer', async () => {
    ingestStatus.mockResolvedValue(status())
    show()
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText(/Europe\/Budapest/)).toBeInTheDocument()
  })
})

/**
 * The bar layout's menu, by keyboard. The CSS hides the panel only below 900px
 * (jsdom applies no media queries), so what is pinned is the markup order and
 * where focus goes — the two things a stylesheet cannot fix.
 */
describe('the menu button', () => {
  it('comes before the links it reveals, so Tab reaches them next', async () => {
    ingestStatus.mockResolvedValue(status())
    show()
    const toggle = screen.getByRole('button', { name: /^Menu/ })
    const firstLink = within(screen.getByRole('navigation')).getAllByRole('link')[0]
    expect(toggle.compareDocumentPosition(firstLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('returns focus to itself when Escape closes the panel', async () => {
    const userEvent = (await import('@testing-library/user-event')).default
    ingestStatus.mockResolvedValue(status())
    show()
    const toggle = screen.getByRole('button', { name: /^Menu/ })
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const link = within(screen.getByRole('navigation')).getByRole('link', { name: /^Trends/ })
    link.focus()
    await userEvent.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })
})
