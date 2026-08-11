// Package samples serves the raw sample reads behind /v1/samples with HAND-WRITTEN
// pgx.
//
// Why not sqlc? The same reason as in workouts: keyset pagination with optional
// time filters, i.e. a WHERE clause that varies. sqlc expects a static query,
// whereas here the parameter list is assembled from the request; on top of that
// it would also mistype the nullability of the NULL-able value/unit columns.
//
// The cursor rides on the (ts, source_uuid) pair — exactly the non-partitioning
// part of the samples primary key (user_id, ts, source_uuid), which is why
// pagination stays deterministic even when several samples share one timestamp
// (e.g. multiple source devices).
package samples

import (
	"context"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/metrics"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

const (
	// The contract's default is 500, its maximum 2000 (api/openapi.yaml /samples).
	DefaultLimit = 500
	MaxLimit     = 2000
)

// Query holds the parameters of one paginated sample read.
type Query struct {
	DataType string
	From     *time.Time
	To       *time.Time
	Cursor   string
	Limit    int
}

type Service struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// List returns one keyset-paginated page of samples, newest first. An empty
// cursor means the first page.
func (s *Service) List(ctx context.Context, userID uuid.UUID, q Query) (api.SamplePage, error) {
	if q.DataType == "" {
		return api.SamplePage{}, fmt.Errorf("data_type is required")
	}
	limit := ClampLimit(q.Limit)

	beforeTs, beforeUUID, err := decodeCursor(q.Cursor)
	if err != nil {
		return api.SamplePage{}, fmt.Errorf("malformed cursor: %w", err)
	}

	sql, args := buildQuery(userID, q.DataType, q.From, q.To, beforeTs, beforeUUID, limit)
	rows, err := s.pool.Query(ctx, sql, args...)
	if err != nil {
		return api.SamplePage{}, fmt.Errorf("samples query: %w", err)
	}
	defer rows.Close()

	items := []api.Sample{}
	// source_uuid does not go into the wire DTO (the client has no use for it), but
	// the cursor needs it, so we track it in parallel.
	keys := []string{}
	for rows.Next() {
		var (
			ts           pgtype.Timestamptz
			dataType     string
			value        *float64
			unit         *string
			sourceDevice *string
			sourceUUID   string
		)
		if err := rows.Scan(&ts, &dataType, &value, &unit, &sourceDevice, &sourceUUID); err != nil {
			return api.SamplePage{}, fmt.Errorf("scan sample: %w", err)
		}
		items = append(items, toDTO(ts.Time, dataType, value, unit, sourceDevice))
		keys = append(keys, sourceUUID)
	}
	if err := rows.Err(); err != nil {
		return api.SamplePage{}, err
	}

	page := api.SamplePage{}
	if len(items) > limit {
		// The limit+1-th row only signals that there IS another page — we do not hand
		// it out, and we point the cursor at the last row we KEPT.
		items = items[:limit]
		next := encodeCursor(*items[limit-1].Ts, keys[limit-1])
		page.NextCursor = &next
	}
	page.Items = &items
	return page, nil
}

// ClampLimit squeezes the requested limit into the range the contract allows.
// A 0 (a missing parameter) means the default, not an empty page.
func ClampLimit(limit int) int {
	if limit <= 0 {
		return DefaultLimit
	}
	if limit > MaxLimit {
		return MaxLimit
	}
	return limit
}

// toDTO turns one row into a wire sample.
//
// Two deliberate decisions:
//   - Percentage values are scaled to 0…100 HERE too, just as in the summary. If
//     one endpoint said 19.2 and the other 0.19, that would be worse than a
//     consistent mistake (docs/23 §3.0.1).
//   - The unit comes from the CATALOG whenever we know the type: the server's unit
//     wins, and the stored (client-supplied) one is only a fallback for an unknown
//     type.
func toDTO(ts time.Time, dataType string, value *float64, unit, sourceDevice *string) api.Sample {
	out := api.Sample{Ts: &ts, DataType: &dataType, SourceDevice: sourceDevice}
	if value != nil {
		v := float32(metrics.ToWire(dataType, *value))
		out.Value = &v
	}
	if u := metrics.Meta(dataType).Unit; u != "" {
		out.Unit = &u
	} else if unit != nil {
		out.Unit = unit
	}
	return out
}

// buildQuery assembles the WHERE clause from the given filters. The limit+1 is
// what decides whether there is another page.
func buildQuery(userID uuid.UUID, dataType string, from, to *time.Time, beforeTs time.Time, beforeUUID string, limit int) (string, []any) {
	args := []any{
		pgconv.UUID(userID),
		dataType,
		pgconv.Timestamptz(beforeTs),
		beforeUUID,
	}
	var b strings.Builder
	b.WriteString(`SELECT ts, data_type, value, unit, source_device, source_uuid
FROM samples
WHERE user_id = $1
  AND data_type = $2
  AND (ts < $3 OR (ts = $3 AND source_uuid < $4))`)
	if from != nil {
		args = append(args, pgconv.Timestamptz(*from))
		fmt.Fprintf(&b, "\n  AND ts >= $%d", len(args))
	}
	if to != nil {
		args = append(args, pgconv.Timestamptz(*to))
		fmt.Fprintf(&b, "\n  AND ts < $%d", len(args))
	}
	args = append(args, limit+1)
	fmt.Fprintf(&b, "\nORDER BY ts DESC, source_uuid DESC\nLIMIT $%d", len(args))
	return b.String(), args
}

// --- cursor: base64url(RFC3339Nano "|" source_uuid) ---

func encodeCursor(ts time.Time, sourceUUID string) string {
	raw := ts.UTC().Format(time.RFC3339Nano) + "|" + sourceUUID
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// decodeCursor returns an "infinity" sentinel for an empty cursor (on the first
// page every row is earlier).
func decodeCursor(cursor string) (time.Time, string, error) {
	if cursor == "" {
		// The maximum timestamp plus the largest possible source_uuid → every real
		// row is "smaller". In byte order ￿ sits above every practical UUID string.
		return time.Date(9999, 12, 31, 23, 59, 59, 0, time.UTC), "￿", nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 {
		return time.Time{}, "", fmt.Errorf("bad cursor format")
	}
	ts, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, "", err
	}
	return ts, parts[1], nil
}
