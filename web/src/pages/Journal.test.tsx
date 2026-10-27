// Journal and events — the three nothings kept apart (a server too old, a
// phone that never sent, a period with no note), and what the page shows when
// the journal is there.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { en } from '../i18n/en'
import Journal from './Journal'

let answer: 'never' | 'old' | object = 'never'
const calls: string[][] = []
let deletes = 0

vi.mock('../api/client', () => ({
  api: {
    journal: (from: string, to: string, tz?: string) => {
      calls.push([from, to, tz ?? ''])
      if (answer === 'old') return Promise.reject(Object.assign(new Error('Not Found'), { status: 404 }))
      if (answer === 'never') return Promise.resolve({ tz: 'Europe/Budapest', from, to, entries: [], total: 0 })
      return Promise.resolve({ tz: 'Europe/Budapest', from, to, ...answer })
    },
    deleteJournal: () => {
      deletes += 1
      return Promise.resolve({ deleted: 4 })
    },
  },
  browserTz: () => 'Europe/Budapest',
}))

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={['/journal']}>
          <Journal />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const at = '2026-10-22T10:00:00Z'
const JOURNAL = {
  total: 6,
  last_received_at: '2026-10-27T06:00:00Z',
  entries: [
    { source_uuid: 'a', data_type: 'fever', started_at: '2026-10-20T08:00:00Z', ended_at: '2026-10-20T08:00:00Z', value: 3 },
    { source_uuid: 'b', data_type: 'coughing', started_at: '2026-10-21T08:00:00Z', ended_at: '2026-10-21T08:00:00Z', value: 2 },
    { source_uuid: 'c', data_type: 'stateOfMind', started_at: '2026-10-21T19:00:00Z', ended_at: '2026-10-21T19:00:00Z', valence: 0.5, associations: ['family'] },
    { source_uuid: 'd', data_type: 'irregularHeartRhythmEvent', started_at: at, ended_at: at, value: 0 },
    { source_uuid: 'e', data_type: 'dizziness', started_at: at, ended_at: at, value: 3, event_key: `irregularRhythm:${Date.parse(at) / 1000}` },
    { source_uuid: 'f', data_type: 'environmentalAudioExposureEvent', started_at: '2026-10-23T18:00:00Z', ended_at: '2026-10-23T18:05:00Z', value: 0, audio_level_dbaspl: 92 },
  ],
}

beforeEach(() => {
  localStorage.setItem('helsa.lang', 'en')
  answer = 'never'
  calls.length = 0
  deletes = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 27, 9, 12))
})
afterEach(() => {
  vi.useRealTimers()
})

describe('the journal page', () => {
  it('asks for the last 90 days in the reader’s zone', async () => {
    show()
    await screen.findByTestId('journal-never')
    expect(calls[0]).toEqual(['2026-07-30', '2026-10-27', 'Europe/Budapest'])
  })

  it('says where the switch is when the phone never sent a journal — not "nothing noted"', async () => {
    show()
    expect(await screen.findByTestId('journal-never')).toHaveTextContent(en.ui['journal.never.body'])
    expect(screen.queryByTestId('journal-coverage')).toBeNull()
  })

  it('calls a 404 an older server', async () => {
    answer = 'old'
    show()
    expect(await screen.findByText(en.ui['ingest.apiOld.title'])).toBeInTheDocument()
  })

  it('a period with no note says that is not nothing happening', async () => {
    answer = { total: 3, last_received_at: '2026-10-27T06:00:00Z', entries: [] }
    show()
    expect(await screen.findByTestId('journal-coverage')).toHaveTextContent(en.ui['journal.emptyWindow'])
  })

  it('shows the coverage, the episode, the events with their markings and the days', async () => {
    answer = JOURNAL
    show()
    expect(await screen.findByTestId('journal-coverage')).toHaveTextContent('Noted on 3 of 90 days')
    const eps = screen.getByTestId('journal-episodes')
    // The dizziness marked on the event is a journal symptom too (the phone's
    // `ContextHistory` reads every symptom sample), so it extends the episode.
    expect(eps).toHaveTextContent('3 days')
    expect(eps).toHaveTextContent('Fever, Dizziness, Cough')
    const events = screen.getByTestId('journal-events')
    expect(events).toHaveTextContent('Irregular heart rhythm')
    expect(events).toHaveTextContent('Noted: Dizziness (moderate)')
    expect(events).toHaveTextContent('Loud environment')
    expect(events).toHaveTextContent('92 dB')
    const days = screen.getByTestId('journal-days')
    expect(within(days).getByText('Good · Family')).toBeInTheDocument()
    expect(screen.getByTestId('journal-moods').children).toHaveLength(90)
  })

  it('deletes the server’s copy only after a confirmation', async () => {
    answer = JOURNAL
    vi.useRealTimers()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    show()
    const button = await screen.findByRole('button', { name: en.ui['journal.delete.button'] })
    await userEvent.click(button)
    expect(deletes).toBe(0)
    await userEvent.click(button)
    expect(await screen.findByText('4 entries deleted.')).toBeInTheDocument()
    expect(deletes).toBe(1)
    confirm.mockRestore()
  })
})
