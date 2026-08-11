---
title: Home Assistant (MQTT)
layout: default
parent: Integrations
nav_order: 1
description: "Publish daily summaries over MQTT with Home Assistant discovery, and build the sync-freshness alert as a dead man's switch."
---

# Home Assistant over MQTT
{: .no_toc }

1. TOC
{:toc}

---

## What this gives you

Helsa publishes a small set of **daily summary values** to an MQTT broker, together
with Home Assistant discovery messages. Home Assistant creates the entities by
itself — no YAML, no custom integration, nothing to update when Home Assistant
changes its API.

```
helsa worker ──▶ MQTT broker ──▶ Home Assistant
   (daily)         (retained)      (entities appear automatically)
```

> **Daily summaries only.** Not raw samples. The reasoning is on the
> [Integrations overview](./) — in short, tens of thousands of state changes a day
> would wreck the recorder database for data you would never read there.
{: .warning }

## Requirements

- An MQTT broker on your network (Mosquitto is the usual choice).
- The MQTT integration configured in Home Assistant, with discovery enabled — it is
  on by default, using the `homeassistant/` prefix.
- Credentials for the broker, kept in `.env` on the Helsa host and in
  `secrets.yaml` on the Home Assistant side.

> **Keep the broker on your LAN.** If it is reachable from the internet, so is
> everything published to it. Broker credentials are not an afterthought: whoever
> has them can read every summary and publish fake ones.
{: .warning }

## Configuration

In `deploy/.env`:

```bash
HELSA_MQTT_URL=mqtt://helsa:CHANGE_ME@mqtt.lan:1883
HELSA_MQTT_PREFIX=helsa
HELSA_MQTT_DISCOVERY_PREFIX=homeassistant
HELSA_MQTT_PUBLISH_INTERVAL=6h
```

Then start the publisher alongside the rest of the stack. It reads the same
database the API does and publishes summaries on a schedule.

> **Check your checkout.** If `integrations/home-assistant/` is not present in your
> copy of the repository, the publisher has not landed there yet. The
> [REST fallback](rest-fallback.html) does the same job with no extra components,
> and you can move over later — the entity names below are the same either way.
{: .note }

## Topics

```
helsa/status                        online | offline   (retained, LWT)
helsa/daily/steps                   62194
helsa/daily/active_energy           512
helsa/daily/sleep_hours             7.3
helsa/daily/resting_heart_rate      54
helsa/daily/rings_closed            3
helsa/sync/freshness_hours          0.2
```

State messages are **retained**, so Home Assistant restores the last value after a
restart instead of showing `unknown` until the next publish.

`helsa/status` is a last-will message: the broker publishes `offline` on its own if
the publisher disconnects unexpectedly. Entities referencing it as
`availability_topic` grey out rather than showing a stale number.

## Discovery

One retained message per entity, on the discovery topic. Publish these once at
start-up; Home Assistant remembers them.

`homeassistant/sensor/helsa_steps/config`:

```json
{
  "name": "Steps today",
  "unique_id": "helsa_steps",
  "object_id": "helsa_steps",
  "state_topic": "helsa/daily/steps",
  "unit_of_measurement": "steps",
  "state_class": "total_increasing",
  "icon": "mdi:walk",
  "availability_topic": "helsa/status",
  "device": {
    "identifiers": ["helsa"],
    "name": "Helsa",
    "manufacturer": "Helsa",
    "model": "Self-hosted health backend"
  }
}
```

`homeassistant/sensor/helsa_resting_heart_rate/config`:

```json
{
  "name": "Resting heart rate",
  "unique_id": "helsa_resting_heart_rate",
  "state_topic": "helsa/daily/resting_heart_rate",
  "unit_of_measurement": "bpm",
  "state_class": "measurement",
  "icon": "mdi:heart-pulse",
  "availability_topic": "helsa/status",
  "device": { "identifiers": ["helsa"], "name": "Helsa" }
}
```

`homeassistant/sensor/helsa_sleep_hours/config`:

```json
{
  "name": "Sleep last night",
  "unique_id": "helsa_sleep_hours",
  "state_topic": "helsa/daily/sleep_hours",
  "unit_of_measurement": "h",
  "device_class": "duration",
  "state_class": "measurement",
  "icon": "mdi:sleep",
  "availability_topic": "helsa/status",
  "device": { "identifiers": ["helsa"], "name": "Helsa" }
}
```

