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

```bash title="On the server"
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

**a) The three passwords** are already in `.env`, with placeholder values. Replace each value
with the output of its own `openssl rand -hex 32`:

```bash title="On the server"
openssl rand -hex 32      # → POSTGRES_PASSWORD=…
openssl rand -hex 32      # → REDIS_PASSWORD=…
openssl rand -hex 32      # → RABBITMQ_PASSWORD=…
```

**b) Five more lines are NOT in `.env` — add them at the end.** `HELSA_JWT_SECRET`,
`HELSA_APP_DB_PASSWORD`, `HELSA_WORKER_DB_PASSWORD`, `LAN_SUBNET` and `WG_SUBNET` are not in `.env.example` (only commented
reminders at its end), so there is nothing to edit; you append them:

```bash title="On the server"
cd ~/helsa/deploy                      # wherever your clone lives
echo "" >> .env
echo "HELSA_JWT_SECRET=$(openssl rand -base64 48)" >> .env
echo "HELSA_APP_DB_PASSWORD=$(openssl rand -hex 32)" >> .env   # the API's database login
echo "HELSA_WORKER_DB_PASSWORD=$(openssl rand -hex 32)" >> .env   # the worker's database login
echo "LAN_SUBNET=192.168.1.0/24" >> .env   # your home network
echo "WG_SUBNET=10.100.0.0/24" >> .env     # your WireGuard range (the addresses the VPN hands out)
chmod 600 .env
grep -cE "^(HELSA_JWT_SECRET|HELSA_APP_DB_PASSWORD|HELSA_WORKER_DB_PASSWORD|LAN_SUBNET|WG_SUBNET)=" .env   # must print 5
```

**`HELSA_APP_DB_PASSWORD` and `HELSA_WORKER_DB_PASSWORD` are the application's own database
logins.** The API connects as `helsa_app`, the worker and the token tool as `helsa_worker`; neither
can do anything but read and write rows, and `POSTGRES_USER` stays the owner, which only the
migrations use. Two roles because the API reads every person's rows only through the database's
own filters: on a server shared by a household, the database itself hands the API nothing but the
signed-in person's data, even if a query forgot to ask for it. The database creates both roles on its first start
from these values — so, like the others, set them **before** step 3. A production stack without
them refuses to start, with a message naming the missing one. (Upgrading an install from
before `helsa_app` existed: [the steps are below](#upgrading-an-install-from-before-helsa_app).)

`LAN_SUBNET` and `WG_SUBNET` are the two ranges the dashboard on `:8443` answers; everything else
gets a `403` ([Reverse proxy](/deployment/reverse-proxy/)). Put your own ranges in — the values
above are examples. No VPN? Give `WG_SUBNET` your LAN range a second time.

⚠️ **These two do not stop the stack when missing — they fall back silently** to
`192.168.1.0/24` and `10.100.0.0/24`. If your home network is something else, the symptom is a
dashboard that answers `403` from your own sofa, and nothing says why; if one of those example
ranges happens to be somebody else's network you can route to, it is let in. Set both.

⚠️ **Hex for the passwords, on purpose.** They end up inside connection strings. The
backend repairs a base64 password (`/`, `+`, `=`) in its own URLs, but hex has nothing to repair,
and a password containing `'` or `\` breaks the migration tool's connection string either way.

⚠️ **Set them before the first `docker compose up`, and do not change them afterwards casually.**
PostgreSQL and RabbitMQ store the password they were first started with; a new value in `.env`
alone locks the stack out of its own database. On an empty install, `docker compose down -v` and
start again; on one with data, change it inside PostgreSQL / RabbitMQ first.

⚠️ **Why those three are not in the example with a value:** a value in the example would be a
value to copy — a JWT secret that every install shares. A missing `HELSA_JWT_SECRET` stops the stack
with a message naming it (the compose files read it as `$${HELSA_JWT_SECRET:?…}`).

