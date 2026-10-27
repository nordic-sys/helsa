---
title: The screens
description: "What each of the twelve pages shows, and the rules behind the numbers on it."
sidebar:
  order: 1
---
Eleven pages in the sidebar, plus one that opens from a listing.

## Today

The landing page: the day as it stands, in three of the phone's four bands — the
fourth, "what today asks of you", is all writes into Health, which only the phone
can make. **Today, about you**: steps, active energy, resting heart rate and HRV
(each opens Trends on that metric; a metric not measured yet today is a dash, not
a zero), the three rings, the most recent workout and last night with its stages.
*Last night* is the newest **overnight** session — one that crosses midnight or
starts in the small hours — so a nap after it does not take its place; when the two
days hold none, the card says *latest sleep* instead. A session with time in bed but
no asleep segment says *sleep duration not recorded*, never "0 min".
**The long view**: the monthly challenge, the observations and the medals.
**Status**: sync and completeness.

The page keeps itself current: while the worker writes, the cards reload (at most
once a minute, whenever the worker's count of written batches has moved), and a page
left open past midnight moves on to the new day by itself. The same holds for Trends.

The pill at the top reads the **sync queue**, not the phone. The phone counts an
upload as done the moment it has handed it over, while the server may still be
writing it for half an hour — so the pill says *up to date — nothing left to write*
only when nothing is waiting, nothing is set aside **and** nothing has finished for
30 seconds (see [the sync queue](#sync-queue) for why an empty queue is not enough),
and otherwise what the queue holds (with the server's estimate) and links to the
queue.

The **Sync** card says when a device was **last seen** — a heartbeat, which
registering a device also touches — and, separately, what the whole queue holds.
Nothing in the API ties a device's last contact to the batches in the queue, so the
card does not call it an upload or say the backlog is "part of it".

## Trends

Longer-term movement for one metric, bucketed **in your own time zone**.

Two things it does that a plain chart does not:

- **It steps and drills.** Year → month → week → day, and back. Stepping stops at
  the present rather than walking into empty future buckets. Drilling works without
  a mouse too: *The numbers behind the chart*, under it, lists every bucket (an
  unmeasured one as *not measured*) and each period opens like a tap on the chart.
  While a new period loads, the old chart stays, a line above it says so, and it
  cannot be drilled into.
- **Two kinds of window, deliberately.** The window is *rolling* when you open the
  page — the last 30 days, ending today — and *calendar* once you drill into one,
  because "August" means August. A chart that silently changed which kind it was
  showing would be comparing two different things under one label.

Behind it sits [your usual range](/api/reading-data/#your-usual-range): the
middle of your own last 60 days, and five levels for where the period stands
against it. Below 14 measured days there is no band at all — not a wider one, not
a guess — and the page says so; when the reference has enough days but every one
carried the same value, it says *that* instead, because "not enough data" would then
be false. The dashed line in the band is your **average** (the API sends a mean,
not a median).

A day nothing was measured on is a **gap in the line**, not a slope drawn across it,
and a measured day with no measured neighbour is a dot. The comparison with the
previous period shows on how many days each was measured; when the two differ a lot
(less than half the share), a summed total is not compared at all — one measured day
against seven is a sync gap, not a fall — and an average is shown with that caveat.

Beside the total, a summed metric shows **a day** — the average of the days that
carried a measurement, and it says over how many. Dividing by the window's length
would count a day the phone did not sync as a day of sitting still. The metric is
in the address (`/trends?metric=…`), so a chart is a link.

Under the chart, the week and month views add **Day by day**: the window as a
weekday grid, a column per day with its exact value under it, scaled to the
window's own best day. It answers what a curve cannot — which weekday each number
fell on ("every Sunday is empty"). An unmeasured day is an empty cell with a dash,
never a zero-height bar, and the grid counts how many there are. The week starts on
the day your region starts it (Monday in Hungary and most of Europe); the weekday
letters follow the page's language. The day view (hours) and the year view (months)
have no grid, because their cells are not days.

For **body mass** (and lean body mass) the chart also carries a **trend line** — a
weighted moving average that smooths the day-to-day swing of salt, water and the
hour of the weighing — drawn over the weighings, never instead of them. A card
beside the comparison gives its **change in kg/week** over the last 28 days. Both
follow the phone's rules exactly: the smoothing decays with the days actually
elapsed between two weighings, the line breaks across a gap of more than 21 days,
and below 5 weighings or 14 days in one unbroken stretch there is no line at all —
the card says why instead. That is also why the week view always explains rather
than draws: seven days are shorter than the minimum. The year view gets no line,
because its buckets are already monthly averages. No colour and no verdict: losing
weight is not automatically good, and the page does not know what you are after.

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

A monthly medal's period is a link. Opening it (`/achievements/2026-08`) shows the
month as the medal recorded it — the steps it was earned with, that total spread
over **the whole month** as a daily average, and the milestones that were in force,
marked by the medal's own value — and under it a **day-by-day grid** of the month.
The grid is the only part read fresh (from the [monthly challenge](#monthly-challenge)
endpoint), because it is the one thing a medal does not store; if it cannot be
read, the rest of the page stands. When some days were not measured, a second
average over the measured days alone is printed beside the first, labelled, because
the difference between the two is exactly how much of the month is missing. A
solid column is a day that met the daily target — the month's goal over its days.
A medal that kept no milestone snapshot says so instead of guessing them.

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
line until you open it, and **a session that looks as if two devices recorded it is
one row** (marked ×2) — a watch and a phone recording the same run must not make the
month's total count it twice. "Looks as if" is the honest word: Health keeps no link
between two recordings, so the page infers it from the same activity type at
overlapping times (at least 70% of their combined span, or starts within five
minutes), calls them *possible matching recordings*, and says whether their
duration, distance and energy agree within 0.5% — the only fields it compares.

On a wide screen the list and the opened session sit side by side: a row selects
the session into the right-hand half, and the choice is kept in the address
(`/workouts?w=…`). On a narrow one a row opens the session's own page, and so
does a `?w=` address — a bookmark, or the latest-workout link on Today. The filter
takes the type (several at once), indoor or outdoor and a minimum length in one
row; distance, energy and heart-rate limits are under *More filters*.

## Workout detail

One recording, opened from the listing: the summary figures, the splits, the
heart-rate trace, the weather at the time, and the route.

The summary figures are this recording's own; the **heart-rate trace is not**. A
heart-rate sample carries no link to a workout, so the trace — and the lowest,
average and highest above it — is every sample recorded in the session's time
window, by any device, and the page says so under it every time.

The route is **drawn**, not screenshotted — the line, the start and finish
markers, and a scale bar. Whether a map goes behind it is
[a setting whose default is no map](/deployment/map-tiles/), and with the
setting off the page contacts nothing but the Helsa server.

## Sleep

Night by night, broken into stages. **The quality figures are derived** —
efficiency, awakenings, stage shares — because HealthKit has no "sleep quality"
field, and a number presented as measured when it was computed is the kind of
claim this project does not make. A night is a run of segments, not a calendar
day. A night that recorded only time in bed has no sleep duration — it is shown as
*not recorded* and left out of the averages, never counted as a night of zero sleep.

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

## Sync queue

The page at `/ingest` (it was called *Ingest queue*). The page says *parts*, *set
aside* and *worker*; the table below gives RabbitMQ's own words, which the logs use.

What the phone sent and the server has not yet written. The phone uploads much
faster than the worker writes: on a first install, years of history can arrive in
minutes and then take the worker the better part of an hour. While that runs, the
other pages look as if data were missing — this page shows that it is on its way.
It refreshes itself every five seconds.

| On the page | What it means |
|---|---|
| **Waiting to be written** | Batches in the queue not yet handed to a worker. Exact. The "+ up to N in progress" beside it is an upper bound on the batches a worker is holding (its prefetch × the workers connected); plain AMQP cannot count those exactly. ⚠️ So **zero waiting is "nothing waiting for delivery", not "everything written"**: the page says *the worker may still be finishing up to N*, and says *nothing left to write* only once no batch has finished for 30 seconds — the one piece of completion evidence the status carries. With no worker connected an empty queue is final (a batch a worker held goes back to the queue when it disconnects). |
| **Set aside** | The dead-letter queue: batches the worker gave up on, why it gave up on the most recent ones, and a button that sends them back for another try. See below. |
| **Worker** | Consumers on the queue, in one word: *Working* only when a batch finished in the last two minutes; *Nothing finished recently* when the worker reports and nothing has; *Connected* when its counters cannot be read (Redis down, or a worker too old to report) — whether it moves is then **unknown**, which is not the same as not moving. Batches waiting and **zero** workers is the failure that looks like slowness — the page says so in an alert, because the queue will not go down at all. |
| **Rate** (parts and items a minute) | Finished over the last ten minutes, or since the worker started if that is more recent. An item is a sample, workout, sleep segment, activity summary or deletion. |
| **About N** | **For the current backlog, if nothing more arrives**: the waiting batches (plus the in-progress bound) divided by the recent batch rate. **An estimate**: batches differ in size, and the status has no arrival rate, so a queue still growing from a new upload looks the same. It is left out whenever it would be invented — nothing waiting, no worker, no recent completion, or a rate that could not be read. |
| **Worker** | When the worker started, when it last finished a batch, and its totals since the start (they restart from zero with the worker). |

:::danger[A non-empty dead-letter queue is data that is not on the server]
A batch the worker could not write goes to `helsa.ingest.dlq`, and **nothing retries
it on its own** — every processing error ends there, including a database that was
restarting at the wrong moment. The page puts this above everything else.
:::

**Recent failures.** Under the count the page lists the worker's log of its most
recent failures (up to 20, kept for 30 days) — headed as a log, not the queue: when,
which batch, how many items it held, and the error. The error is the worker's own message with every number and
quoted string blanked out (`#`, `"…"`), so no measured value can reach the page
through a database error; what identifies — a `source_uuid`, a `SQLSTATE` code, a
host address — is kept. Two things this list is **not**:

- **Not a listing of the dead-letter queue.** RabbitMQ cannot show what is in a queue
  without taking it out. An entry stays after its batch has been sent back, and a
  retry can move only some batches (it is capped, and it can stop part-way), so the
  page does not guess which entries are still set aside; it shows when the last
  retry finished and how many it moved.
- **Not complete for old batches.** A batch dead-lettered before the server recorded
  reasons has no entry. The full error is still in the worker log
  (`docker compose logs worker`, the `process batch` lines).

**Retry.** The button moves the dead-lettered batches back onto `helsa.ingest`, and
the worker processes them again. It is safe to press: the writes are idempotent
upserts keyed on `source_uuid`, so a batch written twice stores nothing twice, and a
batch is removed from the dead-letter queue only after RabbitMQ has confirmed the copy
on the main queue — a batch is never lost on the way, at worst it is briefly in both.
One press moves at most 1,000 — the button and the confirmation say so — press
again for the rest.

The answer stays on the page after the dead-letter queue empties, and it says only
what is known: how many moved, how many remain if that could be read, and a run that
stopped part-way with the server's reason. A request whose answer never arrived (a
dropped connection, a proxy timeout) is reported as **unknown** — it may have run —
never as "did not run".

Fix the cause first. A batch that failed because the database was restarting will go
through; one that fails on its content will be back in the dead-letter queue once the
worker reaches it — behind whatever was already waiting. Every retry is counted on the
batch: an entry in the log says *failed again after N retries* from the third, and
the retry's answer counts the batches now on their **third retry or later**, because
pressing again is then unlikely to help. Nothing is ever retried automatically.

There is no progress bar and no per-minute chart: the status names neither the size
of an upload nor a history of minutes, and a bar against an invented total would be
the most confident-looking wrong thing on the page.

When the API cannot reach RabbitMQ the page says so and shows **no** queue figures —
an unknown depth is not an empty queue. When the server answers 404 to the page's
request while the rest of the API works, the server is **older than the web page**
(the web image was updated first); the page says so and gives the command,
`make prod-pull && make prod-up`. When the worker's counters (in Redis) cannot
be read, the depth is still shown and the rate and estimate are marked **unknown**
— not "not moving".

## Settings

The device token, the devices that have one, the goals, the language, the time
zone — and [the map source](/deployment/map-tiles/).

There is no sign-in on this page because there is no second user. What it does
carry is the honest description of the two access layers, which is the thing worth
understanding before opening a port.
