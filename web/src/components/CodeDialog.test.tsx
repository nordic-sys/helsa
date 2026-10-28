// The code dialog draws the two kinds of code differently on purpose
// (docs/36 §9, A2, A3): a phone code is a QR AND the code AND the address; a
// browser code is the code alone — a QR of it would only invite scanning it
// with a phone, where it is refused with a 401 that explains nothing.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { CodeIssued } from '../api/types'
import { I18nProvider } from '../i18n'
import { CodeDialog } from './CodeDialog'

const soon = () => new Date(Date.now() + 15 * 60_000).toISOString()

function show(code: CodeIssued, forName?: string) {
  localStorage.setItem('helsa.lang', 'en')
  return render(
    <I18nProvider>
      <CodeDialog code={code} forName={forName} onClose={() => {}} />
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
})
