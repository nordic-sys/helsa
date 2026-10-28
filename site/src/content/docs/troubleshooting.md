---
title: When it does not work
description: "A symptom index: what you are seeing, and the page that explains it."
sidebar:
  order: 90
---
This page holds no explanations of its own. It exists because the explanations are
spread across six pages under six different headings, and a reader at midnight does not
know which one owns their symptom.

## The mistakes people actually make

Collected from a first install by somebody following these pages on a fresh VM and a real iPhone.
Every one of them happened; most cost more time than the step they belong to. In the order you
meet them.

| Step | The mistake | What you see | The fix |
|---|---|---|---|
| Before you start | `make`, `jq` or `git` missing on a fresh cloud image | `make: command not found` | `sudo apt install git make jq openssl` — [What you need](/getting-started/#what-you-need) |
| 1 · Quick start | Looking for `HELSA_JWT_SECRET` in `.env` | It is not there | It is meant to be appended, with `LAN_SUBNET` and `WG_SUBNET` — [Configure secrets](/getting-started/quick-start/#2-configure-secrets) |
| 1 · Quick start | Leaving `LAN_SUBNET` / `WG_SUBNET` out | Nothing — they fall back to example ranges, and the dashboard later answers `403` from your own sofa | Set both to your own ranges |
| 1 · Quick start | Changing a password after the first `docker compose up` | api or worker cannot log in | PostgreSQL and RabbitMQ keep the first one: on an empty install `docker compose down -v` and start again |
| Upgrading | `git pull` and `make prod-up` on an install from before `helsa_app` (2026-10-28) | `required variable HELSA_APP_DB_PASSWORD is missing a value`, or — key added but the role never created — the api logs `password authentication failed for user "helsa_app"` | Add the key, then `make prod-app-role` **before** `make prod-up` — [Upgrading](/getting-started/quick-start/#upgrading-an-install-from-before-helsa_app) |
| Upgrading | Changing `HELSA_APP_DB_PASSWORD` in `.env` only | `password authentication failed for user "helsa_app"` after the next restart | `make prod-app-role` sets the new value in the database |
| 3 · Certificates | Running `make ca` on the server | (`make ca` now refuses) | Clone the repository on your own computer and make the CA there — [Certificates](/getting-started/certificates/) |
| 3 · Certificates | `make server` with the example names still in `server.cnf` | (`make server` now refuses) — before, a certificate for `helsa.example.com`, and the phone's TLS fails | Edit `CN`, `DNS.n`, `IP.n` first — [Issuing](/getting-started/certificates/#issuing--on-your-own-computer) |
| 3 · Certificates | `docker compose restart proxy` | `no such service: proxy` | Both Compose files: `docker compose -f docker-compose.yml -f docker-compose.prod.yml restart proxy` |
| 3 · Certificates | Trusting the CA profile because it looks fine | The app: *"the TLS connection could not be made"* | **General → About → bottom → Certificate Trust Settings → Helsa Root CA on.** The profile looks complete without it. |
| 3 · Certificates | Installing the `.p12` as a profile, like the CA | The app behaves as if there were no client certificate | Import it **in the app**: Settings → Export → Your own server → Client certificate |
| 3 · Certificates | A CA from an earlier attempt still on the phone | TLS fails although trust is on — every attempt is called "Helsa Root CA" | Compare the SHA-256 fingerprints; remove the stale profile |
| 4 · First sync | Looking for "Your own server" in Settings | No such row | It is under **Settings → Export**, at the bottom |
| 4 · First sync | Saving and expecting it to work at once | No device ever registers | Restart the app — the connection is built at launch |
| 4 · First sync | Expecting background sync on iOS 27 | Data goes up only while the app is open | iPhone Settings → General → Background App Refresh → Helsa on |
| Deployment | Adding Helsa to the reverse proxy that already runs the home network (Nginx Proxy Manager, Traefik) as an ordinary proxy host | TLS fails on the phone, or the server presents the wildcard certificate instead of yours | The phone must reach Helsa's Caddy without anything decrypting in between: a dedicated port straight to the Helsa host, or TCP passthrough — [A reverse proxy already runs on your network](/deployment/reverse-proxy/#a-reverse-proxy-already-runs-on-your-network) |
| Deployment | Cloudflare record left on the orange cloud (proxied) | The phone cannot connect from outside; from inside it works | *DNS only* (grey cloud) — Cloudflare would terminate TLS — [Reverse proxy](/deployment/reverse-proxy/#a-reverse-proxy-already-runs-on-your-network) |
| Deployment | An NPM stream on a new port that nobody published | The port is closed although the stream exists | Add the port to NPM's Compose file and recreate the container — [Worked example](/deployment/example-homelab/#4-nginx-proxy-manager-the-dashboard-as-a-proxy-host-the-api-as-a-stream) |
| Deployment | A high external port, but only on the router | Works on mobile data, fails on home Wi-Fi | The same port must answer inside too — [Same address at home and away](/deployment/reverse-proxy/#a-reverse-proxy-already-runs-on-your-network) |
| Deployment | A new certificate without the name the phone still uses | The phone drops off right after the install | Keep the old name in `server.cnf` until the phone is switched — [Issuing](/getting-started/certificates/#issuing--on-your-own-computer) |
| Deployment | The dashboard moved to a new address | "No valid device token" although it worked yesterday | The token is stored per address: paste it again — [The web dashboard](/dashboard/#how-to-reach-it) |
| Deployment | A Proxmox VM without *Start at boot* | After a power cut everything is down until you start the VM | VM → Options → Start at boot |
| Backups | Restoring the VM backup to a new VM (new MAC) | The restored VM boots with no network | cloud-init matched the network to the old MAC: match by driver — [The restore test](/deployment/backups/#the-restore-test) |
| Backups | A dump timer without a time zone, on a UTC VM | In summer the dump runs after the VM backup that should carry it | `OnCalendar=… Europe/Budapest` (your zone) — [Logical dumps](/deployment/backups/#logical-dumps) |
| Backups | Following the cron example on a cloud image | `crontab: command not found` | Use the systemd timer — [Logical dumps](/deployment/backups/#logical-dumps) |
| Tokens | One `SUBJECT` per person instead of per device (tool before 2026-10-27) | The dashboard is empty while the phone uploads | Since then every token binds to the one user; on an old install use `TOKEN_USER` — [Device token](/getting-started/device-token/) |
| Joining a phone | Typing an old or used code | "Code not accepted" | The code lives 15 minutes and works once; the server deliberately does not say which went wrong. Ask for a new one. |
| Joining a phone | Retrying a wrong code again and again | "Too many attempts" (429) | Five failures from one address, or 30 on the whole server, in a quarter of an hour. Wait 15 minutes, then use a new code. |
| Joining a phone | Scanning the QR before importing the certificate | The scan works, then a TLS error | Import the `.p12` first (*Your own server ▸ Client certificate*). The app asks for it when it is missing. |
| Signing in a browser | Opening the dashboard under another address than it is served from | "This request's origin is not this server's" | Open it under its own address, or list the other in `HELSA_WEB_ORIGINS`. |
| A member's phone stops | The account was disabled | "this account has been disabled" | Re-enable it under *Household*; the same phone carries on, nothing has to be re-joined. |

## Nothing arrives from the phone

| What you see | Where the answer is |
|---|---|
| There is no "Your own server" in the app's Settings | It is under **Settings ▸ Export**, at the bottom. [First sync](/getting-started/first-sync/#turn-on-sending) |
| The app acts as if there were no client certificate, though the `.p12` is installed | It went in as a profile — the app cannot see that. Import it in the app. [Installing on the phone](/getting-started/certificates/#installing-on-the-phone) |
| Syncing only happens while the app is open (iOS 27) | Background App Refresh is off for Helsa. [First sync](/getting-started/first-sync/#then-what) |
| Saved the server settings, and no device ever registers | ⚠️ **The app has to be restarted** — the connection is built at launch. [First sync](/getting-started/first-sync/#turn-on-sending) |
| The app reports a network error that is not a network error | The certificate installed but was never **trusted**. [TLS and mutual TLS](/getting-started/certificates/#installing-on-the-phone) |
| It worked, and one day quietly stopped | A certificate expired. [Expiry is a silent failure](/getting-started/certificates/#expiry-is-a-silent-failure) |
| The token is refused, and the body says it was revoked | It was. [Revoking](/getting-started/device-token/#revoking) |
| `503` on every call, with a healthy-looking server | The revocation deny-list is unreachable. [Authentication](/api/authentication/) |
| Uploads are rejected as too large | Chunking. [Ingest failure modes](/api/ingest/#failure-modes) |
| The phone says it is done, and the dashboard is still missing days | The worker is still writing the backlog. The [Ingest queue](/dashboard/screens/#ingest-queue) page shows how much is left — and whether anything went to the dead-letter queue. |

## The numbers look wrong

| What you see | Where the answer is |
|---|---|
| Steps a little higher than the Health app | Several sources recorded the same steps. The server keeps the largest source per hour — an approximation of HealthKit's merge, a few percent high at most, never doubled. [First sync](/getting-started/first-sync/#when-it-does-not-work) |
| A figure that will not update | It is cached for 60 seconds and dropped when a batch lands. [Reading data](/api/reading-data/#summary) |
| An observation resting on very little | Every rule states what it needs first. [Reading data](/api/reading-data/#insights) |
| A Home Assistant sensor showing `unknown` | That is the design — a missing measurement is never a zero. [Home Assistant](/integrations/home-assistant/) |
| Sensors that went stale without anything saying so | The freshness sensor is the alarm. [The alert that matters](/integrations/home-assistant/#the-alert-that-matters) |

## The server itself

| What you see | Where the answer is |
|---|---|
| It answers on the LAN but not through the proxy | [The gotcha that will get you](/deployment/reverse-proxy/#the-gotcha-that-will-get-you) |
| You want to know whether it is really up | `/readyz`, not `/healthz`. [Quick start](/getting-started/quick-start/#confirm-it-answers) |
| Something went wrong and you are deciding what to do first | [If something does go wrong](/deployment/hardening/#if-something-does-go-wrong) |
| You need to get the data back | [Backups and restore](/deployment/backups/) |

## Still stuck

[Support](/support/) — and for the server, an issue in the repository is usually
faster, because the logs can be pasted in.
