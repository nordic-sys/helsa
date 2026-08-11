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

The interface text is **Hungarian**; the code and the comments are English. The
contract already carries a `locale ∈ {hu, en}` setting, so translating the UI is a
matter of extracting the strings, not of restructuring anything.
