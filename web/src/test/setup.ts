import '@testing-library/jest-dom/vitest'

// jsdom has no `ResizeObserver`, and recharts' `ResponsiveContainer` constructs
// one the moment it mounts — so any test that renders a chart dies with an
// uncaught `ReferenceError` rather than a failed assertion, which is a confusing
// way to be told the environment is missing a browser API.
//
// A no-op is the right stub: it never reports a size, so the container stays at
// 0×0 and the chart draws nothing. That is fine — jsdom has no layout to measure
// anyway, and what the chart-bearing tests actually assert is the text around it.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
