// What the opened session must show, and what it must never invent.
//
// The page's own rule is that an absence is drawn as an absence, so most of
// these assert that something is NOT on screen. That reads oddly until the
// alternative is spelled out: a "0 bpm" under a strength session, a 0:00 pace on
// a yoga class, a humidity of 3 000% — each of them a number the person never
// measured, standing where a number belongs.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Sample, Workout, WorkoutPage, WorkoutRoute } from '../api/types'
import { I18nProvider, detectLang } from '../i18n'
import { en } from '../i18n/en'
import { hu } from '../i18n/hu'
import WorkoutDetail from './WorkoutDetail'

const workout = vi.fn<(id: string) => Promise<Workout>>()
const workoutRoute = vi.fn<(id: string) => Promise<WorkoutRoute>>()
const samples = vi.fn<() => Promise<{ items?: Sample[]; next_cursor?: string | null }>>()
const workouts = vi.fn<() => Promise<WorkoutPage>>()

vi.mock('../api/client', () => ({
  api: {
    workout: (id: string) => workout(id),
    workoutRoute: (id: string) => workoutRoute(id),
    samples: () => samples(),
    workouts: () => workouts(),
  },
  browserTz: () => 'Europe/Budapest',
}))

// recharts measures its container with a ResizeObserver, which jsdom lacks.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

/** The dictionary the provider actually picks here — the tests assert on real
 * interface text, so they have to ask for it in the language on screen. */
const dict = detectLang() === 'hu' ? hu : en
const s = (key: keyof typeof en.ui) => dict.ui[key]

function open(id = 'w1') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider>
        <MemoryRouter initialEntries={[`/workouts/${id}`]}>
          <Routes>
            <Route path="/workouts/:id" element={<WorkoutDetail />} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  )
}

const RUN: Workout = {
  id: 'w1',
  source_uuid: 'HK-1',
  activity_type: 'running',
  started_at: '2026-08-11T16:00:00.000Z',
  ended_at: '2026-08-11T16:50:00.000Z',
  total_distance_m: 10000,
  total_energy_kcal: 520,
  avg_heart_rate: 148,
  max_heart_rate: 167,
  metadata: { indoor: false },
}

const YOGA: Workout = {
  id: 'w1',
  activity_type: 'yoga',
  started_at: '2026-08-11T16:00:00.000Z',
  ended_at: '2026-08-11T16:45:00.000Z',
  metadata: { indoor: true },
}

beforeEach(() => {
  workout.mockReset()
  workoutRoute.mockReset()
  samples.mockReset()
  workouts.mockReset()
  workoutRoute.mockResolvedValue({ points: [] })
  samples.mockResolvedValue({ items: [] })
  workouts.mockResolvedValue({ items: [] })
})

