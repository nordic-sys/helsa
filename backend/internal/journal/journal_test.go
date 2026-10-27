package journal

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

func decode(t *testing.T, body string) api.JournalBatch {
	t.Helper()
	var b api.JournalBatch
	if err := json.Unmarshal([]byte(body), &b); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return b
}

func refuse(t *testing.T, body, want string) {
	t.Helper()
	_, err := Validate(decode(t, body))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("%s was accepted (err %v), want a 400", body, err)
	}
	if !strings.Contains(err.Error(), want) {
		t.Errorf("error %q does not mention %q", err, want)
	}
}

const symptom = `{"source_uuid":"A","data_type":"headache","started_at":"2026-10-20T09:00:00Z","ended_at":"2026-10-20T09:00:00Z","value":3,"event_key":"highHeartRate:X","follow_up_hours":24}`
const mood = `{"source_uuid":"B","data_type":"stateOfMind","started_at":"2026-10-20T20:00:00Z","ended_at":"2026-10-20T20:00:00Z","valence":0.5,"mood_kind":"daily_mood","associations":["work","family"],"day_key":"2026-10-20"}`

func TestAPhoneChunkIsAccepted(t *testing.T) {
	b, err := Validate(decode(t, `{"entries":[`+symptom+`,`+mood+`],"deletions":["C"],"sweep_before":"2026-10-27T10:00:00Z"}`))
	if err != nil {
		t.Fatalf("a well-formed chunk was refused: %v", err)
	}
	if len(b.Entries) != 2 || len(b.Deletions) != 1 || b.SweepBefore == nil {
		t.Errorf("chunk = %+v", b)
	}
}

// An empty body is a legitimate chunk: a backfill of an empty journal still
// has to close with its sweep.
func TestAnEmptyChunkIsAccepted(t *testing.T) {
	if _, err := Validate(decode(t, `{}`)); err != nil {
		t.Errorf("an empty chunk was refused: %v", err)
	}
}

// A newer phone's type is stored, not refused — but a type is still a name.
func TestDataTypeIsAPatternNotAList(t *testing.T) {
	newer := strings.Replace(symptom, `"headache"`, `"someFutureSymptom"`, 1)
	if _, err := Validate(decode(t, `{"entries":[`+newer+`]}`)); err != nil {
		t.Errorf("an unknown but well-formed type was refused: %v", err)
	}
	refuse(t, `{"entries":[`+strings.Replace(symptom, `"headache"`, `"head ache; drop"`, 1)+`]}`, "data type")
}

func TestExactlyOneOfValueAndValence(t *testing.T) {
	both := strings.Replace(symptom, `"value":3`, `"value":3,"valence":0.2`, 1)
	refuse(t, `{"entries":[`+both+`]}`, "exactly one")
	neither := strings.Replace(symptom, `"value":3,`, ``, 1)
	refuse(t, `{"entries":[`+neither+`]}`, "exactly one")
}

func TestMoodFieldsBelongToAMood(t *testing.T) {
	tagged := strings.Replace(symptom, `"value":3`, `"value":3,"associations":["work"]`, 1)
	refuse(t, `{"entries":[`+tagged+`]}`, "state of mind only")
	refuse(t, `{"entries":[`+strings.Replace(mood, `0.5`, `1.5`, 1)+`]}`, "valence")
	refuse(t, `{"entries":[`+strings.Replace(mood, `daily_mood`, `weekly`, 1)+`]}`, "mood_kind")
}

func TestAnIntervalCannotEndBeforeItStarts(t *testing.T) {
	back := strings.Replace(symptom, `"ended_at":"2026-10-20T09:00:00Z"`, `"ended_at":"2026-10-20T08:00:00Z"`, 1)
	refuse(t, `{"entries":[`+back+`]}`, "before started_at")
	old := strings.Replace(symptom, `2026-10-20T09:00:00Z","ended_at`, `1970-01-01T00:00:00Z","ended_at`, 1)
	refuse(t, `{"entries":[`+old+`]}`, "2000–2100")
}

func TestFollowUpIsOneOfTheTwoStages(t *testing.T) {
	refuse(t, `{"entries":[`+strings.Replace(symptom, `"follow_up_hours":24`, `"follow_up_hours":12`, 1)+`]}`, "follow_up_hours")
}

// The same uuid twice in one chunk would make the upsert touch one row twice
// in one statement — and it is a client bug either way.
func TestADuplicateUUIDInOneChunkIsRefused(t *testing.T) {
	refuse(t, `{"entries":[`+symptom+`,`+symptom+`]}`, "appears twice")
}

func TestAnOversizedChunkIs413(t *testing.T) {
	dels := make([]string, MaxItems+1)
	for i := range dels {
		dels[i] = "x"
	}
	_, err := Validate(api.JournalBatch{Deletions: &dels})
	if !errors.Is(err, ErrTooLarge) {
		t.Errorf("err = %v, want ErrTooLarge", err)
	}
}

func TestADeletionIsAUUID(t *testing.T) {
	refuse(t, `{"deletions":[""]}`, "deletion")
}
