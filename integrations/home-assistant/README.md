# Home Assistant integration

Helsa publishes **daily summaries** over MQTT, in Home Assistant's discovery
format: Home Assistant creates the entities by itself (step count, active energy,
hours of sleep, resting heart rate, rings closed, sync freshness), with no YAML to
write by hand.

**The full guide is [`docs/integrations/home-assistant.md`](../../docs/integrations/home-assistant.md).**

## Where the code lives

There is nothing to install from this directory. The publisher is part of the
backend:

| | |
|---|---|
| [`backend/internal/hass/`](../../backend/internal/hass/) | The publisher: discovery documents, the daily collection, the freshness heartbeat |
| [`backend/cmd/worker/`](../../backend/cmd/worker/) | Where it runs — a goroutine in the ingestion worker |
| [`backend/test/smoke/mqtt_smoke_test.go`](../../backend/test/smoke/mqtt_smoke_test.go) | The end-to-end check against a real broker |

**Why inside the worker:** it is a handful of small queries a few times a day
against a database the worker already has open. A service of its own would mean
another container, another set of credentials, and another thing to notice had
stopped — for a goroutine's worth of work.

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

## It is off until you turn it on

The publisher starts only if `HELSA_MQTT_URL` is set. With no broker configured
nothing connects and nothing is published; with a broker configured but
unreachable, the worker logs it and carries on. Ingestion never depends on home
automation being up.

## The REST path

[`deploy/scripts/sync-heartbeat.sh`](../../deploy/scripts/sync-heartbeat.sh) pushes
the sync freshness into a sensor through Home Assistant's REST API. It predates the
MQTT publisher and remains the answer for anyone who would rather not run a broker
— see [`docs/integrations/rest-fallback.md`](../../docs/integrations/rest-fallback.md).

Running both at once is not harmful, but it is two sources for one number: pick
one. The MQTT version is the better dead man's switch, because `expire_after` makes
Home Assistant notice the silence by itself rather than inferring it from a sensor
that also goes `unknown` on a restart or a network hiccup.
