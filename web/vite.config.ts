import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Put MapLibre's own web worker next to the built chunks.
 *
 * ⚠️ **Without this, vector tiles silently never load.** MapLibre resolves its
 * worker at runtime as `new URL('./maplibre-gl-worker.mjs', import.meta.url)` —
 * a template literal, so no bundler can see it, and Vite emits nothing. The
 * request then 404s inside `new Worker(...)`, which surfaces as: no error event,
 * no console message, a map canvas that renders its background colour, and four
 * tiles stuck in state `loading` for ever.
 *
 * ⛔ The trap is that RASTER TILES STILL WORK — they are decoded on the main
 * thread — so the feature looks fine in a screenshot of the public-provider
 * option and is broken in exactly one of the two. It cost most of an afternoon.
 *
 * The worker is not self-contained: it imports `./maplibre-gl-shared.mjs`, so
 * both files go, under their real names (the relative import between them has to
 * keep resolving) and beside the chunk that references them.
 */
function maplibreWorker(): Plugin {
  const require = createRequire(import.meta.url)
  const dist = dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'))
  const files = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']
  return {
    name: 'helsa:maplibre-worker',
    apply: 'build',
    generateBundle() {
      for (const name of files) {
        this.emitFile({
          type: 'asset',
          // ⚠️ `assets/`, not the root: the URL is resolved relative to the
          // importing chunk, and the chunks live in assets/.
          fileName: `assets/${name}`,
          source: readFileSync(join(dist, name)),
        })
      }
    },
  }
}

// The web is a READ-ONLY consumer: it reads from the backend API
// (docs/06-web-react.md). In dev mode the /v1 calls are proxied to the locally
// running backend, so there is no CORS to wrestle with; in production Caddy serves
// the static build and /v1 from the same host, so there is no cross-origin there
// either.
export default defineConfig({
  plugins: [react(), maplibreWorker()],
  // ⚠️ In dev the same resolution has to work, and pre-bundling breaks it: an
  // optimised `maplibre-gl` lives in `node_modules/.vite/deps/`, where its
  // sibling worker file is not. Served unbundled, `./maplibre-gl-worker.mjs`
  // resolves beside the real package and the worker starts.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  // ⚠️ These tests exist because there were none. ~4000 lines of code that displays
  // health numbers had no runner at all (`docs/25` F23), while `docs/17` described a
  // vitest / Testing Library / Playwright stack in the present tense.
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
  },
  server: {
    proxy: {
      '/v1': {
        target: process.env.HELSA_API ?? 'http://localhost:8080',
        changeOrigin: true,
      },
      // The map archives. ⚠️ In production these are static files served by the
      // same Caddy as everything else, so `/tiles/` is same-origin for free; in
      // dev the tiles live on whichever machine has them, and this proxy is what
      // keeps the origin single here too.
      //
      // ⛔ Deliberately a proxy and NOT a configurable tile URL in the app: the
      // browser must only ever be told to fetch from its own origin, in dev
      // exactly as in production. A build-time knob pointing elsewhere is how a
      // tile host ends up in a network log by accident.
      '/tiles': {
        target: process.env.HELSA_TILES ?? process.env.HELSA_API ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
