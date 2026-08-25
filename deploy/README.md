# deploy

Everything needed to run Helsa: the compose stacks, the reverse proxy, the private
PKI, and the backup/restore procedure.

**Why this lives next to the source and not in a repository of its own:** the Go
source on its own is of little use to somebody who wants to operate it — the "how do
I make this safe" story is here, in the compose files, the Caddy configuration and
the PKI Makefile. Split apart, both halves would be incomplete.

## Two levels

- **Local dev** — `docker compose`: TimescaleDB + Redis + RabbitMQ for development.
  The application itself runs on your machine (`cd ../backend && make run-api`).
- **A single host** (`docker-compose.prod.yml`) — the same data services plus the
  api/worker/web containers and the Caddy proxy. This is what runs on the home VM.

## Local development

### Prerequisite
Docker + Docker Compose.

### Starting
```bash
cp .env.example .env     # local (never production) values; .env is gitignored
make up                  # or: docker compose up -d
make ps                  # status
```

Then apply the schema from `../backend`: `make migrate`. The schema has **one
source**, the goose migrations — see the note in `init/timescaledb/02-schema.sql`
about what happened when there were two.

### Endpoints (default ports)
| Service | Image | Host | Note |
|---|---|---|---|
| TimescaleDB | `timescaledb-ha:pg18` | `localhost:5433` | database `helsa`, user `helsa`, password in `.env`. 5433 so it does not clash with an existing Postgres |
| Redis | `redis:8-alpine` | `localhost:6380` | with a password (`--requirepass`) |
| RabbitMQ AMQP | `rabbitmq:4-management` | `localhost:5672` | |
| RabbitMQ UI | — | http://localhost:15672 | user/password in `.env` |

Local connection string: `postgres://helsa:helsa_local_dev@localhost:5433/helsa`.

### Useful commands
```bash
make psql        # psql into TimescaleDB
make redis-cli   # redis-cli
make rabbit      # the management UI in a browser
make logs        # logs
make down        # stop (the data survives)
make reset       # stop + DELETE THE DATA (the volumes)
```

`make help` lists all of them, including the `prod-*` and `devvm-*` targets.

## Images or source

The application services (`api`, `worker`, `web`, `token`) default to the images
published to GHCR — `ghcr.io/nordic-sys/helsa/backend` and `.../web` — so running
Helsa does not require compiling it. One backend image carries all three binaries;
the compose file picks one per service with `command`.

`HELSA_PULL_POLICY` in `.env` is the switch:

| Value | What happens | Target |
|---|---|---|
| `always` (default) | the published images are pulled | `make prod-pull` + `make prod-up` |
| `build` | the images are built from this checkout | `make prod-build` + `make prod-up-source` |

⚠️ **If the GHCR packages are private, a pull needs `docker login ghcr.io` first**,
with a token carrying `read:packages`. A missing login fails as `denied`, which
reads like a missing image rather than a missing credential.

Package visibility is set per package and is **independent of the repository's** —
making the repository public does not publish the images with it.

⚠️ **Do not mix the two by accident.** With `HELSA_PULL_POLICY=always` in `.env`, a
plain `make prod-up` quietly replaces locally built images with the published ones
— a successful pull looks exactly like a successful start. `make prod-up-source`
exists for that reason.

## On a host

The expected directory layout is documented at the top of
`docker-compose.prod.yml`. Two things are worth calling out:

- **The migration is a separate, deliberate step** (`make prod-migrate`), never a
  start-up side effect. On a live database, "migrate on start-up" is hard to reverse
  after a bad deploy.
- **The signing material lives outside the checkout** (`/opt/helsa/pki`), so it can
  neither end up in the repository nor be swept away by a `git clean`.

> ⚠️ **Opening a port outwards is the riskiest step in this whole setup.** The
> defaults here are conservative: the base compose file publishes nothing, the data
> ports come only from the dev overlay, and in the production overlay only the proxy
> faces outwards — the API behind mandatory mTLS, the web dashboard behind network
> filtering. If you change that, change it knowingly.

## What is where

| Path | What |
|---|---|
| `docker-compose.yml` | the data services (base; publishes no ports) |
| `docker-compose.dev.yml` | the local overlay (publishes the ports to the host) |
| `docker-compose.prod.yml` | the host overlay (app + proxy + tooling) |
| `docker-compose.devvm.yml` | a development host: the same as production, without the mTLS gate |
| `caddy/` | the reverse proxy — the only component facing outwards |
| `pki/` | the private CA and the certificates ([README](pki/README.md)) |
| `migrate/` | the goose runner image (built locally; not published) |
| `mosquitto/` | a throwaway MQTT broker for testing the Home Assistant publisher (`make mqtt-up`; behind a compose profile, never started by `make up`) |
| `scripts/` | database backup, the restore procedure, the sync-freshness heartbeat |
