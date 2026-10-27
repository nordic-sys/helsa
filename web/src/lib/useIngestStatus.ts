// The ingest snapshot, shared by every screen that summarises it.
//
// One query key for the sidebar badge, the Today page and the queue page itself,
// so they read the same reading at the same moment. React Query polls at the
// SHORTEST interval any mounted observer asks for: the queue page asks every 5
// seconds, the badge every 30 — so the badge is as fresh as the page while the
// page is open, and cheap everywhere else.

import { useQuery } from '@tanstack/react-query'
import { api } from '../api/client'

export const INGEST_STATUS_KEY = ['ingest-status'] as const

export function useIngestStatus(pollMs: number) {
  return useQuery({
    queryKey: INGEST_STATUS_KEY,
    queryFn: () => api.ingestStatus(),
    refetchInterval: pollMs,
    // A 404 is version skew and will not fix itself on retry; anything else gets
    // the app's default retry policy.
    retry: (count, err) => {
      const status = (err as { status?: number })?.status
      if (status === 404 || status === 401 || status === 403) return false
      return count < 2
    },
  })
}
