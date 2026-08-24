import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { I18nProvider } from '../i18n'
import { Ring } from './ui'

const show = (node: ReactNode) => render(<I18nProvider>{node}</I18nProvider>)

/**
 * ⚠️ **The rule the whole product is built on: a missing measurement is not a zero.**
 *
 * The backend refuses to conflate them (`summary.go` argues it at length), the phone app
 * prints an em dash everywhere rather than a 0, and the formatter here has a dash of its
 * own. The web undid all of it on the last metre with a `?? 0` at the call site — which
 * fed the formatter a zero before it could say anything, in the visible text AND in the
 * label a screen reader announces.
 *
 * On a health screen "0 kcal" is read in half a second and understood as a statement
 * about the day: that this person moved not at all. Nobody measured that.
 */
describe('a ring never invents a zero', () => {
  it('shows a dash when the value has not arrived', () => {
    show(<Ring label="Move" value={undefined} goal={500} color="red" unit="kcal" />)
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('says the same thing to a screen reader', () => {
    show(<Ring label="Move" value={undefined} goal={undefined} color="red" unit="kcal" />)
    const label = screen.getByRole('img').getAttribute('aria-label') ?? ''
    expect(label).toContain('–')
    expect(label).not.toMatch(/\b0\b/)
  })

  it('a measured zero is still a zero — the two are different facts', () => {
    show(<Ring label="Move" value={0} goal={500} color="red" unit="kcal" />)
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('draws no arc without a goal, rather than dividing by nothing', () => {
    show(<Ring label="Move" value={250} goal={0} color="red" unit="kcal" />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})
