package export

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// fakeSource is an in-memory data source — it makes the formatting checkable
// without a database.
type fakeSource struct {
	samples  []SampleRow
	workouts []WorkoutRow
	sleep    []SleepRow
	err      error
}

func (f *fakeSource) Samples(_ context.Context, _ uuid.UUID, _ Request, fn func(SampleRow) error) error {
	if f.err != nil {
		return f.err
	}
	for _, r := range f.samples {
		if err := fn(r); err != nil {
			return err
		}
	}
	return nil
}

func (f *fakeSource) Workouts(_ context.Context, _ uuid.UUID, _ Request, fn func(WorkoutRow) error) error {
	for _, r := range f.workouts {
		if err := fn(r); err != nil {
			return err
		}
	}
	return nil
}

func (f *fakeSource) Sleep(_ context.Context, _ uuid.UUID, _ Request, fn func(SleepRow) error) error {
	for _, r := range f.sleep {
		if err := fn(r); err != nil {
			return err
		}
	}
	return nil
}

func f64(v float64) *float64 { return &v }
func str(v string) *string   { return &v }

func testRequest(format Format) Request {
	return Request{
		Format: format,
		Start:  time.Date(2026, 8, 1, 0, 0, 0, 0, time.UTC),
		End:    time.Date(2026, 8, 11, 0, 0, 0, 0, time.UTC),
		TZ:     "Europe/Budapest",
	}
}

func TestValidateRejectsBadFormatsAndRanges(t *testing.T) {
	req := testRequest(FormatCSV)
	if err := req.Validate(); err != nil {
		t.Errorf("a valid CSV request was rejected: %v", err)
	}

	req.Format = FormatPDF
	if err := req.Validate(); !errors.Is(err, ErrPDFNotSupported) {
		// pdf is in the contract but not implemented — the caller has to answer 501
		// instead of 400, which is why a DISTINCT error is needed.
		t.Errorf("pdf: %v, expected ErrPDFNotSupported", err)
	}

	req.Format = "xlsx"
	if err := req.Validate(); err == nil || errors.Is(err, ErrPDFNotSupported) {
		t.Errorf("unknown format: %v", err)
	}

	req = testRequest(FormatJSON)
	req.End = req.Start
	if err := req.Validate(); err == nil {
		t.Error("an empty time span: expected an error")
	}
}

func TestFilenameAndContentType(t *testing.T) {
	req := testRequest(FormatCSV)
	// Through the user's eyes, the half-open end (Aug 11) runs until Aug 10.
	if got, want := req.Filename(), "helsa-export-20260801_20260810.csv"; got != want {
		t.Errorf("Filename() = %q, expected %q", got, want)
	}
	if !strings.HasPrefix(req.ContentType(), "text/csv") {
		t.Errorf("ContentType() = %q", req.ContentType())
	}
	req.Format = FormatJSON
	if !strings.HasPrefix(req.ContentType(), "application/json") {
		t.Errorf("ContentType() = %q", req.ContentType())
	}
}

func TestCSVExportShapeAndScaling(t *testing.T) {
	ts := time.Date(2026, 8, 10, 6, 30, 0, 0, time.UTC)
	src := &fakeSource{samples: []SampleRow{
		{Ts: ts, DataType: "stepCount", Value: f64(812), Unit: str("count"), SourceDevice: str("iphone")},
		{Ts: ts.Add(time.Hour), DataType: "bodyFatPercentage", Value: f64(0.19238333), Unit: str("%")},
		// A NULL value: it must stay an empty cell, not a 0.
		{Ts: ts.Add(2 * time.Hour), DataType: "heartRate"},
	}}

	var buf bytes.Buffer
	if err := Write(context.Background(), &buf, src, uuid.New(), testRequest(FormatCSV)); err != nil {
		t.Fatalf("write: %v", err)
	}

	recs, err := csv.NewReader(&buf).ReadAll()
	if err != nil {
		t.Fatalf("the output is not valid CSV: %v", err)
	}
	if len(recs) != 4 {
		t.Fatalf("%d rows, expected 4 (header + 3 samples)", len(recs))
	}
	if got := strings.Join(recs[0], ","); got != "ts,data_type,value,unit,source_device" {
		t.Errorf("header = %q", got)
	}
	if recs[1][2] != "812" {
		t.Errorf("step value = %q, expected 812 (without needless decimals)", recs[1][2])
	}
	if !strings.HasPrefix(recs[2][2], "19.23") {
		t.Errorf("body fat = %q, expected ~19.24 (the 0…100 scale)", recs[2][2])
	}
	if recs[3][2] != "" {
		t.Errorf("NULL value = %q, expected an empty cell", recs[3][2])
	}
	if recs[1][0] != "2026-08-10T06:30:00Z" {
		t.Errorf("timestamp = %q, expected UTC RFC3339", recs[1][0])
	}
}

