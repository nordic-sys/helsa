package ingeststat

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/nordic-sys/helsa/backend/internal/api"
)

func TestSanitizeErrorRedactsValues(t *testing.T) {
	// The real one: what encoding/json says about a number a float64 cannot hold.
	var v struct{ X float64 }
	jerr := json.Unmarshal([]byte(`{"X": 1e999}`), &v)
	if jerr == nil {
		t.Fatal("expected a decode error")
	}
	got := SanitizeError(fmt.Errorf("decode message: %w", jerr))
	if strings.Contains(got, "999") {
		t.Errorf("the value leaked: %q", got)
	}
	if !strings.HasPrefix(got, "decode message:") {
		t.Errorf("the shape was lost: %q", got)
	}

	cases := []struct{ in, want string }{
		{
			"failed to encode args[3]: unable to encode 72.5 into binary format for float8 (OID 701)",
			"failed to encode args[#]: unable to encode # into binary format for float8 (OID #)",
		},
		{
			`ERROR: invalid input syntax for type double precision: "abc 12" (SQLSTATE 22P02)`,
			`ERROR: invalid input syntax for type double precision: "…" (SQLSTATE 22P02)`,
		},
		{
			"insert sample 3F2504E0-4F89-11D3-9A0C-0305E82C3301: ERROR: value -12.5e3 out of range (SQLSTATE 22003)",
			"insert sample 3F2504E0-4F89-11D3-9A0C-0305E82C3301: ERROR: value # out of range (SQLSTATE 22003)",
		},
		{
			"begin tx: failed to connect to `host=postgres`: dial tcp 172.18.0.3:5432: connect: connection refused",
			"begin tx: failed to connect to `host=postgres`: dial tcp 172.18.0.3:5432: connect: connection refused",
		},
		{"commit: context deadline exceeded", "commit: context deadline exceeded"},
		{"multi\n  line\terror", "multi line error"},
	}
	for _, c := range cases {
		if got := SanitizeError(errors.New(c.in)); got != c.want {
			t.Errorf("\n in: %q\ngot: %q\nwant %q", c.in, got, c.want)
		}
	}
	if SanitizeError(nil) == "" {
		t.Error("nil error gave an empty message")
	}
}

func TestSanitizeErrorTruncates(t *testing.T) {
	got := SanitizeError(errors.New(strings.Repeat("é", 1000)))
	if n := utf8.RuneCountInString(got); n != MaxErrorLen+1 {
		t.Errorf("length = %d runes, want %d + ellipsis", n, MaxErrorLen)
	}
	if !strings.HasSuffix(got, "…") || !utf8.ValidString(got) {
		t.Errorf("cut badly: %q", got[len(got)-8:])
	}
}

func TestBuildRecentFailures(t *testing.T) {
	id := uuid.New()
	at := now.Add(-time.Hour)
	fs := []Failure{
		{BatchID: id, At: at, Error: "commit: boom", Redriven: 3, Samples: 10, Workouts: 1},
		{BatchID: uuid.Nil, At: at.Add(-time.Hour), Error: "decode message: x"},
	}
	lr := &LastRedrive{At: now.Add(-30 * time.Minute), Moved: 2}
	got := Build(now, depth(0, 1, 1), nil, &Snapshot{Failures: fs, LastRedrive: lr}, nil)

	dl := got.DeadLetter
	if dl == nil || dl.RecentFailures == nil || len(*dl.RecentFailures) != 2 {
		t.Fatalf("recent_failures: %+v", dl)
	}
	f0 := (*dl.RecentFailures)[0]
	if f0.BatchId == nil || *f0.BatchId != id || f0.Items != 11 || f0.Samples != 10 ||
		f0.Redriven != 3 || f0.Error != "commit: boom" || !f0.FailedAt.Equal(at) {
		t.Errorf("first failure: %+v", f0)
	}
	if (*dl.RecentFailures)[1].BatchId != nil {
		t.Error("a message without a batch id must leave batch_id out, not send the nil UUID")
	}
	if dl.LastRedrive == nil || dl.LastRedrive.Moved != 2 || !dl.LastRedrive.At.Equal(lr.At) {
		t.Errorf("last_redrive: %+v", dl.LastRedrive)
	}

	// In JSON: absent when there are none, never an empty array or a null.
	raw, _ := json.Marshal(Build(now, depth(0, 1, 0), nil, &Snapshot{}, nil))
	if strings.Contains(string(raw), "recent_failures") || strings.Contains(string(raw), "last_redrive") {
		t.Errorf("empty failure log was serialised: %s", raw)
	}

	// Stats unreachable → no failure log (it lives in Redis); broker unreachable →
	// no dead_letter block to hang it on.
	got = Build(now, depth(0, 1, 1), nil, nil, errors.New("redis down"))
	if got.DeadLetter == nil || got.DeadLetter.RecentFailures != nil {
		t.Errorf("stats unreachable: %+v", got.DeadLetter)
	}
	got = Build(now, nil, errors.New("no broker"), &Snapshot{Failures: fs}, nil)
	if got.DeadLetter != nil {
		t.Errorf("broker unreachable: %+v", got.DeadLetter)
	}
}

func TestParseFailuresSkipsJunk(t *testing.T) {
	good, _ := json.Marshal(Failure{Error: "x", Samples: 1})
	got := parseFailures([]string{"not json", string(good)})
	if len(got) != 1 || got[0].Samples != 1 {
		t.Errorf("got %+v", got)
	}
	if parseLastRedrive(map[string]string{"at": "yesterday"}) != nil {
		t.Error("an unparsable last redrive must be absent, not a zero time")
	}
}

// A member's view keeps the depth and their own failures, and nothing that tells
// when or how much anybody else uploaded (docs/36 §5.8; Codex R2).
func TestMemberViewHidesEverybodysPace(t *testing.T) {
	eta, n, last := 120, 7, time.Now()
	full := api.IngestStatus{
		EtaSeconds: &eta,
		Throughput: &api.IngestThroughput{Batches: 9},
		Worker:     &api.IngestWorkerStats{BatchesSinceStart: &n, LastBatchAt: &last},
		DeadLetter: &api.IngestDeadLetter{LastRedrive: &api.IngestLastRedrive{At: last, Moved: 2}},
		Queue:      &api.IngestQueueDepth{Ready: 3},
	}
	m := MemberView(full)
	if m.EtaSeconds != nil || m.Throughput != nil || m.Worker.BatchesSinceStart != nil || m.Worker.LastBatchAt != nil || m.DeadLetter.LastRedrive != nil {
		t.Errorf("a member's view still carries the server's pace: %+v", m)
	}
	if m.Queue == nil || m.Queue.Ready != 3 {
		t.Errorf("the depth itself is the member's to see: %+v", m.Queue)
	}
}