| Variable | What it is | If you get it wrong |
|---|---|---|
| `POSTGRES_PASSWORD` | The database owner's password — the migrations and backups use it. | Migrations and backups cannot log in. |
| `HELSA_APP_DB_PASSWORD` | The API's role `helsa_app`'s password. | Missing: the production stack refuses to start. Changed in `.env` only: the API cannot log in until `make prod-app-role` sets it in the database too. |
| `HELSA_WORKER_DB_PASSWORD` | The worker's and the token tool's role `helsa_worker`'s password. | The same as above, for the worker: uploads are accepted and never written. |
| `REDIS_PASSWORD` | Cache password. | Readiness check fails. |
| `RABBITMQ_PASSWORD` | Queue password. | Uploads are accepted but never processed. |
| `HELSA_JWT_SECRET` | Signs device tokens. | **Anyone who knows it can mint a token for your data.** Treat it like a private key. |
| `HELSA_PULL_POLICY` | `always` pulls the published images; `build` compiles from this checkout. | With `always` and no registry login, nothing starts. |

Keep a copy of `.env` in a password manager. If you lose `HELSA_JWT_SECRET` you
have to reissue every device token; if it leaks, you have to rotate it, which also
invalidates every token.

## 3. Start the data services

```bash title="On the server"
docker compose up -d
docker compose ps
```

Wait until `timescaledb`, `redis`, and `rabbitmq` all report `healthy`. The first
start takes longer: TimescaleDB initialises its data directory.

None of these publish a port. You cannot reach the database from another machine,
and that is the intended state.

## 4. Run migrations — deliberately

```bash title="On the server"
make prod-migrate
```

:::note
**Migrations never run automatically at API start-up.** Auto-migration is
convenient right up to the day a bad deploy rewrites a production schema on boot,
at which point it is very hard to undo. Running them yourself means you choose
the moment, and you can take a backup first.
:::

Verify:

```bash title="On the server"
docker compose exec timescaledb \
  psql -U helsa -d helsa -c '\dt'
```

And that the application has its own, unprivileged login:

```bash title="On the server"
docker compose exec timescaledb \
  psql -U helsa -d helsa -c '\du helsa_*'
```

Two rows. `helsa_app` with no attributes beside it — no *Superuser*, no *Create role*, no *Create
DB*. `helsa_worker` with one, *Bypass RLS*, and that one on purpose: the database's per-person
filters guard what the API reads, while the worker writes everyone's uploads, each one to the person
who sent it. `make prod-migrate` ends by refreshing that role's grants (`helsa_app: role and grants are in
place.`), so the tables the migration just created are covered.

You should see `users`, `devices`, `workouts`, `workout_route_points`,
`sleep_segments`, `activity_summary`, `goals`, `sync_state`, `achievements`,
`push_tokens`, and the `samples` hypertable — eleven tables of Helsa's, plus `goose_db_version`,
the migration tool's own bookkeeping: twelve rows.

`make prod-migrate` builds one small image locally (`helsa-migrate:local`, a few seconds) — the
migrations are not part of the published images, so this is the one thing that is built even on
the published-image path.

## 5. Pull and start the application

```bash title="On the server"
make prod-pull      # docker compose -f docker-compose.yml -f docker-compose.prod.yml pull
make prod-up        # ... up -d
```

That brings up the API, the worker, the web dashboard and the Caddy proxy. To check
what you are actually running:

```bash title="On the server"
docker compose -f docker-compose.yml -f docker-compose.prod.yml images
```

:::note
**The proxy wants certificates.** The production overlay expects a private CA and
a server certificate in `/opt/helsa/pki` — see [TLS and mutual
TLS](/getting-started/certificates/). Until they exist the `proxy` container will not
start, while the API, worker and dashboard are unaffected. Bring those up on their
own with `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d api worker web`.
:::

### For local development only

If you want the data services in Docker and the Go code on your machine (an edit
and `make run-api` cycle), skip the images entirely and use the dev overlay, which
publishes the data ports to `127.0.0.1`:

```bash title="On your computer"
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

