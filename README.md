# Helsa

Self-hosted backend for the Helsa app — your Apple Health data, on a server you run.

**Documentation: https://nordic-sys.github.io/helsa/**

---

## Not a medical device

Helsa is a hobby project for looking at your own fitness data. It is **not a medical
device**, not for diagnosis, treatment, or monitoring of any medical condition, and
its output must not be used to make health decisions. It is provided **as is,
without warranty of any kind** (see [LICENSE](LICENSE)). The author accepts no
responsibility for data loss, for a server you exposed to the internet, or for
anything you did because of what Helsa displayed.

---

## What this is

The **Helsa iOS app is local-first**: it reads HealthKit on the device, does its
analysis on the device, and by default your health data never leaves the phone.
Sending data anywhere is an option you switch on, pointing at an endpoint you type
in yourself.

This repository is what that endpoint can be:

| | |
|---|---|
| `backend/` | Go API and ingestion worker, PostgreSQL + TimescaleDB schema |
| `web/` | React dashboard |
| `deploy/` | Docker Compose, Caddy configuration, private-CA tooling, backup scripts |
| `integrations/` | Home Assistant (MQTT with discovery) |
| `site/` | The public documentation site, built with Astro and published to GitHub Pages |

The iOS app itself is closed source and not distributed here.

## Apple Health is the only store

Everything Helsa records goes into Apple Health — the daily journal, the symptoms
written on events, the water. There is no separate Helsa store for measurements:
not on the phone, and **not in this backend either**. What the server holds is a
copy for reading on other screens, never the original.

That is what lets the app be removed without taking anything with it, and it has a
price worth stating plainly: **Apple Health's list of measurement types is fixed,
an app cannot add to it, so what is missing there is missing from Helsa.** In
practice that means body water percentage, skeletal muscle mass, lab results, and
every body circumference except the waist. A scale still syncs its body mass and
body fat percentage normally; it is those extra numbers that stop at the door.

If Apple adds a type, it appears on its own — the app works from the list of types
rather than from a list of its own. The reverse, keeping something Health does not,
would create data that exists nowhere else, which is the one thing this design is
built to avoid.

## The app is in closed testing

**Helsa is not on the App Store yet.** It is in a **TestFlight** round —
invitation only, and the invitations go to people the author already knows.

That has two consequences worth stating plainly:

- **You cannot install the app from this repository.** What is here is the
  optional server, and it is useful on its own only if you are writing a client
  against [the API contract](backend/api/openapi.yaml).
- **The contract can still move.** While the app is in testing, an endpoint or a
  field may change shape between releases. Breaking changes are described in the
  commit that makes them; there is no deprecation window yet, because there is
  nobody on the outside depending on one.

The server itself is not in testing — it is what it looks like, and it is MIT
licensed. Run it, fork it, or replace it.

⚠️ **A single-maintainer hobby project.** There is no support commitment, no
uptime, and no roadmap you can hold anyone to.

The API contract is [`backend/api/openapi.yaml`](backend/api/openapi.yaml). It is
the source of truth, and it is what you implement if you would rather write your
own backend.

## Quick start

```bash
git clone https://github.com/nordic-sys/helsa.git
cd helsa/deploy
cp .env.example .env          # then replace every placeholder secret
docker compose up -d
docker compose --profile tools run --rm migrate up
```

Nothing in that sequence is reachable from the internet. Exposing the server is a
separate, deliberate process — see
[Deployment](https://nordic-sys.github.io/helsa/deployment/), and read it before you
forward a port.

## Licence

MIT. See [LICENSE](LICENSE).

## Security

Found something? See [SECURITY.md](SECURITY.md). This is a single-maintainer hobby
project with no service-level commitment.

## A note on how this was built

Helsa was developed with the help of an AI assistant. Every line was reviewed by a
human before it was committed, and the responsibility for the code is the author's.
This is stated for transparency, not because any rule requires it.
