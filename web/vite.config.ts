import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The web is a READ-ONLY consumer: it reads from the backend API
// (docs/06-web-react.md). In dev mode the /v1 calls are proxied to the locally
// running backend, so there is no CORS to wrestle with; in production Caddy serves
// the static build and /v1 from the same host, so there is no cross-origin there
// either.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/v1': {
        target: process.env.HELSA_API ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
