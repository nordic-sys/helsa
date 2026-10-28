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
//     Settings is the rest of the same machinery — the devices, the goals; and
//     for an admin, the Household: who sends to this server at all.
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
import Journey from './pages/Journey'
import Coverage from './pages/Coverage'
import Ingest from './pages/Ingest'
import SettingsPage from './pages/Settings'
import WorkoutDetail from './pages/WorkoutDetail'
import Training from './pages/Training'
import MonthMedal from './pages/MonthMedal'
import PeriodSummary from './pages/PeriodSummary'
import YearByYear from './pages/YearByYear'
import Report from './pages/Report'
import Measurements from './pages/Measurements'
import Journal from './pages/Journal'
import Household from './pages/Household'
import MemberPage from './pages/Member'
import Account from './pages/Account'

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
  /**
   * Drawn and routed for an admin only. ⚠️ Hiding is a courtesy, not the
   * protection: the server answers 403 to a member regardless (authz.go).
   */
  adminOnly?: boolean
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
  // The health summary closes that run of summaries, and in "The long view"
  // rather than in Status beside Settings — although on the phone it opens from
  // Settings and from Export (`SettingsView`, `ExportView`). There it sits next
  // to the export because a phone hands a file over through the share sheet, and
  // the share sheet lives there; the web's Print button is on the page itself,
  // so the web owes the machinery nothing. What is left is the content, and the
  // content is the band's question: what the last one to twelve months were,
  // against the person's own usual range — something to look at and hand over,
  // not something to touch today. Status is "whether the thing that moves your
  // data is working", which a printed summary does not answer.
  { path: '/report', label: 'nav.report', element: <Report />, group: 'longView' },
  { path: '/insights', label: 'nav.insights', element: <Insights />, group: 'longView' },
  { path: '/achievements', label: 'nav.achievements', element: <Achievements />, group: 'longView' },
  { path: '/challenge', label: 'nav.challenge', element: <Challenge />, group: 'longView' },
  // The journey sits right after the challenge, as on the phone, where both are
  // cards of the `longTerm` band (`DashboardCard.journey`): a distance that never
  // resets, read against a route — something to look at, not something to touch
  // today. It exists on the web only because the phone uploads which route and
  // from which day (app 1.0 (7) on); the routes are a generated copy of the app's.
  { path: '/journey', label: 'nav.journey', element: <Journey />, group: 'longView' },

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
  // Measurements is the REST of the phone's Health tab: the generic card grid
  // (`MetricGroupSectionView`) the two bespoke sections above stand beside. So it
  // sits in Areas, right after them — one domain per catalog group, read card by
  // card — and not in "The long view": a card leads with the latest reading and
  // when it was taken, which is a today question, and the weeks-long question is
  // what each card's link to Trends is for. After Sleep and Nutrition rather than
  // before, because those two "earned" bespoke pages (`HealthSection`'s words)
  // and the grid is everything that did not need one.
  { path: '/measurements', label: 'nav.measurements', element: <Measurements />, group: 'areas' },
  // The journal and events close Areas: one more domain read entry by entry —
  // the noted days, the alerts, the illness episodes — and on the phone they
  // are screens of the Health tab's own (`DailyContextView`, `HealthEventsView`,
  // `IllnessEpisodesView`), not cards of the long-term band. Not in "The long
  // view" although the mood strip spans months: what the page answers is "what
  // did I note, and what did the watch flag", entry by entry, and the long
  // question (does it move with a metric) is deliberately not asked here.
  // Last in the group because it is the one page that may be empty by design:
  // the phone sends the journal only when its owner turns on a separate,
  // off-by-default switch (app 1.0 (7) on), and the page says so.
  { path: '/journal', label: 'nav.journal', element: <Journal />, group: 'areas' },

  { path: '/coverage', label: 'nav.coverage', element: <Coverage />, group: 'status' },
  { path: '/ingest', label: 'nav.ingest', element: <Ingest />, group: 'status' },
  { path: '/settings', label: 'nav.settings', element: <SettingsPage />, group: 'status' },
  // The household sits in Status, last (docs/36 §5): who uploads to this server
  // and from which device is the same question as "is the thing that moves the
  // data working", asked about people. No new group for one admin-only page.
  { path: '/household', label: 'nav.household', element: <Household />, group: 'status', adminOnly: true },
]

/**
 * Pages reached from the user menu (`components/UserMenu.tsx`), not the
 * sidebar: they are about the person signed in, not about the data. Routed like
 * the others, and checked in `nav.test.tsx` like the others.
 */
export const MENU: { path: string; label: UiKey; element: ReactElement }[] = [
  { path: '/account', label: 'nav.account', element: <Account /> },
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
  { path: '/household/:id', parent: '/household', element: <MemberPage /> },
]

/** The landing page — the one entry that stands outside the groups. */
export const LANDING = NAV.filter((n) => n.group === undefined)

/** A group's entries — without the admin-only ones unless `isAdmin`. */
export function entriesIn(group: NavGroupKey, isAdmin = true): NavEntry[] {
  return NAV.filter((n) => n.group === group && (isAdmin || !n.adminOnly))
}

/** The parent entry of a detail page, so it can inherit `adminOnly`. */
export function parentOf(detail: DetailEntry): NavEntry | undefined {
  return NAV.find((n) => n.path === detail.parent)
}
