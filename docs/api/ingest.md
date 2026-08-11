---
title: Ingest
layout: default
parent: API
nav_order: 2
description: "POST /v1/ingest: chunk semantics, idempotency, deletions, and the anchor-after-acknowledgement rule that makes offline catch-up work."
---

# Ingest
{: .no_toc }

1. TOC
{:toc}

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

### Routes count against the chunk

A long hike's GPS track can be larger than an entire batch of samples. The client
must count route points toward its chunk budget — otherwise chunking, whose whole
purpose is avoiding giant requests, is defeated by a single workout.

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
| Server maximum | 50,000 items per chunk (samples + workouts + sleep segments + activity summaries + route points + deletions) |
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
dead-letter queue rather than blocking the queue behind them.

Per-batch counts are logged: processed, duplicates, dead-lettered. That is normally
enough to diagnose a chunking problem without adding instrumentation.

## Failure modes

| Response | Meaning | Client should |
|---|---|---|
| `202` | Accepted | Advance the anchor. Send the next chunk. |
| `400` | Malformed body | Not retryable as-is. Log it; something is wrong with the client. |
| `401` | Token problem | Stop, surface it to the user. Retrying will not help. |
| `413` | Chunk too large | Halve it and retry. Do not advance the anchor. |
| TLS handshake failure | Certificate problem | Stop and surface it. Buffer locally. |
| Timeout / connection refused | Server or network down | Retry with backoff. Keep buffering. **Do not advance the anchor.** |

In every non-`202` case the rule is the same: the anchor stays where it is. The
data is still in HealthKit, so nothing is lost by waiting.
