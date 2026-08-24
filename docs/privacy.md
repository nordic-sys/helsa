---
title: Privacy
layout: default
nav_order: 3
description: "What the Helsa app reads, what it writes, and what leaves your device — which by default is nothing."
---

# Privacy policy
{: .no_toc }

Last updated: 25 August 2026
{: .fs-5 .fw-300 }

This page covers the **Helsa iOS app**. The server in this repository is
software you run yourself; when you run it, the data on it is yours and the
policy that governs it is your own.

1. TOC
{:toc}

---

## The short version

**Nothing is collected.** There is no account, no analytics, no crash reporting,
no advertising, and no server operated by the developer — so there is no place
for your data to be sent to, even by mistake. Your health data is read from
Apple Health on your device, analysed on your device, and stays there.

The one way data leaves your phone is a server **you** set up and whose address
**you** type in. That is off by default.

---

## What the app reads

With your permission, from Apple Health: steps and distances, heart rate and its
variability, sleep, workouts and their routes, body measurements, nutrition,
gait measurements, environmental audio exposure, and the events your watch
records (a fall, a high or low heart rate, an irregular rhythm, a loud
environment).

Permission is requested **group by group**, and refusing a group is a normal
outcome the app is built to handle. It reads nothing you have not allowed.

## What the app writes

Three things, all into Apple Health, all entered by you:

- your daily journal — mood, symptoms, tags;
- the symptoms you write on an event;
- the water you log.

Everything else it only reads. It keeps no database of its own: what you write
goes into Apple Health, where other apps can reach it and where you can delete
it.

## What leaves your device

By default, **nothing**.

| | When | Where to |
|---|---|---|
| Health data | Only if you turn on uploading and enter an address | The server you named, over mutual TLS with a device certificate |
| Map tiles | When you look at a map or share a route on one | Apple, through MapKit — Apple's own privacy policy applies |
| Settings | If you have iCloud on | Your own iCloud account (preferences only — never health data) |

There is no fourth row. In particular there is no telemetry, no "anonymous
usage statistics", and no error reporting: the app contains no third-party
software development kit of any kind, and its package manifest has an empty
dependency list.

### Your calendar

If — and only if — you turn on the appointment feature, the app reads the
**titles** of your calendar entries for the next 14 days, to offer a summary
sheet before a medical appointment. It stores nothing from your calendar, logs
nothing, and sends nothing anywhere. Notes, locations and attendees are never
read. It is off by default, and until you turn it on the app does not ask for
calendar access at all.

⚠️ iOS offers only "write only" and "full access" for calendars — there is no
read-limited level — so the narrowing above is done by the app itself rather
than enforced by the system.

### System search

If you turn on search indexing, what **you wrote** — your notes and the days
they belong to — becomes findable in the system's own search. Measured data is
never indexed. The index lives on your device, and turning the switch off
deletes what was already indexed rather than merely stopping new entries.

### Notifications

Reminders and follow-up questions are **local notifications**, scheduled on the
device. Nothing is sent through a push server. They are off by default.

---

## Children

The app is not directed at children and collects nothing from anyone.

## Changes

If this policy changes, the date at the top changes with it, and the history is
in this repository's commit log.

## Contact

Questions about privacy, or about this page: open an issue in
[the repository](https://github.com/nordic-sys/helsa), or see
[SECURITY.md](https://github.com/nordic-sys/helsa/blob/main/SECURITY.md) for
anything that should not be public.
