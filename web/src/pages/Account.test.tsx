// My account: the switches and the refusals that are about the person signed in.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { User } from '../api/types'
import { I18nProvider } from '../i18n'
import { ADMIN, MEMBER, TestSession, testSession } from '../test/session'
import Account from './Account'

const api = {
  myTokens: vi.fn(async () => [
    { id: 't1', label: 'Chrome on Mac', kind: 'web', current: true, created_at: '2026-10-28T10:00:00Z', expires_at: '2099-01-01T00:00:00Z' },
    { id: 't2', label: 'Nóri iPhone', kind: 'device', created_at: '2026-10-20T10:00:00Z', expires_at: '2099-01-01T00:00:00Z', last_used_at: '2026-10-28T09:00:00Z' },
  ]),
  myEvents: vi.fn(async () => [
    { kind: 'code_issued', at: '2026-10-20T09:58:00Z', actor: 'Bob', actor_is_self: false, detail: { purpose: 'device' } },
    { kind: 'member_added', at: '2026-10-20T09:57:00Z' },
  ]),
  patchMe: vi.fn(),
  deleteMe: vi.fn(),
  myDeviceCode: vi.fn(),
  myLoginCode: vi.fn(),
  revokeMyToken: vi.fn(),
}
vi.mock('../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (api as Record<string, unknown>)[k] }) }))
// The export card reads nothing until asked; it is not under test here.
vi.mock('../components/ExportCard', () => ({ ExportCard: () => null }))

function show(me: User, over = {}) {
  localStorage.setItem('helsa.lang', 'en')
  const session = testSession(me, over)
  render(
    <I18nProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <TestSession session={session}>
            <Account />
          </TestSession>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
  return session
}

beforeEach(() => {
  api.patchMe.mockReset()
  api.deleteMe.mockReset()
})

describe('my account', () => {
  it('marks this browser, which signs out instead of being revoked', async () => {
    const signOut = vi.fn(async () => {})
    show(MEMBER, { signOut })
    expect(await screen.findByText('Nóri iPhone')).toBeInTheDocument()
    expect(screen.getByText('this one')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(signOut).toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1)
  })

  it('tells a member what the server\'s owner sees, in two separate sentences', async () => {
    show(MEMBER)
    expect(await screen.findByText(/sees only your name, your devices and when you last uploaded/)).toBeInTheDocument()
    expect(screen.getByText(/they can technically reach the database\. The log does not show that/)).toBeInTheDocument()
  })

  it('turns Home Assistant on with the person\'s own switch', async () => {
    const setMe = vi.fn()
    api.patchMe.mockResolvedValue({ ...MEMBER, ha_publish: true })
    show(MEMBER, { setMe })
    const box = await screen.findByRole('checkbox', { name: /daily numbers \(steps, sleep, rings\)/ })
    expect(box).not.toBeChecked()
    await userEvent.click(box)
    expect(api.patchMe).toHaveBeenCalledWith({ ha_publish: true })
    expect(setMe).toHaveBeenCalledWith({ ...MEMBER, ha_publish: true })
  })

  it('does not offer deletion to the last admin, and says why (A10)', async () => {
    show(ADMIN)
    expect(await screen.findByRole('button', { name: 'Delete my account and data…' })).toBeDisabled()
    expect(screen.getByText(/only admin, so you cannot delete your account/)).toBeInTheDocument()
  })

  it('reads the log as sentences, with the operator named as such', async () => {
    show(MEMBER)
    expect(await screen.findByText('Bob issued a code to connect a phone.')).toBeInTheDocument()
    expect(screen.getByText("The server's operator created the account.")).toBeInTheDocument()
  })

  it('deletes after the handle is typed, and forgets the session', async () => {
    const forget = vi.fn()
    api.deleteMe.mockResolvedValue(undefined)
    show(MEMBER, { forget })
    await userEvent.click(await screen.findByRole('button', { name: 'Delete my account and data…' }))
    await userEvent.type(screen.getByRole('textbox'), 'nori')
    await userEvent.click(screen.getByRole('button', { name: 'Delete for good' }))
    expect(api.deleteMe).toHaveBeenCalledWith('nori')
    expect(forget).toHaveBeenCalledWith('deleted')
  })
})
