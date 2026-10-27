package ingeststat

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// # Why the worker writes down its failures
//
// A dead-lettered batch used to leave one trace: a log line in the worker's
// container. The status page could say "1 batch in the dead-letter queue" and
// nothing about why, so the only way to decide whether a retry could help was a
// shell on the server. Now the worker keeps the last few reasons next to its
// tally, in the same bounded, health-data-free way:
//
//   - `helsa:ingest:<queue>:failures` — a Redis list of JSON records, newest
//     first, trimmed to [MaxFailures] on every push and expiring [FailureTTL]
//     after the last one.
//   - `helsa:ingest:<queue>:redrive` — one hash: when the last redrive that moved
//     anything ran, and how many it moved. The page needs it to tell a failure
//     whose batch was since moved back from one that is still waiting.
//
// ⚠️ The list is a log, not a mirror of the dead-letter queue. A batch that was
// dead-lettered before this existed has no record, and a record outlives the
// redrive of its batch. RabbitMQ cannot be asked what is inside a queue without
// taking the messages out, so this is the closest honest thing.

const (
	// MaxFailures is how many failure records are kept.
	MaxFailures = 20
	// FailureTTL is how long the failure list and the last-redrive record live
	// after their last write.
	FailureTTL = 30 * 24 * time.Hour
	// MaxErrorLen is the longest error message kept, in characters.
	MaxErrorLen = 300
)

func failuresKey(q string) string { return prefix(q) + ":failures" }
func redriveKey(q string) string  { return prefix(q) + ":redrive" }

// Failure is one dead-lettered batch as the worker saw it.
type Failure struct {
	BatchID  uuid.UUID `json:"batch_id"`
	At       time.Time `json:"failed_at"`
	Error    string    `json:"error"`
	Redriven int       `json:"redriven"`

	Samples           int `json:"samples"`
	Workouts          int `json:"workouts"`
	SleepSegments     int `json:"sleep_segments"`
	ActivitySummaries int `json:"activity_summaries"`
	Deletions         int `json:"deletions"`
}

// Items is the batch's size, all kinds added up.
func (f Failure) Items() int {
	return f.Samples + f.Workouts + f.SleepSegments + f.ActivitySummaries + f.Deletions
}

// LastRedrive is the most recent redrive that moved anything.
type LastRedrive struct {
	At    time.Time
	Moved int
}

// DeadLettered records one batch given up on: the failure counters Done(false)
// would raise, plus the record itself, in one pipelined round trip. f.At is set
// here and f.Error is sanitised here — a caller cannot forget either.
func (r *Recorder) DeadLettered(ctx context.Context, f Failure, cause error) error {
	now := r.now()
	f.At = now.UTC()
	f.Error = SanitizeError(cause)
	rec, err := json.Marshal(f)
	if err != nil {
		return err
	}
	mk := minuteKey(r.queue, unixMinute(now))
	wk := workerKey(r.queue)
	fk := failuresKey(r.queue)
	pipe := r.rdb.Pipeline()
	pipe.HIncrBy(ctx, mk, "failed", 1)
	pipe.HIncrBy(ctx, wk, "failed", 1)
	pipe.Expire(ctx, mk, bucketTTL)
	pipe.LPush(ctx, fk, rec)
	pipe.LTrim(ctx, fk, 0, MaxFailures-1)
	pipe.Expire(ctx, fk, FailureTTL)
	_, err = pipe.Exec(ctx)
	return err
}

// RecordRedrive notes a redrive that moved at least one batch. The API calls it;
// a failure to record is the caller's log line, never a failed redrive.
func RecordRedrive(ctx context.Context, rdb *redis.Client, queueName string, at time.Time, moved int) error {
	k := redriveKey(queueName)
	pipe := rdb.TxPipeline()
	pipe.Del(ctx, k)
	pipe.HSet(ctx, k, "at", at.UTC().Format(time.RFC3339Nano), "moved", moved)
	pipe.Expire(ctx, k, FailureTTL)
	_, err := pipe.Exec(ctx)
	return err
}

func parseFailures(raw []string) []Failure {
	out := make([]Failure, 0, len(raw))
	for _, s := range raw {
		var f Failure
		if json.Unmarshal([]byte(s), &f) == nil {
			out = append(out, f)
		}
	}
	return out
}

func parseLastRedrive(h map[string]string) *LastRedrive {
	if len(h) == 0 {
		return nil
	}
	t, err := time.Parse(time.RFC3339Nano, h["at"])
	if err != nil {
		return nil
	}
	return &LastRedrive{At: t, Moved: atoi(h["moved"])}
}

// The redaction. Error strings are what the worker returns: "insert sample
// <source_uuid>: <pgx error>", "decode message: <json error>" and the like. They
// do not normally carry a measured value, but two library errors can: the JSON
// decoder quotes the offending number ("cannot unmarshal number 1e999 into …"),
// and pgx quotes the value it could not encode. So the record keeps the shape of
// the message and drops its literals: every number becomes `#` and every
// double-quoted string `"…"`. What is kept is what identifies rather than
// measures: UUIDs (a source_uuid says which item, not what it measured),
// SQLSTATE codes, and IPv4 addresses with their port (a "connection refused"
// that names the host is the useful kind).
var redactRe = regexp.MustCompile(
	`[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}` + // keep: UUID
		`|SQLSTATE [0-9A-Z]{5}` + // keep
		`|\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b` + // keep: IPv4[:port]
		`|"[^"]*"` + // redact: quoted string
		`|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`) // redact: number

// SanitizeError turns an error into the message a failure record may keep:
// literals redacted (see redactRe), whitespace collapsed, at most MaxErrorLen
// characters with an ellipsis marking a cut.
func SanitizeError(err error) string {
	if err == nil {
		return "unknown error"
	}
	s := redactRe.ReplaceAllStringFunc(err.Error(), func(m string) string {
		switch {
		case strings.HasPrefix(m, `"`):
			return `"…"`
		case strings.HasPrefix(m, "SQLSTATE"), strings.Count(m, "-") == 4 && len(m) == 36,
			strings.Count(m, ".") == 3:
			return m
		default:
			return "#"
		}
	})
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) > MaxErrorLen {
		r := []rune(s)
		s = string(r[:MaxErrorLen]) + "…"
	}
	return s
}
