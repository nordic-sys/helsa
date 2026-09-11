---
title: Reading data
description: "Summaries, activity rings, workouts, sleep, raw samples, insights, achievements, and export — with the pagination and time-zone rules that apply to them."
sidebar:
  order: 3
---
All read endpoints take `Authorization: Bearer <device-token>` and return JSON.
The [conventions](./#conventions) — UTC on the wire, SI units, percentages in
0–100, opaque cursors — apply throughout.

## Summary

```http
GET /v1/summary?range=week&metrics=stepCount,heartRate,activeEnergy&tz=Europe/Budapest
```

| Parameter | |
|---|---|
| `range` | `day`, `week`, `month`, `year`. Required. |
| `metrics` | Comma-separated `data_type` list. Required. |
| `tz` | IANA zone. Defaults to the stored user setting. |
| `from`, `to` | Optional explicit dates. |

```json
{
  "range": "week",
  "from": "2026-08-05", "to": "2026-08-11",
  "tz": "Europe/Budapest",
  "metrics": {
    "stepCount": {
      "agg": "sum",
      "unit": "count",
      "total": 62194,
      "buckets": [
        { "t": "2026-08-05", "v": 8241 },
        { "t": "2026-08-06", "v": 11002 }
      ]
    },
    "heartRate": {
      "agg": "avg",
      "unit": "count/min",
      "buckets": [
        { "t": "2026-08-05", "avg": 68.2, "min": 47, "max": 154 }
      ]
    }
  }
}
```

Note `agg`: some metrics sum (steps, energy) and some average (heart rate). The
server states which, so the client never has to hold that table itself.

:::note
**How fresh these numbers are.** They are computed from the `samples` table with
`time_bucket` cut in your time zone, and cached in Redis for 60 seconds. The cache is
dropped the moment the worker commits a batch — so a sample that has just been
ingested appears immediately, not on the next refresh of a schedule.

⚠️ This page used to claim the answers came from TimescaleDB continuous aggregates
"refreshed on a schedule", and warned that a recent sample might not be in the total
yet. The aggregates exist in the schema, but nothing on this path reads them, and the
real behaviour is the better of the two. The tz-aware bucketing is why: it cannot be
precomputed per day without choosing a zone in advance.
:::

### Time zones matter more than they look

Daily buckets are cut in a time zone. `time_bucket` in UTC would put a run at
23:30 local time on the wrong day, every time, and your "daily steps" would be
subtly wrong in a way that is hard to notice and impossible to unsee.

Set `time_zone` in settings, or pass `tz` explicitly. Both must be valid IANA
names — `Europe/Budapest`, not `CEST` and not `+02:00`.

## Activity rings

```http
GET /v1/activity?from=2026-08-01&to=2026-08-11&tz=Europe/Budapest
```

Daily Move / Exercise / Stand values **with the goal that applied on that day**:

```json
[
  { "day": "2026-08-10",
    "active_energy": 512, "active_energy_goal": 600,
    "exercise_minutes": 34, "exercise_goal": 30,
    "stand_hours": 11, "stand_goal": 12 }
]
```

Storing the goal per day is why history stays truthful when you later change your
Move goal: a day you closed at 600 stays closed, instead of retroactively failing
against a new 900.

Apple's ring goals are set in the Fitness app and are **read-only** through
HealthKit. Helsa tracks them and can offer to follow a change; it never writes back.

## Workouts

```http
GET /v1/workouts?limit=50
GET /v1/workouts?cursor=<next_cursor>
```

```json
{
  "items": [
    { "id": "3f2a…", "source_uuid": "7F31…", "activity_type": "running",
      "started_at": "2026-08-10T16:02:00Z", "ended_at": "2026-08-10T16:47:00Z",
      "total_energy_kcal": 421.5, "total_distance_m": 8120,
      "avg_heart_rate": 152.4, "max_heart_rate": 178 }
  ],
  "next_cursor": "…"
}
```

`GET /v1/workouts/{id}` returns one workout. `avg_heart_rate` and `max_heart_rate`
are computed from samples linked to it, so they appear only once the worker has
resolved that link — occasionally a chunk later than the workout itself.

### Route

```http
GET /v1/workouts/{id}/route
```

```json
{ "points": [ { "ts": "…", "lat": 47.4979, "lon": 19.0402,
                "altitude_m": 108.2, "speed_mps": 3.1, "accuracy_m": 4.1 } ] }
```

Separate from the workout detail on purpose: a three-hour hike is tens of thousands
of points, and a workout list must never drag them along.

**An empty `points` array is a complete answer.** Indoor workouts have no route,
and neither do older ones. That is not a `404` — the workout exists.

`altitude_m`, `speed_mps`, and `accuracy_m` may be missing. They are omitted rather
than zeroed, because `0` would be a real value here (sea level, standing still) and
"missing" is not the same claim. Use `accuracy_m` to discard bad fixes — a point
with 100 m of error can jump a city block.

## Sleep

```http
GET /v1/sleep?from=2026-08-01&to=2026-08-11&tz=Europe/Budapest
```

```json
[ { "started_at": "2026-08-10T22:41:00Z",
    "ended_at": "2026-08-11T05:58:00Z",
    "stage": "asleepCore" } ]
```

Stages: `inBed`, `asleepCore`, `asleepDeep`, `asleepREM`, `awake`. Older rows may
also carry the short spellings (`core`, `deep`, `rem`) and HealthKit's
`asleepUnspecified` — sleep that the source did not break into stages.

Sleep is stored as intervals rather than point samples, which is why it lives in
its own table instead of the samples hypertable. The endpoint returns the
segments **raw**, exactly as they were recorded.

⚠️ **Do not add the segment lengths together.** They overlap: `inBed` wraps the
whole night, and two sources (the phone and the watch) describe the same night
at their own boundaries, so the naive sum is roughly one and a half times the
real sleep time. Sleep time is the UNION of the sleep stages, computed on a
flattened timeline where `awake` beats every sleep stage and `inBed` loses to
everything. Every consumer follows the same rules — `backend/internal/sleep`,
the web's `lib/sleep.ts`, and `SleepAnalysis.swift` on the phone.

## Raw samples

```http
GET /v1/samples?data_type=heartRate&from=2026-08-01T00:00:00Z&limit=500
```

`data_type` is **required** — without a filter this would scan the whole
hypertable. Newest first, keyset pagination:

```json
{
  "items": [ { "ts": "…", "data_type": "heartRate", "value": 61,
               "unit": "count/min", "source_device": "watch" } ],
  "next_cursor": "…"
}
```

Send `next_cursor` back unchanged. The cursor sits on the `(ts, source_uuid)` pair,
so samples sharing a timestamp — several source devices recording at once — are
neither skipped nor duplicated. `next_cursor: null` means the end. `from`/`to` form
a half-open `[from, to)` window.

This endpoint is for debugging and export. It is not what a dashboard should call.

## Insights

```http
GET /v1/insights
```

```json
[ { "id": "resting-hr-elevated:2026-08-11",
    "kind": "anomaly", "metric": "restingHeartRate",
    "rule": "resting-hr-elevated",
    "values": { "recent": 63.0, "baseline": 55.5, "deviation": 0.5, "baselineDays": 28 },
    "title": "A nyugalmi pulzusod 3 napja a szokásos fölött",
    "detail": "Az elmúlt 3 nap átlaga 63.0 bpm, a korábbi 28 nap átlaga 55.5 bpm (szórás 0.5 bpm). …",
    "severity": "notice",
    "generated_at": "2026-08-11T04:00:00Z" } ]
```

Rule-based and explainable — rolling averages, z-scores, Pearson correlation. **No
language model is involved.**

⚠️ **This endpoint sends data, and the sentence is a fallback.** `rule` and
`values` are what a client is meant to read: it composes the wording itself, in
its own language and with its own number formatting. `title` and `detail` are the
server's own Hungarian — the one language this server has ever spoken — and exist
for the case where a client meets a rule it does not know, which can happen when a
server is newer than the app talking to it.

It used to be the other way round, and that made the server the single part of the
system able to speak one language: a phone running in English displayed Hungarian
the moment it fetched anything, with every screen still reading perfectly. The key
set of `values` is per rule and pinned by the shared vectors
(`insight-vectors.md`), which is also what keeps a rule from publishing too little
to be worded.

Current rules and what each needs before it will say anything. ⚠️ This table and
[the test vectors](/api/insight-vectors/) describe the same rules — if they ever
disagree, the vectors are the ones with tests behind them:

| Rule | Requirements |
|---|---|
| **Sustained deviation** (resting HR up, HRV down, sleep down) | 28-day baseline window ending 3 days ago, at least 14 measured days in it, non-constant data, and 3 consecutive recent days at ≥1.5σ plus a per-metric absolute threshold (2 bpm / 5 ms / 30 min). |
| **Weekly trend** (steps, sleep) | Two consecutive 7-day windows, at least 5 measured days in each, ≥10% relative change and an absolute minimum. |
| **Co-occurrence** (steps ↔ that night's sleep) | 60-day window, at least 14 paired days, absolute correlation coefficient ≥ 0.5. |
| **Sleep regularity** (scatter of the night's midpoint) | 28-day window, at least 14 measured nights, midpoint standard deviation ≥ 60 minutes. Needs the sleep segments' start and end, not just the hours. |
| **Free days vs work days** (sleep timing, sleep length, steps) | 28-day window, at least 4 free and 10 work days measured, ≥60 minutes of midpoint shift / ≥1 hour and 10% of sleep / ≥1500 steps and 15%. A free **night** is one starting Friday or Saturday; a free **day**, for steps, is Saturday or Sunday. |
| **Training load** (last 7 days vs last 28) | At least 8 sessions in the 28 days **and at least one in every one of the four weeks**, 2 sessions and 90 minutes in the last 7, ratio ≥ 1.5. |
| **Efficiency** (pace at a given heart rate, per activity) | Two consecutive 28-day windows, at least 4 sessions with distance *and* average heart rate in each, the two windows' average heart rate within 5 bpm, pace ≥5% and ≥5 m/min apart. |
| **Baseline drift** (per metric, including ones no other rule reads) | The last 28 days against days 90–120 back: Welch *t* ≥ 2.5 **and** an absolute floor, with ≥14 measured days in each window (8 for body mass). |
| **Sleep debt** | The last 14 nights against the median of the preceding 90: ≥5 hours owed **and** ≥5% of what those nights should have held. |
| **Social jetlag** (free days versus work days, week by week) | Median weekly midpoint shift ≥90 minutes across ≥6 usable weeks out of 8, with two thirds of them ≥30 minutes. |

The partial current day never enters a window, and missing days are never filled
with zeroes or interpolated.

Two of these deserve their reasoning spelled out. The training-load rule wants a
session in **every** chronic week because a week with none is indistinguishable
from a week that never synced — a rest week and a broken upload leave identical
evidence, and averaging across the gap would announce a "jump" that is really
missing data. The efficiency rule refuses to speak when the two windows' heart
rates differ by more than 5 bpm, because faster at a higher pulse is effort, not
efficiency.

**The training-load figure is sport bookkeeping, not medicine.** It is arithmetic
on your own session lengths and carries no injury forecast, whatever the sports
science literature it borrows its shape from is currently arguing about.

**An empty list is a complete answer.** Below its data minimum a rule stays silent,
because a fabricated insight is worse than none.

`id` is stable within a day (`<rule>:<date>`), so a client can deduplicate or mark
one as dismissed. `kind` is `trend`, `anomaly`, `correlation` or `pattern` — a
`pattern` describes a property of one window (how much bedtime scatters, how the
weekend differs from the week) rather than a change over time.

The same rules run in the iOS app, and both implementations are held to the
[shared test vectors](insight-vectors/).

:::danger
These are arithmetic on your own numbers, not clinical findings. See the
[disclaimer](/disclaimer/).
:::

## Achievements

```http
GET  /v1/achievements
POST /v1/achievements
```

The phone evaluates, the server stores. Thresholds live on the client, so
server-side evaluation would require uploading the settings first — and the phone
is the only uploader anyway.

Each row carries the value and thresholds **as they were when earned**. A badge is
a historical fact: change your monthly step target today and a month you completed
last year must not quietly "un-complete" itself.

`POST` is an idempotent upsert on a client-generated id (`month:complete:2026-08`,
`streak:3:2026-08`, `record:best-month`). It **never deletes**: a reinstalled phone
starts from an empty set, and a replace-everything semantic would erase years of
history on the first sync.

Resending an existing id does not change its original `earned_at`.

## Your usual range

```http
GET /v1/baseline?range=month&metrics=stepCount,restingHeartRate&tz=Europe/Budapest
```

The middle of **your own last 60 days** for a metric, and where the period you are
looking at sits against it — five levels, and no verdict.

```json
{
  "range": "month",
  "from": "2026-08-01", "to": "2026-08-31",
  "reference_from": "2026-07-03", "reference_to": "2026-08-31",
  "reference_days": 60,
  "min_days": 14,
  "metrics": {
    "restingHeartRate": {
      "mean": 54.8, "sd": 2.9, "low": 51.9, "high": 57.7,
      "day_count": 58, "value": 58.1, "level": "above"
    }
  }
}
```

Four rules decide what comes back, and they are the same four the app applies in
`TrendBaseline`. **A formula changed on one side has to be carried to the other** —
a server that computes "your usual" differently from the phone is worse than a
server that does not compute it at all, because the two would quietly disagree
about the same person.

1. The reference is the **60 days ending on the anchor day**, in daily buckets.
   Not 30: a 30-day reference under a 30-day chart would be the chart describing
   itself.
2. The anchor is **the end of the period you are looking at, not today**. Browsing
   back to a month in 2024 and being told it was "above your usual" would
   otherwise mean *above what is usual for you now* — a comparison across two
   years wearing the words of one.
3. At least **14 of those days must carry a measurement**. Below that there is no
   band at all — not a wider one, not a guess: `mean`, `sd`, `low` and `high` stay
   absent and only `day_count` comes back.
4. The band is `mean` ± one **sample** standard deviation (n−1). One sigma, so it
   covers roughly the middle two thirds of your usual days: two would never be
   left, and a band that is never left says nothing.

:::caution
A day without a measurement is never counted as a zero, here or anywhere else. A
reference window whose days never varied gets no band either — a zero-width band
is a line pretending to be one.
:::

Why this is a sibling of `/summary` rather than a field on it: it has a window of
its own, so `from`/`to` would have to mean two different windows at once; it
exists for two of the four ranges only, and a field that silently disappears on
`day` and `year` reads like "no data"; and `/summary` is cached per (range, tz,
metrics, window), which a second, differently shaped window would either poison or
bypass. It is computed **from** `/summary`'s own daily buckets, so the band rests
on exactly the numbers you would receive yourself.

## The monthly challenge

```http
GET /v1/challenge?month=2026-08&tz=Europe/Budapest
```

The same challenge the iPhone draws as a trail, in numbers: what the month has
added up to, which milestones that passed, and how many days are left.

| Parameter | |
|---|---|
| `month` | `YYYY-MM`. Defaults to the month `tz` is in right now. |
| `tz` | IANA zone. A month is a span in your calendar, not an instant — 2026-08-31 22:30 UTC is already September in Budapest. |
| `thresholds` | `20000,35000,70000` — override what the server thinks your milestones are. Cleaned up exactly as the phone cleans the same input: non-positive dropped, duplicates removed, sorted. |

**The milestones are yours, and they live on the phone.** Nothing syncs them, so
the server takes them in this order: the `thresholds` parameter, then the newest
threshold snapshot on a recorded badge, then the factory row. `thresholds_source`
says which happened — "your milestones" and "our guess at your milestones" are
different statements and should not be told apart by guessing.

Three things about the numbers:

- **`steps` is the real figure, never clipped to the goal.** Someone who walked
  200 000 against a 100 000 goal walked 200 000. It is `percent` that stops at
  100, and `overshoot_steps` carries the difference.
- **`days_elapsed` excludes today**, because there are still steps to be taken
  today; today is counted in `days_remaining` instead, so the two always add up to
  `days_in_month`. This matters because `days_elapsed` is the denominator of
  `steps_per_day`: dividing a month's total by 31 on the third of the month gives
  a daily average a third of the truth.
- **A missing measurement is not a zero.** With no measured day at all, `steps` is
  absent along with everything derived from it, and no milestone counts as
  reached — we do not know whether the month has begun.

:::caution
**The streak is a lower bound**, and `streak.missing_inputs` says why. The phone
also knows days that do *not* break a streak — an illness day derived from the
daily journal, and a rest day you chose — and neither reaches the server. The
journal stays on the device, so a day the phone counts as neutral is a plain
missed day here. This streak can be shorter than the one on your phone, never
longer.
:::

## Coverage

```http
GET /v1/coverage?from=2025-09-11&to=2026-09-11&tz=Europe/Budapest
```

Per catalog type: whether anything arrives at all, on how many days of the window,
when the most recent measurement was, and which source wrote it. `types` carries
the **whole catalog, in catalog order** — including types nothing has ever been
received for, because "this entire area is empty" is exactly what this endpoint
exists to make visible. The window defaults to the last 365 days.

:::caution
**This answers a narrower question than the app's completeness screen, and its
vocabulary is deliberately different so the two cannot be confused.** The phone
knows about *permissions*: it can tell "the read ran and nothing came" from "the
system will still ask about this group" from "HealthKit refused this type" from
"there is no HealthKit here". None of that reaches the server — a type that was
never granted and a type that has no sensor arrive here identically, as an
absence.

So `state` has three values, all of them statements about **what reached this
server**, and it never borrows the phone's four (`empty`, `notRequested`,
`refused`, `unavailable`) for a weaker claim.
:::

The one thing the server computes exactly as the phone does is the **rhythm** of a
metric and the silence that breaks it (`gap`), derived from the arrival days
themselves with the same thresholds. Where the server cannot answer, the field is
absent — a missing measurement is never reported as a zero.

## Export

```http
POST /v1/export
{ "format": "csv", "from": "2026-01-01", "to": "2026-08-11", "metrics": [] }
```

Synchronous: the response **is** the file, streamed, with a `Content-Disposition`
filename.

| Format | Contents |
|---|---|
| `csv` | Long format, one sample per row: `ts,data_type,value,unit,source_device` |
| `json` | `{meta, samples, workouts, sleep_segments}` |
| `pdf` | In the contract, **not implemented** — returns `501` |

`from`/`to` are days in your time zone and `to` is inclusive. Omitted, they mean
the last 30 days. An empty `metrics` array means everything.

`GET /v1/export/{id}` always returns `404`. The asynchronous path is not built;
the route is reserved so it can be added later without breaking anything.

:::danger
A full-history export is a complete copy of your health data in one file.
Wherever it lands — a downloads folder, a cloud-synced directory, a chat — that
is now a copy you are responsible for.
:::
