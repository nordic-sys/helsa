import { describe, expect, it } from 'vitest'
import type { AccountEvent, TokenInfo } from '../api/types'
import { deviceEndpoint, enrolUrl, liveTokens, logLine, mmss, normalizeCode, secondsLeft } from './household'

describe('normalizeCode', () => {
  it('takes the code with or without the dash, in any case, with stray spaces', () => {
    for (const typed of ['K7QM-4XPA', 'k7qm4xpa', ' k7qm - 4xpa ', 'K7QM4XPA']) {
      expect(normalizeCode(typed), typed).toBe('K7QM-4XPA')
    }
  })

  it('reads the letters people confuse the way the server does (O → 0, I and L → 1)', () => {
    expect(normalizeCode('OIL0-1234')).toBe('0110-1234')
  })

  it('refuses what cannot be a code — and leaves the deciding to the server', () => {
    for (const typed of ['', 'K7QM-4XP', 'K7QM-4XPAB', 'K7QM-4XPU', 'K7QM_4XPA']) {
      expect(normalizeCode(typed), typed).toBeNull()
    }
  })
})

describe('the connection QR', () => {
  it('carries the phone address and the bare code', () => {
    expect(enrolUrl('https://helsa.example.net:48443/v1', 'K7QM-4XPA')).toBe(
      'helsa://enrol?e=https%3A%2F%2Fhelsa.example.net%3A48443%2Fv1&c=K7QM4XPA',
    )
  })

  it('points at the configured device door, not at this page', () => {
    expect(deviceEndpoint({ hostname: 'helsa.local' }, 'https://helsa.local:48443/v1/')).toBe(
      'https://helsa.local:48443/v1',
    )
  })

  it('guesses the default HTTPS port of this host when nothing is configured', () => {
    expect(deviceEndpoint({ hostname: 'helsa.local' }, '')).toBe('https://helsa.local/v1')
    expect(deviceEndpoint({ hostname: 'helsa.local' }, undefined)).toBe('https://helsa.local/v1')
  })
})

describe('the countdown', () => {
  it('never goes below zero', () => {
    const now = Date.parse('2026-10-28T20:00:00Z')
    expect(secondsLeft('2026-10-28T20:10:00Z', now)).toBe(600)
    expect(secondsLeft('2026-10-28T19:59:00Z', now)).toBe(0)
    expect(mmss(600)).toBe('10:00')
    expect(mmss(65)).toBe('1:05')
  })
})

describe('liveTokens', () => {
  const now = Date.parse('2026-10-28T20:00:00Z')
  const tok = (over: Partial<TokenInfo>): TokenInfo => ({
    id: 'x',
    label: 'x',
    kind: 'device',
    created_at: '2026-10-01T00:00:00Z',
    expires_at: '2027-10-01T00:00:00Z',
    ...over,
  })

  it('leaves out the revoked and the expired, and puts this browser first', () => {
    const out = liveTokens(
      [
        tok({ id: 'old', last_used_at: '2026-10-02T00:00:00Z' }),
        tok({ id: 'revoked', revoked_at: '2026-10-20T00:00:00Z' }),
        tok({ id: 'expired', expires_at: '2026-10-27T00:00:00Z' }),
        tok({ id: 'recent', last_used_at: '2026-10-28T19:00:00Z' }),
        tok({ id: 'this', kind: 'web', current: true }),
      ],
      now,
    )
    expect(out.map((t) => t.id)).toEqual(['this', 'recent', 'old'])
  })
})

describe('logLine', () => {
  const role = (r: string) => (r === 'admin' ? 'admin' : 'member')
  const line = (ev: AccountEvent, owner = true) => logLine(ev, owner, 'OPERATOR', role)
  const at = '2026-10-28T20:00:00Z'

  it('says "you" to the owner, and the name to the admin, for the same line', () => {
    const ev: AccountEvent = { kind: 'code_issued', at, actor: 'Nóri', actor_is_self: true, detail: { purpose: 'device' } }
    expect(line(ev, true)).toMatchObject({ key: 'log.deviceCode.you' })
    expect(line(ev, false)).toMatchObject({ key: 'log.deviceCode.named', params: { actor: 'Nóri' } })
  })

  it('names somebody else who acted, and the operator when nobody is named', () => {
    expect(
      line({ kind: 'code_issued', at, actor: 'Bob', actor_is_self: false, detail: { purpose: 'web' } }),
    ).toMatchObject({ key: 'log.webCode.by', params: { actor: 'Bob' } })
    expect(line({ kind: 'role_changed', at, detail: { to: 'admin', by: 'operator' } })).toMatchObject({
      key: 'log.roleChanged',
      params: { actor: 'OPERATOR', role: 'admin' },
    })
  })

  it('carries the device name of a revoke and a join', () => {
    expect(line({ kind: 'token_revoked', at, actor: 'Bob', detail: { label: 'Nóri iPhone' } })).toMatchObject({
      key: 'log.tokenRevoked.by',
      params: { label: 'Nóri iPhone' },
    })
    expect(
      line({ kind: 'code_redeemed', at, actor: 'Nóri', actor_is_self: true, detail: { purpose: 'device', label: 'iPhone' } }),
    ).toMatchObject({ key: 'log.redeemed.device', params: { label: 'iPhone' } })
  })

  it('prints a kind it does not know rather than hiding it', () => {
    expect(line({ kind: 'something_new', at, actor: 'Bob' })).toEqual({ raw: 'something_new', actor: 'Bob' })
  })
})
