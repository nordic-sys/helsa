---
title: Backups and restore
description: "Two backup layers, the TimescaleDB restore trap, and why the restore test is the only step that proves anything."
sidebar:
  order: 3
---
Data loss is the most likely thing that will actually cost you something here.
Not an intrusion — a disk, a bad migration, or a `down -v` in the wrong terminal.

## Two layers, neither sufficient alone

| Layer | Restores | Good for |
|---|---|---|
| **Machine snapshot** (hypervisor backup, VM image) | The whole host as it was | Disk failure, a wrecked host, "everything is broken" |
| **Logical dump** (`pg_dump`) | The data, into any empty database | A bad migration, an accidental delete, moving to new hardware |

:::danger
**A snapshot of a running PostgreSQL is only crash-consistent.** PostgreSQL
usually survives that through WAL replay, and "usually" is doing a lot of work in
that sentence. The logical dump is what makes the guarantee. Run both.
:::

## Logical dumps

`deploy/scripts/pg-backup.sh` runs `pg_dump` inside the container and writes to a
directory you choose. Schedule it daily with a systemd timer or cron, and write to
storage that is **not the same disk** — ideally not the same machine.

The directory is `HELSA_BACKUP_DIR`; without it the script writes to `/opt/helsa/backups`, which an
ordinary user cannot create — the first run then stops with `Permission denied`. Run it from the
`deploy` directory (it reads the Compose files from there):

```bash
cd ~/helsa/deploy
HELSA_BACKUP_DIR=/mnt/nas/helsa-backups bash scripts/pg-backup.sh
# ... backup complete: /mnt/nas/helsa-backups/helsa-20261027-122614.dump (48K)
```

`pg_dump` prints a warning about *circular foreign-key constraints* on `continuous_agg`. That is
TimescaleDB's own catalog, it is expected, and the restore below handles it — the dump is fine.

**Schedule it with a systemd timer.** A Debian or Ubuntu cloud image has no `cron` at all, and a
cron line that appends to `/var/log/…` fails for an ordinary user anyway. A timer logs to the
journal (`journalctl -u helsa-backup`):

```ini title="/etc/systemd/system/helsa-backup.service"
[Unit]
Description=Helsa logical database backup (pg_dump)
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
User=you
WorkingDirectory=/home/you/helsa/deploy
Environment=HELSA_BACKUP_DIR=/home/you/helsa-backups
Environment=HELSA_BACKUP_KEEP=3
ExecStart=/usr/bin/bash scripts/pg-backup.sh
```

```ini title="/etc/systemd/system/helsa-backup.timer"
[Unit]
Description=Nightly Helsa database backup

[Timer]
OnCalendar=*-*-* 03:30:00 Europe/Budapest
Persistent=true

[Install]
WantedBy=timers.target
```

```bash title="On the server"
sudo systemctl daemon-reload
sudo systemctl enable --now helsa-backup.timer
sudo systemctl start helsa-backup.service      # run one now, and look at the result
journalctl -u helsa-backup -n 5
```

⚠️ **Give the time a zone.** A cloud VM usually runs on UTC while the hypervisor's backup schedule is
in local time; without the zone, summer time moves the dump to *after* the VM backup that was meant
to carry it away.

