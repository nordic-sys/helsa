import { expect, it } from 'vitest'
import { coverageVerdict } from './compare'

it('withholds judgement when one period was measured far less than the other', () => {
  // The reviewer's case: one measured day against seven.
  expect(coverageVerdict({ measured: 1, total: 7 }, { measured: 7, total: 7 })).toBe('uneven')
  expect(coverageVerdict({ measured: 7, total: 7 }, { measured: 1, total: 7 })).toBe('uneven')
})

it('compares periods measured on a similar share of their days', () => {
  expect(coverageVerdict({ measured: 6, total: 7 }, { measured: 7, total: 7 })).toBe('comparable')
  expect(coverageVerdict({ measured: 4, total: 7 }, { measured: 7, total: 7 })).toBe('comparable')
  // Shares, not counts: three of a three-day stub beside seven of seven.
  expect(coverageVerdict({ measured: 3, total: 3 }, { measured: 7, total: 7 })).toBe('comparable')
})
