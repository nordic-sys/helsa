#!/usr/bin/env bash
# Contract-first code generation.
#
# Why not straight from the canonical openapi.yaml? oapi-codegen v2.7.1 does not
# yet handle the OpenAPI 3.1 `type: [string, 'null']` (nullable union) syntax.
# The canonical spec (api/openapi.yaml) is DELIBERATELY 3.1 and stays untouched —
# here we derive a 3.0-flavour input (api/openapi.gen.yaml) purely for the
# generator: nullable union → `nullable: true`, and the version header
# 3.1.0 → 3.0.3. Once oapi-codegen supports 3.1 natively, this transformation can
# be deleted.
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="api/openapi.yaml"
GEN_INPUT="api/openapi.gen.yaml"

sed -E \
  -e 's/^openapi: 3\.1\.0/openapi: 3.0.3/' \
  -e "s/type: \[string, 'null'\]/type: string, nullable: true/g" \
  -e "s/type: \[number, 'null'\]/type: number, nullable: true/g" \
  "$SRC" > "$GEN_INPUT"

go tool oapi-codegen -config api/oapi-codegen.yaml "$GEN_INPUT"

echo "Generated: internal/api/api.gen.go (source: $SRC → $GEN_INPUT)"
