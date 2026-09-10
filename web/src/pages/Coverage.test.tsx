import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CoverageResponse } from '../api/types'
import { I18nProvider } from '../i18n'
import Coverage from './Coverage'

const coverage = vi.fn<() => Promise<CoverageResponse>>()

vi.mock('../api/client', () => ({
  api: { coverage: () => coverage() },
  browserTz: () => 'Europe/Budapest',
}))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <Coverage />
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const report: CoverageResponse = {
  from: '2025-09-11',
  to: '2026-09-10',
  tz: 'Europe/Budapest',
  days: 365,
  types: [
    {
      data_type: 'stepCount',
      group: 'activity',
      in_catalog: true,
      state: 'measured',
      measured_days: 364,
      sample_count: 23090,
      last_day: '2026-09-10',
      sources: [{ bundle_id: 'com.nordic-sys.Helsa', device: 'iphone', sample_count: 23090 }],
    },
    {
      // Nothing in the window, but it used to arrive.
      data_type: 'bodyMass',
      group: 'body',
      in_catalog: true,
      state: 'outside_window',
      last_day: '2025-11-03',
    },
    {
      // Never got here — no counts, no dates.
      data_type: 'vo2Max',
      group: 'heart',
      in_catalog: true,
      state: 'never_arrived',
    },
  ],
}

beforeEach(() => {
  coverage.mockReset()
  coverage.mockResolvedValue(report)
})

/**
 * ⛔ **The rule this page exists to defend: a missing measurement is not a zero.**
 *
 * The server leaves the field out rather than sending 0, and the page must not
 * fill it back in on the last metre. "0 days measured" claims we looked at every
 * day of the year and found nothing; an absent count says there is nothing to
 * report. On a health screen the first is read in half a second as a statement
 * about the person.
 */
describe('a row without data never shows a zero', () => {
  it('prints a dash where nothing arrived', async () => {
    show()
    const row = await screen.findByRole('row', { name: /vo2max|VO₂/i })
    expect(within(row).queryByText('0')).not.toBeInTheDocument()
    expect(within(row).getAllByText('–').length).toBeGreaterThanOrEqual(3)
  })

  it('a type that stopped before the window keeps its last date but reports no count', async () => {
    show()
    const row = await screen.findByRole('row', { name: /body mass|testtömeg|weight/i })
    expect(within(row).queryByText('0')).not.toBeInTheDocument()
    expect(row.textContent).toMatch(/2025/)
  })
})

/**
 * ⛔ No scores, grades or verdicts. "2 of 3 types brought data" is a fact; "your
 * data quality is 67%" is a score, and a score invites you to improve a number
 * rather than to look at the row that went quiet.
 */
describe('the page states facts, not grades', () => {
  it('has no percentage anywhere', async () => {
    const { container } = show()
    await screen.findByText(/stepCount|Steps|Lépés/i)
    expect(container.textContent).not.toMatch(/\d+\s*%/)
  })

  it('counts the examined types rather than a hard-coded catalogue size', async () => {
    show()
    // One of the three brought data in the window.
    expect(await screen.findByText(/\b1\b.*\b3\b|\b3\b.*\b1\b/)).toBeInTheDocument()
  })
})

/**
 * The honesty note is not decoration. The page answers a narrower question than
 * the app's screen, and saying so IS the feature — a completeness page that
 * quietly implied it knew about permissions would mislead about the one thing it
 * is for.
 */
describe('the limits of what the server can say', () => {
  it('always states them, data or no data', async () => {
    show()
    const note = await screen.findByText(/what this page can and cannot tell you/i)
    expect(note).toBeInTheDocument()
  })

  it('does not use the phone’s permission words for the server’s absence', async () => {
    const { container } = show()
    await screen.findByText(/stepCount|Steps|Lépés/i)
    // "refused" and "will still ask" are claims only the phone can make.
    expect(container.textContent).not.toMatch(/refused|still ask about this group/i)
  })
})

describe('provenance', () => {
  it('names the writing app', async () => {
    show()
    expect(await screen.findByText('com.nordic-sys.Helsa')).toBeInTheDocument()
  })

  it('says the device was not stated rather than calling it the phone', async () => {
    coverage.mockResolvedValue({
      ...report,
      types: [
        {
          data_type: 'heartRate',
          group: 'heart',
          in_catalog: true,
          state: 'measured',
          measured_days: 3,
          sample_count: 9,
          last_day: '2026-09-10',
          sources: [{ bundle_id: 'com.example.strap', sample_count: 9 }],
        },
      ],
    })
    show()
    expect(await screen.findByText(/device not stated/i)).toBeInTheDocument()
  })
})

describe('an empty server', () => {
  it('says nothing has arrived instead of drawing a hundred zero rows', async () => {
    coverage.mockResolvedValue({ from: '2025-09-11', to: '2026-09-10', days: 365, types: [] })
    const { container } = show()
    expect(await screen.findByText(/nothing has arrived yet/i)).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\b0\b/)
  })
})
