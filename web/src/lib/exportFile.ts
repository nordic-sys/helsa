// The pure half of the export button (`components/ExportCard.tsx`): which days
// to ask for, what to call the file, and whether what arrived is whole.
//
// Kept apart from the card so every one of these decisions is testable without
// a DOM, the same split the rest of `lib/` keeps.

import { isoDay } from './window'

/** The phone's period choices (`ExportView.dayOptions`): 30 days, 90, a year. */
export const EXPORT_DAY_OPTIONS = [30, 90, 365] as const

/**
 * `days` back, up to and including today, as calendar days — the phone's
 * `LocalExportBuilder.window(days:now:timeZone:)` (`App/LocalExport.swift`).
 *
 * ⚠️ Today is the LAST day, not the end: the contract's `to` is inclusive, so
 * "30 days" is today and the 29 before it. Built from local midnights, not by
 * subtracting milliseconds, so a DST change inside the window cannot move a day.
 */
export function exportWindow(days: number, now: Date): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (Math.max(days, 1) - 1))
  return { from: isoDay(start), to: isoDay(today) }
}

/** Whether a hand-picked range can be sent: both days present, in order. The
 * server would answer 400 for a reversed one; saying so before is kinder. */
export function rangeValid(from: string, to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to
}

/**
 * The file name out of `Content-Disposition`.
 *
 * The server sends `attachment; filename="helsa-export-20260801_20260810.csv"`
 * (Go's `%q`). `filename*=UTF-8''…` (RFC 6266) is read first if it is ever
 * there. ⚠️ Anything with a path separator is reduced to its last part: a name
 * is a name, never a path, whoever sent it.
 */
export function filenameFrom(disposition: string | null | undefined): string | null {
  if (!disposition) return null
  const star = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(disposition)
  let name: string | null = null
  if (star) {
    try {
      name = decodeURIComponent(star[2].trim())
    } catch {
      name = null
    }
  }
  if (!name) {
    const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(disposition)
    const bare = /filename\s*=\s*([^;]+)/i.exec(disposition)
    name = quoted ? quoted[1].replace(/\\(.)/g, '$1') : bare ? bare[1].trim() : null
  }
  if (!name) return null
  const last = name.split(/[\\/]/).pop()?.trim() ?? ''
  return last || null
}

/** What to call the file when the header did not say — the server's own pattern. */
export function fallbackFilename(format: 'csv' | 'json', from: string, to: string): string {
  return `helsa-export-${from.replace(/-/g, '')}_${to.replace(/-/g, '')}.${format}`
}

/**
 * Whether a JSON export arrived whole.
 *
 * ⚠️ The server streams, so an export that fails half-way still went out as a
 * 200 — the status was sent before the first row (`server/export.go`). The JSON
 * writer closes with `]}` (`export.writeJSON`), so a body that does not end on
 * it was cut off. Only the tail is read: the file can be hundreds of megabytes,
 * and parsing it to find out would hold it in memory twice.
 *
 * A CSV has no such closing mark — a CSV that stops after any row is a valid
 * CSV — so nothing is claimed about one, and the card says so.
 */
export async function jsonLooksComplete(blob: Blob): Promise<boolean> {
  const tail = await blobText(blob.slice(Math.max(0, blob.size - 64)))
  return /\]\s*\}\s*$/.test(tail)
}

/** `Blob.text()` where it exists; a FileReader where it does not (jsdom). */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result ?? ''))
    r.onerror = () => reject(r.error)
    r.readAsText(blob)
  })
}

/** "12.4 MB" — base-1000 units, the ones a file manager shows. */
export function formatBytes(bytes: number, locale: string): string {
  const units = ['B', 'kB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i += 1
  }
  const digits = i === 0 ? 0 : v < 10 ? 1 : 0
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v)} ${units[i]}`
}
