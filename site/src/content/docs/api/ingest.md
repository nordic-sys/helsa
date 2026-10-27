---
title: Ingest
description: "POST /v1/ingest: chunk semantics, idempotency, deletions, and the anchor-after-acknowledgement rule that makes offline catch-up work."
sidebar:
  order: 2
---
```http
POST /v1/ingest
Authorization: Bearer <device-token>
Content-Type: application/json
```

The only write path for health data. Everything else in the API reads.

## It is a chunk endpoint, not an upload endpoint

`/v1/ingest` does not mean "here is all my data". It means "here is the next piece".
The client loop is:

```
read a bounded delta from HealthKit (from the current anchor)
  → POST /v1/ingest
    → 202 Accepted
      → save the new anchor
        → repeat
```

**The anchor advances only after the `202`.** That single ordering rule is what
makes a phone that has been offline for three weeks recover completely: each
acknowledged chunk moves the cursor, and an interruption costs at most the chunk in
flight. Save the anchor before the acknowledgement and a dropped connection silently
loses everything since the last save.

## Request

```json
{
  "device_id": "9a1f…",
  "time_zone": "Europe/Budapest",
  "samples": [
    {
      "source_uuid": "0B2C…",
      "data_type": "stepCount",
      "ts": "2026-08-11T07:15:00Z",
      "value": 412,
      "unit": "count",
      "source_device": "watch",
      "source_bundle": "com.apple.health"
    }
  ],
  "workouts": [
    {
      "source_uuid": "7F31…",
      "activity_type": "running",
      "started_at": "2026-08-10T16:02:00Z",
      "ended_at": "2026-08-10T16:47:00Z",
      "total_energy_kcal": 421.5,
      "total_distance_m": 8120,
      "route": [
        { "ts": "2026-08-10T16:02:05Z", "lat": 47.4979, "lon": 19.0402, "accuracy_m": 4.1 }
      ]
    }
  ],
  "sleep_segments": [
    {
      "source_uuid": "C4A9…",
      "started_at": "2026-08-10T22:41:00Z",
      "ended_at": "2026-08-11T05:58:00Z",
      "stage": "asleepCore"
    }
  ],
  "activity_summaries": [
    {
      "day": "2026-08-10",
      "active_energy": 512, "active_energy_goal": 600,
      "exercise_minutes": 34, "exercise_goal": 30,
      "stand_hours": 11,     "stand_goal": 12
    }
  ],
  "deletions": ["1D77…"]
}
```

Every array is optional. A chunk carrying only `deletions` is valid.

⚠️ **`device_id` is a UUID — the `id` the server returned from `POST /v1/devices`** (an upsert on
`platform` + `model`; see the OpenAPI document). The example above is shortened. Anything that is
not a UUID is refused with `400 Invalid batch` (*"invalid UUID length"*).

### `data_type` is an open string, not an enum

HealthKit defines well over a hundred quantity types and adds more with each iOS
release. Send the identifier without its prefix, in lowerCamelCase: `stepCount`,
`restingHeartRate`, `heartRateVariabilitySDNN`, `dietaryEnergyConsumed`,
`oxygenSaturation`, `bodyMass`.

The server **accepts and stores types it does not recognise**. A closed enum would
mean that every new iOS type required a contract change, code generation, and a
deployment — during which the data would be silently dropped. Better to have the
data than to be tidy.

### Workout links

Samples reference their workout by `workout_source_uuid` — the HealthKit
`HKWorkout.uuid`, because the client has never seen a server-side id. The worker
resolves it. If the workout arrives in a **later** chunk than its samples, the link
is resolved when it does; workout heart-rate aggregates depend on this.

### Routes have their own budget

A long hike's GPS track can be larger than an entire batch of samples — an hour of running is
~3,600 points. Route points therefore do not count against the 50,000 items; they have their own
limit of 200,000 per chunk, and the 32 MB body limit (~140–190 bytes a point) is what really bounds
them. The client should still count them when sizing a chunk, and halve it on a `413`.

### Deletions

If you delete a sample or a workout in the Apple Health app, HealthKit reports it
through the anchored query's deleted-objects list. The client forwards the
`source_uuid` values in `deletions`, and the worker removes the matching rows from
samples, workouts, and sleep segments.

Without this, the server slowly drifts away from the phone, keeping records the
user has explicitly removed.

## Response

```http
202 Accepted
```

```json
{
  "batch_id": "b7f0…",
  "received": {
    "samples": 1840,
    "workouts": 2,
    "sleep_segments": 9,
    "activity_summaries": 1,
    "deletions": 0
  },
  "max_items": 50000
}
```

