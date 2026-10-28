// An admin's member page: the review's rules, each one a test (docs/36 §9).

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Member } from '../api/types'
import { I18nProvider } from '../i18n'
import { ADMIN, TestSession } from '../test/session'
import MemberPage from './Member'

const api = {
  member: vi.fn<(id: string) => Promise<Member>>(),
  memberTokens: vi.fn(async () => []),
  memberEvents: vi.fn(async () => []),
  memberCode: vi.fn(),
  patchMember: vi.fn(),
  deleteMember: vi.fn(),
  revokeMemberToken: vi.fn(),
}
vi.mock('../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (api as Record<string, unknown>)[k] }) }))

const nori: Member = {
  id: 'u-nori',
  handle: 'nori',
  display_name: 'Nóri',
  role: 'member',
  created_at: '2026-10-20T10:00:00Z',
  devices: 0,
}

function show(id: string) {
  localStorage.setItem('helsa.lang', 'en')
  render(
    <I18nProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/household/${id}`]}>
          <TestSession>
            <Routes>
              <Route path="/household/:id" element={<MemberPage />} />
              <Route path="/household" element={<p>the list</p>} />
            </Routes>
          </TestSession>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset()
  api.memberTokens.mockResolvedValue([])
  api.memberEvents.mockResolvedValue([])
})

describe('a member page', () => {
  it('offers two separate codes (A6) to a member with nothing live', async () => {
    api.member.mockResolvedValue(nori)
    api.memberCode.mockResolvedValue({ code: 'K7QM-4XPA', purpose: 'device', expires_at: new Date(Date.now() + 9e5).toISOString() })
    show('u-nori')
    await userEvent.click(await screen.findByRole('button', { name: 'Connect a device' }))
    expect(api.memberCode).toHaveBeenCalledWith('u-nori', 'device')
    expect(await screen.findByRole('dialog', { name: 'Connection code — Nóri' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Web sign-in code' })).toBeInTheDocument()
  })

  it('explains the 409: a member with a device asks for their own code (C2)', async () => {
    api.member.mockResolvedValue(nori)
    api.memberCode.mockRejectedValue(Object.assign(new Error('The member has a device'), { status: 409 }))
    show('u-nori')
    await userEvent.click(await screen.findByRole('button', { name: 'Web sign-in code' }))
    expect(await screen.findByText(/Nóri already has a working device, so they ask for the new code themselves/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says the same before the click when the member has a live device', async () => {
    api.member.mockResolvedValue({ ...nori, devices: 1 })
    show('u-nori')
    expect(await screen.findByRole('button', { name: 'Connect a device' })).toBeDisabled()
    expect(screen.getByText(/revoke them here first/)).toBeInTheDocument()
  })

  it('makes role, disabling and deletion inactive on your own row (A19)', async () => {
    api.member.mockResolvedValue({ ...nori, id: ADMIN.id!, handle: 'bob', display_name: 'Bob', role: 'admin' })
    show(ADMIN.id!)
    expect(await screen.findByRole('combobox', { name: 'Role' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Disable' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Delete…' })).toBeDisabled()
    // The codes stay: they are yours to use.
    expect(screen.getByRole('button', { name: 'Connect a device' })).toBeEnabled()
  })

  it('asks before disabling, and says it is not revoking (A8) and stops export (A9)', async () => {
    api.member.mockResolvedValue(nori)
    api.patchMember.mockResolvedValue({ ...nori, disabled: true })
    show('u-nori')
    await userEvent.click(await screen.findByRole('button', { name: 'Disable' }))
    const ask = screen.getByRole('group', { name: 'Disable' })
    expect(ask).toHaveTextContent(/cannot export either/)
    expect(ask).toHaveTextContent(/this is not revoking/)
    await userEvent.click(within(ask).getByRole('button', { name: 'Disable' }))
    expect(api.patchMember).toHaveBeenCalledWith('u-nori', { disabled: true })
  })

  it('deletes only once the handle is typed, and warns that a disabled member cannot export', async () => {
    api.member.mockResolvedValue({ ...nori, disabled: true })
    api.deleteMember.mockResolvedValue(undefined)
    show('u-nori')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete…' }))
    const confirm = screen.getByRole('group', { name: 'Delete Nóri for good' })
    expect(confirm).toHaveTextContent(/disappears from the backups within five weeks/)
    expect(confirm).toHaveTextContent('Nóri is disabled right now, and so cannot export either.')
    const go = within(confirm).getByRole('button', { name: 'Delete Nóri for good' })
    expect(go).toBeDisabled()
    await userEvent.type(within(confirm).getByRole('textbox'), 'nori')
    await userEvent.click(go)
    expect(api.deleteMember).toHaveBeenCalledWith('u-nori', 'nori')
    expect(await screen.findByText('the list')).toBeInTheDocument()
  })
})
