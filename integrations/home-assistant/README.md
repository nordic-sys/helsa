# Home Assistant integration

> **Placeholder.** The code does not exist yet; this file records its place and its
> intended shape.

## What will live here

Helsa will publish **daily summaries** over MQTT, in Home Assistant's discovery
format: Home Assistant creates the entities by itself (step count, active energy,
hours of sleep, resting heart rate), with no YAML to write by hand.

**Why MQTT and not a custom Home Assistant integration:** a bespoke integration
gives a nicer experience (a configuration wizard), but it demands continuous
maintenance — Home Assistant's API moves, and the integration would have to be kept
in step with its releases. The MQTT discovery protocol is stable and produces no
maintenance debt. A custom integration is a later "nice to have", not the first
round.

⚠️ **A design constraint: daily summaries go to Home Assistant, not raw samples.**
Fifty thousand samples would wreck Home Assistant's recorder database. Home
Assistant is an automation surface, not a health data store — the raw data stays in
Helsa's own database.

## What is already usable

`deploy/scripts/sync-heartbeat.sh` pushes the sync freshness into a sensor through
Home Assistant's REST API. This is the system's one real alert, and it deliberately
does not go over MQTT: it is a dead man's switch, and it has to keep working at the
moment the rest of Helsa no longer does.
