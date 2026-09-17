# Third-party components

Helsa is MIT licensed (see [`LICENSE`](LICENSE)). That licence covers the code in this
repository and nothing else. What follows is what Helsa is built on and what ships
inside the published images, so that the notices those licences require are actually
reproduced somewhere rather than assumed.

⚠️ **This file exists because a list was wrong.** The disclaimer page credited a theme
the site stopped using in August, and omitted the two components with the most
demanding notice requirements — MapLibre and OpenStreetMap data. A credits list nobody
maintains is worse than none, because it reads as a checked one.

## Services the stack runs

| Component | Licence | Where |
|---|---|---|
| PostgreSQL | PostgreSQL Licence | `deploy/docker-compose.yml` |
| TimescaleDB | Apache-2.0 (community edition) | same image as PostgreSQL |
| Redis | RSALv2 / SSPLv1 (Redis 8) | cache, refresh tokens, revocation deny-list |
| RabbitMQ | MPL-2.0 | ingest queue |
| Caddy | Apache-2.0 | the reverse proxy |
| martin | MIT/Apache-2.0 | the **optional** tile service (`tiles` profile) |
| planetiler | Apache-2.0 | build-time only, never shipped |

## Go (backend)

The full set with versions is [`backend/go.mod`](backend/go.mod). The direct
dependencies are chi (MIT), pgx (MIT), sqlc-generated code (MIT), go-redis (BSD-2),
golang-jwt (MIT), amqp091-go (BSD-2), google/uuid (BSD-3) and paho.mqtt.golang
(**EPL-2.0**, for the Home Assistant publisher).

## JavaScript (web dashboard and this site)

The full set is in [`web/package-lock.json`](web/package-lock.json) and
[`site/package-lock.json`](site/package-lock.json). Worth naming:

- **MapLibre GL JS** — BSD-3-Clause. Shipped inside the `web` image.
- **React**, **Vite**, **TypeScript** — MIT.
- **Astro** and **Starlight** — MIT. This documentation site. (Not "Just the Docs",
  which it was before 2026-08-26.)

## Map and route data

⛔ **OpenStreetMap data is © OpenStreetMap contributors, under the
[Open Database License](https://opendatacommons.org/licenses/odbl/).** ODbL requires
attribution and carries a share-alike obligation on derived databases. It applies in
two places here:

1. **The web dashboard's optional basemap** — whether you self-host an archive built by
   `deploy/scripts/tiles-build.sh` from an OSM extract, or point the setting at a public
   provider. The map draws the credit; see
   [the map page](https://helsa.nordic-sys.com/deployment/map-tiles/) for what the
   setting can and cannot know about a provider you choose yourself.
2. **The walking routes bundled with the iOS app** — their tracks are derived from OSM.
   ⚠️ **Attribution alone does not settle this one.** The app does not merely *draw* with
   those coordinates, it **computes** with them — where along the route you are — so what it
   ships is a derivative database rather than only a produced work, and share-alike applies.
   That obligation is met by publishing the derived data: [`data/journey-tracks/`](data/journey-tracks/),
   under ODbL, with the recipe that produced each file.

## The iOS app

Closed source, and it has **no third-party dependencies at all**: `HelsaKit/Package.swift`
declares none and the Xcode project references no remote packages. Everything it uses is
Apple's own frameworks.
