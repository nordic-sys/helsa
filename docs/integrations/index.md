---
title: Integrations
layout: default
nav_order: 8
has_children: true
description: "Getting daily summaries out of Helsa and into home automation — over MQTT with discovery, or over REST."
---

# Integrations

Two ways to get numbers out of Helsa and into your home automation.
{: .fs-5 .fw-300 }

| | Best when | Cost |
|---|---|---|
| **[MQTT with Home Assistant discovery](home-assistant.html)** | You already run an MQTT broker | Home Assistant creates the entities itself; nothing to maintain on either side |
| **[REST polling](rest-fallback.html)** | You do not want a broker | Hand-written YAML, no discovery, and you own the polling schedule |

MQTT is the recommended path, not because it is prettier but because it creates no
maintenance debt: the discovery protocol is stable, and there is no custom
integration to keep in step with Home Assistant releases. A bespoke HACS
integration would be a nicer experience and a permanent obligation.

The MQTT publisher ships **inside the ingestion worker** and is **off until you set
`HELSA_MQTT_URL`**. Nothing about running Helsa requires a broker; if you do not
set one, no MQTT code ever runs.

## One rule that governs both

> ## Daily summaries go out. Raw samples do not.
> {: .no_toc }
>
> A single day of an actively worn Apple Watch is **5,000–15,000 samples**. Pushing
> those into Home Assistant would write tens of thousands of state changes a day
> into the recorder database, which is SQLite by default. The database bloats, the
> history graphs become unusable, purges take longer than the interval between
> them, and eventually the whole instance slows down — for data you will never look
> at in Home Assistant anyway.
>
> Home Assistant is an **automation surface, not a health data store**. The health
> data store is the TimescaleDB behind Helsa, which is built for exactly this shape
> of data and compresses it.
>
> So: a handful of daily numbers — steps, active energy, sleep duration, resting
> heart rate — updated a few times a day. If you want the detail, query the
> database or use [`GET /v1/samples`](../api/reading-data.html#raw-samples).
{: .warning }

## What is worth sending

| Entity | Update rate | Useful for |
|---|---|---|
| Daily steps | A few times a day | Dashboards, a nudge in the evening |
| Daily active energy | A few times a day | Same |
| Last night's sleep duration | Once a morning | Morning routines, lighting |
| Resting heart rate | Once a day | A long-term graph |
| Rings closed | Once a day | A "day complete" indicator |
| **Sync freshness** | Every 15 minutes | **The one alert that matters** — see [below](home-assistant.html#the-alert-that-matters) |

## What is not worth sending

- Per-minute heart rate. Use the database.
- Individual workouts as entities. An event or a notification, maybe; an entity per
  workout, no.
- Anything you would not want in a second database with a different backup story.

> **Whatever you publish leaves Helsa's boundary.** Home Assistant has its own
> database, its own backups, and possibly its own remote access. Daily aggregates
> are usually fine to keep there; think before you add anything more sensitive.
{: .note }
