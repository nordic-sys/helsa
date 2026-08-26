---
title: Disclaimer
description: "Helsa is not a medical device, comes with no warranty, and you operate it at your own risk."
layout: ../layouts/ProseLayout.astro
lede: "Read this before you rely on anything Helsa shows you."
---

## Not a medical device

Helsa is a personal hobby project for viewing and storing fitness data that your
Apple devices already collect. It is:

- **not a medical device** and has not been evaluated, certified, or registered as
  one under any regulatory framework;
- **not diagnostic** — nothing it displays is a finding, a measurement of clinical
  quality, or a statement about your health;
- **not a monitoring system** — it will not notice that something is wrong with
  you, and it is not designed or tested to raise an alarm if it did.

**Do not use Helsa to make decisions about your health.** If a number worries you,
talk to a doctor. If you feel unwell, do not wait for a dashboard to confirm it.

### The `/insights` endpoint in particular

Helsa can report simple statistical observations: "your resting heart rate has
been above its 28-day baseline for three days". These are **arithmetic, not
medicine**. They are computed with rolling averages, z-scores, and correlation
coefficients on whatever data happened to be recorded. A missed night of sleep, a
different watch, a change in how you wore it, or a gap in recording will move them.

They carry no medical meaning, and the fact that Helsa stayed silent means nothing
either — every rule has a data minimum and simply says nothing below it.

## No warranty

Helsa is distributed under the **MIT licence**. The licence text is authoritative;
in plain terms it means the software is provided *"as is"*, without warranty of any
kind, express or implied, and the authors and copyright holders are **not liable
for any claim, damages, or other liability** arising from the software or its use.

The author explicitly accepts **no responsibility** for:

- data loss, corruption, or a backup that turns out not to restore;
- a server you exposed to the internet and someone else reached;
- an integration, automation, or alert that failed to fire — or fired wrongly;
- anything you concluded, did, or did not do because of what Helsa displayed.

## You are the operator

If you run this software, **you** are running a service that holds your health
data. That is the point of the project, and it is also the cost. Nobody else can
patch your machine, rotate your certificates, or notice that your backups stopped.

The documentation tries to keep you out of trouble:

- defaults are conservative — nothing in [Getting started](getting-started/) is
  reachable from the internet;
- every genuinely risky step (opening a router port, handling private keys,
  storing tokens) carries an explicit warning that says what the risk is;
- the [hardening checklist](deployment/hardening/) lists what to verify before
  and after you expose anything.

Following the documentation is not a guarantee of security. It is one person's
best effort, written for one person's threat model: a home network, a single user,
and an internet full of automated scanners.

## Privacy, in plain terms

- The app's default is that **health data stays on the device**. Uploading is
  something you switch on, pointing at an endpoint you type in yourself.
- Neither the app nor this server sends anything to the author. There is **no
  telemetry, no analytics, no crash reporting, no update ping**.
- If you run the server, your data is on **your** machine, in **your** database,
  under **your** backup regime. Nobody else has access, and nobody else can help
  you recover it.
- Helsa stores **no health data in iCloud**. HealthKit is the store, and Apple
  already syncs and backs that up; the app keeps no second copy. Only app settings
  sync through iCloud.

## Legal status of this project

Helsa was written by one person, for their own use, and released because the
backend is more useful to others in the open than closed. There is no company, no
support contract, no service-level commitment, and no promise that development
continues.

If you need something you can depend on, fork it. That is what the MIT licence is
for.

## Third-party components

Helsa builds on PostgreSQL, TimescaleDB, Redis, RabbitMQ, Caddy, Go and React
libraries, and the Just the Docs theme for this site. Each carries its own licence
and its own warranty disclaimer. Helsa's licence does not extend to them, and
their behaviour is not something this project can vouch for.