describe('an outdoor run', () => {
  beforeEach(() => {
    workout.mockResolvedValue(RUN)
    workoutRoute.mockResolvedValue({
      points: [
        { lat: 47.5, lon: 19.05, ts: '2026-08-11T16:00:00.000Z', accuracy_m: 5 },
        { lat: 47.51, lon: 19.06, ts: '2026-08-11T16:20:00.000Z', accuracy_m: 5 },
        { lat: 47.52, lon: 19.04, ts: '2026-08-11T16:40:00.000Z', accuracy_m: 5 },
        // ⚠️ A fix off by a city block. Drawn, it would put a there-and-back
        // spike across the frame that looks like a road actually taken.
        { lat: 47.9, lon: 19.9, ts: '2026-08-11T16:30:00.000Z', accuracy_m: 400 },
      ],
    })
    samples.mockResolvedValue({
      items: [
        { ts: '2026-08-11T16:30:00.000Z', data_type: 'heartRate', value: 155, source_device: 'watch' },
        { ts: '2026-08-11T16:10:00.000Z', data_type: 'heartRate', value: 132, source_device: 'watch' },
      ],
    })
  })

  it('draws the route as a line, without a map under it', async () => {
    const { container } = open()
    await screen.findByRole('img', { name: /shape of the route|útvonal alakja/i })
    const path = container.querySelector('svg.route path')
    expect(path?.getAttribute('d')).toMatch(/^M[\d.]+ [\d.]+L/)
    // ⛔ No tile request, from anywhere: nothing on the page may point off-site.
    for (const el of container.querySelectorAll('img, image, iframe')) {
      expect(el.getAttribute('src')).not.toMatch(/^https?:/)
    }
  })

  it('says how many fixes it left out rather than quietly drawing a shorter line', async () => {
    open()
    expect(await screen.findByText(/1 inaccurate point|1 pontatlan pont/i)).toBeInTheDocument()
  })

  it('names the device that wrote the heart rate, and admits what it cannot name', async () => {
    open()
    expect(await screen.findByText(s('device.watch'))).toBeInTheDocument()
    expect(screen.getByText(s('workout.source.gap'))).toBeInTheDocument()
  })

  it('measures a run in minutes per kilometre', async () => {
    open()
    expect(await screen.findByText(s('workout.metric.pace'))).toBeInTheDocument()
    expect(screen.getByText('5:00')).toBeInTheDocument()
    expect(screen.queryByText(s('workout.metric.speed'))).not.toBeInTheDocument()
  })
})

describe('an indoor session with nothing to draw', () => {
  beforeEach(() => {
    workout.mockResolvedValue(YOGA)
  })

  it('says there is no route instead of showing an empty frame', async () => {
    const { container } = open()
    expect(await screen.findByText(s('workout.route.none'))).toBeInTheDocument()
    expect(container.querySelector('svg.route')).toBeNull()
  })

  it('says there is no heart rate instead of drawing a flat line at zero', async () => {
    open()
    expect(await screen.findByText(s('workout.hr.none')).catch(() => null)).toBeTruthy()
  })

  /**
   * ⚠️ The rule the whole page turns on. A yoga class has no distance and no
   * pace; a 0 in either place is a measurement nobody took, and — on the list —
   * one that would drop the session out of every "at least" filter.
   */
  it('leaves out the cards it has no measurement for, rather than filling them with zeros', async () => {
    open()
    await screen.findByText(s('workout.metric.time'))
    expect(screen.queryByText(s('workout.metric.distance'))).not.toBeInTheDocument()
    expect(screen.queryByText(s('workout.metric.pace'))).not.toBeInTheDocument()
    expect(screen.queryByText(s('workout.metric.speed'))).not.toBeInTheDocument()
    expect(screen.queryByText(s('workout.metric.avgHr'))).not.toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('marks it indoor, because HealthKit said so', async () => {
    open()
    expect(await screen.findByText(new RegExp(s('workouts.place.indoor')))).toBeInTheDocument()
  })

  it('says nothing about where it happened when nothing said', async () => {
    workout.mockResolvedValue({ ...YOGA, metadata: {} })
    open()
    await screen.findByText(s('workout.metric.time'))
    expect(screen.queryByText(new RegExp(s('workouts.place.outdoor')))).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(s('workouts.place.indoor')))).not.toBeInTheDocument()
  })
})

describe('the weather', () => {
  // ⛔ The broken rows are ALREADY on people's servers: the phone used to
  // multiply a 0…100 humidity by 100 again. Clamping to 100 would turn a value
  // known to be broken into one we invented.
  it('shows the temperature and drops a humidity that cannot be one', async () => {
    workout.mockResolvedValue({
      ...RUN,
      metadata: { indoor: false, weather: { temperature_c: 21, humidity_pct: 3000, condition: 1 } },
    })
    open()
    expect(await screen.findByText(s('workout.weather.temperature')).catch(() => null)).toBeTruthy()
    expect(screen.queryByText(s('workout.weather.humidity'))).not.toBeInTheDocument()
    expect(screen.queryByText(/3\s?000/)).not.toBeInTheDocument()
  })

  it('shows a fraction as a percentage', async () => {
    workout.mockResolvedValue({
      ...RUN,
      metadata: { indoor: false, weather: { humidity_pct: 0.62 } },
    })
    open()
    expect(await screen.findByText('62%')).toBeInTheDocument()
  })

  it('is not there at all when the recording carried none', async () => {
    workout.mockResolvedValue(RUN)
    open()
    await screen.findByText(s('workout.metric.time'))
    expect(screen.queryByText(s('workout.weather.title'))).not.toBeInTheDocument()
  })
})

