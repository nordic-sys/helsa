// The code dialog draws the two kinds of code differently on purpose
// (docs/36 §9, A2, A3): a phone code is a QR AND the code AND the address; a
// browser code is the code alone — a QR of it would only invite scanning it
// with a phone, where it is refused with a 401 that explains nothing.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import type { CodeIssued } from '../api/types'
import { I18nProvider } from '../i18n'
import { CodeDialog } from './CodeDialog'

const soon = () => new Date(Date.now() + 15 * 60_000).toISOString()

function show(code: CodeIssued, forName?: string, onRevoke?: () => Promise<void>, operator = false) {
  localStorage.setItem('helsa.lang', 'en')
  return render(
    <I18nProvider>
      <CodeDialog code={code} forName={forName} onRevoke={onRevoke} operator={operator} onClose={() => {}} />
    </I18nProvider>,
  )
}

describe('the code dialog', () => {
  it('shows a phone code as a QR, the code, and the server address to type', () => {
    show({ code: 'K7QM-4XPA', purpose: 'device', expires_at: soon() }, 'Nóri')
    expect(screen.getByRole('dialog', { name: 'Connection code — Nóri' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'QR code for connecting the phone' })).toBeInTheDocument()
    expect(screen.getByTestId('code-value')).toHaveTextContent('K7QM-4XPA')
    expect(screen.getByText("The server's address for the phone")).toBeInTheDocument()
    expect(screen.getByText(/^https:\/\/.+\/v1$/)).toBeInTheDocument()
    expect(screen.getByText(/left$/)).toBeInTheDocument()
  })

  it('shows a browser code WITHOUT a QR', () => {
    show({ code: 'ABCD-EFGH', purpose: 'web', expires_at: soon() })
    expect(screen.getByRole('dialog', { name: 'Web sign-in code' })).toBeInTheDocument()
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-value')).toHaveTextContent('ABCD-EFGH')
  })

  it('says when the code has run out, and stops offering the QR', () => {
    show({ code: 'K7QM-4XPA', purpose: 'device', expires_at: new Date(Date.now() - 1000).toISOString() })
    expect(screen.getByText(/The code has expired/)).toBeInTheDocument()
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument()
  })

  // W2: a code shown on the wrong screen need not be left to expire.
  it('withdraws the code: the QR goes, the code is struck through, and nothing is offered again', async () => {
    let calls = 0
    show({ code: 'K7QM-4XPA', purpose: 'device', expires_at: soon() }, undefined, async () => {
      calls++
    })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the code' }))
    expect(await screen.findByText(/Revoked — nobody can connect/)).toBeInTheDocument()
    expect(calls).toBe(1)
    expect(screen.queryByTestId('qr')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-value')).toHaveClass('code-value--dead')
    expect(screen.queryByRole('button', { name: 'Revoke the code' })).not.toBeInTheDocument()
    // Nothing left to redeem it with (agy C7).
    expect(screen.queryByText(/On the phone:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/The code works once/)).not.toBeInTheDocument()
  })

  it('words a withdrawn sign-in code as signing in, not connecting', async () => {
    show({ code: 'ABCD-EFGH', purpose: 'web', expires_at: soon() }, undefined, async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the code' }))
    expect(await screen.findByText(/nobody can sign in with this code/)).toBeInTheDocument()
  })

  it("tells the server's admin how to make the certificate, not to ask the owner (agy C8)", () => {
    show({ code: 'K7QM-4XPA', purpose: 'device', expires_at: soon() }, undefined, undefined, true)
    expect(screen.getByText(/make client NAME=/)).toBeInTheDocument()
    expect(screen.queryByText(/ask them for it/)).not.toBeInTheDocument()
  })

  it('says so when the code was already used — and points at the device to revoke instead', async () => {
    show({ code: 'K7QM-4XPA', purpose: 'device', expires_at: soon() }, undefined, () =>
      Promise.reject(new ApiError(409, 'The code can no longer be revoked', 'used')),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/already been used.*revoke that device/)
    expect(screen.queryByRole('button', { name: 'Revoke the code' })).not.toBeInTheDocument()
  })

  it('keeps the button after a failure, with the error', async () => {
    show({ code: 'ABCD-EFGH', purpose: 'web', expires_at: soon() }, undefined, () => Promise.reject(new ApiError(500, 'x')))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be revoked/)
    expect(screen.getByRole('button', { name: 'Revoke the code' })).toBeEnabled()
  })

  it('offers no revoking for a code that has run out', () => {
    show({ code: 'K7QM-4XPA', purpose: 'device', expires_at: new Date(Date.now() - 1000).toISOString() }, undefined, async () => {})
    expect(screen.queryByRole('button', { name: 'Revoke the code' })).not.toBeInTheDocument()
  })
})
