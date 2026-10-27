---
title: The screens
description: "What each of the nineteen pages shows, and the rules behind the numbers on it."
sidebar:
  order: 1
---
Seventeen pages in the sidebar, plus two that open from a listing: a workout and a month's medal.

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

## Year in numbers

One named **calendar** period at once — a year, or a month — the phone's *year in
numbers* card, laid out side by side. Four totals (steps, active energy, exercise
time, walking/running distance), each with a strip of the period's months (or days)
under it, the nights, the workouts, the medals that name the period, and the peaks:
the best month, the longest night, the longest and farthest workout. The period is in
the address (`/period?p=2026`, `/period?p=2026-08`).

The rules are the phone's, ported with its tests:

- **A running period says so.** "2026" in October is ten months, and the line under
  the title names the day the data reaches. The comparison is cut to **the same
  stretch** of the previous period, never set against the whole of it.
- **A month without data is a gap, not a zero.** Each total says how many of the
  elapsed months carried data, and the "a month" figure beside it is over those
  months only. The same holds for nights: the average is over the measured nights.
- **An uneven comparison is flagged — or withheld.** When the two periods were
  measured on different numbers of months the delta carries the caveat; when the
  measured *shares* differ by more than half, a total is not compared at all — the
  same rule as Trends.
- **Two recordings of one workout count once**, as on the Workouts page — one
  deliberate difference from the phone, which counts what HealthKit hands it.
- A medal without a period (a milestone) is not listed: its timestamp is when it was
  first evaluated, not when it was reached.

The totals are summed, so the server's per-hour source merge applies: they can read
a little above the phone's.

## Year by year

The phone's *long view*: the measurements you choose, every calendar year beside the
others, up to five years back. On the phone it is a button with a progress bar,
because reading five years out of HealthKit costs battery; here it is **one request**
— monthly buckets across all the years at once — and the page simply shows it.

- **The figure is the average month** (or the average level, for an averaged
  measurement), over the months that carried data. A year's total beside a
  part-year's would only say that one of them is shorter.
- **A year needs three measured months** before it gets a figure. Fewer is shown as
  *2 months · too few*, not hidden and not compared.
- **The span printed is the span found** — *measured data found for: 2023–2026* —
  never the five years that were asked for.
- The last column is the change from the first measured year to the last; when the
  two were measured on very different shares of their months, it says to read it
  loosely.

The choice of measurements is kept in **this browser** (the *Recommended* button
gives the phone's eight). Sleep is not offered: it does not come from the same
source as the rest and would only ever be an empty row.

## Health summary

The phone's printable report for a doctor, made from what the server holds. Choose
a period — **30 days, 3 months, 6 months or 1 year**, the phone's four — and the
measurements (the default is the phone's: blood pressure, resting heart rate, body
mass, blood oxygen and steps), then **Print**. The PDF comes from the browser's
print dialog ("Save as PDF"): the server's own export does not make PDFs.

- **What changed comes first**: at most three measurements that moved at least 5%
  against the previous period of the same length, both numbers printed, no arrow
  and no colour. The previous period needs seven measured days, and — the web's one
  rule on top of the phone's — when the two periods were measured on very
  different shares of their days, the change is **named as not compared** instead
  of printed.
- Each row has the daily average, the extremes, **your usual range** and how many
  days were measured. The usual range is the phone's: the middle 80% of your own
  daily values over the last year (10th–90th percentile, at least 14 days). It is
  not a medical reference range, and the page says so.
- A measurement with no data says *no measurement*, never 0; a range with too
  little data says *little data (9 days)*, never a blank.
- **What it cannot show, it says.** The journal and symptom marks never leave the
  phone, and events (falls, heart-rate notifications) are put together on the
  phone — both sections are on the page as one sentence each, so their absence
  does not read as "nothing happened". The source marks the phone prints are not
  here either.
- **No chart**, as on the phone: a sparkline invites the eye to find a trend.
- On paper it is black on white whatever the screen's theme, the header and the
  honesty block repeat on every sheet, pages are numbered, and a long workout list
  starts on a sheet of its own. Unlike the phone's single sheet there is no
  six-measurement cap: the browser paginates.

The period and the measurements are in the address, so next month's printout can
be the same one.

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
  — an illness day from the journal, a rest day you chose. The rest days reach the
  server once the phone has sent its settings (app 1.0 (7) on), and then count here
  exactly as on the phone: neutral, at most two in any seven days, a third one
  breaking the streak; the page lists the rest days of the current run. Illness
  days never reach the server. So this streak can be shorter than the phone's,
  never longer, and the note under it says which input is missing.

**Whose milestones.** From app 1.0 (7) the phone uploads its milestones, and the
page says *your own milestones, as your phone last sent them* with the date. Before
that it shows the milestones of the most recent badge, called *our best guess*, or
the factory row, and says so.

## Virtual journey

The route you are walking on the phone, and how far the distance has carried you:
covered, the share of the route, what is left, the next milestone, the milestone
table and the route drawn with the covered stretch highlighted (with the same
optional map underneath as a workout). It exists because the phone, from app 1.0
(7), uploads **which route and from which day** — nothing else. The routes are a
generated copy of the app's catalogue; the distance is the server's own total of
the route's movement (walked and run, or cycled) from the start day to today.

- **No measurement is not zero kilometres**, and nothing counts as reached without
  one.
- **The percentage divides by the published length**, never by the drawn line's;
  a route without an imported track is drawn as a sketch between approximate
  stage points, and says so.
- **The source note carries the OpenStreetMap credit** (ODbL) for every route
  drawn from OpenStreetMap data.
- Three states are told apart: *your phone has not sent its journey yet* (an
  older app or server), *no journey is running*, and *a route this dashboard does
  not know* (the app is newer than the server — nothing is drawn rather than
  something wrong).

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

## Training progress

The phone's progress screen, counted the same way: how often, how long and how
hard you trained, week by week, over 4 weeks, 3 months or — the default here — a
year. **On a wide screen the year is one row of 52 squares**, oldest on the left,
so a break is a run of dashed squares you can see at once; on a narrow screen it
folds into the phone's 13 columns of four weeks.

The rules are the phone's, and each has a test on both sides:

- **A week without a workout is a gap, not a missing week.** It stays in the grid
  and counts in the averages — a month off is part of how often somebody trains.
- **The current week is not over**, so it is outlined, left out of every average,
  and not yet counted as a break.
- **A session recorded twice counts once**, with the same fold the Workouts page
  uses.
- The *typical week* is a **median** over at least three finished weeks, so one
  training camp does not make every ordinary week look lazy. The comparison with
  the previous period appears only when the history reaches back that far.

**Zone 3 and above** is minutes at or above 70% of your *measured* maximum heart
rate: the second-highest maximum your workouts recorded in the past year (one
sensor spike does not set the zones), from at least five workouts, readings
outside 100–230 bpm ignored. Never `220 − age`. Each reading stands for the time
to the next one, at most 60 seconds — a minute of silence is missing data, not
hard minutes — and a workout with fewer than two readings is *unmeasured*, not
zero. As on the workout detail page, a workout's heart rate is every reading in its
time window, by any device; the card says so. The server computes this
(`GET /v1/workout-intensity`) because the browser would need hundreds of
`/samples` pages for a year. **An older server answers 404**, and the card then
says the server needs updating rather than showing an error.

Beside it, resting heart rate and HRV as weekly averages of the daily values —
with the explicit line that moving together with training does not make
training the cause. No score, no advice, and the phone's effort ratings are not
here: they stay in Health and never reach the server.

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

**Water against your goal.** The goal is the one you set on the phone, uploaded
from app 1.0 (7). Today shows the amount against it; a week or 30 days shows on how
many of the days with water logged it was reached. With no goal of your own the
page shows the phone's suggestion from your latest body mass (33 ml per kilogram,
rounded to 100 ml) and labels it a suggestion, not medical advice; with no body
mass there is no suggestion. If the phone has not sent its settings, the card says
that instead of pretending you have no goal.

