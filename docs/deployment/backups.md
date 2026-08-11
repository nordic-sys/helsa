---
title: Backups and restore
layout: default
parent: Deployment
nav_order: 3
description: "Two backup layers, the TimescaleDB restore trap, and why the restore test is the only step that proves anything."
---

# Backups and restore
{: .no_toc }

1. TOC
{:toc}

---

Data loss is the most likely thing that will actually cost you something here.
Not an intrusion — a disk, a bad migration, or a `down -v` in the wrong terminal.

## Two layers, neither sufficient alone

| Layer | Restores | Good for |
|---|---|---|
| **Machine snapshot** (hypervisor backup, VM image) | The whole host as it was | Disk failure, a wrecked host, "everything is broken" |
| **Logical dump** (`pg_dump`) | The data, into any empty database | A bad migration, an accidental delete, moving to new hardware |

> **A snapshot of a running PostgreSQL is only crash-consistent.** PostgreSQL
> usually survives that through WAL replay, and "usually" is doing a lot of work in
> that sentence. The logical dump is what makes the guarantee. Run both.
{: .warning }

## Logical dumps

`deploy/scripts/pg-backup.sh` runs `pg_dump` inside the container and writes to a
directory you choose. Schedule it daily with a systemd timer or cron, and write to
storage that is **not the same disk** — ideally not the same machine.

```bash
# Example: daily at 03:30, keeping dumps on a NAS mount.
30 3 * * *  /opt/helsa/deploy/scripts/pg-backup.sh >> /var/log/helsa-backup.log 2>&1
```

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

> **Check the exact procedure against the documentation for your installed
> TimescaleDB version before you run it on real data.** The details have changed
> across versions. Rehearse on an empty database first.
{: .warning }

## Restoring

```bash
cd /opt/helsa/deploy
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

> **Do this once, before you trust the deployment. Consider the setup unfinished
> until you have.**
{: .warning }

1. Restore a machine snapshot to a scratch VM. Does the stack come up?
2. Restore a logical dump into an **empty** database. Are all hypertables and
   continuous aggregates there?
3. Write down what you did, and how long it took, next to the backup script.

Step 3 matters because the next time you do this, something will have gone wrong
and you will not be in a mood to work it out from first principles.

## What is not backed up, on purpose

| Not backed up | Why |
|---|---|
| Redis | Cache and deny-list. Rebuilds itself. Note that revocations are lost with it. |
| RabbitMQ | Transient. The phone re-sends anything not acknowledged. |
| Generated exports | Regenerable from the data. |
| Docker images | Rebuilt from source. |

## What is not in any backup, and matters more than all of it

> **The CA private key.** It belongs in your password manager, not on the server
> and not in a dump. If you lose it, every certificate must be reissued through a
> full CA rotation, which requires physical access to the phone. It is the one
> secret whose loss cannot be repaired from a backup — because it must never be in
> one.
{: .warning }

Also keep in the password manager: `.env` (specifically `HELSA_JWT_SECRET` — losing
it invalidates every device token) and the `.p12` passwords.

## Growth, and why there is no retention policy

Samples are compressed after 30 days. A heavily instrumented Apple Watch user
generates on the order of 5,000–15,000 samples a day; at roughly 150–200 bytes per
row that is a few megabytes a day uncompressed, and TimescaleDB typically achieves
well over 90% compression on this shape of data — many repeated `data_type` values
and a monotonic timestamp.

The practical result is on the order of tens of megabytes per year. **There is no
retention policy and there is not meant to be one**: for a personal health archive
the old data is the interesting part. A ten-year resting-heart-rate trend is not
stale data, it is the most valuable thing in the database.

Watch disk usage anyway if you enable an unusually high-frequency data type.
