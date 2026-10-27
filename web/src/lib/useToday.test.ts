import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TODAY_TICK_MS, useToday } from './useToday'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 27, 23, 59, 30))
})
afterEach(() => vi.useRealTimers())

it('rolls over to the new day by itself, without a reload', () => {
  const { result } = renderHook(() => useToday())
  expect(result.current).toBe('2026-10-27')
  act(() => {
    vi.advanceTimersByTime(TODAY_TICK_MS)
  })
  expect(result.current).toBe('2026-10-28')
})
