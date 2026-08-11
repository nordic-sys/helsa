#!/usr/bin/env bash
# Helsa — a sync-freshness heartbeat into Home Assistant (docs/16 §2).
#
# WHY THIS WAY: an expired certificate, a stale DDNS record, a dead worker and a
# full disk all fail in the same way — nothing signals anything, and you only notice
# weeks later that data is missing. This is the system's one real alert.
#
# ⚠️ The alert is NOT decided here. This script only pushes STATE into Home
# Assistant; when silence means trouble is for the HA automation to say. That
# difference is what makes it a dead man's switch: if this VM dies, the script does
# not run either, and that is exactly how HA notices the trouble. If Helsa itself
# sent the alert, it could not announce its own death.
set -euo pipefail

cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a

: "${HA_URL:?required in .env: HA_URL}"
: "${HA_TOKEN:?required in .env: HA_TOKEN}"
ENTITY="${HA_ENTITY:-sensor.helsa_sync_freshness}"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
q() { $COMPOSE exec -T timescaledb psql -U "${POSTGRES_USER:-helsa}" -d "${POSTGRES_DB:-helsa}" -tAc "$1" 2>/dev/null | tr -d '\r' | head -1; }

# Of the newest sample and the newest device heartbeat, the fresher one counts: the
# ingest is itself a heartbeat, and it may simply be that there is no new HealthKit
# data.
#
# ⚠️ **The heartbeat counts ONLY from the uploading device.** This used to read
# `max(last_seen_at)` over ALL devices — except that the iPad, the Mac and the watch
# also check in, while none of them uploads anything (docs/04: the iPhone is the only
# uploader). An app left open on an iPad would therefore have kept this alert looking
# healthy even if the phone had not synced for weeks — which is to say, precisely the
# silent data loss this metric exists for would have gone unnoticed.
#
# The filter goes on `platform`. If there is ever more than one iOS device (an old
# phone, say), that at worst makes it more cautious: the alert fires sooner, not
# later.
newest=$(q "SELECT to_char(GREATEST(
              COALESCE((SELECT max(ts) FROM samples), 'epoch'::timestamptz),
              COALESCE((SELECT max(last_seen_at) FROM devices WHERE platform = 'ios'),
                       'epoch'::timestamptz)
            ) AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');")

skew_s=0
if [ -z "$newest" ] || [ "$newest" = "1970-01-01T00:00:00Z" ]; then
    hours="unknown"
    newest="never"
else
    now=$(date -u +%s)
    then_=$(date -u -d "$newest" +%s 2>/dev/null || echo "$now")
    age_s=$(( now - then_ ))

    # ⚠️ A TIMESTAMP IN THE FUTURE. If the newest data is later than the current time,
    # `age` goes negative — and a negative freshness SILENTLY DISABLES the alert: it
    # never reaches the threshold, however long the sync has been stopped. So we clamp
    # it to zero.
    #
    # The clamp must not hide the cause, though, because for the duration of the skew
    # the real staleness stays hidden too (data dated 2 hours ahead swallows 2 hours of
    # standstill). That is why the `future_skew_s` attribute spells it out — Home
    # Assistant can raise a separate alert from it.
    #
    # Where it can come from: a wrong clock on the phone or on the VM, mishandled time
    # zones in the ingest, or developer mock data that dates things ahead (which is
    # exactly what caused it on 2026-08-11).
    if [ "$age_s" -lt 0 ]; then
        skew_s=$(( -age_s ))
        age_s=0
    fi
    hours=$(( age_s / 3600 ))
fi

# In Home Assistant `state` is at most 255 characters; the details go into attributes.
payload=$(printf '{"state":"%s","attributes":{"friendly_name":"Helsa sync freshness","unit_of_measurement":"h","icon":"mdi:heart-pulse","newest_data":"%s","future_skew_s":%s,"source":"helsa-vm"}}' "$hours" "$newest" "$skew_s")

code=$(curl -sS -m 15 -o /dev/null -w '%{http_code}' \
    -X POST -H "Authorization: Bearer $HA_TOKEN" -H 'Content-Type: application/json' \
    -d "$payload" "$HA_URL/api/states/$ENTITY")

note=""
[ "$skew_s" -gt 0 ] && note=" ⚠️ data from the future: ${skew_s}s ahead"
echo "$(date -Is) $ENTITY = $hours h (newest data: $newest)$note → HA HTTP $code"
[ "$code" = "200" ] || [ "$code" = "201" ]
