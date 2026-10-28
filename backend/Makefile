# Helsa backend — developer conveniences.
# The infrastructure (TimescaleDB/Redis/RabbitMQ) runs in ../deploy: `cd ../deploy && make up`.
.DEFAULT_GOAL := help
ENV_FILE := .env

# Load .env for the targets that run something (if it exists).
ifneq (,$(wildcard $(ENV_FILE)))
include $(ENV_FILE)
export
endif

GOOSE_DBSTRING ?= $(HELSA_DATABASE_URL)

.PHONY: help generate build run-api run-worker migrate smoke test tidy lint security docker

# golangci-lint, govulncheck and gosec are installed with `go install`, so they land
# in GOPATH/bin — which is usually not on PATH. Resolve it once for the targets below.
GOBIN := $(shell go env GOBIN)
ifeq ($(GOBIN),)
GOBIN := $(shell go env GOPATH)/bin
endif

help: ## List the commands
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

$(ENV_FILE):
	@cp .env.example .env && echo "Created .env"

generate: ## Code generation: oapi-codegen + sqlc
	go generate ./...
	go tool github.com/pressly/goose/v3/cmd/goose version >/dev/null 2>&1 || true
	sqlc generate

build: ## Build both binaries into ./bin
	go build -o bin/helsa-api ./cmd/api
	go build -o bin/helsa-worker ./cmd/worker

run-api: $(ENV_FILE) ## Start the API server
	go run ./cmd/api

run-worker: $(ENV_FILE) ## Start the ingestion worker
	go run ./cmd/worker

migrate: ## Apply the goose migrations (idempotent against an already bootstrapped schema)
	GOOSE_DRIVER=postgres GOOSE_DBSTRING="$(GOOSE_DBSTRING)" GOOSE_MIGRATION_DIR=db/migrations go tool goose up

# The smoke suite is not only test/smoke: internal/insights carries the
# database-level tests of the sleep series, and internal/coverage the ones that
# check the day grid is cut in the user's timezone — both need the same live
# Timescale and would be meaningless without it. internal/sourcemerge holds the
# database tests of the source merge (docs/25 F9) for the same reason.
# internal/ingeststat needs only Redis and RabbitMQ: the worker's tally round trip
# and the passive-declare queue depth behind GET /v1/ingest/status. internal/queue
# needs only RabbitMQ: the dead-letter redrive (confirm before ack, unroutable
# publish put back) cannot be shown without a broker. internal/workouts holds the
# database test of GET /v1/workout-intensity: the heart rate is matched to a
# workout by its time window in SQL, and only a live Timescale can show that the
# edges are where the phone puts them.
# internal/latest holds the database test of GET /v1/latest: the newest sample per
# type is a LATERAL index walk, and a summed type's day total must come out
# source-merged, which only the real query can show.
# internal/challenge holds the database test of the phone's uploaded settings
# (migration 00010): "never touched" (NULL) and "deleted every milestone" ('{}')
# have to survive pgx as two different values, and only a real round trip shows
# that they do.
# internal/journal holds the database test of the phone's opt-in journal
# (migration 00011): a re-send replaces, a backfill's sweep keeps exactly the
# rows stamped with its token, and the purge and the user cascade leave nothing.
# internal/ingest holds the database test of deleting by HealthKit UUID from a
# COMPRESSED chunk: only a real Timescale has a decompression limit to hit.
#
# As production connects: production's api and worker log in as helsa_app, not as
# the owner (deploy/init/timescaledb/03-app-role.sql). To run this suite under the
# same privileges, `cd ../deploy && make app-role` (with HELSA_APP_DB_PASSWORD in
# deploy/.env), then point HELSA_DATABASE_URL at helsa_app and
# HELSA_SMOKE_OWNER_DATABASE_URL at the owner — two fixtures (compressing a chunk,
# refreshing a continuous aggregate) are owner-only, and use that second URL.
# Unset, it falls back to HELSA_DATABASE_URL.
SMOKE_PKGS := ./test/smoke ./internal/insights ./internal/coverage ./internal/sourcemerge ./internal/ingeststat ./internal/queue ./internal/workouts ./internal/latest ./internal/challenge ./internal/journal ./internal/ingest

# ⛔ test/smoke runs the API as helsa_app and the worker as helsa_worker — never as
# the owner, whom row-level security does not bind (docs/36 §4.8.8, §9 C17): a smoke
# run as the owner would pass with every policy missing. The two URLs are built from
# the passwords in deploy/.env (`cd ../deploy && make app-role` creates the roles).
DEPLOY_ENV := ../deploy/.env
SMOKE_APP_PW := $(shell sed -n 's/^HELSA_APP_DB_PASSWORD=//p' $(DEPLOY_ENV) 2>/dev/null)
SMOKE_WORKER_PW := $(shell sed -n 's/^HELSA_WORKER_DB_PASSWORD=//p' $(DEPLOY_ENV) 2>/dev/null)
SMOKE_DB := localhost:5433/helsa?sslmode=disable
# -p 1: the packages share ONE database and one samples hypertable, and the ingest
# package's test compresses old chunks and relies on them staying compressed. Run in
# parallel, another package's writes into the same chunk made it fail 2 runs in 3
# (2026-10-28); serially, 3 in 3 pass. Packages, not tests, are what -p serialises.

smoke: $(ENV_FILE) ## E2E smoke: auth -> ingest -> summary (against the running infrastructure)
	@test -n "$(SMOKE_APP_PW)" -a -n "$(SMOKE_WORKER_PW)" || { echo "smoke needs HELSA_APP_DB_PASSWORD and HELSA_WORKER_DB_PASSWORD in $(DEPLOY_ENV), then: cd ../deploy && make app-role"; exit 1; }
	HELSA_SMOKE_API_DATABASE_URL="postgres://helsa_app:$(SMOKE_APP_PW)@$(SMOKE_DB)" \
	HELSA_SMOKE_WORKER_DATABASE_URL="postgres://helsa_worker:$(SMOKE_WORKER_PW)@$(SMOKE_DB)" \
	go test -p 1 -tags smoke -count=1 -v $(SMOKE_PKGS)

test: ## Unit tests
	go test ./...

tidy: ## go mod tidy
	go mod tidy

lint: ## golangci-lint on its own (the quick loop)
	$(GOBIN)/golangci-lint run ./...

# The full gate: lint + reachable known vulnerabilities + our own insecure patterns.
# What each tool is for, and why suppression is per-site, is in the script's header.
security: ## Security scan: golangci-lint + govulncheck + gosec
	./scripts/security-scan.sh

docker: ## Build the backend image locally (it carries api + worker + token)
	docker build -t helsa-backend:dev .