**"Not the same machine", when the host is isolated.** If the Helsa host cannot open connections into
your LAN ([as the hardening checklist asks](/deployment/hardening/#network)), it cannot write to a
NAS either. Then let the two layers work together: dump to a local directory, keep only the last few
(`HELSA_BACKUP_KEEP`), and schedule the dump shortly **before** the nightly VM backup — the VM backup
carries the dump off the machine. Measured on a real install: four million samples dump to 166 MB in
20 seconds.

Check afterwards that the file exists and has a plausible size. A backup job that
has been failing for a month usually looks exactly like one that is working, unless
you look.

## The TimescaleDB trap

**This is not an ordinary `pg_restore`.** Hypertable metadata lives in
TimescaleDB's own catalog, and if the extension is running normally during the
restore, you end up with an inconsistent state — tables present, hypertable
metadata wrong.

The required choreography is:

```
timescaledb_pre_restore()  →  pg_restore  →  timescaledb_post_restore()
```

:::danger
**Check the exact procedure against the documentation for your installed
TimescaleDB version before you run it on real data.** The details have changed
across versions. Rehearse on an empty database first.
:::

## Restoring

```bash
cd ~/helsa/deploy          # wherever your clone lives
set -a && . ./.env && set +a
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# 1. Stop the writers, so nothing arrives mid-restore.
$C stop api worker

# 2. Rename the existing database rather than dropping it.
#    Keep it until the restored copy is proven good.
$C exec -T timescaledb psql -U "$POSTGRES_USER" -d postgres \
  -c "ALTER DATABASE $POSTGRES_DB RENAME TO ${POSTGRES_DB}_old;"
$C exec -T timescaledb psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE $POSTGRES_DB;"
$C exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# 3. Into restore mode.
$C exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT timescaledb_pre_restore();"

# 4. Load the dump.
$C exec -T timescaledb pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-privileges < /path/to/helsa-YYYYMMDD-HHMMSS.dump

# 5. Back to normal mode. DO NOT SKIP THIS.
$C exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT timescaledb_post_restore();"

# 6. Start the writers again.
$C start api worker
```

Renaming instead of dropping in step 2 means a failed restore costs you nothing.
Drop `*_old` only once you have verified the new database.

## Verify a restore

```sql
-- Hypertables present?
SELECT hypertable_name FROM timescaledb_information.hypertables;

-- Continuous aggregates present?
SELECT view_name FROM timescaledb_information.continuous_aggregates;

-- Does the data reach where you expect?
SELECT data_type, count(*), min(ts), max(ts) FROM samples GROUP BY 1 ORDER BY 2 DESC;
SELECT count(*) FROM workouts;
SELECT count(*) FROM sleep_segments;
```

Then bring the stack up and load the dashboard. Numbers on a screen you recognise
are a better check than any row count.

## The restore test

:::danger
**Do this once, before you trust the deployment. Consider the setup unfinished
until you have.**
:::

1. Restore a machine snapshot to a scratch VM. Does the stack come up? Give the scratch VM a
   **new MAC address** (Proxmox: *unique* on restore), or it collides with the original on the network.
   ⚠️ A VM made from a cloud image often has its network matched **by MAC** (cloud-init writes
   `match: macaddress:` into `/etc/netplan/50-cloud-init.yaml`) — the restored copy then boots with
   no network at all. That is exactly what would happen in a real disaster on new hardware. Match by
   driver instead, on the real server, before you need it:

   ```yaml title="/etc/netplan/50-cloud-init.yaml"
   network:
     version: 2
     ethernets:
       eth0:
         match:
           driver: virtio_net
         dhcp4: true
         set-name: eth0
   ```

   then `sudo netplan generate && sudo netplan apply`.
2. Restore a logical dump into an **empty** database. Are all hypertables and
   continuous aggregates there?
3. Write down what you did, and how long it took, next to the backup script — or next to the
   dumps, where you will look for it.

For scale, measured on a real install of four million samples: the dump restored into an empty
database in 6 seconds with identical counts everywhere; the VM restored from Proxmox Backup Server
in about 70 seconds and came up by itself. (In the TimescaleDB `-ha` image the extension already
exists in a new database, so `CREATE EXTENSION` answers *already exists, skipping* — that is fine.)

Step 3 matters because the next time you do this, something will have gone wrong
and you will not be in a mood to work it out from first principles.

## What is not backed up, on purpose

| Not backed up | Why |
|---|---|
| Redis | Cache, refresh tokens and the revocation deny-list. The cache rebuilds itself; ⚠️ the revocations do not — wiping the volume makes a revoked token work again until it expires. |
| RabbitMQ | Transient. The phone re-sends anything not acknowledged. |
| Generated exports | Regenerable from the data. |
| Docker images | Rebuilt from source. |

## What is not in any backup, and matters more than all of it

:::danger
**The CA private key.** It belongs in your password manager, not on the server
and not in a dump. If you lose it, every certificate must be reissued through a
full CA rotation, which requires physical access to the phone. It is the one
secret whose loss cannot be repaired from a backup — because it must never be in
one.
:::

Also keep in the password manager: `.env` (specifically `HELSA_JWT_SECRET` — losing
it invalidates every device token) and the `.p12` passwords.

## Growth, and why there is no retention policy

Samples are compressed after 30 days. A heavily instrumented Apple Watch user
generates on the order of 5,000–15,000 samples a day; at roughly 150–200 bytes per
row that is a few megabytes a day uncompressed, and TimescaleDB typically achieves
well over 90% compression on this shape of data — many repeated `data_type` values
and a monotonic timestamp.

The practical result is on the order of tens of megabytes per year **once compressed**.

⚠️ **The first upload is not that.** It brings your whole Health history at once, and it lands
uncompressed — compression only reaches data older than 30 days on its next run (every 12 hours).
Measured on a real first install (2026-10-27): an iPhone + Apple Watch history of several years
uploaded **millions of samples**; at 2.27 million the database stood at **1.3 GB**, about 580 bytes
a sample with its indexes, plus ~380,000 GPS points. The phone finishes in minutes and the worker
then drains the queue at roughly 100 batches a minute — the numbers in the database keep rising for
a while after the app says *Done*. Size the disk for the first upload, not for the yearly growth:
plan for the 32 GB in [What you need](/getting-started/#what-you-need) — 20 GB held it, with the
Docker images, at 61 %. **There is no
retention policy and there is not meant to be one**: for a personal health archive
the old data is the interesting part. A ten-year resting-heart-rate trend is not
stale data, it is the most valuable thing in the database.

Watch disk usage anyway if you enable an unusually high-frequency data type.
