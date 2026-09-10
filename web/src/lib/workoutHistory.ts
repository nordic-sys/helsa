// Walking `/workouts` — the one place that does it, for both pages that need it.
//
// # Why a shared hook rather than a copy
//
// The list walks the history because a filter over a truncated list does not
// show less, it ANSWERS WRONGLY. The detail page walks it for a different
// reason: to find out whether the session it is showing was recorded more than
// once, which is a question about the session's neighbours and cannot be
// answered from `/workouts/{id}` alone.
//
// Both reach for the same endpoint with the same cursor, so both use the same
// react-query key. That is not tidiness — it is what makes opening a row cost
// nothing: the pages the list already walked are in the cache, and the detail
// page finds its neighbours without a single request.
//
// ⚠️ What the two do NOT share is when to stop. The list wants everything; the
// detail page wants only as far back as the session it is showing. `stopBefore`
// is that difference, and it is the whole reason this file takes an option.

import { useEffect, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import type { Workout } from '../api/types'
import { startMs } from './workouts'

/** 200 is the contract's maximum (`openapi.yaml`), and the walk is a walk:
 * fewer, larger pages is fewer round trips over WireGuard. */
export const PAGE_SIZE = 200

/**
 * The ceiling on how many pages the walk will take.
 *
 * ⚠️ Not a performance knob: it is the guard against a cursor that never
 * terminates, which on a page somebody is looking at is an infinite loop. When
 * it stops here, the caller has to SAY the history is cut off rather than
 * present a partial list as the whole thing.
 */
export const MAX_PAGES = 20

export type WorkoutHistory = {
  /** Every recording loaded so far, de-duplicated by id. */
  items: Workout[]
  isLoading: boolean
  isError: boolean
  error: unknown
  /** The walk stopped at `MAX_PAGES` with more still to come. */
  capped: boolean
  /** More is on its way — the caller should say so rather than look finished. */
  stillLoading: boolean
  /** Everything the walk was asked for has arrived. */
  complete: boolean
}

/**
 * @param stopBefore Stop once a page has reached back past this instant (ms).
 *   Absent = walk the whole history.
 */
export function useWorkoutHistory(stopBefore?: number): WorkoutHistory {
  const q = useInfiniteQuery({
    queryKey: ['workouts'],
    queryFn: ({ pageParam }) => api.workouts(PAGE_SIZE, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })

  /** ⚠️ De-duplicated by id rather than concatenated. A stale cursor answering
   * with the first page again would otherwise grow the list for ever, and the
   * repeated rows would read as repeated workouts. */
  const items = useMemo(() => {
    const seen = new Set<string>()
    const all: Workout[] = []
    for (const page of q.data?.pages ?? []) {
      for (const w of page.items ?? []) {
        const key = w.id ?? w.source_uuid ?? ''
        if (key && seen.has(key)) continue
        if (key) seen.add(key)
        all.push(w)
      }
    }
    return all
  }, [q.data])

  const pages = q.data?.pages.length ?? 0
  const capped = pages >= MAX_PAGES

  /**
   * Whether the walk has already reached past the instant the caller cares
   * about.
   *
   * ⚠️ The oldest item of the LOADED pages, not the newest: the list comes back
   * newest first, so it is the tail that says how far back we have got.
   */
  const reachedBack = useMemo(() => {
    if (stopBefore == null) return false
    let oldest = Infinity
    for (const w of items) {
      const ms = startMs(w)
      if (!Number.isNaN(ms)) oldest = Math.min(oldest, ms)
    }
    return oldest <= stopBefore
  }, [items, stopBefore])

  const wants = q.hasNextPage && !capped && !reachedBack

  // The walk runs itself rather than waiting for a click. On the list because a
  // filter over half a history is wrong rather than short; here because a
  // duplicate nobody paged far enough to see is a duplicate the page silently
  // denies.
  useEffect(() => {
    if (wants && !q.isFetchingNextPage) void q.fetchNextPage()
  }, [q, wants])

  return {
    items,
    isLoading: q.isLoading,
    isError: q.isError,
    error: q.error,
    capped: capped && (q.hasNextPage ?? false),
    stillLoading: q.isFetchingNextPage || wants,
    complete: !q.isLoading && !q.isFetchingNextPage && !wants,
  }
}