Sharing one `device` block groups every entity under a single Helsa device in the
Home Assistant UI.

> `state_class: total_increasing` suits values that count up within a day and reset
> at midnight, such as steps and active energy. Use `measurement` for values that
> simply are what they are, such as heart rate. Getting this wrong does not break
> anything, but long-term statistics will be nonsense.
{: .note }

![Home Assistant dashboard card with Helsa entities](../assets/screenshots/home-assistant-card.png)

> **Screenshot placeholder.** Not in the repository yet — see `docs/SCREENSHOTS.md`.

## The alert that matters
{: #the-alert-that-matters }

Everything above is convenience. This part is the reason the integration exists.

Helsa's characteristic failure is not a crash — it is **silence**. An expired client
certificate, a stale dynamic-DNS record, a dead worker, a full disk, and a powered-off
host all look identical from outside: no new data, no error, nothing in a log you
were watching. The app keeps buffering, so you do not even lose data. You just stop
noticing, for weeks.

### Build it as a dead man's switch

> **A system cannot announce its own death.** If Helsa were the thing that decided
> "no data has arrived, send an alert", then the case where Helsa itself is dead —
> the most important case — would produce no alert at all.
>
> So Helsa only **pushes state**, every 15 minutes. Home Assistant decides when the
> silence has lasted too long. The missing signal is the signal.
{: .warning }

The freshness value is the age, in hours, of the newest data — the later of the
newest sample timestamp and the last heartbeat from the **uploading** device.

> Filter to the uploading phone specifically. An iPad or a Mac opening the dashboard
> also checks in, and counting those would keep the alert looking healthy while the
> phone had not synced for weeks — which is exactly the failure this is here to
> catch.
{: .note }

`homeassistant/sensor/helsa_sync_freshness/config`:

```json
{
  "name": "Helsa sync freshness",
  "unique_id": "helsa_sync_freshness",
  "state_topic": "helsa/sync/freshness_hours",
  "unit_of_measurement": "h",
  "state_class": "measurement",
  "icon": "mdi:heart-pulse",
  "expire_after": 5400,
  "json_attributes_topic": "helsa/sync/attributes"
}
```

`expire_after: 5400` is what makes it a dead man's switch: if no message arrives for
90 minutes, Home Assistant marks the entity `unavailable` by itself.

Deliberately **no `availability_topic` here**: this entity must be able to expire.
If the publisher's last will marked it unavailable, the expiry would be masked.

### The automation

```yaml
automation:
  - alias: Helsa sync stalled
    trigger:
      # 1. The data itself is old.
      - platform: numeric_state
        entity_id: sensor.helsa_sync_freshness
        above: 12
        for: "00:30:00"
      # 2. Nothing is publishing at all — the host or the publisher is gone.
      - platform: state
        entity_id: sensor.helsa_sync_freshness
        to: "unavailable"
        for: "00:30:00"
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: Helsa is not syncing
          message: >-
            {% raw %}{% if is_state('sensor.helsa_sync_freshness', 'unavailable') %}
              No heartbeat from the Helsa host for over 90 minutes.
            {% else %}
              Newest health data is {{ states('sensor.helsa_sync_freshness') }} hours old.
            {% endif %}{% endraw %}
```

### Test it

An untested alert is a decoration.

1. Stop the publisher. Within 90 minutes plus 30, the notification should arrive.
2. Set the freshness value above 12 by hand (Developer Tools → States) and confirm
   the first trigger fires.
3. Start it again and check that the entity recovers.

> **If you replace your phone, `notify.mobile_app_*` changes name and the automation
> silently stops notifying.** Nothing errors. Re-point it after any phone change,
> and re-run the test above.
{: .warning }

## Watch out for

| | |
|---|---|
| **Recorder growth** | Even daily entities add up over years. Home Assistant's default purge is 10 days; if you want longer history, use long-term statistics rather than raising the purge window. |
| **A second copy of your data** | Whatever you publish now lives in Home Assistant's database too, with its own backups and possibly its own remote access. |
| **Broker credentials** | In `secrets.yaml` on the Home Assistant side, in `.env` on the Helsa side, and in neither git repository. |
| **Clock skew** | If a host's clock is wrong, freshness can compute as negative and a negative age never crosses a threshold — silently disabling the alert. Publish the raw newest-data timestamp as an attribute so you can see it, and clamp the age at zero. |
| **Timing** | Publishing more than a few times a day gains nothing. These are daily numbers. |
