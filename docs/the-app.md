---
title: The app
layout: default
nav_order: 2
description: "What Helsa looks like on iPhone and iPad, in both languages it ships in."
---

# The app
{: .no_toc }

The server in this repository is optional. This is the thing it is optional *for*.
{: .fs-5 .fw-300 }

1. TOC
{:toc}

> **The app is in closed testing.** It is not on the App Store yet, and these pages
> describe a build that is still going to TestFlight. The source of the app itself is
> not in this repository — only the backend it can optionally talk to.
{: .note }

## About these pictures

They are taken from the running app on a simulator, by
[`scripts/screenshots.sh`](https://github.com/nordic-sys/helsa) — one launch per screen, no
manual tapping, a fixed random seed. Everything above the data layer is the shipping code: the
same views, the same analysis, the same wording.

**The person in them does not exist.** A fresh simulator's Health database is empty, so the
screens are fed from a generated five-month history rather than from anyone's measurements. The
numbers are lifelike, and none of them are real.

The app ships in **English and Hungarian**, and follows the phone's own language and region —
there is no language switch inside it. Both sets are below, because a translation you cannot see
is a translation nobody checked.

## iPhone — English

| | |
|:--|:--|
| ![Today](assets/screenshots/app/en-01-today.png) | ![Trends](assets/screenshots/app/en-02-trends.png) |
| **Today** — the opening tab, four named bands of cards. Every card can be switched off and reordered. | **Trends** — 120 metrics, grouped; day, week, month and year. The dashed line is the previous period. |
| ![Workouts](assets/screenshots/app/en-03-workouts.png) | ![Sleep](assets/screenshots/app/en-04-sleep.png) |
| **Workouts** — grouped by month with a count and a total, filterable by type, place, duration, distance, energy and heart rate. | **Sleep** — the night as it was recorded, with stages, efficiency, and the pattern across the period. |
| ![Water](assets/screenshots/app/en-05-hydration.png) | ![Events](assets/screenshots/app/en-06-events.png) |
| **Water** — the daily amount, and a moss that dries out and comes back. Written to Apple Health, not kept separately. | **Events** — what the watch recorded, and what you felt at the time. The second half is the part no other app keeps. |
| ![Challenge](assets/screenshots/app/en-07-challenge.png) | ![Settings](assets/screenshots/app/en-08-settings.png) |
| **Challenge** — the monthly streak, with rest days built in rather than bolted on. | **Settings** — everything is off by default, including notifications and the calendar. |

## iPhone — Hungarian

| | |
|:--|:--|
| ![Ma](assets/screenshots/app/hu-01-today.png) | ![Trendek](assets/screenshots/app/hu-02-trends.png) |
| ![Edzések](assets/screenshots/app/hu-03-workouts.png) | ![Alvás](assets/screenshots/app/hu-04-sleep.png) |
| ![Folyadék](assets/screenshots/app/hu-05-hydration.png) | ![Események](assets/screenshots/app/hu-06-events.png) |
| ![Kihívás](assets/screenshots/app/hu-07-challenge.png) | ![Beállítások](assets/screenshots/app/hu-08-settings.png) |

## iPad

The iPad shows the same screens with the room to lay them out differently — the tabs move to the
top, and a section that scrolls on the phone fits on one page here.

### English

| | |
|:--|:--|
| ![Today](assets/screenshots/app/ipad-en-01-today.png) | ![Trends](assets/screenshots/app/ipad-en-02-trends.png) |
| ![Workouts](assets/screenshots/app/ipad-en-03-workouts.png) | ![Sleep](assets/screenshots/app/ipad-en-04-sleep.png) |
| ![Water](assets/screenshots/app/ipad-en-05-hydration.png) | ![Events](assets/screenshots/app/ipad-en-06-events.png) |
| ![Challenge](assets/screenshots/app/ipad-en-07-challenge.png) | ![Settings](assets/screenshots/app/ipad-en-08-settings.png) |

### Hungarian

| | |
|:--|:--|
| ![Ma](assets/screenshots/app/ipad-hu-01-today.png) | ![Trendek](assets/screenshots/app/ipad-hu-02-trends.png) |
| ![Edzések](assets/screenshots/app/ipad-hu-03-workouts.png) | ![Alvás](assets/screenshots/app/ipad-hu-04-sleep.png) |
| ![Folyadék](assets/screenshots/app/ipad-hu-05-hydration.png) | ![Események](assets/screenshots/app/ipad-hu-06-events.png) |
| ![Kihívás](assets/screenshots/app/ipad-hu-07-challenge.png) | ![Beállítások](assets/screenshots/app/ipad-hu-08-settings.png) |

## Apple Health is the only store

Everything the app records goes into Apple Health: the daily journal, the symptoms
written on events, the water. There is no separate Helsa store for measurements — not on
the phone, and not on the server this repository builds. What a server holds is a copy for
reading on other screens, never the original.

It is what lets the app be removed without taking anything with it. The price is worth
saying out loud rather than leaving to be discovered:

> **Apple Health's list of measurement types is fixed, and an app cannot add to it.**
> So what is missing there is missing from Helsa.
{: .warning }

| Not recordable | Why |
|---|---|
| Body water percentage | No type exists |
| Skeletal muscle mass | No type exists. Health has *lean body mass*, which measures something else — bone, water and organs are counted in it |
| Lab results | Health displays them, but only when sent by a healthcare institution. No app may write them |
| Circumferences other than the waist | Only the waist has a type |

A scale is not useless because of this: body mass and body fat percentage do have types
and arrive normally. It is these extra numbers that stop at the door.

If Apple adds a type, it appears in the app on its own — it works from the list of types
rather than from a list of its own. The reverse would create data that exists nowhere
else, which is the one thing the design is built to avoid.

## What is not shown here

The Apple Watch app and the complications, because the app has not yet run on a watch — the
minimum is watchOS 26, which needs a Series 6 or newer. The widgets, for the same reason a
widget is hard to photograph honestly: what they show depends on the hour you look.
