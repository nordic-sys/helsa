package ingest

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/api"
	"github.com/nordic-sys/helsa/backend/internal/pgconv"
)

// The client sends the HKWorkout.uuid; the query resolves the server-side
// workouts.id. All the mapping has to do is not lose the raw reference (2A.7).
func TestSampleParamsCarriesWorkoutSourceUUID(t *testing.T) {
	uid := pgconv.UUID(uuid.New())
	src := "AAAA-BBBB-workout"
	val := float32(62)
	unit := "count/min"
	dev := api.SampleInSourceDevice("watch")

	p := sampleParams(uid, api.SampleIn{
		SourceUuid:        "sample-1",
		DataType:          "heartRate",
		Ts:                time.Now(),
		Value:             &val,
		Unit:              &unit,
		SourceDevice:      &dev,
		WorkoutSourceUuid: &src,
	})
	if p.WorkoutSourceUuid == nil || *p.WorkoutSourceUuid != src {
		t.Fatalf("workout_source_uuid was lost: %+v", p.WorkoutSourceUuid)
	}
	if p.Value == nil || *p.Value != 62 {
		t.Errorf("value float32→float64: %+v", p.Value)
	}
	if p.SourceDevice == nil || *p.SourceDevice != "watch" {
		t.Errorf("source_device: %+v", p.SourceDevice)
	}
}

func TestSampleParamsWithoutWorkout(t *testing.T) {
	p := sampleParams(pgconv.UUID(uuid.New()), api.SampleIn{
		SourceUuid: "sample-2", DataType: "stepCount", Ts: time.Now(),
	})
	if p.WorkoutSourceUuid != nil {
		t.Errorf("a sample without a workout must carry no reference: %+v", p.WorkoutSourceUuid)
	}
}

func TestValidate(t *testing.T) {
	if err := Validate(&api.IngestBatch{}); err == nil {
		t.Error("an empty batch must be an error")
	}
	one := []api.SampleIn{{SourceUuid: "x", DataType: "stepCount", Ts: time.Now()}}
	if err := Validate(&api.IngestBatch{Samples: &one}); err != nil {
		t.Errorf("a one-item batch is valid: %v", err)
	}
	tooMany := make([]api.SampleIn, MaxSamples+1)
	if err := Validate(&api.IngestBatch{Samples: &tooMany}); err == nil {
		t.Error("above the size limit an error is expected")
	}
	// A chunk carrying nothing but deletions is valid too (HealthKit deletedObjects).
	dels := []string{"deleted-uuid"}
	if err := Validate(&api.IngestBatch{Deletions: &dels}); err != nil {
		t.Errorf("a deletions-only batch is valid: %v", err)
	}
}
