---
title: REST fallback
description: "Polling the Helsa API from Home Assistant with REST sensors, when you would rather not run an MQTT broker."
sidebar:
  order: 2
---
If you do not want an MQTT broker, Home Assistant can poll the API directly. It
works, it needs no extra components, and it costs you hand-written YAML with no
discovery.

`deploy/scripts/sync-heartbeat.sh` is the push-shaped variant of the same idea: a
cron job on the Helsa host that writes the freshness into a Home Assistant sensor
over the REST API. Either is fine; running one of them **alongside** the MQTT
publisher is not, because then one number has two sources that can disagree.

The same rule applies as everywhere else: **poll summaries, not raw samples.**

## Reaching the API

Home Assistant must be able to reach Helsa **on the LAN or VPN interface** — the
one that does not demand a client certificate. Home Assistant's REST integration
cannot present a client certificate, so it cannot use the public mutual-TLS
interface at all.

That is a feature. The public interface stays limited to devices holding a
certificate you issued.

### Trusting the private CA

The server certificate is signed by your own CA, which Home Assistant does not know
about. Install `ca.crt` into the trust store of the container or OS running Home
Assistant so that certificate verification succeeds.

:::danger
**Do not reach for `verify_ssl: false`.** It does not just skip a warning — it
disables verification that you are talking to your own server, which is what TLS
is for. If you genuinely cannot install the CA, prefer plain HTTP over a trusted
LAN segment to encrypted-but-unverified HTTPS; at least the trust boundary is then
visible rather than imaginary.
:::

## Token

Issue a dedicated device token so it can be revoked on its own, and so the logs tell it apart from your phone:

```bash
make prod-token SUBJECT=home-assistant
```

Put it in `secrets.yaml`, never in `configuration.yaml`:

```yaml
# secrets.yaml
helsa_token: "eyJhbGciOiJIUzI1NiIs..."
helsa_base: "https://helsa.lan:8443/v1"
```

:::danger
This token can read your entire health history. Home Assistant configuration
backups will contain `secrets.yaml`; store those backups accordingly.
:::

## Sensors

```yaml
# configuration.yaml
rest:
  - resource: !secret helsa_base_summary_today
    scan_interval: 1800          # 30 minutes. Do not make this small.
    timeout: 20
    headers:
      Authorization: !secret helsa_auth_header
      Accept: application/json
    sensor:
      - name: "Helsa steps today"
        unique_id: helsa_steps_today
        value_template: "{% raw %}{{ value_json.metrics.stepCount.total | round(0) }}{% endraw %}"
        unit_of_measurement: "steps"
        state_class: total_increasing
        icon: mdi:walk
      - name: "Helsa active energy today"
        unique_id: helsa_active_energy_today
        value_template: "{% raw %}{{ value_json.metrics.activeEnergy.total | round(0) }}{% endraw %}"
        unit_of_measurement: "kcal"
        state_class: total_increasing
        icon: mdi:fire
```

with, in `secrets.yaml`:

```yaml
helsa_base_summary_today: "https://helsa.lan:8443/v1/summary?range=day&metrics=stepCount,activeEnergy&tz=Europe/Budapest"
helsa_auth_header: "Bearer eyJhbGciOiJIUzI1NiIs..."
```

Pass `tz` explicitly. Without it the server falls back to the stored user setting,
and if those two ever disagree your daily totals will be cut at a different
midnight than you expect.

### Sleep — the one the REST path cannot give you

⛔ **There is no sleep figure on `/v1/summary`.** Sleep is not a sample: it lives in
`sleep_segments`, and turning a night's segments into hours means flattening overlaps —
the phone and the watch both record the same night, and `inBed` wraps all of it. That is
`GET /v1/sleep`, which returns the segments, and the arithmetic is then yours.

This page used to carry a `rest` sensor reading `value_json.metrics.sleepHours.total`,
under a note telling you to "check the actual metric key before copying this". There is
no such key and never was; the hedge hid a dead example rather than flagging it.

If you want last night's hours as one number in Home Assistant, **use the MQTT
publisher** — it does exactly this flattening on the server and publishes
`sensor.helsa_sleep_last_night`. See [Home Assistant](/integrations/home-assistant/).

## Freshness, without MQTT

`GET /v1/devices` returns devices ordered by `last_seen_at`. Poll it and compute
the age of the newest entry:

```yaml
rest:
  - resource: !secret helsa_base_devices
    scan_interval: 900           # 15 minutes
    headers:
      Authorization: !secret helsa_auth_header
    sensor:
      - name: "Helsa sync freshness"
        unique_id: helsa_sync_freshness
        unit_of_measurement: "h"
        state_class: measurement
        value_template: >-
          {% raw %}{% set ios = value_json | selectattr('platform', 'eq', 'ios') | list %}
          {% if ios | count > 0 %}
            {{ [ ((now().timestamp() - (ios | map(attribute='last_seen_at') | max | as_datetime | as_timestamp)) / 3600), 0 ] | max | round(1) }}
          {% else %}
            unknown
          {% endif %}{% endraw %}
```

Two things this template does deliberately:

- **It filters to `platform == 'ios'`.** Only the phone uploads. An iPad or Mac
  checking in would otherwise keep the sensor looking healthy while the phone had
  not synced for weeks — precisely the failure being watched for.
- **It clamps at zero.** If a clock is skewed and the newest timestamp is in the
  future, the age goes negative, and a negative number never crosses an "above 12"
  threshold. That silently disables the alert.

### The important limitation

:::danger
**This version is not a dead man's switch.** If the Helsa host dies, the REST
sensor becomes `unavailable` or `unknown` — but so does it when Home Assistant
restarts, when the network hiccups, or when the token expires. It is a weaker
signal than the MQTT `expire_after` approach, where a missing heartbeat is
unambiguous.

Alert on `unavailable` as well as on a high value, and accept a few false
positives. A false alarm is cheap; a month of unnoticed silence is not.
:::

```yaml
automation:
  - alias: Helsa sync stalled (REST)
    trigger:
      - platform: numeric_state
        entity_id: sensor.helsa_sync_freshness
        above: 12
        for: "00:30:00"
      - platform: state
        entity_id: sensor.helsa_sync_freshness
        to: ["unavailable", "unknown"]
        for: "01:00:00"
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: Helsa is not syncing
          message: "No fresh health data from the phone."
```

## Polling budget

| Endpoint | Sensible interval | Why not faster |
|---|---|---|
| `/v1/summary?range=day` | 30 minutes | The answer is cached for 60 s and recomputed when a batch lands. Polling every minute mostly returns the same number, and the phone syncs far less often than that. |
| `/v1/summary?range=week` | 6 hours | It is a weekly figure. |
| `/v1/devices` | 15 minutes | Enough resolution for a 12-hour threshold. |
| `/v1/samples` | **Never** | This is the raw-data endpoint. It is not for Home Assistant. |

## When to switch to MQTT

If you find yourself adding a fourth REST sensor, or writing templates to reshape
responses, the broker will save you time. Discovery means the entity definitions
live with the publisher rather than in your Home Assistant configuration, and the
freshness alert becomes a genuine dead man's switch.
