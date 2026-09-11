# Screenshots

**Not published** — this file sits outside the Astro `src/` tree.

## What is captured, and how

**The 32 app screenshots** (`app/{en,hu,ipad-en,ipad-hu}-0N-*.png`) are produced by
`scripts/screenshots.sh` in the **helsa-apple** repository, against a simulator:

```bash
scripts/screenshots.sh <device-udid> <out-dir> en en_US
scripts/screenshots.sh <device-udid> <out-dir> hu hu_HU
```

⚠️ **Reproducible by construction, and that is a rule rather than a nicety.** The plan has a
fixed seed, every screen is reached by a launch argument and never by a coordinate, and the
status bar is overridden — so the same set can be rebuilt months from now. A tap at (x, y)
stops being the right screen the first time a row moves.

⚠️ **`-HelsaMockData YES` must cover every source a captured screen reads from.** It used to
substitute only the raw sample reader, so the water and events screens came out EMPTY beside
screens holding five months of data — and that went onto the public site before anyone noticed.
An empty screen next to a full one does not read as "no data", it reads as a broken feature.
See `DevTools/MockPlanContextStores.swift`.

**The web images** come from a browser pointed at the development server, with a device token
injected into `localStorage`. ⛔ Never photograph a screen that displays the token, and never
photograph the live server — that one holds real measurements.

## Where the files go

```
site/src/assets/screenshots/
├── web-dashboard.png
├── ios-sync-settings.png
├── web-first-data.png
├── ios-certificate-trust.png
└── home-assistant-card.png
```

Names are referenced literally by the pages; do not rename them.

## Before you upload anything

> **These images go into a public repository.** Check every one for:
>
> - your real hostnames and domains — the ones in `deploy/.env`, in `server.cnf`,
>   and in your git remotes → set the field to `helsa.example.net` before
>   capturing, or blur it afterwards;
> - internal IP addresses;
> - device tokens, certificate passwords, anything from a password manager;
> - visible notifications, other apps, calendar entries, message previews;
> - the device name in iOS screenshots, if it contains your name.
>
> Health values themselves are your call. They are your numbers, and a real
> dashboard is far more convincing than an empty one — but a screenshot is
> permanent and public. Nothing stops you from capturing a week of ordinary,
> unremarkable data.

Enable Do Not Disturb before capturing on the phone.

---

## 1. `web-dashboard.png`

**Used on:** `site/src/pages/index.astro` was where this lived on the Jekyll site. The
rebuilt landing page uses the app screenshots instead, so this image is now
**unused** — keep the brief in case a dashboard shot is wanted again.

**Show:** the web dashboard at its default view, with real data present. The
activity rings, the daily/weekly summary cards, and at least one chart with a
recognisable trend. This is the "this is what you get" image, so it should look
populated rather than freshly installed.

**Capture:** desktop browser, light mode if you have both — a light screenshot
reads acceptably on a dark page, less so the other way round.

**Size:** 2400 × 1400 px or similar 16:9-ish landscape, downscaled to about
1600 px wide. Under 400 KB. PNG.

**Crop:** the browser chrome out. Content only, or a minimal window frame.

---

## 2. `ios-sync-settings.png`

**Used on:** `site/src/content/docs/getting-started/first-sync.md` — under "Turn on sending".

**Show:** the app's settings screen where sending to your own server is
configured: the enable toggle switched on, the endpoint field with a URL visible,
and the token field (masked). If the app has a connection-test control, show it in
a success state.

**Why it matters:** this page tells someone to type in their own endpoint. Seeing
the actual screen removes all ambiguity about *where*.

**Redact:** the endpoint must read `https://helsa.example.net/v1`. Either set it to
that value before capturing, or blur the field.

**Size:** iPhone screenshot at native resolution, downscaled to about 750 px wide
(portrait, roughly 9:19.5). Under 300 KB. PNG.

---

## 3. `web-first-data.png`

**Used on:** `site/src/content/docs/getting-started/first-sync.md` — under "Verify it landed".

**Show:** the dashboard immediately after a first sync — one or a few days of data,
sparse charts, ideally a visible "first day" state. Deliberately *not* the polished
image from #1: this one is proof that the pipeline worked end to end, and a sparse
view is what someone will actually see at that moment.

**Size:** same as #1, or a cropped section around 1200 × 700 px if a full-page shot
is mostly empty.

---

## 4. `ios-certificate-trust.png`

**Used on:** `site/src/content/docs/deployment/tls-mtls.md` — under "Installing on the phone".

**Show:** **Settings → General → About → Certificate Trust Settings**, with the
Helsa root CA listed and its toggle **enabled** (green).

**Why it matters:** this is the single most common failure in the whole setup —
the certificate installs, the trust switch is never flipped, and the app reports
what looks like a network error. A picture of the exact screen with the toggle on
is worth several paragraphs.

**Redact:** the certificate name will contain whatever CN you used. `Helsa Root CA`
is fine; anything with your name or domain in it is not.

**Size:** iPhone screenshot, downscaled to about 750 px wide. Under 300 KB. PNG.

---

## 5. `home-assistant-card.png`

**Used on:** `site/src/content/docs/integrations/home-assistant.md` — after the discovery examples.

**Show:** a Home Assistant dashboard card with the Helsa entities: steps today,
active energy, sleep last night, resting heart rate, and the sync-freshness sensor.
An entities card is fine; a small grid with the freshness sensor visible is better,
since that entity is the point of the section.

**Redact:** the Home Assistant instance URL if the address bar is in frame — crop
it out.

**Size:** about 900 × 700 px, cropped to the card rather than a full-screen
dashboard. Under 250 KB. PNG.

---

---

## Status (2026-09-11)

| File | State |
|---|---|
| `app/*` (32) | ✅ real — mock plan, both languages, iPhone + iPad |
| `web-dashboard.png` | ✅ real — the Trends page, populated |
| `web-first-data.png` | ✅ real — Today after a sync, cropped above the fold |
| `ios-sync-settings.png` | ✅ real — "Your own server", sending off by default |
| `ios-certificate-trust.png` | ⛔ **needs a person.** It is a screen of the iOS Settings app; a simulator can be given a root certificate (`simctl keychain add-root-cert`) but not a tap, so nothing can reach it unattended. |
| `home-assistant-card.png` | ⛔ **needs a Home Assistant with Helsa entities.** The development server publishes nothing to MQTT, and the live one carries real measurements — so neither is the right thing to photograph. Bringing up the `mosquitto` profile against a throwaway HA would do it. |


## Notes on format

- **PNG** for all of them. These are UI screenshots with text and flat colour; JPEG
  artefacts around text look bad.
- Keep each file under roughly 400 KB. The pages are text-heavy and should stay
  fast on a phone.
- No retina `@2x` variants and no hand-written `srcset`. Astro generates the
  responsive variants at build time from whatever you drop in.
- If you later add more images, put them in the same directory and reference them
  as `../../../assets/screenshots/<name>.png` from a page under
  `src/content/docs/<section>/`, or import them in an `.astro` page.
