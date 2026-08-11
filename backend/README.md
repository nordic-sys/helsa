# backend

The Helsa **Go** backend: the HTTP API and the ingestion worker.

## Layout

```
api/            the OpenAPI 3.1 contract — the single source of truth
cmd/api/        HTTP API
cmd/worker/     queue-consuming ingestion
cmd/token/      device-token CLI (there is no interactive sign-in)
internal/       auth, ingest, samples, summary, workouts, insights, export, store, queue
db/migrations/  goose — tables, hypertable, continuous aggregates
db/queries/     sqlc
test/smoke/     E2E smoke test against the running local stack
```

**Stack:** `chi` + `pgx` + `sqlc` + `goose`, `go-redis`, JWT, RabbitMQ.
**Database:** PostgreSQL + TimescaleDB.

## Getting started

The data services run in [`../deploy`](../deploy):

```bash
cd ../deploy && make up      # TimescaleDB + Redis + RabbitMQ
cd ../backend
cp .env.example .env
make migrate                 # apply the schema
make run-api                 # :8080
make run-worker              # in a second shell
```

`make help` lists everything else.

## Contract-first

`api/openapi.yaml` is the canonical spec, and it is **OpenAPI 3.1**. The generator does
not yet speak 3.1, so `make generate` derives a 3.0-flavour input for it
(`api/openapi.gen.yaml`, gitignored) — the reasoning is at the top of
`scripts/gen-api.sh`. Do not edit `internal/api/api.gen.go` or `internal/db/*.sql.go`
by hand; both are generated.

## Tests

```bash
make test    # unit tests, no infrastructure needed
make smoke   # E2E against the running stack (auth → ingest → summary → reads)
```

The smoke test runs the API and the worker in-process and publishes to a **separate
queue** (`helsa.ingest.smoke`). That isolation is not optional: on the shared queue, a
`make run-worker` running alongside would take the batch, and the smoke test would
silently be measuring somebody else's — possibly stale — binary.
