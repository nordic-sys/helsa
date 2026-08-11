---
title: Quick start
layout: default
parent: Getting started
nav_order: 1
description: "Clone the repository, set secrets, start the containers, run migrations, and confirm the API answers — all on localhost."
---

# Quick start
{: .no_toc }

1. TOC
{:toc}

---

## 1. Clone and configure

```bash
git clone https://github.com/nordic-sys/helsa.git
cd helsa/deploy
cp .env.example .env
```

`.env` holds every secret the stack needs. It is git-ignored, and it must stay
that way.

> **Generate real secrets now, not later.** The example file contains obvious
> placeholder values so that a copy-paste mistake is visible rather than silent.
> Replace all of them before the stack ever leaves your machine.
{: .warning }

```bash
# Run these and paste the output into .env.
openssl rand -base64 36   # POSTGRES_PASSWORD
openssl rand -base64 36   # REDIS_PASSWORD
openssl rand -base64 36   # RABBITMQ_PASSWORD
openssl rand -base64 48   # HELSA_JWT_SECRET
```

| Variable | What it is | If you get it wrong |
|---|---|---|
| `POSTGRES_PASSWORD` | Database password. | The API cannot start. |
| `REDIS_PASSWORD` | Cache password. | Readiness check fails. |
| `RABBITMQ_PASSWORD` | Queue password. | Uploads are accepted but never processed. |
| `HELSA_JWT_SECRET` | Signs device tokens. | **Anyone who knows it can mint a token for your data.** Treat it like a private key. |

Keep a copy of `.env` in a password manager. If you lose `HELSA_JWT_SECRET` you
have to reissue every device token; if it leaks, you have to rotate it, which also
invalidates every token.

## 2. Start the data services

```bash
docker compose up -d
docker compose ps
```

Wait until `timescaledb`, `redis`, and `rabbitmq` all report `healthy`. The first
start takes longer: TimescaleDB initialises its data directory.

None of these publish a port. You cannot reach the database from another machine,
and that is the intended state.

## 3. Run migrations — deliberately

```bash
docker compose --profile tools run --rm migrate up
```

> **Migrations never run automatically at API start-up.** Auto-migration is
> convenient right up to the day a bad deploy rewrites a production schema on boot,
> at which point it is very hard to undo. Running them yourself means you choose
> the moment, and you can take a backup first.
{: .note }

Verify:

```bash
docker compose exec timescaledb \
  psql -U helsa -d helsa -c '\dt'
```

You should see `users`, `devices`, `workouts`, `sleep_segments`,
`activity_summary`, `goals`, `sync_state`, `achievements`, and the `samples`
hypertable.

## 4. Start the application

The local profile adds the API and the worker, and binds published ports to the
loopback interface only:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Check what is listening:

```bash
docker compose ps --format 'table {% raw %}{{.Service}}\t{{.Ports}}{% endraw %}'
```

> **Every published port must start with `127.0.0.1:`.** If you see `0.0.0.0:8080`
> or `:::8080`, the API is reachable from every machine on your network without
> TLS and without the mutual-TLS gate. Stop, fix the port binding, and start again.
{: .warning }

The Makefile in `deploy/` wraps these combinations; `make help` lists the targets.
The raw `docker compose` commands above are what those targets run.

## 5. Confirm it answers

```bash
curl -s http://127.0.0.1:8080/healthz
# {"status":"ok"}

curl -s http://127.0.0.1:8080/readyz
# {"status":"ready"}   — database, Redis, and the queue are all reachable
```

`/readyz` is the one to trust: `/healthz` only proves the process is alive, while
`/readyz` proves it can talk to its dependencies.

Anything else needs a token:

```bash
curl -s -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:8080/v1/summary?range=day&metrics=stepCount'
# 401
```

A `401` here is a **pass**, not a failure. Next step: [issue a device
token](device-token.html).

## 6. Stopping and starting

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml down    # stop, keep data
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d   # start again
```

To wipe everything, including the database volume:

```bash
docker compose down -v
```

> **`down -v` deletes your health history.** There is no confirmation prompt and
> no undo. On a machine that holds real data, take a dump first — see
> [Backups and restore](../deployment/backups.html).
{: .warning }

## What this is not

This local stack is **not a deployment**. It has no TLS, no client certificate
check, and a database whose only protection is that nothing is published beyond
loopback. It is fine for trying things out and for development. Before you point
a phone at it from outside your machine, work through
[Deployment](../deployment/).
