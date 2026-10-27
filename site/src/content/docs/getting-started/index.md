---
title: Getting started
description: "Four steps, in this order: bring the stack up, issue a device token, make the certificates, run a first sync from the phone — with nothing exposed to the internet."
sidebar:
  order: 0
---
Get a working Helsa server on your own machine, reachable from your home network.
This section takes you from an empty directory to a running API that has accepted
real data from your phone, in **four steps, in this order** — each page ends with a link to the
next one. **Nothing here is opened to the internet**, and no router configuration is involved.
Exposing the server is a separate, deliberate step afterwards, in [Deployment](/deployment/).

## The order

1. **[Quick start](quick-start/)** — *on the server.* Clone, configure secrets, start the
   containers, run migrations, confirm the API answers.
2. **[Device token](device-token/)** — *on the server.* Issue the credential the app and the
   dashboard use, and understand what it grants.
3. **[Certificates](certificates/)** — *on your own computer* ⛔ **not the server.** Create the
   CA, the server and the client certificate; install them on the server and on the phone.
4. **[First sync](first-sync/)** — *on the phone.* Point the app at the server, upload a
   chunk, and check that it landed.

Then, only if the phone should sync from outside your home: **[Deployment](/deployment/)** —
the router, backups, and the hardening checklist.

:::tip[Before you start]
Skim **[the mistakes people actually make](/troubleshooting/#the-mistakes-people-actually-make)** —
a dozen lines, collected from a real first install. Most of them cost more time than the step
they belong to.
:::

## What you need

| | |
|---|---|
| **A Linux host** | A small VM or box that stays on. 2 vCPU / 4 GB RAM / 20 GB disk is comfortable. Running it on a laptop is fine for trying it out. |
| **Docker and Compose v2** | Everything runs in containers. `docker compose version` should print v2.x. Install it from Docker's own repository, following the official guide for your distribution: [Debian](https://docs.docker.com/engine/install/debian/) · [Ubuntu](https://docs.docker.com/engine/install/ubuntu/) · [others](https://docs.docker.com/engine/install/) — the distribution's own `docker.io` package is often too old for Compose v2. Then `sudo usermod -aG docker $USER` and log in again, so `docker` works without `sudo`. |
| **`git`, `make`, `openssl`, `jq`** | Every step below is a `make` target, and the checks use `jq`. A fresh Debian or Ubuntu cloud image has none of `git`, `make` or `jq`: `sudo apt install git make jq openssl`. |
| **An iPhone with the Helsa app** | The app is the only thing that can upload HealthKit data. Without it, the server has an empty database and a working API. |
| **About 30 minutes** | Longer if you go on to real deployment — certificates are the slow part. |

Not needed yet: a domain name, a router change, a public IP, or a certificate
authority. Those belong to [Deployment](/deployment/).

## What gets deployed

| Service | Role | Exposed |
|---|---|---|
| `timescaledb` | PostgreSQL + TimescaleDB. The samples table is a hypertable. | Never. Internal Docker network only. |
| `redis` | Cache, refresh tokens, and the revocation deny-list. | Never. |
| `rabbitmq` | Ingestion queue between the API and the worker. | Never. |
| `api` | The HTTP API. Accepts uploads, serves reads. | Behind the proxy in production; `127.0.0.1` locally. |
| `worker` | Consumes the queue, writes to the database, resolves references. | Never. |
| `web` | The static [dashboard](/dashboard/) bundle. | LAN / VPN only, never the public internet. |
| `proxy` | Caddy. TLS termination and the mutual-TLS gate. | The only service with a public port — and only after you set it up. |

:::note
**The base Compose file publishes no ports at all.** That is deliberate: the safe
default is that services talk to each other over the internal Docker network and
nothing else can reach them. Overlays add exactly the exposure a given profile
needs — the local profile binds to `127.0.0.1`, the production profile publishes
only the proxy.
:::

## A note on data

The database is the only durable copy of what you upload. Before you rely on it,
read [Backups and restore](/deployment/backups/) — in particular the part
about TimescaleDB not restoring like plain PostgreSQL. An untested backup is not
a backup, and this is the failure mode most likely to actually cost you something.
