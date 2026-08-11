// Package export dumps your own data as CSV and JSON (docs/13).
//
// # Why SYNCHRONOUS, and why there is no job table
//
// docs/13 §3 sketches an asynchronous branch (queue + worker + object store), but
// the document itself says that "for a start, synchronous CSV/JSON is plenty" —
// and there is no object store anyway (MinIO is EOL —
// [[minio-needs-alternative]]). So the response here IS the file, DIRECTLY and
// STREAMED: rows go from the database cursor onto the network, never piling up
// in memory. Size is therefore not the limit, only time — and if the full
// history ever really does time out, THEN a job makes sense, not before.
//
// A job table today would be pure loss: it would store state about something
// that has already happened.
package export

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/metrics"
)

// Format lists the supported output formats.
type Format string

const (
	FormatCSV  Format = "csv"
	FormatJSON Format = "json"
	FormatPDF  Format = "pdf"
)

// DefaultDays: without from/to we export this many days backwards. Not the full
// history, because a request with no parameters rarely means "everything".
const DefaultDays = 30

// Request is the resolved (validated) form of an export request.
type Request struct {
	Format  Format
	Metrics []string // empty → all of the user's metrics within the window
	Start   time.Time
	End     time.Time // half-open: [Start, End)
	TZ      string
}

// SampleRow / WorkoutRow / SleepRow: the raw rows handed over by the source.
type SampleRow struct {
	Ts           time.Time
	DataType     string
	Value        *float64
	Unit         *string
	SourceDevice *string
	SourceUUID   string
}

type WorkoutRow struct {
	SourceUUID      string
	ActivityType    string
	StartedAt       time.Time
	EndedAt         *time.Time
	TotalEnergyKcal *float64
	TotalDistanceM  *float64
}

type SleepRow struct {
	StartedAt time.Time
	EndedAt   time.Time
	Stage     string
}

// Source is the export's data source. The database implementation lives in
// store.go; the tests supply their own in-memory source — which is what makes
// the formatting checkable without a database.
//
// The callback-based shape is deliberate: it is what forces the rows not to pile
// up in a slice, but to flow continuously into the response.
type Source interface {
	Samples(ctx context.Context, userID uuid.UUID, req Request, fn func(SampleRow) error) error
	Workouts(ctx context.Context, userID uuid.UUID, req Request, fn func(WorkoutRow) error) error
	Sleep(ctx context.Context, userID uuid.UUID, req Request, fn func(SleepRow) error) error
}

// Validate checks the request's format and time span.
func (r Request) Validate() error {
	switch r.Format {
	case FormatCSV, FormatJSON:
	case FormatPDF:
		return ErrPDFNotSupported
	default:
		return fmt.Errorf("unknown format: %q", r.Format)
	}
	if !r.End.After(r.Start) {
		return fmt.Errorf("`to` must be later than `from`")
	}
	return nil
}

// ErrPDFNotSupported: the contract knows about pdf (docs/13 §2, "later"), but it
// is not implemented. A distinct error so the caller can answer 501 instead of
// 400 — the difference being that the request is correct, the server just cannot
// do it yet.
var ErrPDFNotSupported = fmt.Errorf("PDF export is not implemented yet")

// Filename is the file name suggested for the download.
func (r Request) Filename() string {
	// Through the user's eyes `to` is the LAST day, not the half-open end.
	last := r.End.AddDate(0, 0, -1)
	return fmt.Sprintf("helsa-export-%s_%s.%s",
		r.Start.Format("20060102"), last.Format("20060102"), r.Format)
}

// ContentType is the response's MIME type.
func (r Request) ContentType() string {
	if r.Format == FormatJSON {
		return "application/json; charset=utf-8"
	}
	return "text/csv; charset=utf-8"
}

// Write writes the export into w in the requested format.
func Write(ctx context.Context, w io.Writer, src Source, userID uuid.UUID, req Request) error {
	if req.Format == FormatJSON {
		return writeJSON(ctx, w, src, userID, req)
	}
	return writeCSV(ctx, w, src, userID, req)
}

// --- CSV ---
//
// Long format: one sample per row. The wide shape (a column per metric) is
// tempting in Excel, but timestamps differ from metric to metric — so a wide
// table either lies (a rounded time grid) or is full of empty cells.
var csvHeader = []string{"ts", "data_type", "value", "unit", "source_device"}

func writeCSV(ctx context.Context, w io.Writer, src Source, userID uuid.UUID, req Request) error {
	cw := csv.NewWriter(w)
	if err := cw.Write(csvHeader); err != nil {
		return err
	}
	err := src.Samples(ctx, userID, req, func(row SampleRow) error {
		if err := cw.Write(CSVRecord(row)); err != nil {
			return err
		}
		// Flush per row: the client sees the first rows immediately, and the buffer
		// does not grow during a long export.
		cw.Flush()
		return cw.Error()
	})
	if err != nil {
		return err
	}
	cw.Flush()
	return cw.Error()
}

