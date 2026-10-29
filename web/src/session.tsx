// Who is signed in — and the one place that decides it.
//
// # Why a gate and not a page among the others
//
// Until the household there was nobody to sign in (docs/08): one person, one
// token pasted once. Now several people can use the same browser, and the
// failure that matters is not "a page errors" but **one person's numbers on
// screen under another person's name** (the review, C12). So nothing that reads
// data is mounted until the server has said who this is, and everything read is
// thrown away the moment that changes:
//
//   * **sign-in, sign-out, a 401 anywhere** — the query cache is emptied and
//     its requests cancelled (C12, A7). A 401 shows the sign-in page with "your
//     session has ended", not an error card on whichever page was open;
//   * **a different person in another tab** — signing in or out writes a marker
//     to `localStorage`; every other tab hears it (`storage` event), asks
//     `/me` again, and empties its cache if the answer is somebody else. The
//     cookie is shared by the tabs, so without this a tab left open as Bob
//     would fetch Nóri's data into Bob's page the next time it refreshed;
//   * **the frame is keyed by the user's id** (`App.tsx`), so no component state
//     outlives the person it was built for either.
//
// The legacy device token (A5) is deleted on load, once, and the sign-in page
// says why — there is no transition period in which it is still sent.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ApiError, api, setUnauthorizedHandler, takeLegacyToken } from './api/client'
import type { User } from './api/types'
import Login from './pages/Login'
import './styles/household.css'

/** Why the sign-in page is showing — each says something different on it. */
export type SignedOutReason = 'none' | 'ended' | 'signedOut' | 'deleted'

export type Session = {
  me: User
  isAdmin: boolean
  /** Ends this browser's session on the server, then forgets everything. */
  signOut: () => Promise<void>
  /** After the account itself was deleted: forget everything, say so. */
  forget: (reason: SignedOutReason) => void
  /** Puts a fresh `/me` in place (after a change to the account). */
  setMe: (me: User) => void
  /** True once, when an old device token was found and removed on this load. */
  legacyNotice: boolean
  dismissLegacyNotice: () => void
}

export const SessionContext = createContext<Session | null>(null)

export function useSession(): Session {
  const s = useContext(SessionContext)
  if (!s) throw new Error('useSession must be used inside <SessionGate>')
  return s
}

/** The key another tab listens on. Its value is only ever a timestamp. */
export const SESSION_SIGNAL_KEY = 'helsa.session.changed'

function signalOtherTabs() {
  try {
    localStorage.setItem(SESSION_SIGNAL_KEY, String(Date.now()))
  } catch {
    /* storage blocked: the other tabs find out on their next 401 */
  }
}

// ⚠️ Module-level and computed once, not in a `useState` initialiser: StrictMode
// runs initialisers twice, and the second run would find the token already gone
// and report that there never was one.
let legacyFound: boolean | null = null
function legacyTokenRemoved(): boolean {
  if (legacyFound === null) legacyFound = takeLegacyToken()
  return legacyFound
}
/** Tests only: forget the answer, so the next mount looks again. */
export function resetLegacyCheck() {
  legacyFound = null
}

type State =
  { status: 'loading' } | { status: 'signedOut'; reason: SignedOutReason } | { status: 'signedIn'; me: User }

export function SessionGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [legacy, setLegacy] = useState(legacyTokenRemoved)
  // The current person, readable from the callbacks below without re-binding
  // them on every change.
  const current = useRef<string | undefined>(undefined)
  // Every identity change moves the generation on; an answer that was asked for in
  // an older generation is thrown away. Without it a slow /me for A could land
  // after another tab signed in as B, and paint A's name over B's cookie (§10.4, S3).
  const generation = useRef(0)

  /** Everything read so far belonged to someone; throw it away. */
  const purge = useCallback(() => {
    void qc.cancelQueries()
    qc.clear()
  }, [qc])

  const signedIn = useCallback(
    (me: User) => {
      if (me.id !== current.current) purge()
      current.current = me.id
      setState({ status: 'signedIn', me })
    },
    [purge],
  )

  const forget = useCallback(
    (reason: SignedOutReason) => {
      generation.current++
      purge()
      current.current = undefined
      setState({ status: 'signedOut', reason })
    },
    [purge],
  )

  /** Asks the server who this is. A 401 is "nobody", whatever came before. */
  const look = useCallback(
    async (after401: SignedOutReason) => {
      const asked = ++generation.current
      try {
        const me = await api.me({ quiet: true })
        if (asked !== generation.current) return // somebody else's answer by now
        signedIn(me)
      } catch (e) {
        if (asked !== generation.current) return
        if ((e as ApiError).status === 401) forget(after401)
        else throw e
      }
    },
    [signedIn, forget],
  )

  // The first look. Not "ended" on a 401: nothing has ended, nobody was here.
  const [bootError, setBootError] = useState<unknown>(null)
  useEffect(() => {
    look('none').catch(setBootError)
  }, [look])

  // Any other request's 401: the session is over (A7).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (current.current !== undefined) forget('ended')
    })
    return () => setUnauthorizedHandler(null)
  }, [forget])

  // Another tab signed in or out.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SESSION_SIGNAL_KEY) return
      // The cookie has already changed under this tab. Take the pages down and the
      // cache with them NOW, before asking who it is: the old pages must not send one
      // more request with the new person's cookie while the answer is on its way.
      const was = current.current
      purge()
      current.current = undefined
      setState({ status: 'loading' })
      look(was !== undefined ? 'ended' : 'none').catch(() => {
        /* the server is unreachable; the next request will say so */
      })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [look])

  const signOut = useCallback(async () => {
    try {
      await api.webLogout()
    } catch (e) {
      // A 401 means the server had already let go — the goal is reached. Any
      // other failure means the session may still be alive, and saying
      // "signed out" then would be the one wrong answer.
      if ((e as ApiError).status !== 401) throw e
    }
    forget('signedOut')
    signalOtherTabs()
  }, [forget])

  const onSignedIn = useCallback(async () => {
    // The sign-in page has already explained the removed token; once is enough.
    setLegacy(false)
    purge()
    signalOtherTabs()
    await look('none')
  }, [look, purge])

  const me = state.status === 'signedIn' ? state.me : undefined
  const session = useMemo<Session | null>(
    () =>
      me
        ? {
            me,
            isAdmin: me.role === 'admin',
            signOut,
            forget,
            // Only ever the same person: a late answer to a PATCH started before the
            // person changed is dropped, not written over the new identity (S3).
            setMe: (next) => {
              if (next.id === current.current) setState({ status: 'signedIn', me: next })
            },
            legacyNotice: legacy,
            dismissLegacyNotice: () => setLegacy(false),
          }
        : null,
    [me, signOut, forget, legacy],
  )

  if (state.status === 'loading' && !bootError) return <div className="gate-loading" aria-busy="true" />
  if (!session) {
    // ⚠️ A server that could not be asked at all is not "signed out": the page
    // says so on the sign-in form, which stays usable — signing in looks again.
    return (
      <Login
        reason={state.status === 'signedOut' ? state.reason : 'none'}
        legacyNotice={legacy}
        onSignedIn={onSignedIn}
        bootError={state.status === 'loading' ? bootError : undefined}
      />
    )
  }
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
}
