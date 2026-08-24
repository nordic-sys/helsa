import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'
import { createElement } from 'react'
import { I18nProvider } from '../i18n'
import { useFormat } from './format'

/**
 * ⚠️ The dash is a rule, not a style choice, and it is the same rule the phone app
 * enforces everywhere: **a missing measurement is never a zero**. On a health screen a
 * "0" is read in half a second and understood as a statement about the day — that the
 * person walked no steps, drank nothing, slept not at all.
 *
 * The formatter gets this right on its own. What these tests are really guarding is that
 * nobody feeds it a `?? 0` before it can do its job, which is exactly the defect the
 * component tests next door catch.
 */
const wrap = ({ children }: { children: ReactNode }) => createElement(I18nProvider, null, children)
const format = () => renderHook(() => useFormat(), { wrapper: wrap }).result.current

describe('the missing value is a dash, never a zero', () => {
  it.each([
    ['num', (f: ReturnType<typeof format>) => f.num],
    ['num1', (f: ReturnType<typeof format>) => f.num1],
    ['percent', (f: ReturnType<typeof format>) => f.percent],
    ['km', (f: ReturnType<typeof format>) => f.km],
    ['duration', (f: ReturnType<typeof format>) => f.duration],
  ])('%s', (_name, pick) => {
    const fn = pick(format())
    expect(fn(undefined)).toBe('–')
    expect(fn(null)).toBe('–')
  })

  it('a real zero still prints as zero — the two are different facts', () => {
    const f = format()
    expect(f.num(0)).toBe('0')
    expect(f.num(0)).not.toBe('–')
  })

  it('an unparseable date is a dash rather than "Invalid Date"', () => {
    const f = format()
    expect(f.date(undefined)).toBe('–')
    expect(f.date('not-a-date')).toBe('–')
  })
})

describe('numbers are formatted, not concatenated', () => {
  it('rounds to whole numbers and keeps one decimal where asked', () => {
    const f = format()
    // ⚠️ 1235, not 1234: `num` rounds. The group separator is locale-dependent, hence the dot.
    expect(f.num(1234.56)).toMatch(/1.235/)
    expect(f.num1(1234.56)).toMatch(/1.234[.,]6/)
  })

  it('promotes metres to kilometres once that is the honest unit', () => {
    const f = format()
    expect(f.km(500)).toMatch(/500/)
    expect(f.km(5000)).toMatch(/5/)
    expect(f.km(5000)).toMatch(/km/)
  })
})
