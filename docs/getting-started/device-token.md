---
title: Device token
layout: default
parent: Getting started
nav_order: 2
description: "Issue the long-lived bearer token that the app and the dashboard use, and understand exactly what it grants."
---

# Device token
{: .no_toc }

1. TOC
{:toc}

---

## Why there is no login screen

Helsa is a single-user system. There is nobody to distinguish from anybody else,
so a username-and-password flow would add a login form, a password reset path, and
a session store without answering any question the system actually has.

What it needs instead is **device authentication**: is this connection one of my
devices? That is answered in two independent layers.

| Layer | Mechanism | Checked by |
|---|---|---|
| **Transport** | Mutual TLS. The client presents a certificate signed by *your* private CA. | The reverse proxy, before any HTTP is parsed. See [TLS and mutual TLS](../deployment/tls-mtls.html). |
| **Application** | A long-lived bearer token in the `Authorization` header. | The API. |

Both are required on the public interface. The browser dashboard uses only the
token, because it is reachable only over your LAN or VPN, where the network itself
is the gate.

There is deliberately **no HTTP endpoint that issues tokens** — an endpoint that
mints credentials is an endpoint anyone can call. Tokens are issued on the server,
by you, with a command.

## Issuing a token

```bash
cd helsa/deploy
docker compose --profile tools run --rm token -subject iphone
```

Output:

```
subject:       iphone
access_token:  eyJhbGciOiJIUzI1NiIs...
refresh_token: ...
```

The `access_token` is what you paste into the app or the dashboard.

Issue **one token per device**, with a name you will recognise later:

```bash
docker compose --profile tools run --rm token -subject iphone
docker compose --profile tools run --rm token -subject browser
```

## Lifetime

The token TTL comes from `HELSA_ACCESS_TTL`. The `token` tool is configured with a
long default (a year) rather than the API's normal 15 minutes.

That is a considered trade-off, not laziness:

> A short-lived credential protects you when it can be renewed automatically. Here
> it cannot — renewal would be a manual step on a phone. An expired token does not
> fail loudly; the phone simply stops uploading, and because the app buffers
> locally you may not notice for weeks. **The expiry is more likely to cost you
> data than to save you from an attacker** who would need your client certificate
> as well.
{: .note }

Set your own value when issuing:

```bash
HELSA_DEVICE_TOKEN_TTL=8760h docker compose --profile tools run --rm token -subject iphone
```

## Treat it as a credential

A device token is a bearer credential. Whoever holds it can read your entire
health history through the API — subject to also getting past the mutual-TLS gate
on the public interface, or being on your LAN or VPN for the dashboard.

- Store it in a password manager. The app keeps it in the iOS Keychain; the
  dashboard keeps it in an `httpOnly` cookie.
- Do not paste it into a shell history, a chat, a screenshot, or an issue report.
- Do not commit it. Not to a private repository either — git history is forever.

## Revoking

Tokens can be revoked through the Redis deny-list, which is what `POST
/v1/auth/logout` writes to. With one or two devices, the blunter instruments are
usually right:

| Situation | Do this |
|---|---|
| One device compromised or retired | Log it out, then issue a fresh token for the replacement. |
| `HELSA_JWT_SECRET` leaked | Change the secret and restart the API. **Every existing token stops working**; reissue for each device. |
| Phone lost | Rotate the secret *and* rotate the CA — the client certificate went with the phone. See [certificate rotation](../deployment/tls-mtls.html#rotating). |

> **Redis holds the deny-list.** If you wipe the Redis volume, revocations
> disappear with it and previously revoked tokens work again until they expire.
> Rotating the JWT secret is the reliable way to invalidate everything.
{: .warning }

## Next

[Point the app at the server and run a first sync](first-sync.html).