// An empty export must still be a valid file: with a header, not zero bytes —
// otherwise "no data" looks exactly like a failed download.
func TestCSVExportWithNoRowsStillHasHeader(t *testing.T) {
	var buf bytes.Buffer
	if err := Write(context.Background(), &buf, &fakeSource{}, uuid.New(), testRequest(FormatCSV)); err != nil {
		t.Fatalf("write: %v", err)
	}
	if got := strings.TrimSpace(buf.String()); got != "ts,data_type,value,unit,source_device" {
		t.Errorf("empty export = %q", got)
	}
}

func TestJSONExportIsValidAndComplete(t *testing.T) {
	ts := time.Date(2026, 8, 10, 6, 30, 0, 0, time.UTC)
	src := &fakeSource{
		samples: []SampleRow{
			{Ts: ts, DataType: "stepCount", Value: f64(812), Unit: str("count")},
			{Ts: ts, DataType: "oxygenSaturation", Value: f64(0.97), Unit: str("%")},
		},
		workouts: []WorkoutRow{
			{SourceUUID: "wo-1", ActivityType: "running", StartedAt: ts, TotalEnergyKcal: f64(410)},
		},
		sleep: []SleepRow{
			{StartedAt: ts.Add(-8 * time.Hour), EndedAt: ts, Stage: "asleepCore"},
		},
	}
	req := testRequest(FormatJSON)
	req.Metrics = []string{"stepCount", "oxygenSaturation"}

	var buf bytes.Buffer
	if err := Write(context.Background(), &buf, src, uuid.New(), req); err != nil {
		t.Fatalf("write: %v", err)
	}

	var got struct {
		Meta     Meta         `json:"meta"`
		Samples  []JSONSample `json:"samples"`
		Workouts []struct {
			SourceUUID string `json:"source_uuid"`
		} `json:"workouts"`
		Sleep []struct {
			Stage string `json:"stage"`
		} `json:"sleep_segments"`
	}
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("the output is not valid JSON: %v\n%s", err, buf.String())
	}
	if len(got.Samples) != 2 || len(got.Workouts) != 1 || len(got.Sleep) != 1 {
		t.Fatalf("samples=%d workouts=%d sleep=%d", len(got.Samples), len(got.Workouts), len(got.Sleep))
	}
	if got.Meta.From != "2026-08-01" || got.Meta.To != "2026-08-10" {
		t.Errorf("meta time span = %s..%s", got.Meta.From, got.Meta.To)
	}
	if got.Meta.TZ != "Europe/Budapest" {
		t.Errorf("meta tz = %q", got.Meta.TZ)
	}
	// Percentages are scaled here too — otherwise the CSV and the JSON would say
	// different things.
	for _, s := range got.Samples {
		if s.DataType == "oxygenSaturation" {
			if s.Value == nil || *s.Value < 96.9 || *s.Value > 97.1 {
				t.Errorf("oxygenSaturation = %v, expected ~97", s.Value)
			}
		}
	}
}

// Empty arrays must be valid JSON too (`[]`, not a missing key) — this is the most
// common bug in a hand-assembled streaming output.
func TestJSONExportWithNoRowsIsStillValid(t *testing.T) {
	var buf bytes.Buffer
	if err := Write(context.Background(), &buf, &fakeSource{}, uuid.New(), testRequest(FormatJSON)); err != nil {
		t.Fatalf("write: %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(buf.Bytes(), &got); err != nil {
		t.Fatalf("not valid JSON: %v\n%s", err, buf.String())
	}
	for _, key := range []string{"meta", "samples", "workouts", "sleep_segments"} {
		if _, ok := got[key]; !ok {
			t.Errorf("missing key: %s", key)
		}
	}
	if string(got["samples"]) != "[]" {
		t.Errorf("samples = %s, expected []", got["samples"])
	}
}

// An error from the source must not be swallowed: it is how the caller learns the
// download is truncated.
func TestWritePropagatesSourceErrors(t *testing.T) {
	boom := errors.New("connection lost")
	var buf bytes.Buffer
	err := Write(context.Background(), &buf, &fakeSource{err: boom}, uuid.New(), testRequest(FormatCSV))
	if !errors.Is(err, boom) {
		t.Errorf("err = %v, expected %v", err, boom)
	}
}

func TestMetaForSortsMetricsAndKeepsEmptyListNonNil(t *testing.T) {
	req := testRequest(FormatJSON)
	req.Metrics = []string{"stepCount", "heartRate"}
	m := MetaFor(req, time.Now())
	if m.Metrics[0] != "heartRate" {
		t.Errorf("the metrics are not sorted: %v", m.Metrics)
	}

	req.Metrics = nil
	m = MetaFor(req, time.Now())
	if m.Metrics == nil {
		t.Error("a missing metric list must be [] on the wire, not null")
	}
}
