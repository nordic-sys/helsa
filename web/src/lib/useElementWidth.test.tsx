import { act, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useElementWidth } from './useElementWidth'

/** A ResizeObserver that reports a fixed width as soon as it observes. */
class FakeRO {
  constructor(private cb: ResizeObserverCallback) {}
  observe() {
    this.cb([{ contentRect: { width: 320 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
  disconnect() {}
  unobserve() {}
}

afterEach(() => vi.unstubAllGlobals())

/**
 * ⚠️ The Trends chart mounts its container only after the first load. With a
 * `RefObject` the hook looked once, at mount, saw nothing, and the width stayed
 * 0 for good — so the x labels were never thinned and overlapped at 390 px.
 */
describe('useElementWidth', () => {
  it('measures an element that appears after the first render', () => {
    vi.stubGlobal('ResizeObserver', FakeRO)
    let show: (v: boolean) => void = () => {}
    let seen = -1
    function Probe() {
      const [visible, setVisible] = useState(false)
      show = setVisible
      const [ref, width] = useElementWidth()
      seen = width
      return visible ? <div ref={ref} /> : <p>loading</p>
    }
    render(<Probe />)
    expect(seen).toBe(0)
    act(() => show(true))
    expect(seen).toBe(320)
  })
})
