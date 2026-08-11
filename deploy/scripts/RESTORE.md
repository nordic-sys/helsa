# Restoring

> **An untested backup is not a backup.** This document exists so that the restore
> procedure is not discovered for the first time in an emergency.

There are two complementary layers (`docs/07-infra-deployment.md` §6):

| Layer | What it gives back | When |
|---|---|---|
| **VM-level backup** | the whole machine, as it was | disk failure, a broken VM, "everything fell over" |
| **`pg-backup.sh`** (logical) | the data, even into an empty database | a botched migration, an accidental deletion, a move |

---

## A. Logical restore

### ⚠️ The TimescaleDB trap

This is **not** a plain `pg_restore`. The metadata of the hypertables lives in
Timescale's own catalog, and if the extension runs "live" during the restore, that
creates an inconsistent state. Hence the official choreography:

```
timescaledb_pre_restore()  →  pg_restore  →  timescaledb_post_restore()
```

⚠️ **Check the exact procedure against the documentation of the Timescale version
you have installed** before running it on real data — this part has changed between
versions before. What follows is the usual sequence, but **try it on an empty
database first** (see C).

### Steps

```bash
cd /opt/helsa/helsa/deploy
set -a && . ./.env && set +a
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# 1. Stop the writers — otherwise data arriving mid-restore collides.
$COMPOSE stop api worker

# 2. The target database. For a real restore, rename the old one first,
#    do NOT drop it until the new one has proven itself.
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d postgres \
  -c "ALTER DATABASE $POSTGRES_DB RENAME TO ${POSTGRES_DB}_old;"
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d postgres \
  -c "CREATE DATABASE $POSTGRES_DB;"
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "CREATE EXTENSION IF NOT EXISTS timescaledb;"

# 3. Put Timescale into restore mode
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT timescaledb_pre_restore();"

# 4. Load the dump back
$COMPOSE exec -T timescaledb pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  --no-owner --no-privileges < /opt/helsa/backups/helsa-YYYYMMDD-HHMMSS.dump

# 5. Back to normal mode (DO NOT SKIP THIS)
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT timescaledb_post_restore();"

# 6. Everything can start again
$COMPOSE start api worker
```

### Verification after the restore

```bash
# Are the hypertables there?
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT hypertable_name FROM timescaledb_information.hypertables;"

# Is the data there?
$COMPOSE exec -T timescaledb psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM samples;"

# Does the API see it too?
curl -sk https://localhost:8443/v1/summary?range=week&metrics=stepCount \
  -H "Authorization: Bearer $(cat /opt/helsa/device-token.txt)"
```

If everything is in order: `DROP DATABASE ${POSTGRES_DB}_old;`

---

## B. VM-level restore

From the hypervisor's interface: restore the VM from the backup server.

⚠️ **A restore overwrites the existing VM.** If you only want to check something,
restore it to a **new VM id**, and do not run it at the same time as the old one
(the fixed IP and the Docker network would collide).

---

## C. Trial restore — the exit criterion of phase 0

This **must be carried out** before the system counts as "done"
(`docs/21-utemterv.md` 0.7):

1. Take a fresh dump: `scripts/pg-backup.sh`
2. Restore it into a **temporary** database (`helsa_restoretest`), following the
   steps in section A but with `CREATE DATABASE helsa_restoretest` in step 2
3. Verify: the hypertables are there, the row count of `samples` matches
4. `DROP DATABASE helsa_restoretest;`
5. **Write the result down here**, with the date — so it is possible to tell when it
   was last proven that the backup can be restored

### Trials carried out

| Date | What | Result |
|---|---|---|
| **2026-08-10** | Logical dump → an empty `helsa_restoretest` database, with the `pre_restore` / `pg_restore` / `post_restore` choreography | ✅ **passed** |

**Details of the 2026-08-10 trial**

Every row count matched: `samples` 364, `workouts` 7, `sleep_segments` 84,
`activity_summary` 14, `goals` 0, `devices` 0, `users` 1. All three chunks of the
`samples` hypertable are present **under the same names** (`_hyper_1_1..3_chunk`),
and both continuous aggregates (`samples_daily`, `samples_hourly`) exist in the
restored database too.

⚠️ **One difference that is alarming at first sight but benign:**
`timescaledb_information.chunks` returns 3 rows in the original and 5 in the
restored database. The extra two are the **materialisation hypertables** of the
continuous aggregates (`_materialized_hypertable_2/3`) — in the restored database
these show up separately in the catalog view, while in the original they do not. No
user data differs. If you see this in a later trial, **do not panic**, but do compare
the row counts anyway.

⚠️ **A warning observed during the backup:** `pg_dump` prints that
*"You might not be able to restore the dump without using --disable-triggers…"*
and *"Consider using a full dump instead of a --data-only dump"*. This is a known
interaction between TimescaleDB and `pg_dump`; per the trial above, the restore is
correct regardless. If you ever do run into an error, start the investigation here.