/**
 * The failure this section exists to prevent: `/workouts` folds two recordings
 * of one session into a single row, so opening that row could easily show one
 * recording's numbers and never mention that a second exists.
 */
describe('a session that was recorded twice', () => {
  const OTHER: Workout = {
    id: 'w2',
    activity_type: 'running',
    started_at: '2026-08-11T16:00:30.000Z',
    ended_at: '2026-08-11T16:48:00.000Z',
    total_distance_m: 9800,
    total_energy_kcal: 495,
  }

  beforeEach(() => {
    workout.mockResolvedValue(RUN)
    workouts.mockResolvedValue({ items: [RUN, OTHER] })
  })

  it('says the numbers above belong to one recording only', async () => {
    open('w1')
    expect(await screen.findByText(s('workout.dup.thisOnly'))).toBeInTheDocument()
  })

  it('puts the other recording’s own numbers on the page, and a way into it', async () => {
    open('w1')
    // ⚠️ Found by destination, not by its text: the label is a time, and a time
    // is written differently in every locale the app runs in.
    const link = await screen.findByRole('link', { name: /\d/ })
    expect(link).toHaveAttribute('href', '/workouts/w2')
    expect(screen.getByText(/9\.8 km|9,8 km/)).toBeInTheDocument()
  })

  // ⚠️ Not averaged, not reconciled, not preferred. Two devices measuring one
  // half hour disagree, and the page says so instead of choosing.
  it('refuses to decide which one to keep, and says that out loud', async () => {
    open('w1')
    expect(await screen.findByText(s('workout.dup.keep'))).toBeInTheDocument()
  })

  it('tells a deep-linked reader that the list shows the other one', async () => {
    workout.mockResolvedValue(OTHER)
    open('w2')
    expect(await screen.findByText(s('workout.dup.secondary'))).toBeInTheDocument()
    expect(screen.getByText(s('workout.dup.listed'))).toBeInTheDocument()
  })

  it('says nothing about duplicates for a session recorded once', async () => {
    workouts.mockResolvedValue({ items: [RUN] })
    open('w1')
    await screen.findByText(s('workout.metric.time'))
    expect(screen.queryByText(s('workout.dup.title'))).not.toBeInTheDocument()
  })
})

describe('a link to a session that is not here', () => {
  // ⚠️ A 404 is not a failure state. The request worked; the answer was "there
  // is no such session". Wording it as an error sends the reader looking for a
  // fault that is not there.
  it('says the session is not on this server, not that something went wrong', async () => {
    workout.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
    open('nope')
    expect(await screen.findByText(s('workout.missing.title'))).toBeInTheDocument()
    expect(screen.queryByText(s('error.generic.title'))).not.toBeInTheDocument()
  })
})

describe('a session with no end time', () => {
  // ⚠️ An open-ended sample query would drag in every beat since. The absence
  // of a window is a fact about the recording, so it is said rather than left
  // as an empty chart.
  it('does not invent a window to read the heart rate over', async () => {
    workout.mockResolvedValue({ ...RUN, ended_at: undefined })
    open()
    expect(await screen.findByText(s('workout.hr.noWindow'))).toBeInTheDocument()
    expect(samples).not.toHaveBeenCalled()
  })
})
