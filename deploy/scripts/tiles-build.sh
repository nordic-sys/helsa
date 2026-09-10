#!/usr/bin/env bash
# Build one map region — ON THE BUILD MACHINE, not on the server.
#
# This is the "your own tile server" answer to Settings ▸ Map under the route: an
# archive you build once and serve yourself, so that a page about where somebody
# ran does not have to ask a stranger for the streets. It is entirely optional —
# the setting defaults to no map, and the other option is a public provider.
#
# ⚠️ This wants a machine with RAM and cores, and it is emphatically NOT the dev
# VM: planetiler runs a JVM with several gigabytes of heap, and the dev VM has
# about 2.8 GB of RAM in total. Build on the Mac, copy the result over
# (`tiles-install.sh`).
#
# Usage:
#   scripts/tiles-build.sh hungary europe/hungary
#   scripts/tiles-build.sh austria europe/austria
#   scripts/tiles-build.sh iceland europe/iceland
#
#   $1  the region id — becomes `<id>.pmtiles`, and the id the manifest carries
#   $2  the Geofabrik path, WITHOUT the `-latest.osm.pbf` suffix
#
# Environment:
#   WORKDIR   where the downloads and the output go   (default: ./tiles-build)
#   JAVA_HEAP heap for planetiler                     (default: 6g)
#
# Roughly what to expect on an M-series Mac: Hungary is a 320 MB extract, two
# minutes, and a 287 MB archive; Austria is 730 MB, fifty seconds (it parallelises
# better), and 608 MB. Budget disk on the SERVER at about that rate — see
# `tiles-install.sh`, which refuses to fill it.
set -euo pipefail

REGION="${1:?usage: tiles-build.sh <region-id> <geofabrik-path>}"
GEOFABRIK="${2:?usage: tiles-build.sh <region-id> <geofabrik-path>   e.g. europe/hungary}"
WORKDIR="${WORKDIR:-$(pwd)/tiles-build}"
JAVA_HEAP="${JAVA_HEAP:-6g}"

# ⚠️ `latest` rather than a pinned version, deliberately: this is a basemap, not a
# dependency. A rebuild a year from now should pick up a year of road changes.
PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar"
PBF_URL="https://download.geofabrik.de/${GEOFABRIK}-latest.osm.pbf"

mkdir -p "$WORKDIR"
cd "$WORKDIR"

command -v java >/dev/null || { echo "java not found — planetiler needs a JVM (21+)" >&2; exit 1; }

[ -f planetiler.jar ] || { echo "→ planetiler"; curl -fSL --progress-bar -o planetiler.jar "$PLANETILER_URL"; }
[ -f "${REGION}-latest.osm.pbf" ] || {
  echo "→ ${PBF_URL}"
  curl -fSL --progress-bar -o "${REGION}-latest.osm.pbf" "$PBF_URL"
}

echo "→ planetiler ${REGION}"
# `--download` fetches the two auxiliary sources planetiler wants (water polygons
# and Natural Earth) — build-time downloads on THIS machine, which is a different
# thing entirely from a runtime request out of somebody's browser.
java "-Xmx${JAVA_HEAP}" -jar planetiler.jar \
  --osm-path="${REGION}-latest.osm.pbf" \
  --output="${REGION}.pmtiles" \
  --download --force

ls -lh "${REGION}.pmtiles"
cat <<EOF

Built: ${WORKDIR}/${REGION}.pmtiles

⛔ Do NOT commit it. The repository is public and this is a deploy-time artefact;
   deploy/.gitignore already refuses *.pmtiles, and it should stay that way.

Next:
   scripts/tiles-install.sh ${WORKDIR}/${REGION}.pmtiles helsa-dev
   (then, on the server: make tiles-up)
EOF
