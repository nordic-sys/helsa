// The web's credential rules, pinned at the one place requests are made.
//
// ⛔ The failure this guards against is quiet: a bearer header sent beside the
// cookie is refused by the server (400, docs/36 §9 C11) — but an old token left
// in storage and sent ALONE would still be accepted, as somebody else, by an
// older server. So the rule is absolute: no request ever carries one.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGACY_TOKEN_KEY, api, setUnauthorizedHandler, takeLegacyToken } from './client'

type Call = { url: string; init: RequestInit }
let calls: Call[] = []
let answer: () => Response = () => json(200, {})

function json(status: number, body: unknown) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  calls = []
  answer = () => json(200, {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return answer()
    }),
  )
})

afterEach(() => {
  setUnauthorizedHandler(null)
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('every request', () => {
  it('carries the cookie and never a bearer — even with an old token still in storage', async () => {
    localStorage.setItem(LEGACY_TOKEN_KEY, 'an-old-year-long-token')
    await api.me()
    await api.summary('day', ['stepCount'])
    await api.patchMe({ ha_publish: true })
    await api.memberCode('u1', 'device')
    answer = () => json(204, null)
    await api.webLogin('K7QM-4XPA')
    await api.webLogout()
    answer = () => new Response('a,b\n', { status: 200 })
    await api.exportFile({ format: 'csv' })

    expect(calls.length).toBe(7)
    for (const c of calls) {
      expect(new Headers(c.init.headers).has('Authorization'), c.url).toBe(false)
      expect(c.init.credentials, c.url).toBe('same-origin')
    }
  })

  it('says JSON when it sends JSON — the server insists for a cookie write', async () => {
    await api.patchMe({ ha_publish: false })
    const c = calls[0]
    expect(c.init.method).toBe('PATCH')
    expect(new Headers(c.init.headers).get('Content-Type')).toBe('application/json')
    expect(c.init.body).toBe('{"ha_publish":false}')
  })
})

describe('a 401', () => {
  it('tells the session layer the session is over', async () => {
    const ended = vi.fn()
    setUnauthorizedHandler(ended)
    answer = () => json(401, { title: 'Unauthorized' })
    await expect(api.devices()).rejects.toMatchObject({ status: 401 })
    expect(ended).toHaveBeenCalledTimes(1)
  })

  it('is only an answer when a code is redeemed, or on the first look at who is here', async () => {
    const ended = vi.fn()
    setUnauthorizedHandler(ended)
    answer = () => json(401, { title: 'Code not accepted' })
    await expect(api.webLogin('K7QM-4XPA')).rejects.toMatchObject({ status: 401 })
    await expect(api.me({ quiet: true })).rejects.toMatchObject({ status: 401 })
    expect(ended).not.toHaveBeenCalled()
  })

  it('is not raised by other refusals', async () => {
    const ended = vi.fn()
    setUnauthorizedHandler(ended)
    answer = () => json(403, { title: 'Forbidden' })
    await expect(api.members()).rejects.toMatchObject({ status: 403 })
    expect(ended).not.toHaveBeenCalled()
  })
})

describe('the old device token', () => {
  it('is deleted, and its removal reported once', () => {
    localStorage.setItem(LEGACY_TOKEN_KEY, 'tok')
    expect(takeLegacyToken()).toBe(true)
    expect(localStorage.getItem(LEGACY_TOKEN_KEY)).toBeNull()
    expect(takeLegacyToken()).toBe(false)
  })
})
