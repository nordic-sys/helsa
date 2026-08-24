---
title: API
layout: default
nav_order: 6
has_children: true
description: "The contract: base URL, conventions, endpoint map, and where the authoritative OpenAPI document lives."
---

# API
{: .no_toc }

1. TOC
{:toc}

---

## The contract

`backend/api/openapi.yaml` is an OpenAPI 3.1 document and it is **the source of
truth**. The Go server, the iOS app, and the web client all generate code from it.
These pages explain the parts that a schema cannot: why the ingest endpoint is
shaped the way it is, and what the conventions mean.

If this documentation and the specification disagree, the specification is right —
and the disagreement is a bug worth reporting.

Because the app lets you point it at any endpoint, **the specification is what you
implement if you want to write your own backend**. Nothing about the upload path
is specific to this Go implementation.

## Base URL and versioning

```
https://<your-host>/v1
```

Everything is under `/v1`. Version numbers move only for breaking changes;
additions — a new field, a new endpoint, a new `data_type` — happen in place.

The version is `0.x` and this is a hobby project. Pin what you depend on.

## Authentication

Every endpoint except `/healthz` and `/readyz` requires a bearer token:

```http
Authorization: Bearer <device-token>
```

On the public interface a **client certificate** is required as well, checked by
the proxy before HTTP is parsed. See [Authentication](authentication.html).

## Conventions
{: #conventions }

These apply everywhere, and getting them wrong is the usual source of "the numbers
look weird".

| | |
|---|---|
| **Time** | ISO-8601, UTC, on the wire. Always. |
| **Days** | Daily and weekly buckets are computed in a time zone, not in UTC. Pass `tz` as an IANA name (`Europe/Budapest`); without it the user's stored `time_zone` is used. "Today's steps" is meaningless without this. |
| **Units** | Stored in SI: metres, kilocalories, counts, milliseconds. The response carries the unit; trust it over any client-side table. |
| **Percentages** | Where `unit` is `%`, values are in the **0–100** range (19.24% arrives as `19.24`). HealthKit itself uses 0–1 fractions; the conversion happens once, on the server's read path. **Clients must not rescale.** |
| **Errors** | RFC 9457 problem documents, `application/problem+json`, with `type`, `title`, `status`, `detail`. |
| **Pagination** | Opaque cursors. Send back `next_cursor` unchanged. `null` means the end. |
| **Empty results** | A `200` with an empty array is a complete answer, not a failure. An indoor workout has no GPS route; an insight rule with too little data says nothing. |
| **Identity** | Deduplication keys are HealthKit UUIDs (`source_uuid`), not server-side ids. The client does not know server ids. |

## Endpoint map

### Ingestion

| | |
|---|---|
| `POST /v1/ingest` | The only write path for health data. Chunked, idempotent, asynchronous. [Details](ingest.html) |

### Reading

| | |
|---|---|
| `GET /v1/summary` | Aggregated series per metric for a range. The dashboard's main call. |
| `GET /v1/activity` | Daily Move / Exercise / Stand values with the goal that applied that day. |
| `GET /v1/workouts` · `/{id}` | Paged workout list; detail with average and maximum heart rate. |
| `GET /v1/workouts/{id}/route` | GPS track for one workout. Separate endpoint — a three-hour hike is tens of thousands of points, and the list must never carry them. |
| `GET /v1/sleep` | Sleep segments, or a daily roll-up. |
| `GET /v1/samples` | Raw samples for one `data_type`, keyset-paginated. Debugging and export. |
| `GET /v1/insights` | Rule-based observations. Statistics, not medicine — see the [disclaimer](../disclaimer.html). |
| `GET /v1/achievements` | Earned badges, newest first. |

[Details](reading-data.html)

### Writing (not health data)

| | |
|---|---|
| `GET/PUT /v1/settings` | Time zone, locale, unit system, notification preferences. Partial update: omitted fields are left alone. |
| `GET/POST /v1/devices` | Device list and heartbeat. `last_seen_at` is always set by the server. |
| `GET/PUT /v1/goals` | Step and ring targets. |
| `POST /v1/achievements` | Idempotent upsert. **The phone evaluates, the server stores** — the thresholds live on the client, and a badge is a historical fact that must not "un-earn" itself when you later change a threshold. Never deletes: a reinstalled phone starting from an empty set must not wipe years of history. |
| `POST /v1/push/register`, `PUT /v1/push/prefs` | Stores an APNs token. **Storage only — nothing is currently sent.** The token is captured at permission time or it is lost, so it is stored now and the delivery path is decided later. |

### Export

| | |
|---|---|
| `POST /v1/export` | Synchronous. The response *is* the file, streamed, with a `Content-Disposition` filename. `csv` gives one sample per row; `json` gives `{meta, samples, workouts, sleep_segments}`. `pdf` is in the contract but returns `501`. |
| `GET /v1/export/{id}` | Reserved for a future asynchronous path. **Always returns `404` today**, because no export job exists. A permanently `pending` fake job would be a lie. |

### Health

| | |
|---|---|
| `GET /healthz` | Liveness. Trivial by design; no authentication. |
| `GET /readyz` | Readiness: database, Redis, and queue reachable. This is the one worth checking. |

## Reading the spec

```bash
# Serve the document with any OpenAPI viewer, e.g.
npx @redocly/cli preview-docs backend/api/openapi.yaml
```

The comments inside the YAML are part of the documentation — they record why
fields are shaped the way they are, which is usually the thing you need when
implementing against it.
