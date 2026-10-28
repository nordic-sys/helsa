---
title: Hardening
description: "A checklist to walk before and after exposing the server, plus the things that are deliberately absent."
sidebar:
  order: 4
---
A checklist, not a philosophy. Walk it before you forward a port, and again after
any change to the proxy or the network.

## Network

- [ ] **Exactly one forwarded port, onto the host's TCP 443.** The number on the
      router's outside may differ (for example `48443` → `443`). Not the database, not
      the RabbitMQ console, not the dashboard on 8443, and ideally not SSH. Check it
      from outside with a public TCP port check: your port answers, `443` and `8443`
      time out.
- [ ] The dashboard port `8443` is reachable **only** over LAN or VPN, enforced
      both by the router and by the `remote_ip` rule in the proxy.
- [ ] Administrative interfaces — RabbitMQ management, pgAdmin, any metrics UI —
      are on the VPN only. If you cannot reach them without the VPN, that is
      correct.
- [ ] Router firewall input rules are scoped to the LAN interface, not to "any".
      An open DNS resolver or management port on a WAN interface is the classic
      home-network mistake and gets abused within days.
- [ ] The host running Helsa cannot open connections into the rest of your LAN, or
      is on its own segment. ⚠️ On a flat home network **the router cannot enforce
      this** — hosts on one subnet talk without passing its firewall. Do it where the
      VM's network card is: the hypervisor's firewall, or a separate VLAN.
      [A Proxmox example](/deployment/example-homelab/#2-isolation-belongs-to-the-hypervisor-not-the-router).
- [ ] The host has a **fixed address**: a static DHCP lease (on a MikroTik, by MAC
      only — a lease that also matches the client-id breaks at the next OS upgrade)
      or a static IP. Port forwards and DNS records point at it.

## Containers

- [ ] `docker compose ps` shows a published port for **the proxy only**.
      Everything else must be empty.
- [ ] The production Compose profile is what is running — not the local
      development overlay, which publishes database ports to the host.
- [ ] Containers use `restart: unless-stopped`, so the stack returns after a
      reboot or a power cut.
- [ ] The host starts the stack on boot — and a VM starts with its hypervisor
      (Proxmox: *Start at boot*, off by default).
- [ ] TimescaleDB telemetry is off: `SHOW timescaledb.telemetry_level;` answers `off`. The image
      phones home daily by default; the Compose file switches it off since 2026-10-28 — an older
      install gets it with the next `git pull` and `make prod-up`.
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
      query. In Helsa that role is `helsa_app` (since 2026-10-28; an older install
      gets it with [these steps](/getting-started/quick-start/#upgrading-an-install-from-before-helsa_app)).
      Check it from inside the api's own connection string, not by trusting the
      Compose file:

      ```bash
      C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
      $C exec timescaledb psql -U helsa -d helsa -c \
        "SELECT a.usename, r.rolsuper, count(*) FROM pg_stat_activity a JOIN pg_roles r ON r.oid = a.usesysid
         WHERE a.datname = 'helsa' AND a.backend_type = 'client backend' GROUP BY 1, 2;"
      ```

      The api's connections must be `helsa_app | f`, the worker's `helsa_worker | f`;
      the one `helsa | t` row is your own `psql`. And the role must be unable to change the
      schema — as `helsa_app`, `CREATE TABLE x (i int);` answers *permission denied
      for schema public*. What it may do is spelled out in
      `deploy/init/timescaledb/03-app-role.sql`: `SELECT`/`INSERT`/`UPDATE`/`DELETE`
      on Helsa's tables, `SELECT` on the views, nothing on the migration tool's
      table, no temporary tables, no `TRUNCATE`.
- [ ] The API cannot read another person's rows **even without the application's own filter**:
      every table with a person's rows has row-level security, and the raw samples are out of
      the API role's reach altogether (it reads them through the `my_samples` view). As
      `helsa_app`, `SELECT 1 FROM samples LIMIT 1;` answers *permission denied*, and
      `SELECT count(*) FROM workouts;` without setting `helsa.user_id` answers `0`. The smoke
      suite checks this on every run (`TestEveryMemberTableHasAPolicy`).
- [ ] `.env` holds `HELSA_APP_DB_PASSWORD` and `HELSA_WORKER_DB_PASSWORD`, and they differ from `POSTGRES_PASSWORD` and from each other. The api,
      worker and token containers see only the former — the Compose file blanks the
      owner's password in their environment.
- [ ] Migrations are run as an explicit step, never automatically on API start-up.
- [ ] A dump ran last night, and you have looked at the file.
- [ ] You have completed a [restore test](backups/#the-restore-test).

## Application

- [ ] `/healthz` returns something trivial. No versions, no dependency status, no
      hostnames.
- [ ] Ingest body size is limited — **at the proxy** (`request_body { max_size 32MB }` in the Caddyfile, which ships enabled) and, one layer later, by the application's 50,000-item cap. ⚠️ The application's limit alone is not enough: it applies after the body has been read and decoded.
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
own death. See [Home Assistant](/integrations/home-assistant/#the-alert-that-matters).

## Updates

- [ ] Host OS security updates applied, unattended upgrades on if the distribution
      makes it easy.
- [ ] `docker compose pull && docker compose up -d` occasionally, so Caddy, Redis,
      and PostgreSQL do not drift years behind. Then `docker image prune -f`: every
      pull leaves the previous images on the disk, and they add up.
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
