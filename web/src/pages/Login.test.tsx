// The sign-in page's answers (docs/36 §9, A3): one sentence for every way a
// code can be wrong — the server deliberately does not say which — and a
// separate one for "too many tries", which has a different remedy.

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import Login from './Login'

const webLogin = vi.fn<(code: string) => Promise<void>>()
vi.mock('../api/client', () => ({ api: { webLogin: (c: string) => webLogin(c) } }))

const fail = (status: number) => Object.assign(new Error('x'), { status })

function show() {
  localStorage.setItem('helsa.lang', 'en')
  const onSignedIn = vi.fn(async () => {})
  render(
    <I18nProvider>
      <Login reason="none" legacyNotice={false} onSignedIn={onSignedIn} />
    </I18nProvider>,
  )
  return onSignedIn
}

async function submit(code: string) {
  await userEvent.type(screen.getByRole('textbox', { name: 'Sign-in code' }), code)
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  webLogin.mockReset()
})

describe('the sign-in page', () => {
  it('names every reason at once when the code is refused', async () => {
    webLogin.mockRejectedValue(fail(401))
    const onSignedIn = show()
    await submit('K7QM-4XPA')
    expect(
      await screen.findByText(/did not accept this code\. It may have expired .*, been used already, or been mistyped — ask for a new one\./),
    ).toBeInTheDocument()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('says "wait" — not "wrong code" — when there were too many tries', async () => {
    webLogin.mockRejectedValue(fail(429))
    show()
    await submit('K7QM-4XPA')
    expect(await screen.findByText(/Too many attempts failed\. Wait a quarter of an hour/)).toBeInTheDocument()
    expect(screen.queryByText(/did not accept/)).not.toBeInTheDocument()
  })

  it('catches an obvious typo without asking the server', async () => {
    show()
    await submit('K7QM-4X')
    expect(await screen.findByText(/eight characters/)).toBeInTheDocument()
    expect(webLogin).not.toHaveBeenCalled()
  })

  it('goes on once the server accepts', async () => {
    webLogin.mockResolvedValue()
    const onSignedIn = show()
    await submit('k7qm 4xpa')
    expect(webLogin).toHaveBeenCalledWith('K7QM-4XPA')
    expect(onSignedIn).toHaveBeenCalled()
  })
})
