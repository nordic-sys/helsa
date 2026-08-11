# web

The Helsa dashboard: **React + Vite + TypeScript**, a read-only consumer of the
backend API.

```bash
npm install
npm run dev       # :5173, /v1 proxied to http://localhost:8080
npm run build     # a static build into dist/
npm run lint      # tsc --noEmit
```

`npm run gen:api` regenerates the full contract types from
`../backend/api/openapi.yaml`. The views, however, use the narrow, hand-written set
in `src/api/types.ts` — that way a contract change surfaces as a compile error
rather than at runtime.

## Access

There is **no sign-in screen**. Access is layered (`docs/08-auth-hozzaferes.md`):

1. **network** — the dashboard is reachable over WireGuard only; the proxy serves it
   on a port that is deliberately not forwarded on the router;
2. **application** — a long-lived device token, entered once per machine on the
   Settings page.

In a single-user system there is nobody to sign in, so a login flow would be
ceremony without a purpose.

## What is worth knowing about the code

- **`src/lib/metrics.ts`** is the presentation catalog for the HealthKit quantity
  types: display name, unit, group, colour, and — most importantly — whether the
  metric is **summed or averaged**. Getting that wrong produces a plausible-looking
  false number, which is why it is stated per metric rather than guessed.
- **`src/lib/useAvailability.ts`** answers "which metrics have any data at all". The
  catalog knows ~100 types and a given person will have data for a handful; without
  this, every picker would be a hundred rows of "–".
- **`src/lib/sleep.ts`** derives sleep quality. HealthKit has no such field —
  duration, efficiency and awakenings are all computed from the raw stage segments,
  grouped into nights rather than calendar days.

## Language

The interface speaks **Hungarian and English**, switchable at runtime from the
sidebar (and from Settings). The starting language comes from `navigator.language`
— anything that is neither Hungarian nor English lands on English — and a choice
made in the switcher is remembered in `localStorage`.

The whole of it lives in `src/i18n/`, hand-rolled rather than pulled from a
library: two languages and a few hundred keys need a typed record and `Intl`, not
a framework. `hu.ts` defines the key set, `en.ts` is typed as its shape, so a
missing translation is a **compile error**. `MetricKey` is derived from the
dictionary too, which means the ~105-entry metric catalog in `lib/metrics.ts`
cannot name a metric that has no display name.

Formatting is part of translation, not separate from it: `useFormat()` builds its
number, date, duration and relative-time formatters from the active locale via
`Intl`, so `1 234,6` / `1,234.6` and `2026. aug. 11.` / `Aug 11, 2026` both follow
the language. Units are stored as canonical tokens (`min`, `count/min`) and
translated on the way out, which is also how the server's units are rendered.

**Not translated, on purpose** — this is server content, not interface text:

- the `/insights` sentences, which the backend composes in Hungarian;
- `problem+json` error titles and details (the UI's own fallbacks *are*
  translated);
- device names, platform strings and the `unit_system` value, which are echoed
  back as they were registered.
