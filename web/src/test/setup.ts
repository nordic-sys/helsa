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


// ⚠️ jsdom here has **no `localStorage`** — not an empty one, an absent one: the
// property exists as an accessor that returns `undefined`, because the document
// has an opaque origin and a storage area needs a real one.
//
// That matters more than it looks. The two things this app keeps in storage are
// the device token and the map-source setting, and every read of them is wrapped
// in a `try` — a private window, cleared site data and a browser that refuses
// storage are all real cases. So the missing API failed nothing: it silently took
// the fallback branch, which meant no test could ever exercise a stored setting,
// and a bug in one would have been invisible in a green suite.
//
// `defineProperty`, not assignment: the accessor jsdom installed has no setter,
// so `globalThis.localStorage = ...` is swallowed without an error — which is the
// second silent failure in the same three lines.
{
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() {
        return store.size
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    } as Storage,
  })
}
