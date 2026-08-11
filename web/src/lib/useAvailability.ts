// Which metrics have any data at all?
//
// The catalog knows ~100 types, of which a new user will have data for five or
// six. A hundred-item list full of "–" is useless, so every picker asks this hook
// and pushes the types that do have data to the front.
//
// The probe asks for a single year-long window (monthly buckets), so it is cheap,
// and the server caches it in Redis as well. The wire names go out in chunks: a
// hundred names in one query string is ~2.5 kB, which needlessly approaches the
// usual proxy limits.

import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { api, browserTz } from '../api/client'
import { ALL_WIRE_NAMES, METRIC_LIST } from './metrics'

const CHUNK = 40

function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

const CHUNKS = chunked(ALL_WIRE_NAMES, CHUNK)

export type Availability = {
  /** Is there any data for this catalog key (aliases included)? */
  has: (key: string) => boolean
  /** How many catalog metrics have data. */
  count: number
  /** Has the probe finished? Until it has, hide nothing. */
  known: boolean
  isLoading: boolean
}

export function useAvailability(): Availability {
  const tz = browserTz()

  const results = useQueries({
    queries: CHUNKS.map((names, i) => ({
      queryKey: ['availability', tz, i],
      queryFn: () => api.summary('year', names, tz),
      staleTime: 5 * 60_000,
    })),
  })

  const done = results.every((r) => r.isSuccess)
  const isLoading = results.some((r) => r.isLoading)
  // The data array's reference is new on every render, so the memo key is built
  // from the number of successful responses and the loading state.
  const merged = results.map((r) => (r.isSuccess ? r.data : undefined))
  const signature = results.map((r) => `${r.status}@${r.dataUpdatedAt}`).join(',')

  const set = useMemo(() => {
    const s = new Set<string>()
    for (const resp of merged) {
      const m = resp?.metrics
      if (!m) continue
      for (const def of METRIC_LIST) {
        if (s.has(def.key)) continue
        const found = [def.key, ...def.aliases].some((n) =>
          m[n]?.buckets?.some((b) => b.v != null || b.avg != null),
        )
        if (found) s.add(def.key)
      }
    }
    return s
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  return {
    has: (key: string) => set.has(key),
    count: set.size,
    known: done,
    isLoading,
  }
}
