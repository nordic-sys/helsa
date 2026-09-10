// What keeps the sidebar from going flat again.
//
// The failure this pins is not hypothetical — it is what happened. Four pages
// were added on one day, each of them correctly told to "add a page to the nav",
// and the result was ten links in a row with no claim in them. These tests do
// not judge whether the grouping is good; they make it impossible to add a page
// without making the choice.

import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider, detectLang } from './i18n'
import { en } from './i18n/en'
import { hu } from './i18n/hu'
import { LANDING, NAV, NAV_GROUPS, entriesIn } from './nav'

// The frame is what is under test, not the pages inside it — but `nav.tsx`
// imports all ten of them, so the module they all reach for has to answer.
vi.mock('./api/client', () => ({
  api: new Proxy({}, { get: () => () => new Promise(() => {}) }),
  browserTz: () => 'UTC',
  getToken: () => null,
  setToken: () => {},
  clearToken: () => {},
  ApiError: class ApiError extends Error {
    status = 0
  },
}))

// recharts measures its container with a ResizeObserver, which jsdom does not
// implement — several of the imported pages would throw on render without it.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const { default: App } = await import('./App')

/** The dictionary the provider will actually pick in this environment. */
const dict = detectLang() === 'hu' ? hu : en

describe('the route table and the sidebar are the same list', () => {
  it('gives every page but the landing one a group', () => {
    const homeless = NAV.filter((n) => n.group === undefined).map((n) => n.path)
    expect(homeless).toEqual(['/'])
  })

  it('has exactly one landing page, and it is the root', () => {
    expect(LANDING).toHaveLength(1)
    expect(LANDING[0].path).toBe('/')
    // Without `end`, every other route would light the Today link up as active.
    expect(LANDING[0].end).toBe(true)
  })

  it('leaves no group empty and no group unlisted', () => {
    for (const group of NAV_GROUPS) expect(entriesIn(group.key).length).toBeGreaterThan(0)
    const listed = new Set<string>(NAV_GROUPS.map((g) => g.key))
    for (const entry of NAV) {
      if (entry.group) expect(listed.has(entry.group)).toBe(true)
    }
  })

  it('routes each path once', () => {
    const paths = NAV.map((n) => n.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('labels every entry and every heading in both languages', () => {
    for (const key of [...NAV.map((n) => n.label), ...NAV_GROUPS.map((g) => g.label)]) {
      expect(en.ui[key], `en: ${key}`).toBeTruthy()
      expect(hu.ui[key], `hu: ${key}`).toBeTruthy()
    }
  })
})

describe('the sidebar', () => {
  it('shows every heading and every link at once, with nothing to open first', () => {
    render(
      <I18nProvider>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <MemoryRouter initialEntries={['/settings']}>
            <App />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nProvider>,
    )

    const sidebar = screen.getByRole('navigation')
    for (const group of NAV_GROUPS) {
      // `role="group"` + `aria-labelledby`: the heading is announced together
      // with its links, which is the entire content of the grouping.
      expect(within(sidebar).getByRole('group', { name: dict.ui[group.label] })).toBeInTheDocument()
      for (const entry of entriesIn(group.key)) {
        expect(
          within(sidebar).getByRole('link', { name: dict.ui[entry.label] }),
        ).toBeInTheDocument()
      }
    }
    expect(within(sidebar).getByRole('link', { name: dict.ui['nav.today'] })).toBeInTheDocument()
  })
})
