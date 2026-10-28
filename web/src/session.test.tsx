// The gate: who is signed in, and that nobody ever sees what was read for
// somebody else (docs/36 §9, C12, A5, A7).
//
// These run the REAL client against a stubbed `fetch` with a tiny server behind
// it, because what is under test is the hand-off between the two — a 401 in the
// client turning into an emptied cache and the sign-in page in the gate.

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_TOKEN_KEY, api } from './api/client'
import { I18nProvider } from './i18n'
import { SESSION_SIGNAL_KEY, SessionGate, resetLegacyCheck, useSession } from './session'

/** Whose cookie the browser holds; null = none, every call but login is a 401. */
let who: 'bob' | 'nori' | null
/** Who the next valid code signs in. */
let nextLogin: 'bob' | 'nori'
let requests: { url: string; init: RequestInit }[]

const PEOPLE = {
  bob: { id: 'u-bob', handle: 'bob', display_name: 'Bob', role: 'admin' },
  nori: { id: 'u-nori', handle: 'nori', display_name: 'Nóri', role: 'member' },
}

function reply(status: number, body?: unknown) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('helsa.lang', 'en')
  resetLegacyCheck()
  who = null
  nextLogin = 'bob'
  requests = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      requests.push({ url, init })
      if (url === '/v1/auth/web/login') {
        who = nextLogin
        return reply(204)
      }
      if (!who) return reply(401, { title: 'Unauthorized' })
      if (url === '/v1/auth/web/logout') {
        who = null
        return reply(204)
      }
      if (url === '/v1/me') return reply(200, PEOPLE[who])
      if (url.startsWith('/v1/goals')) return reply(200, [{ metric: `${who}-data` }])
      return reply(404, { title: 'Not Found' })
    }),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A page that reads something personal, and the sign-out button. */
function Probe() {
  const { me, signOut } = useSession()
  // `staleTime: Infinity`: a cache that survived an identity change WOULD be
  // shown without asking again — which is exactly what must not happen.
  const q = useQuery({ queryKey: ['goals'], queryFn: () => api.goals(), staleTime: Infinity })
  return (
    <div>
      <p>signed in as {me.display_name}</p>
      <p data-testid="data">{q.data?.[0]?.metric ?? 'loading'}</p>
      <button onClick={() => void signOut()}>out</button>
    </div>
  )
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <I18nProvider>
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SessionGate>
            <Probe />
          </SessionGate>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
  return qc
}

async function signInWith(code: string) {
  await userEvent.type(await screen.findByRole('textbox', { name: 'Sign-in code' }), code)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('signing in', () => {
  it('starts at the sign-in page when nobody is signed in — without "session ended"', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.queryByText(/session has ended/)).not.toBeInTheDocument()
  })

  it('accepts the code with or without the dash, in any case, and sends it formatted', async () => {
    mount()
    await signInWith('k7qm4xpa')
    expect(await screen.findByText('signed in as Bob')).toBeInTheDocument()
    const login = requests.find((r) => r.url === '/v1/auth/web/login')!
    expect(login.init.body).toBe('{"code":"K7QM-4XPA"}')
  })
})

describe('the old device token (A5)', () => {
  it('is deleted on load, never sent, and explained once', async () => {
    localStorage.setItem(LEGACY_TOKEN_KEY, 'an-old-year-long-token')
    mount()
    expect(await screen.findByText('This browser now signs in with a code')).toBeInTheDocument()
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull()
    for (const r of requests) expect(new Headers(r.init.headers).has('Authorization')).toBe(false)
  })
})

describe('a session that ends (A7, C12)', () => {
  it('empties the cache and shows the sign-in page with the reason on any 401', async () => {
    who = 'bob'
    const qc = mount()
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('bob-data'))

    who = null // the server forgot this browser — revoked, expired, deleted
    await act(() => qc.refetchQueries({ queryKey: ['goals'] }))

    expect(await screen.findByText('Your session has ended. Sign in again.')).toBeInTheDocument()
    expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })

  it('signs out on the server, then forgets everything', async () => {
    who = 'bob'
    const qc = mount()
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('bob-data'))
    await userEvent.click(screen.getByRole('button', { name: 'out' }))

    expect(await screen.findByText('You have signed out.')).toBeInTheDocument()
    const out = requests.find((r) => r.url === '/v1/auth/web/logout')!
    expect(out.init.method).toBe('POST')
    expect(qc.getQueryCache().getAll()).toHaveLength(0)
  })
})

describe('two people, one browser (C12)', () => {
  it('never shows the first person\'s data to the second', async () => {
    who = 'bob'
    mount()
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('bob-data'))
    await userEvent.click(screen.getByRole('button', { name: 'out' }))

    nextLogin = 'nori'
    await signInWith('K7QM-4XPA')
    expect(await screen.findByText('signed in as Nóri')).toBeInTheDocument()
    // Not for a single frame: the cached answer is gone, so it is fetched anew.
    expect(screen.getByTestId('data')).not.toHaveTextContent('bob-data')
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('nori-data'))
  })

  it('notices when another tab signs somebody else in', async () => {
    who = 'bob'
    const qc = mount()
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('bob-data'))

    // The other tab signed out and in as Nóri; the cookie is shared.
    who = 'nori'
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: SESSION_SIGNAL_KEY, newValue: '1' }))
    })

    expect(await screen.findByText('signed in as Nóri')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('data')).toHaveTextContent('nori-data'))
    expect(qc.getQueryData(['goals'])).toEqual([{ metric: 'nori-data' }])
  })
})
