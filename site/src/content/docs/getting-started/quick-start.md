---
title: Quick start
description: "Pull the published images, set secrets, start the containers, run migrations, and confirm the API answers — all on localhost."
sidebar:
  order: 1
---
You do not have to build Helsa to run it. Every push to `main` publishes container
images, and the Compose files use them by default; building from source is
[the second path](#building-from-source-instead), and it stays fully supported.

| | Image |
|---|---|
| API, worker and the token CLI | `ghcr.io/nordic-sys/helsa/backend` |
| Web dashboard | `ghcr.io/nordic-sys/helsa/web` |

Two images, not three — the token CLI runs from the backend image rather than having one
of its own. Both are built for **`linux/amd64` and `linux/arm64`**, so a Raspberry Pi, an ARM
VPS or an Apple Silicon machine runs them natively. The tags each image carries:

| Tag | What it is |
|---|---|
| `main` | the tip of the default branch — **the default**, and the newest thing that exists |
| `sha-…` | one exact build, and the only tag that never moves |
| `1.2.3`, `latest` | a release. ⚠️ **There are none yet**, so `latest` does not resolve — do not put it in your `.env` expecting it to work |

One backend image carries all three binaries; the Compose file picks which one each
service runs.

## 1. Get the Compose files

The images are the application, but the *shape* of a safe deployment — the Compose
files, the Caddy configuration, the PKI recipe — lives in the repository. So you
still start with a clone; you just do not compile anything.

```bash
git clone https://github.com/nordic-sys/helsa.git
cd helsa/deploy
cp .env.example .env
```

### The images are public

No registry login is needed: `ghcr.io/nordic-sys/helsa/backend` and `.../web` serve
anonymously.

:::note
Package visibility is set per package and is independent of the repository's, so if
you fork this and your own images come back `denied`, that is a visibility setting
rather than a missing image. `docker login ghcr.io` with a token carrying
`read:packages` is the fix — or [build from
source](#building-from-source-instead), which needs no registry at all.
:::

## 2. Configure secrets

`.env` holds every secret the stack needs. It is git-ignored, and it must stay
that way.

:::danger
**Generate real secrets now, not later.** The example file contains obvious
placeholder values so that a copy-paste mistake is visible rather than silent.
Replace all of them before the stack ever leaves your machine.
:::

```bash
# Run these and paste the output into .env.
openssl rand -base64 36   # POSTGRES_PASSWORD
openssl rand -base64 36   # REDIS_PASSWORD
openssl rand -base64 36   # RABBITMQ_PASSWORD
openssl rand -base64 48   # HELSA_JWT_SECRET
```

⚠️ **`HELSA_JWT_SECRET` is not in `.env.example`, and neither are `LAN_SUBNET` or
`WG_SUBNET`** — you add those lines yourself. They are not forgotten: the compose
files read them as `$${VAR:?…}`, so a missing one stops the stack with a message
naming it rather than starting with a default somebody might never notice. Adding
them to the example would be adding a value to copy.

| Variable | What it is | If you get it wrong |
|---|---|---|
| `POSTGRES_PASSWORD` | Database password. | The API cannot start. |
| `REDIS_PASSWORD` | Cache password. | Readiness check fails. |
| `RABBITMQ_PASSWORD` | Queue password. | Uploads are accepted but never processed. |
| `HELSA_JWT_SECRET` | Signs device tokens. | **Anyone who knows it can mint a token for your data.** Treat it like a private key. |
| `HELSA_PULL_POLICY` | `always` pulls the published images; `build` compiles from this checkout. | With `always` and no registry login, nothing starts. |

Keep a copy of `.env` in a password manager. If you lose `HELSA_JWT_SECRET` you
have to reissue every device token; if it leaks, you have to rotate it, which also
invalidates every token.

## 3. Start the data services

```bash
docker compose up -d
docker compose ps
```

Wait until `timescaledb`, `redis`, and `rabbitmq` all report `healthy`. The first
start takes longer: TimescaleDB initialises its data directory.

None of these publish a port. You cannot reach the database from another machine,
and that is the intended state.

## 4. Run migrations — deliberately

```bash
make prod-migrate
```

:::note
**Migrations never run automatically at API start-up.** Auto-migration is
convenient right up to the day a bad deploy rewrites a production schema on boot,
at which point it is very hard to undo. Running them yourself means you choose
the moment, and you can take a backup first.
:::

Verify:

```bash
docker compose exec timescaledb \
  psql -U helsa -d helsa -c '\dt'
```

You should see `users`, `devices`, `workouts`, `workout_route_points`,
`sleep_segments`, `activity_summary`, `goals`, `sync_state`, `achievements`,
`push_tokens`, and the `samples` hypertable — eleven in all.

## 5. Pull and start the application

```bash
make prod-pull      # docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
make prod-up        # ... up -d
```

That brings up the API, the worker, the web dashboard and the Caddy proxy. To check
what you are actually running:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml images
```

:::note
**The proxy wants certificates.** The production overlay expects a private CA and
a server certificate in `/opt/helsa/pki` — see [TLS and mutual
TLS](/deployment/tls-mtls/). Until they exist the `proxy` container will not
start, while the API, worker and dashboard are unaffected. Bring those up on their
own with `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api worker web`.
:::

### For local development only

If you want the data services in Docker and the Go code on your machine (an edit
and `make run-api` cycle), skip the images entirely and use the dev overlay, which
publishes the data ports to `127.0.0.1`:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
cd ../backend && make migrate && make run-api      # and make run-worker in a second shell
```

:::danger
**Every published port must start with `127.0.0.1:`.** If you see `0.0.0.0:8080`
or `:::8080`, the API is reachable from every machine on your network without
TLS and without the mutual-TLS gate. Stop, fix the port binding, and start again.
:::

## 6. Confirm it answers

⚠️ **On the production path the API publishes no port at all** — only the proxy does,
on 443 and 8443. So ask the container, not the host:

```bash
make prod-exec-api CMD="wget -qO- http://127.0.0.1:8080/healthz"
# {"status":"ok"}

make prod-exec-api CMD="wget -qO- http://127.0.0.1:8080/readyz"
# {"status":"ready"}   — database, Redis, and the queue are all reachable
```

On the **development** path above (`make run-api` on the host) 8080 is yours directly,
and plain `curl http://127.0.0.1:8080/readyz` works.

`/readyz` is the one to trust: `/healthz` only proves the process is alive, while
`/readyz` proves it can talk to its dependencies.

Anything else needs a token:

```bash
make prod-exec-api CMD="wget -qO- -S http://127.0.0.1:8080/v1/summary?range=day&metrics=stepCount"
# 401 Unauthorized
```

A `401` here is a **pass**, not a failure. Next step: [issue a device
token](device-token/).

## Building from source instead
Nothing about Helsa requires the published images. Building needs no registry
login, is the only way to run a change you have made, and is what you should do if
you would rather not trust a binary you did not compile.

```bash
make prod-build      # HELSA_PULL_POLICY=build docker compose ... build
make prod-up-source  # ... up -d, from what you just built
```

Or set `HELSA_PULL_POLICY=build` in `.env` and forget about it — every `make
prod-*` target then builds.

:::danger
**The two paths must not be mixed by accident.** With `HELSA_PULL_POLICY=always`
in `.env`, a plain `make prod-up` replaces your locally built images with the
published ones — silently, because a successful pull looks exactly like a
successful start. That is what `make prod-up-source` is for.
:::

You need the same things either way (Docker and Compose v2), plus roughly two
minutes of compilation on first build.

## 7. Stopping and starting

```bash
make prod-down                                          # stop, keep data
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

To wipe everything, including the database volume:

```bash
docker compose down -v
```

:::danger
**`down -v` deletes your health history.** There is no confirmation prompt and
no undo. On a machine that holds real data, take a dump first — see
[Backups and restore](/deployment/backups/).
:::

## Keeping it up to date

```bash
git pull            # the Compose files and the migrations
make prod-pull      # the images
make prod-migrate   # only if the pull brought new migrations — read them first
make prod-up
```

:::danger
**Pull the migrations before the images, and read them.** The default tag is `main`,
the tip of the default branch, so an image can expect a schema your database does not
have yet. The containers will start and then fail on queries, which looks like a bug
rather than a missed step. Pin `HELSA_BACKEND_IMAGE` to a `sha-…` tag if you would
rather decide when that happens.
:::

## What this is not

This local stack is **not a deployment**. Without the proxy it has no TLS and no
client certificate check, and a database whose only protection is that nothing is
published beyond loopback. It is fine for trying things out and for development.
Before you point a phone at it from outside your machine, work through
[Deployment](/deployment/).
