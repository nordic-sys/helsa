#!/usr/bin/env bash
# Helsa backend — the security gate (docs/15-security-privacy.md).
#
# Three tools, because they answer three DIFFERENT questions, and any one of them
# alone leaves a hole the other two would have caught:
#
#   golangci-lint — "is this code correct and idiomatic?"
#       The general gate. It is here not for style but because a large share of
#       real security bugs first show up as an ordinary correctness smell: an
#       unchecked error, a value assigned and never read, a deprecated call. It
#       already caught `middleware.RealIP` (SA1019, IP spoofing) this way.
#
#   govulncheck   — "does a KNOWN vulnerability sit in our dependency graph, and
#                    does OUR code actually reach it?"
#       The difference from an ordinary dependency scanner is the second half.
#       Anything that walks go.sum will report every advisory touching every
#       module we happen to require — mostly noise for a service that never calls
#       the affected function. govulncheck does call-graph analysis and separates
#       "reachable from this binary" from "merely present". The reachable ones are
#       the findings that deserve to interrupt someone's day; the rest are an
#       upgrade-when-convenient list. That is what makes its output worth reading
#       instead of skimming.
#
#   gosec         — "did WE write an insecure pattern?"
#       govulncheck looks at other people's code, gosec at ours: unchecked integer
#       conversions, weak randomness, command injection, world-readable files.
#
# ON SUPPRESSIONS. gosec has well-known false positives, and the tempting fix — a
# global exclusion list — turns the scanner into decoration: it stops reporting the
# class of bug you excluded, not just the instance. So suppression happens ONE SITE
# AT A TIME, with `#nosec G115 -- <reason>` on the line, and the reason has to say
# why that particular value cannot be hostile. If you find yourself wanting to
# exclude a whole rule, the honest move is to fix the code instead.
#
# The single scope-level exception is -exclude-generated, see GOSEC_ARGS below.
set -uo pipefail

cd "$(dirname "$0")/.."

# The tools are installed with `go install` and land in GOPATH/bin, which is
# typically NOT on PATH. Look there too rather than making everyone edit a profile.
GOBIN="$(go env GOBIN)"
[ -n "$GOBIN" ] || GOBIN="$(go env GOPATH)/bin"

# tool <name> <go-install-path> — resolves the binary or explains how to get it.
tool() {
    local name="$1" install="$2" path
    path="$(command -v "$name" 2>/dev/null)" || path=""
    [ -n "$path" ] || { [ -x "$GOBIN/$name" ] && path="$GOBIN/$name"; }
    if [ -z "$path" ]; then
        echo "MISSING: $name — install it with:" >&2
        echo "    go install $install@latest" >&2
        return 1
    fi
    echo "$path"
}

GOLANGCI="$(tool golangci-lint github.com/golangci/golangci-lint/v2/cmd/golangci-lint)" || exit 127
GOVULNCHECK="$(tool govulncheck golang.org/x/vuln/cmd/govulncheck)" || exit 127
GOSEC="$(tool gosec github.com/securego/gosec/v2/cmd/gosec)" || exit 127

# -exclude-generated: internal/api/api.gen.go and internal/db/*.sql.go are written
# by oapi-codegen and sqlc, carry "DO NOT EDIT", and are rebuilt by `make generate`.
# A `#nosec` annotation in them survives exactly until the next regeneration, so
# there is no way to triage a finding there in place. (What it hides today: G101
# "potential hardcoded credentials" on the sqlc constant `upsertPushToken` — a SQL
# string whose NAME contains "token". Nothing is credential about it.) If a real
# finding ever needs checking, drop the flag for one run.
GOSEC_ARGS=(-quiet -exclude-generated -fmt=text ./...)

failed=()
run() {
    local label="$1"; shift
    echo
    echo "=== $label ==="
    if "$@"; then
        echo "--- $label: clean"
    else
        echo "--- $label: FINDINGS (exit $?)"
        failed+=("$label")
    fi
}

run "golangci-lint (correctness + idiom)" "$GOLANGCI" run ./...
run "govulncheck (reachable known vulnerabilities)" "$GOVULNCHECK" ./...
run "gosec (insecure patterns in our own code)" "$GOSEC" "${GOSEC_ARGS[@]}"

echo
if [ ${#failed[@]} -eq 0 ]; then
    echo "All three scans are clean."
    exit 0
fi
echo "Reported findings: ${failed[*]}"
echo "Read them. A finding that is not real gets a narrow #nosec with a reason;"
echo "one that stays unfixed goes into docs/25-ismert-hibak.md — not into silence."
exit 1
