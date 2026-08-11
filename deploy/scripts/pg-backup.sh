#!/usr/bin/env bash
# Helsa — logical database backup (docs/07-infra-deployment.md §6.2).
#
# WHY IT IS NEEDED even with a VM-level backup system: a snapshot taken of a
# running Postgres is only crash-consistent. Postgres usually survives that via WAL
# replay, but that is thin as a guarantee. The two layers together give real
# protection:
#   VM backup → "the whole machine comes back"
#   this      → "the data comes back, even into an empty database"
#
# ⚠️ TIMESCALEDB-SPECIFIC: the restore is NOT a plain pg_restore, see
# scripts/RESTORE.md. The BACKUP, on the other hand, is a plain pg_dump — the trick
# is all on the restore side.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

DEST="${HELSA_BACKUP_DIR:-/opt/helsa/backups}"
KEEP="${HELSA_BACKUP_KEEP:-14}"
DB="${POSTGRES_DB:-helsa}"
USER="${POSTGRES_USER:-helsa}"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

mkdir -p "$DEST"
stamp=$(date +%Y%m%d-%H%M%S)
out="$DEST/helsa-$stamp.dump"

# -Fc = the custom format: compressed, and pg_restore can restore selectively from
# it (which is what the Timescale pre/post_restore choreography needs).
$COMPOSE exec -T timescaledb pg_dump -U "$USER" -d "$DB" -Fc > "$out.part"
mv "$out.part" "$out"

# Integrity check: if the dump is corrupt, `pg_restore -l` chokes on it — better to
# find out now than during a real restore.
if ! $COMPOSE exec -T timescaledb pg_restore -l < "$out" > /dev/null 2>&1; then
    echo "ERROR: the dump cannot be read back ($out)" >&2
    exit 1
fi

size=$(du -h "$out" | cut -f1)
echo "$(date -Is) backup complete: $out ($size)"

# Retention: the most recent $KEEP are kept.
ls -1t "$DEST"/helsa-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    rm -f -- "$old"
    echo "$(date -Is) deleted (retention): $old"
done
