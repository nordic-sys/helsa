import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { I18nProvider } from './i18n'
import './styles/global.css'

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // The data refreshes a couple of times a day (the phone syncs in the
      // background), so there is no point in refetching aggressively.
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        // On a 401/403 there is no point retrying — the token is missing or wrong.
        const status = (err as { status?: number })?.status
        if (status === 401 || status === 403) return false
        return count < 2
      },
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <QueryClientProvider client={qc}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </I18nProvider>
  </React.StrictMode>,
)
