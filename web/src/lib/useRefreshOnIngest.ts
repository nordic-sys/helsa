// Health data refreshes itself while the worker writes.
//
// ⚠️ The sync queue page could show a drain advancing while every health card
// beside it kept the numbers it loaded half an hour earlier: nothing polls the
// summaries (the data changes a few times a day), focus refetching is off
// (main.tsx), and `staleTime` only marks data stale — it never fetches by
// itself. So the cards claimed a state of the database the queue page already
// showed to be out of date.
//
// The one signal that the database changed is the worker's own count of written
// batches. When it advances, every query except the queue snapshot itself is
// invalidated — the ones on screen refetch, the rest refetch when next shown.
// At most once per `REFRESH_MIN_MS`: a forty-minute drain must not reload every
// chart every five seconds. A change seen inside that interval is remembered and
// applied on the first reading after it, so the last batches of a drain are not
// lost to the throttle.

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { IngestStatus } from '../api/types'
import { INGEST_STATUS_KEY } from './useIngestStatus'

/** The shortest gap between two refreshes caused by ingest progress. */
export const REFRESH_MIN_MS = 60_000

/** What identifies "how much the worker has written": restarts reset the count. */
export function progressMark(s: IngestStatus | undefined): string | null {
  const w = s?.worker
  if (!s?.stats_reachable || !w || w.batches_since_start == null) return null
  return `${w.started_at ?? ''}#${w.batches_since_start}`
}

export function useRefreshOnIngest(status: IngestStatus | undefined, now: () => number = Date.now) {
  const qc = useQueryClient()
  const lastMark = useRef<string | null>(null)
  const pending = useRef(false)
  const lastRefresh = useRef(0)

  useEffect(() => {
    const mark = progressMark(status)
    if (mark == null) return
    if (lastMark.current != null && mark !== lastMark.current) pending.current = true
    lastMark.current = mark
    if (pending.current && now() - lastRefresh.current >= REFRESH_MIN_MS) {
      pending.current = false
      lastRefresh.current = now()
      void qc.invalidateQueries({
        predicate: (q) => q.queryKey[0] !== INGEST_STATUS_KEY[0],
      })
    }
  }, [status, qc, now])
}
