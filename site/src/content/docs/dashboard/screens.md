---
title: The screens
description: "What each of the eleven pages shows, and the rules behind the numbers on it."
sidebar:
  order: 1
---
Ten pages in the sidebar, plus one that opens from a listing.

## Today

The landing page: the day as it stands. Rings, the day's numbers, the most recent
workout, hydration, the journal prompt and the observations — the same cards the
phone's Today tab carries, in the same four bands.

## Trends

Longer-term movement for one metric, bucketed **in your own time zone**.

Two things it does that a plain chart does not:

- **It steps and drills.** Year → month → week → day, and back. Stepping stops at
  the present rather than walking into empty future buckets.
- **Two kinds of window, deliberately.** The window is *rolling* when you open the
  page — the last 30 days, ending today — and *calendar* once you drill into one,
  because "August" means August. A chart that silently changed which kind it was
  showing would be comparing two different things under one label.

Behind it sits [your usual range](/api/reading-data/#your-usual-range): the
middle of your own last 60 days, and five levels for where the period stands
against it. Below 14 measured days there is no band at all — not a wider one, not
a guess.

## Observations

:::danger
**Statistics, not medicine.** Nothing on this page is a diagnosis or advice, and no
threshold on it is a clinical one. See the [disclaimer](/disclaimer/).
:::

What the rules found in the measured days: a rolling average, a z-score, a
correlation. **There is no model here**, and no rule guesses at a day that was not
measured. Each observation says which rule produced it and on how much data, so an
observation resting on four days cannot look like one resting on ninety.

## Medals

Milestones already earned, grouped into families that collapse. Each one is a
**historical fact** — the record of a condition that was met at a given moment,
kept as it stood then. A milestone you later changed does not rewrite a badge you
already have.

Opening a month gives its detail sheet, a daily grid, and the daily average on the
caption.

## Monthly challenge

The step challenge the phone draws as a trail, in numbers: the month's total, the
milestones it passed, the streak, and how many days are left.

Three rules worth knowing, all of them visible on the page:

- **The total is what you walked**, never clipped to the goal; it is the
  percentage that stops at 100.
- **Today counts as remaining, not elapsed** — there are still steps to be taken
  today. This matters because the elapsed count is the denominator of the daily
  average.
- **The streak is a lower bound.** The phone knows days that do not break a streak
  — an illness day from the journal, a rest day you chose — and neither reaches
  the server. This streak can be shorter than the phone's, never longer.

## Workouts

Sessions grouped by the month you trained in, newest first. A closed month is one
line until you open it, and **a session two devices recorded is one row** — a
watch and a phone recording the same run must not make the month's total count it
twice.

## Workout detail

One recording, opened from the listing: the summary figures, the splits, the
heart-rate trace, the weather at the time, and the route.

The route is **drawn**, not screenshotted — the line, the start and finish
markers, and a scale bar. Whether a map goes behind it is
[a setting whose default is no map](/deployment/map-tiles/), and with the
setting off the page contacts nothing but the Helsa server.

## Sleep

Night by night, broken into stages. **The quality figures are derived** —
efficiency, awakenings, stage shares — because HealthKit has no "sleep quality"
field, and a number presented as measured when it was computed is the kind of
claim this project does not make. A night is a run of segments, not a calendar
day.

## Nutrition

Energy consumed, macros and micronutrients. A meal-logging app writes these into
Health and the dashboard only reads them — ⚠️ with one exception, and it is on this
page: **water**. That is the one nutrition value Helsa writes, from the phone, when
you log a glass.

## Completeness

Which of your measurements are arriving here, on how many days, when the last one
came, and which source wrote it — across the whole catalog, including the types
nothing has ever arrived for.

:::caution
**This is a narrower question than the app's completeness screen, and its wording
differs on purpose.** The phone knows about permissions; the server does not. A
type that was never granted and a type that has no sensor arrive here identically,
as an absence — so every state on this page is a statement about *what reached
this server*, never about what your phone was asked.
:::

## Settings

The device token, the devices that have one, the goals, the language, the time
zone — and [the map source](/deployment/map-tiles/).

There is no sign-in on this page because there is no second user. What it does
carry is the honest description of the two access layers, which is the thing worth
understanding before opening a port.