## Measurements

The rest of the phone's Health tab: every measurement outside sleep and
nutrition, in the phone's sections — activity, heart, breathing, body, mobility,
environment, other — with the phone's sub-groups ("Daily movement", "Body
temperature", …). **The sections come from the metric catalog, not from a hand
list**, and a leftover group catches anything not filed, so a newly supported
HealthKit type gets a card without anybody remembering to add one. Sleep and
nutrition are linked, not copied.

Each card leads with **the latest value and when it was taken**. For a
measurement taken at a moment (heart rate, weight, walking speed) that is the
latest reading itself; for an amount (steps, energy, daylight) it is the total of
the latest day — merged across apps exactly as everywhere else — and *today so
far* while that day is still running. The age is always printed, and a value
older than the chosen span says so instead of passing for current. Below it: the
span (7 days, 30 days or 12 months) as a small chart in which an unmeasured day is
a gap, never a zero; your usual range from the last 60 days (daily, so not drawn
on the 12-month span, and the card says why); and a link to Trends for the full
chart. By default only measurements with data are shown; one switch shows the
rest, each saying that nothing has reached the server.

Two kinds of measurement are kept out of the grid on purpose:

- **Blood pressure is one card, as a pair.** Only a systolic and a diastolic
  value taken at the same instant make a reading; half a reading shows no number
  and says which half is missing. Readings that **stand out against your own**
  are listed — each compared with your other readings of the last 90 days (at
  least 15 needed, 1.5 standard deviations *and* 8/5 mmHg apart), the phone's rule
  — and **never against a clinical limit** such as 140/90.
- **The five gait measurements share one time axis**: the last 7 finished days
  against the 28 before them, with your own band, the phone's thresholds, and the
  wording "higher/lower", never "better/worse". Falls are drawn on the same axis.
  Apple's walking-steadiness *notifications* are not: they are a kind of HealthKit
  record the phone does not upload, and the card says so.

The latest values come from **`GET /v1/latest`**, one call for the whole page
instead of one per metric. **An older server answers 404**; the page then shows
each card's last measured day from the past 30 days and says the server needs
updating.

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

**Export** downloads your raw samples from the server (`POST /v1/export`): CSV, one
sample per row, or JSON with the period's workouts and sleep segments as well. The
period is 30 days, 90 days, a year (each ending today, today included) or two dates
you choose; the metrics are all of them or the ones you tick from those that have
data — the choice narrows the samples only. The server streams the file, so the
page shows how much has **arrived** rather than a percentage it cannot know, and you
can stop it. Once the server has started sending it cannot change its answer, so an
export that fails half-way arrives short: a JSON file is checked for its closing
bracket and is not saved when it is missing; a CSV cannot be checked that way, and
the page says so. There is no PDF — the server does not make one yet.

There is no sign-in on this page because there is no second user. What it does
carry is the honest description of the two access layers, which is the thing worth
understanding before opening a port.
