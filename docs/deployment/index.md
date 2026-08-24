---
title: Deployment
layout: default
nav_order: 5
has_children: true
description: "Running Helsa for real: what you are actually defending against, the topology, and the order in which to do things."
---

# Deployment

Everything that changes when the phone has to reach the server from outside your network.
{: .fs-5 .fw-300 }

## What you are actually defending against

Be specific about the threat model, because it determines which precautions are
worth the effort and which are theatre. For a single-user system on a home
network, the realistic list is short — and note that the top three are not all
attacks:

| # | Risk | How real | What handles it |
|---|---|---|---|
| 1 | **Automated internet scanning** for known vulnerabilities on your open port | Happens continuously, to every public address, within minutes of it being reachable | **Mutual TLS.** A scanner fails the handshake and never reaches HTTP. |
| 2 | **Data loss** — disk failure, a bad migration, a deleted VM | The most likely thing that will actually cost you something | Snapshots *plus* logical dumps, and a **restore you have tested**. |
| 3 | **Silent sync failure** — expired certificate, stale dynamic DNS, dead worker, full disk | Common, and invisible for weeks because the app buffers locally | A freshness alert built as a **dead man's switch**. |
| 4 | Lost or stolen phone | Possible | Device passcode; if it is really gone, rotate the CA. |
| 5 | Losing your CA private key | An operational mistake, not an attack | Keep it in a password manager, never on the server. |
| 6 | Supply chain — a bad Go or npm dependency | Real but low exposure here | `govulncheck` / `npm audit` occasionally. |

Two of the top three are operational failures rather than intrusions. Budget your
attention accordingly: the elaborate WAF you did not install would have prevented
none of them.

## Topology

```
    Internet
        │
        │  TCP 443 only — one forwarded port, nothing else
        ▼
  ┌───────────┐
  │  Router   │  dynamic DNS ─────────────────┐
  └─────┬─────┘                               │  the phone resolves this name
        │                                     │  and pins your CA
        ▼
  ┌──────────────────────────────────────────────────────────┐
  │ Host / VM (Docker)                                       │
  │                                                          │
  │  Caddy :443   mutual TLS required  ──▶ api ──▶ rabbitmq  │
  │        :8443  LAN/VPN only, no client cert    │      │    │
  │                                               │      ▼    │
  │                                               │   worker  │
  │                                               ▼      │    │
  │                                          timescaledb ◀┘   │
  │                                          redis            │
  └──────────────────────────────────────────────────────────┘
        ▲
        │  WireGuard or LAN
   Browser / iPad / Mac  →  dashboard on :8443
```

Two interfaces, two different gates:

| Port | Serves | Gate | Forwarded on the router |
|---|---|---|---|
| `443` | `/v1/*`, `/healthz`, `/readyz` | **Mutual TLS is mandatory** — a client certificate signed by your CA. Plus the device token. | Yes. The only one. |
| `8443` | The web dashboard, and `/v1/*` for it | Network only: source-IP restricted to LAN and VPN ranges. | **No. Never.** |

The dashboard has no client-certificate requirement because certificates in a
browser are miserable to live with. Its protection is that the port is not
reachable from the internet — enforced twice, by the router and by a source-IP
rule, so that neither alone is a single point of failure.

## Recommended shape

- **A dedicated VM or host.** Not the machine that also runs everything else. If
  something goes wrong, the blast radius should be one thing you can restore.
- **A separate development instance** if you intend to develop against it. Sharing
  one broker or one database between "real health history" and "test data that
  gets generated and wiped" ends badly — and it ends badly *quietly*, which is
  worse. The development instance should have **no mutual TLS at all**, so that a
  mistyped hostname cannot send real data into it: without a client certificate
  the connection structurally cannot succeed.
- **No public port other than 443.** Not the database. Not the RabbitMQ console.
  Not SSH, if you can avoid it.

## The order to do things in

1. **[TLS and mutual TLS](tls-mtls.html)** — create the private CA, issue server
   and client certificates, install them. Slowest step; do it first.
2. **[Reverse proxy](reverse-proxy.html)** — Caddy configuration for the two
   interfaces, and how to validate it before it goes live.
3. **[Backups and restore](backups.html)** — set up dumps and **perform one
   restore** before you consider the deployment finished.
4. **[Hardening](hardening.html)** — the checklist to walk before and after you
   open the port.

Only after step 4 should the router forward anything.

> **The step you will be tempted to skip is the restore test.** It is the only one
> that verifies a thing you cannot verify any other way. A dump file that exists is
> not a backup; a dump file you have restored into an empty database and looked at
> is.
{: .warning }
