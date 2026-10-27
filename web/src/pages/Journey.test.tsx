import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'

const mockSettings = vi.fn()
const mockSummary = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    settings: (...args: unknown[]) => mockSettings(...args),
    summary: (...args: unknown[]) => mockSummary(...args),
  },
  browserTz: () => 'UTC',
  getToken: () => null,
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

const { default: JourneyPage } = await import('./Journey')

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <I18nProvider>
          <JourneyPage />
        </I18nProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockSettings.mockReset()
  mockSummary.mockReset()
})

// English, as in the other page tests: jsdom reports en-US and there is no
// stored choice.
describe('the virtual journey page', () => {
  /** An older phone or server: not "no journey" — we do not know. */
  it('says the phone has not sent its journey, rather than that there is none', async () => {
    mockSettings.mockResolvedValue({ time_zone: 'UTC' })
    show()
    expect(await screen.findByText(/Your phone has not sent its journey yet/)).toBeInTheDocument()
    expect(mockSummary).not.toHaveBeenCalled()
  })

  it('says no journey is running when the phone said so', async () => {
    mockSettings.mockResolvedValue({ journey: { updated_at: '2026-10-27T09:00:00Z' } })
    show()
    expect(await screen.findByText(/No virtual journey is running on your phone/)).toBeInTheDocument()
  })

  /** A newer app than dashboard: name the id, draw nothing rather than something wrong. */
  it('names a route it does not know instead of drawing one', async () => {
    mockSettings.mockResolvedValue({ journey: { route_id: 'a-route-from-the-future', started_on: '2026-08-01' } })
    show()
    expect(await screen.findByText(/a-route-from-the-future/)).toBeInTheDocument()
    expect(mockSummary).not.toHaveBeenCalled()
  })

  it('shows the progress, asking the server for the route’s own movement since the start day', async () => {
    mockSettings.mockResolvedValue({ journey: { route_id: 'balatoni-bringakorut', started_on: '2026-08-01' } })
    mockSummary.mockResolvedValue({ metrics: { distanceCycling: { total: 102, unit: 'km' } } })
    show()

    expect(await screen.findByText('Lake Balaton Cycle Circuit')).toBeInTheDocument()
    // The cycling route asks for cycling, from the start day, in yearly buckets.
    const [range, metrics, , from] = mockSummary.mock.calls[0]
    expect(range).toBe('year')
    expect(metrics).toEqual(['distanceCycling'])
    expect(from).toBe('2026-08-01')
    // 102 km of the published 204 km.
    expect(await screen.findByText('50%')).toBeInTheDocument()
    // The ODbL credit is printed with the route.
    expect(screen.getByText(/© OpenStreetMap contributors \(ODbL\)/)).toBeInTheDocument()
  })

  /** No measurement is not zero kilometres. */
  it('never turns a journey with no measurement into zero', async () => {
    mockSettings.mockResolvedValue({ journey: { route_id: 'rpddk', started_on: '2026-08-01' } })
    mockSummary.mockResolvedValue({ metrics: { distanceWalkingRunning: {} } })
    show()

    expect(await screen.findByText(/No distance has arrived for this journey yet/)).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
    // A route without a track says its drawing is a sketch.
    expect(screen.getByText(/The route drawing is a sketch/)).toBeInTheDocument()
  })
})