// CSVRecord is one sample's CSV row. Values in `%` go out as 0…100 here too —
// the same convention as in the /summary and /samples responses (docs/23
// §3.0.1).
func CSVRecord(row SampleRow) []string {
	rec := []string{row.Ts.UTC().Format(time.RFC3339), row.DataType, "", "", ""}
	if row.Value != nil {
		rec[2] = formatFloat(metrics.ToWire(row.DataType, *row.Value))
	}
	if u := metrics.Meta(row.DataType).Unit; u != "" {
		rec[3] = u
	} else if row.Unit != nil {
		rec[3] = *row.Unit
	}
	if row.SourceDevice != nil {
		rec[4] = *row.SourceDevice
	}
	return rec
}

// formatFloat: no exponent in the usual range, and no needless trailing decimal
// zeros (8412.0 should stay 8412, not become 8412.000000).
func formatFloat(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}

// --- JSON ---

// Meta is the export's header: what, for when, in which timezone.
type Meta struct {
	GeneratedAt time.Time `json:"generated_at"`
	From        string    `json:"from"`
	To          string    `json:"to"`
	TZ          string    `json:"tz"`
	Metrics     []string  `json:"metrics"`
	Note        string    `json:"note"`
}

// MetaFor builds the header from the request.
func MetaFor(req Request, now time.Time) Meta {
	m := Meta{
		GeneratedAt: now.UTC(),
		From:        req.Start.Format("2006-01-02"),
		To:          req.End.AddDate(0, 0, -1).Format("2006-01-02"),
		TZ:          req.TZ,
		Metrics:     req.Metrics,
		Note: "Values in percent units are in the 0…100 range (HealthKit gives 0…1); " +
			"all timestamps are UTC.",
	}
	if m.Metrics == nil {
		m.Metrics = []string{}
	}
	sort.Strings(m.Metrics)
	return m
}

// JSONSample is the sample shape of the JSON export (field names matching the
// wire Sample).
type JSONSample struct {
	Ts           time.Time `json:"ts"`
	DataType     string    `json:"data_type"`
	Value        *float64  `json:"value,omitempty"`
	Unit         string    `json:"unit,omitempty"`
	SourceDevice *string   `json:"source_device,omitempty"`
}

// ToJSONSample turns a raw row into its wire shape (scaled value, catalog unit).
func ToJSONSample(row SampleRow) JSONSample {
	out := JSONSample{Ts: row.Ts.UTC(), DataType: row.DataType, SourceDevice: row.SourceDevice}
	if row.Value != nil {
		v := metrics.ToWire(row.DataType, *row.Value)
		out.Value = &v
	}
	if u := metrics.Meta(row.DataType).Unit; u != "" {
		out.Unit = u
	} else if row.Unit != nil {
		out.Unit = *row.Unit
	}
	return out
}

type jsonWorkout struct {
	SourceUUID      string     `json:"source_uuid"`
	ActivityType    string     `json:"activity_type"`
	StartedAt       time.Time  `json:"started_at"`
	EndedAt         *time.Time `json:"ended_at,omitempty"`
	TotalEnergyKcal *float64   `json:"total_energy_kcal,omitempty"`
	TotalDistanceM  *float64   `json:"total_distance_m,omitempty"`
}

type jsonSleep struct {
	StartedAt time.Time `json:"started_at"`
	EndedAt   time.Time `json:"ended_at"`
	Stage     string    `json:"stage"`
}

// writeJSON assembles the wrapping object by hand so that the array elements can
// go out STREAMED: marshalling one big struct would pull the whole thing into
// memory, which is exactly what the entire streaming path exists to avoid.
func writeJSON(ctx context.Context, w io.Writer, src Source, userID uuid.UUID, req Request) error {
	enc := json.NewEncoder(w)
	meta, err := json.Marshal(MetaFor(req, time.Now()))
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(w, `{"meta":%s,"samples":[`, meta); err != nil {
		return err
	}
	first := true
	sep := func() error {
		if first {
			first = false
			return nil
		}
		_, err := io.WriteString(w, ",")
		return err
	}
	err = src.Samples(ctx, userID, req, func(row SampleRow) error {
		if err := sep(); err != nil {
			return err
		}
		return enc.Encode(ToJSONSample(row))
	})
	if err != nil {
		return err
	}

	if _, err := io.WriteString(w, `],"workouts":[`); err != nil {
		return err
	}
	first = true
	err = src.Workouts(ctx, userID, req, func(row WorkoutRow) error {
		if err := sep(); err != nil {
			return err
		}
		// Field-for-field match: the conversion only swaps the JSON tags.
		return enc.Encode(jsonWorkout(row))
	})
	if err != nil {
		return err
	}

	if _, err := io.WriteString(w, `],"sleep_segments":[`); err != nil {
		return err
	}
	first = true
	err = src.Sleep(ctx, userID, req, func(row SleepRow) error {
		if err := sep(); err != nil {
			return err
		}
		return enc.Encode(jsonSleep(row))
	})
	if err != nil {
		return err
	}
	_, err = io.WriteString(w, "]}")
	return err
}
