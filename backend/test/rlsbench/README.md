# rlsbench — row-level security on Helsa's own queries

The measurement behind docs/36 §4.8.5 (M1–M6): can a household server keep one
member's rows away from another's **in the database**, as a second line behind the
application's own `WHERE user_id = …`, and what does it cost on Helsa's real queries
(`sourcemerge.BucketQuery`, the latest-value query, the raw series, the small tables)?

⛔ **Synthetic data, throwaway database.** It runs against `helsa_rls` in the LOCAL
dev container (`deploy/` → `make up`), never against a real database. Drop it when done.

## Run

```bash
# 1. the throwaway database, with the schema
docker exec -i helsa-timescaledb psql -U helsa -d helsa -c "CREATE DATABASE helsa_rls"
docker exec -i helsa-timescaledb psql -U helsa -d helsa_rls -c "CREATE EXTENSION timescaledb" -c "CREATE EXTENSION pgcrypto"
GOOSE_DRIVER=postgres GOOSE_DBSTRING="postgres://helsa:helsa_local_dev@localhost:5433/helsa_rls?sslmode=disable" \
  GOOSE_MIGRATION_DIR=db/migrations go tool goose up      # ⚠️ may need a second run: docs/25 F36

# 2. ≈4 million synthetic samples (≈35 s), then the variants (≈1 min, builds an uncompressed copy)
docker exec -i helsa-timescaledb psql -U helsa -d helsa_rls -q < test/rlsbench/seed.sql
docker exec -i helsa-timescaledb psql -U helsa -d helsa_rls -q < test/rlsbench/setup.sql

# 3. the security checks (M1, M3, M5) and the timings (M4, ≈4 min)
go test -tags rlsbench -count=1 -v -timeout 40m ./test/rlsbench/

# 4. clean up
docker exec -i helsa-timescaledb psql -U helsa -d helsa -c "DROP DATABASE helsa_rls"
```

## The variants

| | Role | Reads samples through | Note |
|---|---|---|---|
| today | `helsa_rls_base` | the table | the application's filter only |
| today + transaction | `helsa_rls_base` | the table, inside `BEGIN; set_config(…); …; COMMIT` | what the GUC itself costs |
| (a) | `helsa_rls_api` | `my_samples`, `security_barrier` view | no right on the table |
| (a') | `helsa_rls_api` | `my_samples_nb`, plain view, `current_setting()` in the filter | |
| (a'') | `helsa_rls_api` | `my_samples_ip`, plain view, the filter as a scalar subquery (InitPlan) | |
| (b) | `helsa_rls_api` | `samples_plain`, an uncompressed copy with an RLS policy | |

Why not RLS on `samples` itself: TimescaleDB (2.31) refuses row security on a
compressed hypertable, in either order — docs/36 §9.1.

The results and what they decided are in docs/36 §4.8.8. The timings of a laptop
move ±30 % between runs; read the absolute milliseconds and the plan nodes, not
single percentages.
