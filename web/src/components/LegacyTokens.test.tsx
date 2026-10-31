// The old-token notice (docs/36 W4): there only while such a token is in use, it
// asks before revoking, and says plainly when the asking device would lock itself out.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { I18nProvider } from '../i18n'
import { LegacyTokens } from './LegacyTokens'

function show(props: Partial<Parameters<typeof LegacyTokens>[0]> & { onRevoke?: () => Promise<void> }) {
  localStorage.setItem('helsa.lang', 'en')
  return render(
    <I18nProvider>
      <LegacyTokens onRevoke={async () => {}} {...props} />
    </I18nProvider>,
  )
}

const recently = () => new Date(Date.now() - 2 * 3600_000).toISOString()

describe('the old-token notice', () => {
  it('is not there when no old token is in use', () => {
    const { container } = show({ usedAt: undefined })
    expect(container).toBeEmptyDOMElement()
  })

  it('asks first, then revokes', async () => {
    let calls = 0
    show({
      usedAt: recently(),
      onRevoke: async () => {
        calls++
      },
    })
    expect(screen.getByText('An old sign-in of yours is still in use')).toBeInTheDocument()
    expect(screen.getByText(/First connect that device again with a code/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke old sign-ins' }))
    expect(calls).toBe(0)
    expect(screen.getByText(/Every old sign-in stops working at once/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await screen.findByRole('button', { name: 'Revoke old sign-ins' })
    expect(calls).toBe(1)
  })

  it("names the member on an admin's view", () => {
    show({ usedAt: recently(), name: 'Nóri' })
    expect(screen.getByText('Nóri still uses an old sign-in')).toBeInTheDocument()
    expect(screen.getByText(/First Nóri connects their device again/)).toBeInTheDocument()
  })

  it('explains the 409: this device would lock itself out', async () => {
    show({ usedAt: recently(), onRevoke: () => Promise.reject(new ApiError(409, 'x')) })
    fireEvent.click(screen.getByRole('button', { name: 'Revoke old sign-ins' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/this would lock it out/)
  })
})