- `received` counts what the server **took**, not what it wrote. Writing happens in
  the worker, after the queue. Use it to confirm the chunk arrived whole.
- `batch_id` correlates with the server log — useful when debugging a long
  catch-up.
- `max_items` advertises the current server limit so the client can size the next
  chunk without guessing.

`202`, not `200`: the data is accepted, not yet persisted. That is what allows the
API to answer quickly while the worker does the slow part.

## Idempotency

Every item carries a stable `source_uuid` from HealthKit, and the database uses it
as a deduplication key. Re-sending a chunk is harmless: duplicates are skipped.

This is what makes retry safe. A client that is unsure whether a chunk arrived
should just send it again.

## Size limits

| | |
|---|---|
| Server maximum | 50,000 items per chunk (samples + workouts + sleep segments + activity summaries + deletions) **plus** 200,000 route points, in a request body of at most 32 MB |
| Recommended client chunk | 2,000–5,000 items |
| Over the limit | `413`, with a problem document |

The recommended size is far below the maximum on purpose: smaller chunks mean more
frequent acknowledgements, so an interrupted catch-up loses less and resumes
sooner. The limit is a design parameter, not a defence — behind mutual TLS there is
exactly one client.

A `413` is the client's cue to halve the chunk and retry, not to give up.

## Processing

```
POST /v1/ingest ──▶ api ──▶ rabbitmq ──▶ worker ──▶ timescaledb
                     │
                     └──▶ 202 (immediately)
```

