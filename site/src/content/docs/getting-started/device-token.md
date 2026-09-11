---
title: Device token
description: "Issue the long-lived bearer token that the app and the dashboard use, and understand exactly what it grants."
sidebar:
  order: 2
---
## Why there is no login screen

Helsa is a single-user system. There is nobody to distinguish from anybody else,
so a username-and-password flow would add a login form, a password reset path, and
a session store without answering any question the system actually has.

What it needs instead is **device authentication**: is this connection one of my
devices? That is answered in two independent layers.

| Layer | Mechanism | Checked by |
|---|---|---|
| **Transport** | Mutual TLS. The client presents a certificate signed by *your* private CA. | The reverse proxy, before any HTTP is parsed. See [TLS and mutual TLS](/deployment/tls-mtls/). |
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
make prod-token SUBJECT=iphone
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
make prod-token SUBJECT=iphone
make prod-token SUBJECT=browser
```

## Lifetime

The token TTL comes from `HELSA_ACCESS_TTL`. The `token` tool is configured with a
long default (a year) rather than the API's normal 15 minutes.

That is a considered trade-off, not laziness:

:::note
A short-lived credential protects you when it can be renewed automatically. Here
it cannot — renewal would be a manual step on a phone. An expired token does not
fail loudly; the phone simply stops uploading, and because the app buffers
locally you may not notice for weeks. **The expiry is more likely to cost you
data than to save you from an attacker** who would need your client certificate
as well.
:::

Set your own value when issuing:

```bash
HELSA_DEVICE_TOKEN_TTL=8760h make prod-token SUBJECT=iphone
```

## Treat it as a credential

A device token is a bearer credential. Whoever holds it can read your entire
health history through the API — subject to also getting past the mutual-TLS gate
on the public interface, or being on your LAN or VPN for the dashboard.

- Store it in a password manager. The app keeps it in the iOS **Keychain**; the
  dashboard keeps it in that browser's **`localStorage`** — ⚠️ not a cookie, and not
  `httpOnly`. Any script running on that origin could read it, which is one more
  reason `8443` never faces the internet.
- Do not paste it into a shell history, a chat, a screenshot, or an issue report.
- Do not commit it. Not to a private repository either — git history is forever.

## `HELSA_AUTH_DEV_MODE=true` in production is not a mistake

`docker-compose.prod.yml` sets it, and a hardening reader grepping their own compose
file will find "DEV_MODE true" and worry. It is what lets the `token` CLI mint a
session for a named subject instead of going through Apple's identity flow — which is
the only way tokens are issued here, because there is no sign-in
([ADR-0003](https://github.com/nordic-sys/helsa)). It opens **no HTTP route**: there is
no endpoint that issues tokens, in any mode.

## Revoking

A device token can be taken back on its own, from the server:

```bash
make prod-token-revoke TOKEN="<the access token>"
```

The device using it is refused from its next request onwards; every other device
carries on. The deny-list entry is kept only until the token would have expired
anyway — after that the token is refused on expiry, and a list that only grows is
its own kind of problem.

`POST /v1/auth/logout` does the same thing for the device making the call: it
revokes **the token on that request**, never one named in the body. That way the
route can only ever end the caller's own session.

| Situation | Do this |
|---|---|
| One device compromised or retired | Revoke its token, then issue a fresh one for the replacement. The other devices are untouched. |
| You no longer have the token string | You cannot revoke it individually — rotate `HELSA_JWT_SECRET` and reissue for every device. Keep the tokens you issue somewhere you can find them. |
| `HELSA_JWT_SECRET` leaked | Change the secret and restart the API. **Every existing token stops working**; reissue for each device. |
| Phone lost | Revoke that phone's token, and rotate the CA — the client certificate went with the phone. See [certificate rotation](/deployment/tls-mtls/#rotating). |

:::caution
**Revocation lives in Redis, and the check fails closed.** If the API cannot reach
Redis it answers `503` rather than letting requests through — a deny-list that can
be bypassed by stopping Redis is not one. Redis is already part of `/readyz`, so an
instance in that state is reporting itself unready anyway.

⚠️ If you **wipe** the Redis volume, the deny-list goes with it and a revoked token
works again until it expires. Rotating the secret remains the only thing that
invalidates everything at once.
:::

## Next

[Point the app at the server and run a first sync](first-sync/).
