---
title: Hardening
description: "A checklist to walk before and after exposing the server, plus the things that are deliberately absent."
sidebar:
  order: 4
---
A checklist, not a philosophy. Walk it before you forward a port, and again after
any change to the proxy or the network.

## Network

- [ ] **Exactly one forwarded port: TCP 443.** Not the database, not the RabbitMQ
      console, not the dashboard on 8443, and ideally not SSH.
- [ ] The dashboard port `8443` is reachable **only** over LAN or VPN, enforced
      both by the router and by the `remote_ip` rule in the proxy.
- [ ] Administrative interfaces — RabbitMQ management, pgAdmin, any metrics UI —
      are on the VPN only. If you cannot reach them without the VPN, that is
      correct.
- [ ] Router firewall input rules are scoped to the LAN interface, not to "any".
      An open DNS resolver or management port on a WAN interface is the classic
      home-network mistake and gets abused within days.
- [ ] The host running Helsa cannot reach the rest of your LAN, or is on its own
      segment, if that is easy for you to arrange.

## Containers

- [ ] `docker compose ps` shows a published port for **the proxy only**.
      Everything else must be empty.
- [ ] The production Compose profile is what is running — not the local
      development overlay, which publishes database ports to the host.
- [ ] Containers use `restart: unless-stopped`, so the stack returns after a
      reboot or a power cut.
- [ ] The host starts the stack on boot.
- [ ] Images are rebuilt and pulled occasionally. A container that has been up for
      a year is running a year-old TLS stack.

## Secrets

- [ ] `HELSA_JWT_SECRET` is a generated random value, not the example string. The
      API refuses to start without it being set, but it cannot tell that you set it
      to something silly.
- [ ] Database, Redis, and RabbitMQ passwords are generated, not defaults.
- [ ] `.env` is git-ignored, mode `0600`, and copied into a password manager.
- [ ] **The CA private key is not on the server.** Password manager only.
- [ ] `.p12` passwords are in the password manager and the plaintext files are
      deleted.
- [ ] Nothing secret has ever been committed. If it has, rotate it — deleting the
      file does not remove it from history.

## Database

- [ ] The application connects as a **non-superuser** role with rights only on its
      own schema. Cheap to do, and it turns a catastrophic mistake into a failed
      query.
- [ ] Migrations are run as an explicit step, never automatically on API start-up.
- [ ] A dump ran last night, and you have looked at the file.
- [ ] You have completed a [restore test](backups/#the-restore-test).

## Application

- [ ] `/healthz` returns something trivial. No versions, no dependency status, no
      hostnames.
- [ ] Ingest body size is limited — in the application, and preferably at the proxy
      too.
- [ ] Logs go to stdout as structured JSON and you know how to read them:
      `docker compose logs -f api`.
- [ ] The freshness alert is running, and you have **tested that it fires** by
      stopping the heartbeat.

## The alert is not optional

Everything in the list above protects against something happening. The freshness
alert protects against something *stopping*, which is the failure this system
actually has.

An expired certificate, a stale DNS record, a dead worker, a full disk, and a
crashed VM all present identically: no new data, no error message, nothing in a
log you were reading. The app keeps buffering, so you do not even lose data — you
just stop noticing for a month.

Build it as a **dead man's switch**: the server pushes a heartbeat, and something
*else* decides when the silence has gone on too long. A system cannot report its
own death. See [Home Assistant](../integrations/home-assistant/#the-alert-that-matters).

## Updates

- [ ] Host OS security updates applied, unattended upgrades on if the distribution
      makes it easy.
- [ ] `docker compose pull && docker compose up -d` occasionally, so Caddy, Redis,
      and PostgreSQL do not drift years behind.
- [ ] `govulncheck ./...` in `backend/` and `npm audit` in `web/` from time to
      time. There is no CI here; the check happens because you run it.
- [ ] Certificate expiry dates are in your calendar. `make expiry` prints them.

## Deliberately absent

Do not add these unless your situation genuinely differs — each is real
maintenance for no benefit at this scale.

| Not present | Why |
|---|---|
| Rate limiting | One client, behind mutual TLS. Nothing to throttle. |
| WAF / intrusion detection in front of the API | There is no anonymous HTTP surface to protect. The handshake is the filter. |
| Audit log | Nobody to audit. Structured logs cover debugging. |
| Prometheus, Grafana, tracing | One API and one worker. Dashboards cost more to maintain than they reveal. A `/metrics` endpoint can be scraped later if you already run a monitoring stack. |
| Field-level encryption in the database | The database is on your own machine; key management would add more risk than it removes. |
| Full-disk encryption | Protects against physical theft of the host. Judge that for yourself — automatic unlock at boot largely defeats it. |
| Account deletion endpoint | `docker compose down -v` does the same with less code. |

## If something does go wrong

1. **Stop the exposure first.** Remove the port forward. The system still works
   over LAN and VPN, and the phone buffers.
2. **Rotate the credentials that could have leaked**: `HELSA_JWT_SECRET` (which
   invalidates all tokens) and, if a device or key is involved, the CA.
3. **Take a dump before you investigate**, not after. Investigation changes things.
4. Only then work out what happened. Nothing here is time-critical for anyone but
   you.
