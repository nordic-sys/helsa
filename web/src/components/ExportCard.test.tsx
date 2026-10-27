// The export button: what it asks the server for, what it saves, and what it
// refuses to claim.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExportOptions, ExportRequest, ExportedFile } from '../api/client'
import { I18nProvider } from '../i18n'
import { exportWindow } from '../lib/exportFile'
import { ExportCard } from './ExportCard'

const calls: ExportRequest[] = []
let answer: (opts: ExportOptions) => Promise<ExportedFile>

vi.mock('../api/client', () => {
  class ApiError extends Error {
    status: number
    detail?: string
    constructor(status: number, title: string, detail?: string) {
      super(title)
      this.status = status
      this.detail = detail
    }
  }
  return {
    ApiError,
    api: {
      exportFile: (body: ExportRequest, opts: ExportOptions) => {
        calls.push(body)
        return answer(opts)
      },
      // The metric list probes availability; give it one metric with data.
      summary: () =>
        Promise.resolve({ metrics: { stepCount: { agg: 'sum', buckets: [{ t: '2026-01-01T00:00:00Z', v: 5 }] } } }),
    },
    browserTz: () => 'Europe/Budapest',
  }
})

const csvFile = (): ExportedFile => ({
  blob: new Blob(['ts,data_type,value,unit,source_device\n']),
  disposition: 'attachment; filename="helsa-export-20260928_20261027.csv"',
  bytes: 38,
})

function show(save = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <ExportCard save={save} />
      </I18nProvider>
    </QueryClientProvider>,
  )
  return save
}

beforeEach(() => {
  calls.length = 0
  answer = () => Promise.resolve(csvFile())
})

describe('the export card', () => {
  it('asks for the last 30 days, as CSV, of every metric — and offers no PDF', async () => {
    const save = show()
    expect(screen.queryByRole('button', { name: /pdf/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /download from the server/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(calls[0]).toEqual({ format: 'csv', ...exportWindow(30, new Date()) })
    expect(calls[0].metrics).toBeUndefined()
  })

  it('saves under the name the server gave, and says how big it was', async () => {
    const save = show()
    await userEvent.click(screen.getByRole('button', { name: /download from the server/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1]).toBe('helsa-export-20260928_20261027.csv')
    expect(await screen.findByText(/handed to the browser: helsa-export-20260928_20261027\.csv \(38 B\)/i)).toBeInTheDocument()
  })

  it('reports bytes as they arrive, with no invented percentage', async () => {
    let finish!: () => void
    answer = (opts) =>
      new Promise((resolve) => {
        opts.onProgress?.(2_500_000)
        finish = () => resolve(csvFile())
      })
    show()
    await userEvent.click(screen.getByRole('button', { name: /download from the server/i }))
    expect(await screen.findByText(/arriving: 2\.5 MB so far/i)).toBeInTheDocument()
    expect(screen.getByText(/no percentage/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download from the server/i })).toBeDisabled()
    finish()
    await screen.findByText(/handed to the browser/i)
  })

  it('refuses to save a JSON file that arrived cut off', async () => {
    answer = () =>
      Promise.resolve({ blob: new Blob(['{"meta":{},"samples":[{"a":']), disposition: null, bytes: 27 })
    const save = show()
    await userEvent.click(screen.getByRole('button', { name: 'JSON' }))
    await userEvent.click(screen.getByRole('button', { name: /download from the server/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/arrived cut off/i)
    expect(save).not.toHaveBeenCalled()
    expect(calls[0].format).toBe('json')
  })

  it("names the server's own reason when it refuses", async () => {
    const { ApiError } = await import('../api/client')
    answer = () => Promise.reject(new ApiError(400, 'Invalid export request', '`to` must be later than `from`'))
    show()
    await userEvent.click(screen.getByRole('button', { name: /download from the server/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The export failed: Invalid export request — `to` must be later than `from`',
    )
  })

  it('sends a hand-picked range, and will not send a reversed one', async () => {
    show()
    await userEvent.click(screen.getByRole('button', { name: /choose dates/i }))
    const from = screen.getByLabelText(/^from/i)
    const to = screen.getByLabelText(/^to/i)
    await userEvent.clear(from)
    await userEvent.type(from, '2026-02-01')
    await userEvent.clear(to)
    await userEvent.type(to, '2026-01-31')
    expect(screen.getByText(/cannot be later than the last/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /download from the server/i })).toBeDisabled()

    await userEvent.clear(to)
    await userEvent.type(to, '2026-02-28')
    await userEvent.click(screen.getByRole('button', { name: /download from the server/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })

  it('narrows to ticked metrics, sending every wire name they arrive under', async () => {
    show()
    await userEvent.click(screen.getByRole('radio', { name: /only the ones i tick/i }))
    // Nothing ticked yet: nothing to send.
    expect(screen.getByRole('button', { name: /download from the server/i })).toBeDisabled()
    await userEvent.click(await screen.findByRole('checkbox', { name: /steps/i }))
    await userEvent.click(screen.getByRole('button', { name: /download from the server/i }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].metrics).toContain('stepCount')
  })
})
