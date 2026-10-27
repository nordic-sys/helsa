import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { IngestStatus } from '../api/types'
import { REFRESH_MIN_MS, useRefreshOnIngest } from './useRefreshOnIngest'

const status = (batches: number): IngestStatus => ({
  checked_at: '2026-10-27T12:00:00Z',
  broker_reachable: true,
  stats_reachable: true,
  worker: { started_at: '2026-10-27T11:00:00Z', batches_since_start: batches },
})

function setup() {
  const client = new QueryClient()
  const spy = vi.spyOn(client, 'invalidateQueries')
  let now = 1_000_000
  const clock = () => now
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(({ s }: { s: IngestStatus | undefined }) => useRefreshOnIngest(s, clock), {
    wrapper,
    initialProps: { s: status(10) },
  })
  return { spy, hook, advance: (ms: number) => (now += ms) }
}

describe('health data while the worker writes', () => {
  it('is refreshed when the written count advances — but not the queue snapshot itself', () => {
    const { spy, hook } = setup()
    expect(spy).not.toHaveBeenCalled() // the first reading is a baseline, not progress
    hook.rerender({ s: status(12) })
    expect(spy).toHaveBeenCalledTimes(1)
    const { predicate } = spy.mock.calls[0][0] as unknown as { predicate: (q: { queryKey: unknown[] }) => boolean }
    expect(predicate({ queryKey: ['summary', 'day'] })).toBe(true)
    expect(predicate({ queryKey: ['ingest-status'] })).toBe(false)
  })

  it('is not refreshed when nothing was written', () => {
    const { spy, hook } = setup()
    hook.rerender({ s: status(10) })
    expect(spy).not.toHaveBeenCalled()
  })

  it('refreshes at most once a minute, and does not lose the progress it held back', () => {
    const { spy, hook, advance } = setup()
    hook.rerender({ s: status(11) })
    expect(spy).toHaveBeenCalledTimes(1)
    advance(10_000)
    hook.rerender({ s: status(12) })
    expect(spy).toHaveBeenCalledTimes(1) // throttled
    advance(REFRESH_MIN_MS)
    hook.rerender({ s: { ...status(12), checked_at: '2026-10-27T12:01:10Z' } })
    expect(spy).toHaveBeenCalledTimes(2) // the held-back change, applied
  })
})