The worker normalises units to SI, resolves workout references, applies deletions,
and writes with `ON CONFLICT DO NOTHING`. Unprocessable messages go to a
dead-letter queue rather than blocking the queue behind them; they stay there until
somebody [sends them back](#retrying-dead-lettered-batches).

Each batch is logged with what it contained — `samples`, `workouts`,
`sleep_segments`, `activity_summaries`, `deletions` — beside its byte size, which is
normally enough to diagnose a chunking problem without adding instrumentation.

⚠️ Those are items **received**, not rows changed. The writes are upserts, so a chunk
replayed after a failed acknowledgement logs the same numbers and stores nothing new;
the log says what arrived, and the database decides what that means.

## Watching the queue

`GET /v1/ingest/status` (same device token as every other `/v1` route) reports what
the queue between the `202` and the database is doing. It carries counts only.

```json
{
  "checked_at": "2026-10-27T12:30:30Z",
  "broker_reachable": true,
  "queue": { "name": "helsa.ingest", "ready": 4000, "consumers": 1, "in_flight_max": 8 },
  "dead_letter": {
    "name": "helsa.ingest.dlq",
    "ready": 1,
    "recent_failures": [
      {
        "batch_id": "0b6c5c1e-3f0a-4a52-9d55-2f3c8e1b7a10",
        "failed_at": "2026-10-27T12:10:04Z",
        "error": "begin tx: failed to connect to `host=timescaledb user=helsa database=helsa`: dial tcp 172.18.0.2:5432: connect: connection refused",
        "items": 2000, "samples": 1990, "workouts": 4, "sleep_segments": 6,
        "activity_summaries": 0, "deletions": 0,
        "redriven": 0
      }
    ],
    "last_redrive": { "at": "2026-10-26T20:01:12Z", "moved": 3 }
  },
  "stats_reachable": true,
  "worker": {
    "started_at": "2026-10-27T11:30:00Z",
    "last_batch_at": "2026-10-27T12:30:28Z",
    "prefetch": 8,
    "batches_since_start": 2400,
    "items_since_start": 9000000,
    "failed_since_start": 0
  },
  "throughput": {
    "window_seconds": 630,
    "batches": 1100,
    "items": 4400000,
    "failed": 0,
    "batches_per_minute": 104.8,
    "items_per_minute": 419047.6
  },
  "eta_seconds": 2296
}
```

- **`queue.ready` is exact**, read with an AMQP passive declare. The batches a worker
  holds unacknowledged are not in it and cannot be counted over AMQP;
  `in_flight_max` is their upper bound (prefetch × consumers).
- **`throughput`** covers the last ten minutes plus the current one, cut short to the
  worker's start if that is later; the rate is divided by at least a minute, so a
  worker that has just started does not report a burst.
- **`eta_seconds` is an estimate** — (`ready` + `in_flight_max`) ÷ the batch rate —
  and is absent when there is no backlog, no consumer, or no batch finished in the
  window.
- **Nothing unmeasured is reported as zero.** It is always a `200`: if RabbitMQ
  cannot be asked, `broker_reachable` is `false`, `broker_error` says why, and
  `queue`/`dead_letter` are absent. If the worker's counters cannot be read,
  `stats_reachable` is `false` and `worker`/`throughput` are absent.
- A non-zero **`dead_letter.ready`** means batches that were not written and that
  nothing will retry on its own — [send them back](#retrying-dead-lettered-batches)
  once the cause is fixed. See the [Ingest queue screen](/dashboard/screens/#ingest-queue).
- **`dead_letter.recent_failures`** is why the worker gave up on its most recent
  batches, newest first: at most 20, each kept for 30 days, absent when there are none
  or when Redis cannot be read. `error` is the worker's message cut at 300 characters,
  with every number replaced by `#` and every quoted string by `"…"`, so no measured
  value can leak through it; UUIDs (`source_uuid`), `SQLSTATE` codes and IP addresses
  are kept. `redriven` is how many retries the batch had already had when it failed
  this time. `batch_id` is the id the `202` returned, absent for a batch queued by an
  older server.
- ⚠️ **That list is a log, not the queue's contents.** A batch dead-lettered before
  the server recorded reasons has no entry, and an entry outlives the retry of its
  batch — compare `failed_at` with **`dead_letter.last_redrive.at`** (the last retry
  that moved anything, kept for 30 days).

The worker keeps its counters in Redis: one hash per worker (reset on start), one
small hash per minute that expires after two hours, and the capped failure list, so
the footprint stays bounded however long it runs.

## Retrying dead-lettered batches

`POST /v1/ingest/dead-letter/redrive` (same device token) moves dead-lettered batches
back onto the ingest queue, where the worker processes them again. The body is
optional:

```json
{ "max": 10 }
```

Without a body, or without `max`, it moves every batch that is in the dead-letter
queue when the call starts. Either way at most **1000** per call; `max` outside
1–1000 is a `400`.

```json
{ "moved": 3, "remaining": 0, "max_redriven": 1, "repeated": 0 }
```

| Field | Meaning |
|---|---|
| `moved` | Batches confirmed on the main queue **and** removed from the dead-letter queue. Exact. |
| `remaining` | The dead-letter queue's depth afterwards. Absent if it could not be read — never a guessed 0. |
| `max_redriven` | The highest retry count among the moved batches, after this retry (`1` for a first retry, `0` when nothing moved). |
| `repeated` | Moved batches now on their third retry or later. They have failed again after earlier retries; the cause is probably in the data, not a passing outage. |
| `stopped_early` | Present only when the run stopped before its count, with the reason. `moved` still counts only the confirmed ones, and the batch in hand went back to the dead-letter queue. |

- **Safe to repeat.** The worker's writes are idempotent upserts keyed on
  `source_uuid`, so a batch processed twice stores nothing twice.
- **No batch is lost.** Each batch is republished first, with RabbitMQ publisher
  confirms; only after the broker confirms it — and has not returned it as
  unroutable — is the dead-letter copy acknowledged. An unconfirmed publish puts the
  batch back on the dead-letter queue and stops the run. The worst case is a batch in
  both queues, which the upserts absorb.
- **Nothing retries automatically.** Each moved batch carries an `x-helsa-redriven`
  header counting its retries; it is reported, never acted on.
- **No double move.** The number to move is fixed when the call starts, so a batch
  that fails again during the run is not picked up a second time. A second call while
  one is running gets a `409`. The lock lives in the API process, which is enough
  because the server runs a single API instance.
- **`503`** means nothing could be moved: RabbitMQ is unreachable.

Fix the cause before you retry. A batch that failed on a database restart goes
through; one that fails on its content returns to the dead-letter queue within
seconds, and its next entry in `recent_failures` shows the higher `redriven`.

## Failure modes

| Response | Meaning | Client should |
|---|---|---|
| `202` | Accepted | Advance the anchor. Send the next chunk. |
| `400` | `Malformed JSON` (the body is not JSON) or `Invalid batch` (it is JSON, but a value does not fit — a non-UUID `device_id`, a wrong type, an empty batch) | Not retryable as-is. Log it; something is wrong with the client. |
| `401` | Token problem | Stop, surface it to the user. Retrying will not help. |
| `413` | Chunk too large | Halve it and retry. Do not advance the anchor. |
| TLS handshake failure | Certificate problem | Stop and surface it. Buffer locally. |
| Timeout / connection refused | Server or network down | Retry with backoff. Keep buffering. **Do not advance the anchor.** |

In every non-`202` case the rule is the same: the anchor stays where it is. The
data is still in HealthKit, so nothing is lost by waiting.
