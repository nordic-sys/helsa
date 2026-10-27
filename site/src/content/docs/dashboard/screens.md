---
title: The screens
description: "What each of the twelve pages shows, and the rules behind the numbers on it."
sidebar:
  order: 1
---
Eleven pages in the sidebar, plus one that opens from a listing.

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

## Ingest queue

What the phone sent and the server has not yet written. The phone uploads much
faster than the worker writes: on a first install, years of history can arrive in
minutes and then take the worker the better part of an hour. While that runs, the
other pages look as if data were missing — this page shows that it is on its way.
It refreshes itself every five seconds.

| On the page | What it means |
|---|---|
| **Waiting** | Batches in the queue not yet handed to a worker. Exact. The "+ up to N in progress" beside it is an upper bound on the batches a worker is holding (its prefetch × the workers connected); plain AMQP cannot count those exactly. |
| **Dead-letter queue** | Batches the worker gave up on, why it gave up on the most recent ones, and a button that sends them back for another try. See below. |
| **Workers connected** | Consumers on the queue. Batches waiting and **zero** workers is the failure that looks like slowness — the page says so in red, because the queue will not go down at all. |
| **Batches / min**, **Items / min** | Finished over the last ten minutes, or since the worker started if that is more recent. An item is a sample, workout, sleep segment, activity summary or deletion. |
| **About N left** | The waiting batches divided by the recent batch rate. **An estimate**: batches differ in size, so it moves. It is left out whenever it would be invented — nothing waiting, no worker, or nothing finished in the window. |
| **Worker** | When the worker started, when it last finished a batch, and its totals since the start (they restart from zero with the worker). |

:::danger[A non-empty dead-letter queue is data that is not on the server]
A batch the worker could not write goes to `helsa.ingest.dlq`, and **nothing retries
it on its own** — every processing error ends there, including a database that was
restarting at the wrong moment. The page puts this above everything else.
:::

**Why it failed.** Under the count the page lists the worker's reasons for its most
recent failures (up to 20, kept for 30 days): when, which batch, how many items it
held, and the error. The error is the worker's own message with every number and
quoted string blanked out (`#`, `"…"`), so no measured value can reach the page
through a database error; what identifies — a `source_uuid`, a `SQLSTATE` code, a
host address — is kept. Two things this list is **not**:

- **Not a listing of the dead-letter queue.** RabbitMQ cannot show what is in a queue
  without taking it out. An entry stays after its batch has been sent back, which is
  why the page also shows when the last retry ran.
- **Not complete for old batches.** A batch dead-lettered before the server recorded
  reasons has none — the page says *reason not recorded*. The full error is still in
  the worker log (`docker compose logs worker`, the `process batch` lines).

**Retry.** The button moves the dead-lettered batches back onto `helsa.ingest`, and
the worker processes them again. It is safe to press: the writes are idempotent
upserts keyed on `source_uuid`, so a batch written twice stores nothing twice, and a
batch is removed from the dead-letter queue only after RabbitMQ has confirmed the copy
on the main queue — a batch is never lost on the way, at worst it is briefly in both.
One press moves at most 1000; press again for the rest.

Fix the cause first. A batch that failed because the database was restarting will go
through; one that fails on its content will be back in the dead-letter queue within
seconds. Every retry is counted on the batch, and from the third one the page says so
— *this one has failed N times after retries* — because pressing again is then
unlikely to help. Nothing is ever retried automatically.

When the API cannot reach RabbitMQ the page says so and shows **no** queue figures —
an unknown depth is not an empty queue. When the worker's counters (in Redis) cannot
be read, the depth is still shown and the rate and estimate are marked unknown.

## Settings

The device token, the devices that have one, the goals, the language, the time
zone — and [the map source](/deployment/map-tiles/).

There is no sign-in on this page because there is no second user. What it does
carry is the honest description of the two access layers, which is the thing worth
understanding before opening a port.
