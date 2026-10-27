// The site's structure — the sidebar and the router built from ONE list.
//
// # Why one list
//
// Until now the sidebar was an array of links in `App.tsx` and the router was
// the same pages again as `<Route>` elements beside it. Adding a page meant
// appending to both, and appending is all anybody ever did: four pages arrived
// in a single day, each of them correctly told to "add a page to the nav", and
// the result was a flat list of ten items that made no claim about anything.
//
// With the router generated from this array, a page cannot reach the web
// without being handed a group. That is the whole point of the file: the
// grouping is not a decoration on top of the routes, it IS the route table.
//
// # Why these groups
//
// The phone spent a design round on exactly this question and the answer is in
// `HelsaKit/Sources/HelsaKit/Dashboard/DashboardCard.swift`: twelve cards in
// four named bands, where the band is "an editorial claim — this is something
// you are expected to touch today versus this is something to look at". Two of
// those band names are reused here word for word, because they are claims about
// the content and the content is the same.
//
//   * **The long view** — the phone's `longTerm` band, which holds the monthly
//     challenge, the medals and the observations. The web adds Trends, which is
//     a tab on the phone only because a phone tab bar is the only place a metric
//     picker fits; the question it answers ("what has this metric done over
//     weeks") is the band's question.
//   * **Areas** — the phone's Workouts tab plus the two bespoke sections of its
//     Health tab (`HealthSection`: sleep and nutrition "do real analysis that no
//     generic card grid could stand in for"). Each is one domain, read entry by
//     entry: sessions, nights, nutrients.
//   * **Status** — the phone's `status` band, "whether the thing that moves your
//     data is working". Completeness is exactly that question, and so is the
//     ingest queue (is what the phone sent still on its way to the database?);
//     Settings is the rest of the same machinery — the token, the devices, the
//     goals.
//
// Today stays outside the groups because it is the landing page, not a peer of
// the pages listed under a heading.
//
// ⚠️ **What is deliberately NOT copied: the five tabs.** The phone has five
// because a phone shows one thing at a time and a sixth tab would fall into a
// "More" menu nobody opens (`HealthSection`'s own header says so). A sidebar at
// 1440 shows all ten links and their headings at once, so the web pays none of
// that cost — and copying the compromise would have buried Observations, Medals,
// the challenge and Completeness one level down for no reason.

import type { ReactElement } from 'react'
import type { UiKey } from './i18n'
import Dashboard from './pages/Dashboard'
import Trends from './pages/Trends'
import Insights from './pages/Insights'
import Workouts from './pages/Workouts'
import Achievements from './pages/Achievements'
import Sleep from './pages/Sleep'
import Nutrition from './pages/Nutrition'
import Challenge from './pages/Challenge'
import Coverage from './pages/Coverage'
import Ingest from './pages/Ingest'
import SettingsPage from './pages/Settings'
import WorkoutDetail from './pages/WorkoutDetail'
import Training from './pages/Training'
import MonthMedal from './pages/MonthMedal'
import PeriodSummary from './pages/PeriodSummary'
import YearByYear from './pages/YearByYear'

export type NavGroupKey = 'longView' | 'areas' | 'status'

/** The groups in sidebar order, with the heading each one is drawn under. */
export const NAV_GROUPS: { key: NavGroupKey; label: UiKey }[] = [
  { key: 'longView', label: 'nav.group.longView' },
  { key: 'areas', label: 'nav.group.areas' },
  { key: 'status', label: 'nav.group.status' },
]

export type NavEntry = {
  path: string
  label: UiKey
  element: ReactElement
  /** Absent on the landing page, and only there — see `nav.test.tsx`. */
  group?: NavGroupKey
  /** `end` for "/", so every other route does not light it up as active. */
  end?: boolean
}

export const NAV: NavEntry[] = [
  { path: '/', label: 'nav.today', element: <Dashboard />, end: true },

  { path: '/trends', label: 'nav.trends', element: <Trends />, group: 'longView' },
  // The year in numbers and year by year sit right under Trends because they
  // are the same question asked over a longer reach — weeks, then a named
  // period, then the years beside each other. On the phone the first is a card
  // and the second a screen under it (`PeriodSummaryView`, `RetrospectiveView`);
  // both are the `longTerm` band's question, "something to look at", not
  // something to touch today. The second is not called "The long view", as the
  // phone's screen is, because that is already the heading it stands under.
  { path: '/period', label: 'nav.period', element: <PeriodSummary />, group: 'longView' },
  { path: '/years', label: 'nav.years', element: <YearByYear />, group: 'longView' },
  { path: '/insights', label: 'nav.insights', element: <Insights />, group: 'longView' },
  { path: '/achievements', label: 'nav.achievements', element: <Achievements />, group: 'longView' },
  { path: '/challenge', label: 'nav.challenge', element: <Challenge />, group: 'longView' },

  { path: '/workouts', label: 'nav.workouts', element: <Workouts />, group: 'areas' },
  // Training progress sits in Areas, right under Workouts, and not in "The long
  // view" where its subject (weeks) might seem to point. On the phone it is a
  // section of the Workouts TAB, not a card of the long-term band: it is the
  // workouts domain read week by week rather than entry by entry, and the
  // reader who wants it is the one already looking at workouts. A sidebar link
  // rather than a tab inside the Workouts page, because that page is a two-pane
  // list + detail and a year-wide grid needs the whole column.
  { path: '/training', label: 'nav.training', element: <Training />, group: 'areas' },
  { path: '/sleep', label: 'nav.sleep', element: <Sleep />, group: 'areas' },
  { path: '/nutrition', label: 'nav.nutrition', element: <Nutrition />, group: 'areas' },

  { path: '/coverage', label: 'nav.coverage', element: <Coverage />, group: 'status' },
  { path: '/ingest', label: 'nav.ingest', element: <Ingest />, group: 'status' },
  { path: '/settings', label: 'nav.settings', element: <SettingsPage />, group: 'status' },
]

/**
 * Pages that are opened FROM a page rather than from the sidebar.
 *
 * ⚠️ **This is not a loophole in the rule above, it is the rule applied to a
 * second kind of page.** A sidebar entry has to name the group it belongs to; a
 * detail page has to name the listing it opens from — because a detail page that
 * belongs to no listing is a URL nothing links to, and that is the same failure
 * the grouping exists to prevent. `nav.test.tsx` checks that every `parent`
 * below is a real `NAV` path.
 *
 * They stay out of `NAV` because they are not links: `/workouts/:id` has no
 * standalone meaning to put in a sidebar, and a route with a parameter cannot be
 * one.
 */
export type DetailEntry = {
  path: string
  /** The `NAV` path this page is reached from. */
  parent: string
  element: ReactElement
}

export const DETAILS: DetailEntry[] = [
  { path: '/workouts/:id', parent: '/workouts', element: <WorkoutDetail /> },
  { path: '/achievements/:month', parent: '/achievements', element: <MonthMedal /> },
]

/** The landing page — the one entry that stands outside the groups. */
export const LANDING = NAV.filter((n) => n.group === undefined)

export function entriesIn(group: NavGroupKey): NavEntry[] {
  return NAV.filter((n) => n.group === group)
}
