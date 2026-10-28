---
title: Device token
description: "Issue the long-lived bearer token that the app and the dashboard use, and understand exactly what it grants."
sidebar:
  order: 2
---
## Why there is no password

Helsa has no passwords. What it needs is **device authentication**: is this connection one
of the devices of a person on this server? That is answered in two independent layers.

| Layer | Mechanism | Checked by |
|---|---|---|
| **Transport** | Mutual TLS. The client presents a certificate signed by *your* private CA. | The reverse proxy, before any HTTP is parsed. See [TLS and mutual TLS](/getting-started/certificates/). |
| **Application** | A long-lived token: a bearer header from the phone, a session cookie in the browser. | The API — on every request, against the token register and the person's account. |

A server can hold several people ([a household](/getting-started/household/)); every token
belongs to exactly one of them and opens only their data.

Tokens come from two places: this command, run by you on the server, and a **one-time code** —
an admin gives one to a new member, a member asks for one for their next phone or their browser.
The one endpoint that turns a code into a token (`POST /v1/enroll`) answers only on the
mutual-TLS port, only for a live, unused code, and only for the person the code was made for.

## Issuing a token

```bash title="On the server"
cd helsa/deploy
make prod-token SUBJECT=iphone
```

Output:

```
device:        iphone
user:          6d08a14d-… (handle owner)
token id:      3f2b9c1e-…
access_token:  eyJhbGciOiJIUzI1NiIs...
expires:       2027-10-27T12:17:18Z (8760h0m0s from now)
```

The `access_token` is what you paste into the app or the dashboard.

Issue **one token per device**, with a name you will recognise later. `SUBJECT` is required and
names the **device**, not a person: every token opens the same — the only — user's data, so the
dashboard's own token shows exactly what the phone uploaded.

```bash title="On the server"
make prod-token SUBJECT=iphone
make prod-token SUBJECT=browser
```

On an empty database the first token creates the user. ⚠️ If the database holds **more than one**
user — an install that issued tokens with the tool before 2026-10-27 made one per subject — the
tool refuses and lists them; pick one with `TOKEN_USER=<id or handle>`. The old per-subject
users are not merged: revoke their tokens and issue new ones for the user that holds your data.

## Lifetime

The lifetime of a device token comes from `HELSA_DEVICE_TOKEN_TTL` in `deploy/.env`, default
`8760h` — a year, rather than the API's normal 15 minutes. The tool prints the exact expiry.

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

```bash title="On the server"
HELSA_DEVICE_TOKEN_TTL=17520h make prod-token SUBJECT=iphone
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

## Revoking

A device token can be taken back on its own, from the server:

```bash title="On the server"
make prod-token-revoke TOKEN="<the access token>"
# revoked the token of device "browser". ...
```

The device using it is refused from its next request onwards; every other device
carries on. (Put a space before the command, or clear it from your shell history afterwards — the
token is on the command line.) The deny-list entry is kept only until the token would have expired
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
| Phone lost | Revoke that phone's token, and rotate the CA — the client certificate went with the phone. See [certificate rotation](/getting-started/certificates/#rotating). |

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

:::tip[Next: step 3]
**→ [Step 3: Certificates](/getting-started/certificates/)**

⛔ **On your own computer, not on this server** — clone the repository there a second time. The phone cannot connect before this step.
:::
