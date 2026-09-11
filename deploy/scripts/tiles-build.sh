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
#   $2  WHERE THE OSM DATA COMES FROM, in one of three forms:
#         * a Geofabrik path without the `-latest.osm.pbf` suffix (`europe/hungary`)
#         * a full https:// URL to any `.osm.pbf`
#         * a path to an `.osm.pbf` already on this machine
#
# Environment:
#   WORKDIR      where the downloads and the output go   (default: ./tiles-build)
#   JAVA_HEAP    heap for planetiler                     (default: 6g)
#   PLANETILER_ARGS  extra planetiler flags, verbatim    (default: empty)
#
# ## The whole planet
#
# Nothing here is limited to a country, and nothing downstream is either: martin
# reads a `.pmtiles` archive with range reads whatever its size, `tiles-install.sh`
# only checks that the disk has room, and the setting takes one address. So a
# planet-sized archive is a question of HARDWARE, not of this pipeline.
#
# ⚠️ But it is not `$2 = planet`, and the reason is worth stating: **Geofabrik does
# not publish the planet** — it publishes extracts of it. The planet file comes from
# the OSM mirrors, and it is the one case where you fetch the input yourself:
#
#   scripts/tiles-build.sh planet https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf
#
# ⚠️ A planet build is a different order of machine from a country: far more heap
# than the 6g default, a large scratch area beside the output, and hours rather
# than minutes. planetiler's own README carries the current numbers and the flags
# that go with them (`--nodemap-type`, `--storage`); pass them through
# `PLANETILER_ARGS` rather than editing this script:
#
#   JAVA_HEAP=100g PLANETILER_ARGS='--nodemap-type=array --storage=mmap' \
#     scripts/tiles-build.sh planet https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf
#
# Roughly what to expect on an M-series Mac: Hungary is a 320 MB extract, two
# minutes, and a 287 MB archive; Austria is 730 MB, fifty seconds (it parallelises
# better), and 608 MB. Budget disk on the SERVER at about that rate — see
# `tiles-install.sh`, which refuses to fill it.
set -euo pipefail

REGION="${1:?usage: tiles-build.sh <region-id> <geofabrik-path>}"
SOURCE="${2:?usage: tiles-build.sh <region-id> <geofabrik-path|url|file.osm.pbf>   e.g. europe/hungary}"
WORKDIR="${WORKDIR:-$(pwd)/tiles-build}"
JAVA_HEAP="${JAVA_HEAP:-6g}"

# ⚠️ `latest` rather than a pinned version, deliberately: this is a basemap, not a
# dependency. A rebuild a year from now should pick up a year of road changes.
PLANETILER_URL="https://github.com/onthegomap/planetiler/releases/latest/download/planetiler.jar"

# What `$2` names. A Geofabrik path is the common case and stays the short form;
# the other two exist so that "somewhere Geofabrik does not publish" — the planet
# above all — is a supported route rather than a thing you discover by reading the
# script.
case "$SOURCE" in
  http://*|https://*) PBF_URL="$SOURCE"; PBF_LOCAL="" ;;
  *.osm.pbf)          PBF_URL="";        PBF_LOCAL="$SOURCE" ;;
  *)                  PBF_URL="https://download.geofabrik.de/${SOURCE}-latest.osm.pbf"; PBF_LOCAL="" ;;
esac

mkdir -p "$WORKDIR"
cd "$WORKDIR"

command -v java >/dev/null || { echo "java not found — planetiler needs a JVM (21+)" >&2; exit 1; }

if [ -n "$PBF_LOCAL" ]; then
  # ⚠️ Referenced where it lies, never copied: a planet extract is large enough
  # that a silent second copy is its own kind of outage.
  [ -f "$PBF_LOCAL" ] || { echo "no such file: $PBF_LOCAL" >&2; exit 1; }
  PBF="$PBF_LOCAL"
else
  PBF="${REGION}-latest.osm.pbf"
  [ -f "$PBF" ] || { echo "→ ${PBF_URL}"; curl -fSL --progress-bar -o "$PBF" "$PBF_URL"; }
fi

[ -f planetiler.jar ] || { echo "→ planetiler"; curl -fSL --progress-bar -o planetiler.jar "$PLANETILER_URL"; }

echo "→ planetiler ${REGION}"
# `--download` fetches the two auxiliary sources planetiler wants (water polygons
# and Natural Earth) — build-time downloads on THIS machine, which is a different
# thing entirely from a runtime request out of somebody's browser.
# shellcheck disable=SC2086  # PLANETILER_ARGS is meant to word-split
java "-Xmx${JAVA_HEAP}" -jar planetiler.jar \
  --osm-path="$PBF" \
  --output="${REGION}.pmtiles" \
  --download --force ${PLANETILER_ARGS:-}

ls -lh "${REGION}.pmtiles"
cat <<EOF

Built: ${WORKDIR}/${REGION}.pmtiles

⛔ Do NOT commit it. The repository is public and this is a deploy-time artefact;
   deploy/.gitignore already refuses *.pmtiles, and it should stay that way.

Next:
   scripts/tiles-install.sh ${WORKDIR}/${REGION}.pmtiles your-server
   (then, on the server: make tiles-up)
EOF