```bash title="On the server"
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

```bash title="On the server"
make prod-exec-api CMD="wget -qO- -S 'http://127.0.0.1:8080/v1/summary?range=day&metrics=stepCount'"
# 401 Unauthorized
```

A `401` here is a **pass**, not a failure. ⚠️ Keep the inner quotes around the URL: without them
the shell cuts it at the `&`, the request goes out without `metrics`, and the answer is a `400`
that looks like something broke. Next step: [issue a device
token](device-token/).

## Building from source instead
Nothing about Helsa requires the published images. Building needs no registry
login, is the only way to run a change you have made, and is what you should do if
you would rather not trust a binary you did not compile.

```bash title="On the server"
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

```bash title="On the server"
make prod-down                                          # stop, keep data
docker compose -f docker-compose.yml -f docker-compose.dev.yml down
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

To wipe everything, including the database volume:

```bash title="On the server"
docker compose down -v
```

:::danger
**`down -v` deletes your health history.** There is no confirmation prompt and
no undo. On a machine that holds real data, take a dump first — see
[Backups and restore](/deployment/backups/).
:::

## Keeping it up to date

```bash title="On the server"
git pull            # the Compose files and the migrations
make prod-pull      # the images
make prod-migrate   # only if the pull brought new migrations — read them first
make prod-up
```

### Upgrading an install from before `helsa_worker`

A household server (2026-11) gives the worker and the token tool a role of their own, and the API
loses its direct access to the raw samples. On an install that already has `helsa_app`:

```bash title="On the server"
cd ~/helsa/deploy
git pull                                                          # 1. the Compose files, the migrations, the role script
echo "HELSA_WORKER_DB_PASSWORD=$(openssl rand -hex 32)" >> .env   # 2. the new key (once; never echoed)
make prod-pull                                                    # 3. the images
make prod-migrate                                                 # 4. the migrations, then BOTH roles' grants
make prod-up                                                      # 5. the worker and the token tool now log in as helsa_worker
```

Step 4 needs the new key: with `HELSA_WORKER_DB_PASSWORD` missing, the role script stops with a
message naming it, and the worker would not be able to log in.

### Upgrading an install from before `helsa_app`

Until 2026-10-28 the api and the worker connected as the database owner, a superuser. The Compose
files now connect them as `helsa_app` and refuse to start without its password. An install with
data does not get the role by itself — the database creates it only on its very first start — so
add it once, in this order:

```bash title="On the server"
cd ~/helsa/deploy                      # wherever your clone lives
git pull                                                        # 1. the Compose files and the role script
echo "HELSA_APP_DB_PASSWORD=$(openssl rand -hex 32)" >> .env    # 2. the new key (once; never echoed)
make prod-app-role                                              # 3. creates helsa_app, sets its password, grants
make prod-pull                                                  # 4. the images
make prod-migrate                                               # 5. any new migrations, then the grants again
make prod-up                                                    # 6. api, worker and token now log in as helsa_app
```

Step 3 is idempotent: run it again whenever you like — after a restore, after changing
`HELSA_APP_DB_PASSWORD` (it is how the database learns the new value), or if a check below fails.
Then confirm the application is no longer the superuser:

```bash title="On the server"
make prod-exec-api CMD="wget -qO- http://127.0.0.1:8080/readyz"   # {"status":"ready"}
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec timescaledb \
  psql -U helsa -d helsa -c "SELECT a.usename, r.rolsuper, count(*) FROM pg_stat_activity a JOIN pg_roles r ON r.oid = a.usesysid WHERE a.datname = 'helsa' AND a.backend_type = 'client backend' GROUP BY 1, 2;"
```

The api's and the worker's connections are the `helsa_app | f` row. The single `helsa | t` row is
the `psql` you just ran; if it counts more than one, something still logs in as the owner.

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

:::tip[Next: step 2]
**→ [Step 2: Device token](/getting-started/device-token/)**

Still on the server: `make prod-token SUBJECT=iphone`.
:::
