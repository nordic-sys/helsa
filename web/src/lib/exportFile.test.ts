// The export's pure decisions: which days, what file name, and whether the file
// arrived whole.

import { describe, expect, it } from 'vitest'
import {
  exportWindow,
  fallbackFilename,
  filenameFrom,
  formatBytes,
  jsonLooksComplete,
  rangeValid,
} from './exportFile'

describe('the window (LocalExportBuilder.window)', () => {
  it('ends on today, included, and counts today as one of the days', () => {
    expect(exportWindow(30, new Date(2026, 9, 27, 15, 0))).toEqual({ from: '2026-09-28', to: '2026-10-27' })
    expect(exportWindow(1, new Date(2026, 9, 27))).toEqual({ from: '2026-10-27', to: '2026-10-27' })
  })

  it('counts calendar days across a DST change, not 24-hour blocks', () => {
    // Europe moves its clocks on the last Sunday of October (2026-10-25).
    expect(exportWindow(7, new Date(2026, 9, 28, 0, 30))).toEqual({ from: '2026-10-22', to: '2026-10-28' })
  })

  it('treats a non-positive day count as one day, as the phone does', () => {
    expect(exportWindow(0, new Date(2026, 9, 27))).toEqual({ from: '2026-10-27', to: '2026-10-27' })
  })
})

describe('a hand-picked range', () => {
  it('needs both days, in order — the same day twice is one day', () => {
    expect(rangeValid('2026-01-01', '2026-01-31')).toBe(true)
    expect(rangeValid('2026-01-31', '2026-01-31')).toBe(true)
    expect(rangeValid('2026-02-01', '2026-01-31')).toBe(false)
    expect(rangeValid('', '2026-01-31')).toBe(false)
  })
})

describe('the file name', () => {
  it("reads the server's quoted name", () => {
    expect(filenameFrom('attachment; filename="helsa-export-20260801_20260810.csv"')).toBe(
      'helsa-export-20260801_20260810.csv',
    )
  })

  it('prefers the RFC 6266 form when it is there', () => {
    expect(filenameFrom(`attachment; filename="x.csv"; filename*=UTF-8''helsa%20%C3%A9v.csv`)).toBe('helsa év.csv')
  })

  it('reads an unquoted name too', () => {
    expect(filenameFrom('attachment; filename=export.json')).toBe('export.json')
  })

  it('never lets a name be a path', () => {
    expect(filenameFrom('attachment; filename="../../etc/passwd"')).toBe('passwd')
    expect(filenameFrom('attachment; filename="..\\\\evil.csv"')).toBe('evil.csv')
  })

  it('says nothing when there is no header, and the fallback copies the server', () => {
    expect(filenameFrom(null)).toBeNull()
    expect(filenameFrom('attachment')).toBeNull()
    expect(fallbackFilename('json', '2026-08-01', '2026-08-10')).toBe('helsa-export-20260801_20260810.json')
  })
})

describe('whether a JSON export arrived whole', () => {
  it('accepts a body that closes on the writer’s own "]}"', async () => {
    const whole = '{"meta":{},"samples":[{"a":1}\n],"workouts":[],"sleep_segments":[]}'
    expect(await jsonLooksComplete(new Blob([whole]))).toBe(true)
  })

  it('rejects one cut off mid-stream, even though the status was 200', async () => {
    expect(await jsonLooksComplete(new Blob(['{"meta":{},"samples":[{"a":1}\n,{"a":']))).toBe(false)
    expect(await jsonLooksComplete(new Blob(['']))).toBe(false)
  })
})

describe('sizes', () => {
  it('prints what a file manager prints', () => {
    expect(formatBytes(512, 'en-GB')).toBe('512 B')
    expect(formatBytes(1_500, 'en-GB')).toBe('1.5 kB')
    expect(formatBytes(12_400_000, 'en-GB')).toBe('12 MB')
    expect(formatBytes(1_500, 'hu-HU')).toBe('1,5 kB')
  })
})
