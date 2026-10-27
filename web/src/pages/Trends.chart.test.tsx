// The chart itself, drawn.
//
// jsdom gives `ResponsiveContainer` no size, so recharts normally draws nothing
// (see Trends.test.tsx). Here the container is replaced by one with a fixed
// size, which is enough for recharts to lay out real SVG — and so for a test to
// see whether a line bridges a day nobody measured.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { cloneElement, type ReactElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SummaryResponse } from '../api/types'
import { I18nProvider } from '../i18n'

vi.mock('recharts', async (importOriginal) => {
  const mod = await importOriginal<typeof import('recharts')>()
  return {
    ...mod,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) => (
      <div style={{ width: 800, height: 300 }}>{cloneElement(children, { width: 800, height: 300 })}</div>
    ),
  }
})

/** Resting heart rate on Sep 4, 5, 7, 8 and 10: gaps on the 6th and the 9th,
 * and the 10th measured with no measured neighbour. */
const MEASURED = ['2026-09-04', '2026-09-05', '2026-09-07', '2026-09-08', '2026-09-10']

function summary(from?: string, to?: string): SummaryResponse {
  const buckets = from === '2026-09-04'
    ? MEASURED.map((d, i) => ({ t: new Date(`${d}T00:00:00`).toISOString(), avg: 50 + i, min: 45, max: 60 }))
    : []
  return { from, to, metrics: { restingHeartRate: { agg: 'avg', unit: 'count/min', buckets, total: 52 } } }
}

vi.mock('../api/client', () => ({
  api: {
    summary: (_r: string, _m: string[], _tz?: string, from?: string, to?: string) => Promise.resolve(summary(from, to)),
    baseline: () => Promise.resolve({ min_days: 14, metrics: {} }),
  },
  browserTz: () => 'Europe/Budapest',
}))

const { default: Trends } = await import('./Trends')

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
  localStorage.setItem('helsa.lang', 'en')
})
afterEach(() => vi.useRealTimers())

it('breaks the line at a day nobody measured, and dots a measured day with no neighbour', async () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/trends?metric=restingHeartRate']}>
          <Trends />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(container.querySelector('.recharts-line-curve')).not.toBeNull())
  const d = container.querySelector('.recharts-line-curve')!.getAttribute('d') ?? ''
  // Three runs — 4–5, 7–8 and the lone 10th (a zero-length segment) — so three
  // "move to" commands. With `connectNulls` it was a single unbroken path.
  expect(d.match(/M/g)?.length).toBe(3)
  // The 10th stands alone, so it is a dot rather than an invisible zero-length line.
  expect(screen.getAllByTestId('isolated-point')).toHaveLength(1)
})

it('keyboard-walks the buckets, and writes tooltip values in the text colour, not the chart fill', async () => {
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/trends?metric=restingHeartRate']}>
          <Trends />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(container.querySelector('.recharts-line-curve')).not.toBeNull())
  // Recharts' accessibility layer: the surface takes focus, and arrows move the tooltip.
  const wrapper = container.querySelector('.recharts-wrapper') as HTMLElement
  const surface = container.querySelector('svg.recharts-surface') as SVGElement
  expect(surface.getAttribute('tabindex')).toBe('0')
  surface.focus()
  fireEvent.keyDown(wrapper, { key: 'ArrowRight' })
  fireEvent.keyDown(surface, { key: 'ArrowRight' })
  await waitFor(() => expect(container.querySelector('.recharts-tooltip-item')).not.toBeNull())
  const item = container.querySelector('.recharts-tooltip-item') as HTMLElement
  expect(item.style.color).toBe('var(--text)')
})
