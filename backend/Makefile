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

.PHONY: help generate build run-api run-worker migrate smoke test tidy lint docker

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
# database-level tests of the sleep series, which need the same live Timescale
# and would be meaningless without it.
SMOKE_PKGS := ./test/smoke ./internal/insights

smoke: $(ENV_FILE) ## E2E smoke: auth -> ingest -> summary (against the running infrastructure)
	HELSA_AUTH_DEV_MODE=true go test -tags smoke -count=1 -v $(SMOKE_PKGS)

test: ## Unit tests
	go test ./...

tidy: ## go mod tidy
	go mod tidy

docker: ## Build the backend image locally (it carries api + worker + token)
	docker build -t helsa-backend:dev .
