---
title: The map under a route
description: "Whether a workout route gets a basemap, where the tiles come from, and what each choice tells whom. Off by default."
sidebar:
  order: 5
---
The workout detail page in the web dashboard draws a GPS route. Since 2026-09
there **can** be a map behind it — and whether there is one is a setting whose
default is *no map*.

## Why this is a setting and not a feature

A tile request tells whoever serves it that somebody is looking at that square of
the world. On a page about where a person ran, that is a privacy trade-off, and it
belongs to the person looking at the screen rather than to us. So it takes the
same shape as Helsa's own server does: optional, off until switched on, and the
screen says what each choice means **before** you pick it.

## The three options

Settings ▸ **Map under the route**:

| Option | Who fetches the tiles | Who learns what |
|---|---|---|
| **No map** (default) | nobody | nobody learns anything. The page is the drawn line, its marker, its scale bar — exactly what it was |
| **Your own tile server** | the Helsa server, from an address you run | nothing reaches a stranger: both ends are yours |
| **A public, open-source source** | the Helsa server, from a provider on the open internet | **the provider sees the request** — your server's address, and which area is being looked at |

## The browser never fetches a tile

In all three states the only host the page talks to is the Helsa origin. The
address you choose is resolved by the API's proxy — `GET /v1/tiles/{z}/{x}/{y}`,
behind the device token like every other `/v1` route. Two reasons, and the second
is the one that decides it:

1. Sent from the server, what the provider learns is the **server's** address.
   Sent from the browser, it would be the reader's, with everything else a browser
   carries along.
2. **An address somebody types in cannot go into an origin allowlist.** A rule
   that has to permit "whatever the user entered" permits everything, and the
   page's request list stops being something anyone can check.

:::caution
That is not the same as "nothing leaves". With the public option something does
leave — from the server, not from the browser — and the setting says so in those
words. A sentence implying nothing leaks would be worse than no sentence.
:::

The proxy is GET-only, http/https-only, size-capped, time-limited, and follows no
redirects; a redirect is the one way a checked address can turn into an unchecked
one between the check and the fetch. It deliberately does **not** block private
addresses — blocking them would break the "your own server" option it exists for.
The full argument is at the top of `backend/internal/server/tiles.go`.

`/v1/tiles` is **not in the OpenAPI contract**, and that is deliberate: the
contract is the phone's, and the phone has MapKit. Adding this would put a forward
proxy into the app's published API surface for the sake of a browser convenience.

## Running a tile server of your own

Optional, off unless started, and nothing depends on it. `docker-compose.tiles.yml`
adds a `tiles` service behind the `tiles` compose **profile** —
[martin](https://martin.maplibre.org), a small Rust server that reads a `.pmtiles`
archive with range reads. No database, no renderer, no cache; a few tens of
megabytes resident, which is what makes it affordable beside everything else on a
small VM.

```bash
# 1. Build a region — on a machine with RAM, NOT the VM (planetiler wants a JVM)
make tiles-build REGION=hungary AREA=europe/hungary

# 2. Copy it over. Refuses if the disk would not take it, and renames only once
#    the whole file has landed
make tiles-install REGION=hungary HOST=your-server

# 3. Start the service, on the server
make tiles-up
```

Then paste this into the setting, with the tile format set to **vector**:

```
http://tiles:3000/hungary/{z}/{x}/{y}
```

A container name — and that is right. The browser never resolves it; the API
container does, from inside the compose network, which is exactly why the address
can be one that only exists there.

Measured on an M-series Mac:

| Region | Extract | Build | Archive |
|---|---|---|---|
| Hungary | 320 MB | 2 min 2 s | 287 MB |
| Austria | 730 MB | 49 s | 608 MB |

:::danger
**The archive never enters git.** A region is 300–600 MB and the repository is
public; `.gitignore` refuses `*.pmtiles` tree-wide, and it should stay that way.
:::

Disk is the binding constraint on a small VM, so it fails loudly rather than
quietly: `tiles-install.sh` checks free space *before* copying and keeps a 2 GB
margin, because the machine that runs out is the one that also runs Postgres. It
copies to `*.pmtiles.part` and renames only on success — a rename inside a
filesystem is atomic, so the directory never holds a file that is still arriving.

## How far this scales, including the whole planet

**Nothing in this pipeline is limited to a country**, and nothing downstream is
either: martin range-reads a `.pmtiles` archive whatever its size,
`tiles-install.sh` only checks that the disk has room, and the setting takes a
single address. How much world you can host is a question about **your hardware**,
not about Helsa.

The one input that is not a Geofabrik path is the planet itself — Geofabrik
publishes extracts *of* the planet, not the planet — so you fetch that one
yourself and pass it in:

```bash
JAVA_HEAP=100g PLANETILER_ARGS='--nodemap-type=array --storage=mmap' \
  make tiles-build REGION=planet AREA=https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf
```

`AREA` takes three forms: a Geofabrik path (`europe/hungary`), any `https://` URL
to an `.osm.pbf`, or a file already on the build machine.

:::caution
A planet build is a different class of machine from a country: far more heap than
the 6 GB default, a large scratch area beside the output, and hours rather than
minutes. [planetiler's README](https://github.com/onthegomap/planetiler) carries
the current numbers and the flags that go with them; pass them through
`PLANETILER_ARGS` rather than editing the script.
:::

**For most people the answer is not the planet.** Self-host the few countries you
actually move around in, and let the public option cover everywhere else. That is
why the setting offers three choices rather than two.

## Using a public provider

Paste the provider's template into the same field, with the tile format set to
**images**. OpenStreetMap's own tiles are the reference:

```
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

:::caution
Read [the OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
before pointing anything at it. The proxy sends a `User-Agent` that identifies
Helsa, which the policy requires — an anonymous one gets blocked, and a block
looks like a broken map rather than like a rule. Tiles are cached for a day, so a
route re-opened is not a second round of requests.
:::

## What a route looks like in each state

- **No map** — the drawn line, the start and finish markers, the scale bar, and a
  sentence saying there is no map because none is switched on. **Not** an empty
  grey square: a missing map that is not explained reads as a fault.
- **A map** — the same drawing, on a muted basemap, with the credit the licence
  requires drawn from our own strings (never fetched), and a sentence naming which
  source it came from.
- **A map that will not draw** — a browser without WebGL, or a source that does
  not answer: the drawing again, with a sentence saying *that* instead.

Three different reasons deserve three different sentences. Telling somebody "no
map is switched on" when they plainly switched one on sends them looking in the
wrong place.

## No labels, and why that is also a defence

The style carries no glyphs, no sprites and no symbol layers. This is where
self-hosted maps leak: a style copied from anywhere carries a
`https://fonts.openmaptiles.org/…` entry in a key nobody reads, and the map then
fetches fonts from a third party while looking entirely local. A test asserts
their absence rather than leaving it for a reviewer to notice.

Dropping labels is not only defensive. The route is the hero here and the map is
background, so street names would compete with the line for the same ink. A
label-free basemap under an overlay is an ordinary cartographic choice — Positron
and Dark Matter both ship one.
