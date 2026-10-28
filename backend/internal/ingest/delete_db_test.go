//go:build smoke

// Deleting samples by HealthKit UUID from a COMPRESSED chunk, against a real
// Timescale.
//
// A real server with four million samples dead-lettered every batch carrying a
// deletion: "tuple decompression limit exceeded". The delete named only user_id
// and source_uuid, so Timescale had to decompress all of the user's compressed
// batches. This pins that a deletion into compressed history goes through, takes
// exactly the named rows, and does so while the limit is set far below the size
// of the user's history.
package ingest

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("HELSA_DATABASE_URL")
	if url == "" {
		url = "postgres://helsa:helsa_local_dev@localhost:5433/helsa?sslmode=disable"
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatalf("parse the database url: %v", err)
	}
	// The guard this test is about, set low for every connection: well below the
	// rows the user holds, so a delete that decompresses the whole history fails.
	cfg.ConnConfig.RuntimeParams["timescaledb.max_tuples_decompressed_per_dml_transaction"] = "500"
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatalf("open the database: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("the database is not reachable (%s): %v — start it with `cd deploy && make up`", url, err)
	}
	return pool
}

func TestDeletingFromCompressedHistoryTakesOnlyTheNamedRows(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)

	var uid uuid.UUID
	if err := pool.QueryRow(ctx,
		`INSERT INTO users (apple_sub, time_zone) VALUES ($1, 'Europe/Budapest') RETURNING id`,
		fmt.Sprintf("ingest-delete-test-%d", time.Now().UnixNano())).Scan(&uid); err != nil {
		t.Fatalf("create user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM samples WHERE user_id = $1`, pgconv.UUID(uid))
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, pgconv.UUID(uid))
	})

	// Two years ago, so far past the 30-day compression policy: 3,000 heart-rate
	// samples a minute apart, plus one step sample, the row the phone deletes.
	base := time.Now().UTC().AddDate(-2, 0, 0).Truncate(24 * time.Hour)
	if _, err := pool.Exec(ctx, `
		INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid)
		SELECT $1, $2::timestamptz + make_interval(mins => g), 'heartRate', 60, 'count/min', 'hr-' || g
		FROM generate_series(1, 3000) AS g`, pgconv.UUID(uid), base); err != nil {
		t.Fatalf("insert heart rate: %v", err)
	}
	target := "steps-to-delete"
	if _, err := pool.Exec(ctx, `
		INSERT INTO samples (user_id, ts, data_type, value, unit, source_uuid)
		VALUES ($1, $2, 'stepCount', 1200, 'count', $3)`, pgconv.UUID(uid), base.Add(90*time.Minute), target); err != nil {
		t.Fatalf("insert the target: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		SELECT compress_chunk(c, if_not_compressed => true)
		FROM show_chunks('samples', older_than => now() - INTERVAL '1 year') AS c`); err != nil {
		t.Fatalf("compress: %v", err)
	}

	// The guard is live: the old statement — user and UUID only — fails on this
	// very history. Without this the test could pass on a server that never
	// compressed anything.
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	_, oldErr := tx.Exec(ctx, `DELETE FROM samples WHERE user_id = $1 AND source_uuid = ANY($2::text[])`,
		pgconv.UUID(uid), []string{"hr-5"})
	_ = tx.Rollback(ctx)
	if oldErr == nil {
		t.Fatalf("the UUID-only delete went through: the chunk is not compressed or the limit is not set, so this test proves nothing")
	}

	ids := []string{target, "not-a-sample-at-all"}
	body, _ := json.Marshal(Message{UserID: uid, BatchID: uuid.New(), Batch: api.IngestBatch{Deletions: &ids}})
	if _, err := Process(ctx, pool, nil, body); err != nil {
		t.Fatalf("a deletion into compressed history must go through: %v", err)
	}

	var left, hr int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE source_uuid = $2), count(*) FILTER (WHERE data_type = 'heartRate')
		FROM samples WHERE user_id = $1`, pgconv.UUID(uid), target).Scan(&left, &hr); err != nil {
		t.Fatalf("count: %v", err)
	}
	if left != 0 {
		t.Errorf("the deleted sample is still there (%d)", left)
	}
	if hr != 3000 {
		t.Errorf("heart-rate rows = %d, want 3000 untouched", hr)
	}
}
