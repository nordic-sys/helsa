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

## The map under a workout route

The workout detail page draws a GPS route, and since 2026-09 there **can** be a
map behind it. Whether there is one is a **setting, and its default is no map** —
the same shape Helsa already uses for its own server: optional, off until switched
on, and the screen says what each choice means before you pick it.

The reason it is a setting and not a feature: a tile request tells whoever serves
it that somebody is looking at that square of the world. That is a privacy
trade-off, and it belongs to the person looking at the screen rather than to us.

### The three options, and what each one sends

Settings ▸ **Map under the route**:

| Option | Who fetches the tiles | Who learns what |
|---|---|---|
| **No map** (default) | nobody | nobody learns anything; the page is exactly what it was — the drawn line, its marker, its scale bar |
| **Your own tile server** | the Helsa server, from an address you run | nothing reaches a stranger: both ends are yours |
| **A public, open-source source** | the Helsa server, from a provider on the open internet | **the provider sees the request** — the Helsa server's address, and which area you are looking at |

⛔ **The browser never fetches a tile.** In every one of the three states the only
host the page talks to is the Helsa origin; the chosen address is resolved by the
API's proxy (`/v1/tiles/{z}/{x}/{y}`, behind the device token like every other
`/v1` route). Two reasons, and the second is the one that decides it:

1. Sent from the server, what the provider learns is the *server's* address. Sent
   from the browser, it would be the reader's, with everything else a browser
   carries along.
2. An address somebody types in cannot go into an origin allowlist. A rule that
   has to permit "whatever the user entered" permits everything, and the page's
   request list stops being something anyone can check.

⚠️ **That is not the same as "nothing leaves".** With the public option something
does leave — from here, not from the browser — and the setting says so in those
words. The full argument, including why the proxy deliberately does *not* block
private addresses (blocking them would break the "your own server" option it
exists for), is at the top of `backend/internal/server/tiles.go`.

### Running a tile server of your own

Optional, off unless started, and nothing depends on it:
`docker-compose.tiles.yml` adds a `tiles` service behind the `tiles` **profile** —
[martin](https://martin.maplibre.org), a small Rust server that reads a
`.pmtiles` archive with range reads. No database, no renderer, no cache; a few
tens of megabytes resident, which is what makes it affordable beside everything
else on a 4 GB VM.

```bash
# 1. Build a region — on a machine with RAM, NOT on the VM (planetiler wants a JVM)
make tiles-build REGION=hungary AREA=europe/hungary

# 2. Copy it over. Refuses if the disk would not take it, and renames only once
#    the whole file has landed
make tiles-install REGION=hungary HOST=your-server

# 3. Start the service (on the server)
make tiles-up
```

Then paste this into the setting, with the tile format set to **vector**:

```
http://tiles:3000/hungary/{z}/{x}/{y}
```

⚠️ A container name, and that is right: the browser never resolves it. The API
container does, from inside the compose network — which is exactly why the address
can be one that only exists there.

`AREA` is a [Geofabrik](https://download.geofabrik.de/) path without the
`-latest.osm.pbf` suffix (`europe/hungary`, `europe/austria`, `europe/italy`).
Measured on an M-series Mac:

| Region | Extract | Build | Archive |
|---|---|---|---|
| Hungary | 320 MB | 2 min 2 s | 287 MB |
| Austria | 730 MB | 49 s | 608 MB |

⛔ **The archive never enters git.** A region is 300–600 MB and this repository is
public; `.gitignore` refuses `*.pmtiles` tree-wide, and it should stay that way.

⚠️ **Disk is the binding constraint on a small VM, so it fails loudly rather than
quietly.** `tiles-install.sh` checks free space *before* copying and keeps a
`KEEP_FREE_G` margin (2 GB), because the machine that runs out is the one that
also runs Postgres. It copies to `*.pmtiles.part` and renames only on success — a
rename inside a filesystem is atomic, so the directory never holds a file that is
still arriving. To make room, delete a region and restart the service:

```bash
ssh your-server 'rm /opt/helsa/tiles/austria.pmtiles'
make tiles-down && make tiles-up
```

### Using a public provider

Paste the provider's template into the same field, with the tile format set to
**images**. OpenStreetMap's own tiles are the reference:

```
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

⚠️ Read [the OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
before pointing anything at it. The proxy sends a `User-Agent` that identifies
Helsa, which the policy requires — an anonymous one gets blocked, and a block
looks like a broken map rather than like a rule. Tiles are cached for a day, so a
route re-opened is not a second round of requests.

### What a route looks like in each state

- **No map** — the drawn line, the start/finish marker, the scale bar, and a
  sentence saying there is no map because none is switched on. **Not** an empty
  grey square: a missing map that is not explained reads as a fault.
- **A map** — the same drawing, on a muted basemap, with the credit the licence
  requires drawn from our own strings (never fetched), and a sentence naming which
  of the two sources it came from.
- **A map that will not draw** — a browser without WebGL, or a source that does
  not answer: the drawing again, with a sentence saying *that* instead. Three
  different reasons deserve three different sentences; telling somebody "no map is
  switched on" when they plainly switched one on sends them looking in the wrong
  place.

## What is where

| Path | What |
|---|---|
| `docker-compose.yml` | the data services (base; publishes no ports) |
| `docker-compose.dev.yml` | the local overlay (publishes the ports to the host) |
| `docker-compose.prod.yml` | the host overlay (app + proxy + tooling) |
| `docker-compose.devvm.yml` | a development host: the same as production, without the mTLS gate |
| `docker-compose.tiles.yml` | the OPTIONAL map tile server, behind the `tiles` profile — nothing depends on it and `up` never starts it |
| `caddy/` | the reverse proxy — the only component facing outwards |
| `pki/` | the private CA and the certificates ([README](pki/README.md)) |
| `migrate/` | the goose runner image (built locally; not published) |
| `mosquitto/` | a throwaway MQTT broker for testing the Home Assistant publisher (`make mqtt-up`; behind a compose profile, never started by `make up`) |
| `scripts/` | database backup, the restore procedure, the sync-freshness heartbeat, and the map-region build/install pair |
