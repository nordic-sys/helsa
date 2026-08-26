---
title: Support
description: "How to reach the person who makes Helsa, and what to expect when you do."
layout: ../layouts/ProseLayout.astro
current: support
lede: "One person makes Helsa. That is the whole support department, and it is worth knowing before you write."
---

## Write to

**[helsa@nordic-sys.com](mailto:helsa@nordic-sys.com)**

In English or in Hungarian — the app speaks both and so does the person reading.

## What to expect

**A reply, usually within a few days.** Not an hour, and not a ticket number. This is a
single-maintainer project built in evenings, and pretending otherwise would only make the
first slow reply feel like being ignored.

**No promise that a bug is fixed by a date.** What you will get is an honest answer about
whether it is understood, whether it is reproducible, and whether it is going to be worked on.
"I do not know why that happens" is an answer this project is willing to give.

## What helps

A bug in a health app is usually about *your* data, which nobody else has. That makes the
details unusually load-bearing:

| | |
|---|---|
| **What you did** | the screen, and what you tapped |
| **What happened, and what you expected** | the second half is the one most reports leave out |
| **Device and iOS version** | Settings ▸ General ▸ About |
| **Language and region** | these are two separate settings, and Helsa has had bugs where only one of them was wrong |
| **App version** | Settings ▸ About, at the bottom |

<aside class="callout callout--warning">
  <p><strong>A screenshot is worth more than a description — and it may contain your
  health data.</strong> That is your call, not mine. Crop it, blur it, or describe it in
  words instead; a report without numbers is still useful. Nothing you send is stored
  anywhere beyond the mailbox, and nothing is ever added to the app.</p>
</aside>

## Things that are not bugs

Some of what looks broken is the app being careful. These come up often enough to be worth
listing:

**Dashes instead of numbers.** Helsa shows a dash where nothing was measured. It never draws a
zero for missing data, because a day you did not wear the watch and a day you did not move look
identical once you do that.

**A screen that stays empty after you granted access.** Apple Health reports a refused read as
"no data" rather than as an error, so the app cannot always tell the two apart. Settings ▸
Health access shows what it can and cannot see.

**A rule that says nothing.** Several of Helsa's observations stay quiet below a minimum number
of measured days. A conclusion drawn from four days would be worse than no conclusion.

**Nothing arriving on the watch.** The watch reads its own Health store, which is not the
phone's. If you never granted access on the watch, it stays empty there.

## The server

The optional self-hosted backend is a different thing from the app, it is open source, and it
has its own place for problems: **[GitHub Issues](https://github.com/nordic-sys/helsa/issues)**.

If it is a security problem, please read [SECURITY.md](https://github.com/nordic-sys/helsa/blob/main/SECURITY.md)
first — some things should not be filed in public.

## Before you write

Two pages answer most of what arrives:

- [**Privacy**](privacy/) — what leaves your device, which by default is nothing.
- [**Disclaimer**](disclaimer/) — what Helsa is not, and what it must not be used for.

And one thing worth repeating here, because it is the most important sentence on this site:
**Helsa is not a medical device.** If a number worries you, the person to ask is a doctor, not
this mailbox.
