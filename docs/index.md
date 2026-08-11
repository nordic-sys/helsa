---
title: Home
layout: default
nav_order: 1
description: "Helsa is a self-hosted backend for Apple Health data. The app works without it; this is the optional server you can point it at."
---

# Helsa

A self-hosted backend for Apple Health data.
{: .fs-6 .fw-300 }

The **Helsa iOS app is local-first**. It reads HealthKit on the device, does its
analysis on the device, and by default **your health data never leaves the phone**.

Sending data anywhere is an option you turn on, and when you turn it on, you type
in **your own endpoint**. This repository is the thing that endpoint can point at:
a Go API, an ingestion worker, a TimescaleDB schema, a web dashboard, and the
deployment recipe that makes it defensible on the open internet.

It is MIT licensed so that you can read it, run it, fork it, or replace it with
something of your own that speaks the same [API contract](api/).

[Get started](getting-started/){: .btn .btn-primary }
[Read the disclaimer](disclaimer.html){: .btn }

---

> ## Not a medical device
> {: .no_toc }
>
> Helsa is a hobby project for looking at your own fitness data. It is **not a
> medical device**, it is **not for diagnosis, treatment, or monitoring of any
> medical condition**, and its output must not be used to make health decisions.
>
> It comes with **no warranty of any kind**. See the
> [full disclaimer](disclaimer.html) and the MIT licence text in the repository.
{: .warning }

---

## What it is

```
┌──────────────────────────────┐
│ iPhone (Helsa app)           │   HealthKit is the store. Analysis runs here.
│  HealthKit ──▶ analysis ──▶ UI│   Works fully offline, with no server at all.
└───────────┬──────────────────┘
            │  optional, opt-in, you choose the URL
            │  mutual TLS + device token
            ▼
┌──────────────────────────────┐
│ Your server (this repo)      │
│  Caddy ▸ API ▸ RabbitMQ      │
│         ▸ worker ▸ Timescale │   Long-term history, web dashboard,
│  web dashboard (LAN/VPN)     │   exports, Home Assistant summaries.
└──────────────────────────────┘
```

The phone is the only writer. Every other surface — the web dashboard, an iPad,
a Mac, Home Assistant — reads from the server. That asymmetry is not a design
preference; HealthKit has no cloud API, so the device that holds the data is the
only thing that can upload it.

![Web dashboard after a first sync](assets/screenshots/web-dashboard.png)

> **Screenshot placeholder.** The image above is not in the repository yet.
> See `docs/SCREENSHOTS.md` for what it should show and where to put it.

## Why you might want it

- **A history longer than the phone's.** HealthKit keeps everything, but only as
  long as you keep the device and the backup chain intact. A server gives you a
  second, queryable copy that you control, with compression and no retention
  policy.
- **A browser view.** Apple Health is an iPhone app. There is no official web view
  of your own data. The dashboard here is one.
- **Automation.** Daily summaries into [Home Assistant](integrations/home-assistant.html)
  for dashboards and automations.
- **SQL.** It is a Postgres database with your data in it. Ask it whatever you want.

## Why you might not

If you just want to look at your numbers on your phone, **you do not need any of
this**. Run the app without a server. That is the intended default, and the
project is designed so that the default is the complete experience for a single
device.

Running a server means running a server: TLS certificates that expire, backups
that must be tested, a port on your router, and a database that is now your
responsibility. The rest of these pages are honest about that cost.

## What it deliberately does not do

| Not this | Why |
|---|---|
| **Medical advice, scoring, or diagnosis** | Out of scope, permanently. It reports numbers you already have. |
| **A hosted service** | Nobody operates a Helsa cloud. There is no sign-up. Your data goes to your machine or nowhere. |
| **Health data in iCloud** | HealthKit *is* the store, and Apple already syncs and backs it up. The app keeps no second copy, so there is nothing to put in iCloud. Only app settings sync. |
| **Write back into HealthKit** | Read-only. Helsa never modifies your Health database or your Apple activity goals. |
| **Multiple users, sharing, family views** | Single user by design. The schema keeps a `user_id` column so the door stays open, but nothing multi-tenant is built or tested. |
| **Telemetry or analytics** | The app and the server collect nothing about you. There is no identifier, no crash pipeline, no phone-home. |
| **LLM-generated health insights** | The `/insights` endpoint is rule-based and explainable: rolling averages, z-scores, Pearson correlation. Each rule has a data minimum, and stays silent below it. |
| **A packaged mobile app** | The iOS app is closed source and not distributed here. This repository is the server side. |

## Where to go next

| | |
|---|---|
| [Getting started](getting-started/) | Bring the stack up locally with Docker Compose, issue a device token, verify a first sync. Nothing is exposed to the internet. |
| [Deployment](deployment/) | TLS, mutual TLS with a private CA, the reverse proxy, backups and restore, and a hardening checklist. Read before you open a port. |
| [API](api/) | The contract: what `/v1/ingest` accepts, what the read endpoints return, and the conventions (UTC, SI units, cursors) that apply everywhere. |
| [Integrations](integrations/) | Home Assistant over MQTT with discovery, plus a REST fallback. Daily summaries only — and the page explains why that limit matters. |

## Status and stability

The OpenAPI document in `backend/api/openapi.yaml` is the source of truth; the
server, the app, and the web client all generate from it. It is now a public
interface, so breaking changes have a cost — but the version is `0.x` and the
project is one person's hobby. Pin what you depend on.
