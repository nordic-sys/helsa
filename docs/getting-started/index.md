---
title: Getting started
layout: default
nav_order: 5
has_children: true
description: "Bring the stack up locally with Docker Compose, issue a device token, and verify a first sync — with nothing exposed to the internet."
---

# Getting started

Get a working Helsa server on your own machine, reachable only from that machine.
{: .fs-5 .fw-300 }

This section takes you from an empty directory to a running API that has accepted
real data from your phone. **Nothing here listens on a public interface**, and no
router configuration is involved. Exposing the server to the internet is a
separate, deliberate step described in [Deployment](../deployment/).

## The order

1. **[Quick start](quick-start.html)** — clone, configure secrets, start the
   containers, run migrations, confirm the API answers.
2. **[Device token](device-token.html)** — issue the credential the app and the
   dashboard use, and understand what it grants.
3. **[First sync](first-sync.html)** — point the app at the server, upload a
   chunk, and check that it landed.

## What you need

| | |
|---|---|
| **A Linux host** | A small VM or box that stays on. 2 vCPU / 4 GB RAM / 20 GB disk is comfortable. Running it on a laptop is fine for trying it out. |
| **Docker and Compose v2** | Everything runs in containers. `docker compose version` should print v2.x. |
| **An iPhone with the Helsa app** | The app is the only thing that can upload HealthKit data. Without it, the server has an empty database and a working API. |
| **About 30 minutes** | Longer if you go on to real deployment — certificates are the slow part. |

Not needed yet: a domain name, a router change, a public IP, or a certificate
authority. Those belong to [Deployment](../deployment/).

## What gets deployed

| Service | Role | Exposed |
|---|---|---|
| `timescaledb` | PostgreSQL + TimescaleDB. The samples table is a hypertable. | Never. Internal Docker network only. |
| `redis` | Cache and token deny-list. | Never. |
| `rabbitmq` | Ingestion queue between the API and the worker. | Never. |
| `api` | The HTTP API. Accepts uploads, serves reads. | Behind the proxy in production; `127.0.0.1` locally. |
| `worker` | Consumes the queue, writes to the database, resolves references. | Never. |
| `web` | The static dashboard bundle. | LAN / VPN only, never the public internet. |
| `proxy` | Caddy. TLS termination and the mutual-TLS gate. | The only service with a public port — and only after you set it up. |

> **The base Compose file publishes no ports at all.** That is deliberate: the safe
> default is that services talk to each other over the internal Docker network and
> nothing else can reach them. Overlays add exactly the exposure a given profile
> needs — the local profile binds to `127.0.0.1`, the production profile publishes
> only the proxy.
{: .note }

## A note on data

The database is the only durable copy of what you upload. Before you rely on it,
read [Backups and restore](../deployment/backups.html) — in particular the part
about TimescaleDB not restoring like plain PostgreSQL. An untested backup is not
a backup, and this is the failure mode most likely to actually cost you something.
