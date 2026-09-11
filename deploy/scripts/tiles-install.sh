#!/usr/bin/env bash
# Put a built region on a Helsa server, without ever half-putting it there.
#
# Usage:
#   scripts/tiles-install.sh /path/to/hungary.pmtiles your-server
#   scripts/tiles-install.sh /path/to/hungary.pmtiles            # local install
#
#   $1  the archive built by `tiles-build.sh`
#   $2  an ssh destination, or empty to install on this machine
#
# Environment:
#   TILES_DIR   where the archives live on the server  (default: /opt/helsa/tiles)
#   KEEP_FREE_G how many GB to leave free              (default: 2)
#
# # The three things this does that a plain `scp` does not
#
# 1. **It checks the disk BEFORE copying, and refuses rather than filling it.**
#    ⚠️ The dev VM has ~12 GB free and a country is 300–600 MB, so four or five
#    regions fit comfortably — but the machine that runs out is the one that also
#    runs Postgres, and a full disk there is a much worse day than a missing map.
#    `KEEP_FREE_G` is the floor it will not cross.
# 2. **It copies to `*.part` and renames only on success.** A rename within a
#    filesystem is atomic, so the served directory never contains a file that is
#    still arriving. ⛔ This is the whole reason a half-written archive cannot be
#    served as a grey hole: it is not in the directory until it is complete.
# 3. **It leaves the running stack alone.** Martin (the optional `tiles` service)
#    picks up whatever is in the directory when it starts, so a newly installed
#    region needs `make tiles-down && make tiles-up` and nothing else — no code
#    change, and no list to edit anywhere.
set -euo pipefail

SRC="${1:?usage: tiles-install.sh <file.pmtiles> [ssh-destination]}"
DEST="${2:-}"
TILES_DIR="${TILES_DIR:-/opt/helsa/tiles}"
KEEP_FREE_G="${KEEP_FREE_G:-2}"

[ -f "$SRC" ] || { echo "no such file: $SRC" >&2; exit 1; }
NAME="$(basename "$SRC")"
case "$NAME" in
  *.pmtiles) ;;
  # Martin serves a `.pmtiles` archive under its basename; anything else in the
  # directory is a file it will not publish, so it is worth refusing here, where
  # somebody is watching, rather than in a log nobody reads.
  *) echo "not a .pmtiles archive: $NAME" >&2; exit 1 ;;
esac

# The magic is seven bytes; checking them costs nothing and catches the classic
# case of an HTML error page saved under a .pmtiles name.
head -c 7 "$SRC" | grep -q '^PMTiles' || { echo "$NAME does not start with the PMTiles magic" >&2; exit 1; }

SIZE_BYTES=$(wc -c <"$SRC" | tr -d ' ')
SIZE_G=$(awk -v b="$SIZE_BYTES" 'BEGIN{printf "%.2f", b/1024/1024/1024}')

run() { if [ -n "$DEST" ]; then ssh "$DEST" "$@"; else bash -c "$*"; fi; }

echo "→ ${NAME} (${SIZE_G} GB) → ${DEST:-this machine}:${TILES_DIR}"

run "mkdir -p '$TILES_DIR'"

# `df -Pk` for the portable, one-line-per-filesystem output; the 4th column is
# available kibibytes.
AVAIL_K=$(run "df -Pk '$TILES_DIR' | awk 'NR==2{print \$4}'")
NEED_K=$(awk -v b="$SIZE_BYTES" -v keep="$KEEP_FREE_G" 'BEGIN{printf "%d", b/1024 + keep*1024*1024}')
if [ "$AVAIL_K" -lt "$NEED_K" ]; then
  AVAIL_G=$(awk -v k="$AVAIL_K" 'BEGIN{printf "%.2f", k/1024/1024}')
  cat >&2 <<EOF
REFUSING: ${AVAIL_G} GB free, and ${NAME} needs ${SIZE_G} GB plus a ${KEEP_FREE_G} GB margin.

This is the failure worth failing loudly on. A tile archive that runs the disk out
takes the database down with it, and a half-copied one renders as a grey hole that
looks like a bug in the page rather than a full disk on a VM.

Free something, install a smaller region, or drop one that is no longer travelled:
    ssh ${DEST:-<host>} 'ls -lh ${TILES_DIR}'
    ssh ${DEST:-<host>} 'rm ${TILES_DIR}/<region>.pmtiles'   # then: make tiles-down && make tiles-up
EOF
  exit 1
fi

# `*.part` while it travels: martin only publishes `*.pmtiles`, so an interrupted
# copy is invisible rather than half-served.
if [ -n "$DEST" ]; then
  scp "$SRC" "${DEST}:${TILES_DIR}/${NAME}.part"
else
  cp "$SRC" "${TILES_DIR}/${NAME}.part"
fi

run "mv '${TILES_DIR}/${NAME}.part' '${TILES_DIR}/${NAME}'"
run "chmod 644 '${TILES_DIR}/${NAME}'"

REGION="${NAME%.pmtiles}"
cat <<EOF

Installed: ${TILES_DIR}/${NAME}

Next, on the server:
    cd /opt/helsa/monorepo/deploy && make tiles-down && make tiles-up

Then, in the dashboard, Settings ▸ Map under the route ▸ "Your own tile server":
    http://tiles:3000/${REGION}/{z}/{x}/{y}          (tile format: vector)

⚠️ That is a container name, and it is right: the BROWSER never fetches tiles.
   The Helsa API does, from inside the compose network — which is what keeps the
   browser talking to one host only.
EOF
