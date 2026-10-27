package queue

import (
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

func TestRedriveCount(t *testing.T) {
	cases := []struct {
		name string
		h    amqp.Table
		want int
	}{
		{"no headers (every batch the API published)", nil, 0},
		{"header absent", amqp.Table{"x-death": []any{}}, 0},
		{"int32 (what Redrive stamps)", amqp.Table{RedriveHeader: int32(2)}, 2},
		{"int64 (a broker or library that widens)", amqp.Table{RedriveHeader: int64(5)}, 5},
		{"int8", amqp.Table{RedriveHeader: int8(1)}, 1},
		{"uint8", amqp.Table{RedriveHeader: uint8(3)}, 3},
		{"numeric string (set by hand)", amqp.Table{RedriveHeader: "4"}, 4},
		{"negative is not a count", amqp.Table{RedriveHeader: int32(-1)}, 0},
		{"garbage string", amqp.Table{RedriveHeader: "lots"}, 0},
		{"wrong type", amqp.Table{RedriveHeader: 1.5}, 0},
	}
	for _, c := range cases {
		if got := RedriveCount(c.h); got != c.want {
			t.Errorf("%s: got %d, want %d", c.name, got, c.want)
		}
	}
}

func TestRedriveLimit(t *testing.T) {
	cases := []struct{ max, ready, want int }{
		{0, 0, 0},       // empty dead-letter queue → nothing to do
		{0, 7, 7},       // no max → everything waiting at the start
		{-3, 7, 7},      // a non-positive max means "all"
		{3, 7, 3},       // max below the depth
		{10, 7, 7},      // max above the depth: never more than were waiting
		{0, 5000, 1000}, // the per-call cap
		{2000, 5000, 1000},
		{0, -1, 0},
	}
	for _, c := range cases {
		if got := RedriveLimit(c.max, c.ready); got != c.want {
			t.Errorf("RedriveLimit(%d, %d) = %d, want %d", c.max, c.ready, got, c.want)
		}
	}
}

// The main-queue copy must be the same message: body byte-for-byte, the
// properties carried over, the headers kept — and the dead-letter delivery's own
// header table left alone, since the copy is built while the original is still
// unacknowledged and may be nacked back.
func TestRepublish(t *testing.T) {
	ts := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	orig := amqp.Table{"x-death": []any{amqp.Table{"count": int64(1)}}, RedriveHeader: int32(1)}
	d := amqp.Delivery{
		Headers:      orig,
		ContentType:  "application/json",
		DeliveryMode: amqp.Transient,
		MessageId:    "m-1",
		Timestamp:    ts,
		Body:         []byte(`{"batch_id":"x"}`),
	}
	p := Republish(d, 2)

	if string(p.Body) != string(d.Body) {
		t.Errorf("body changed: %s", p.Body)
	}
	if p.ContentType != "application/json" || p.MessageId != "m-1" || !p.Timestamp.Equal(ts) {
		t.Errorf("properties not carried: %+v", p)
	}
	if p.DeliveryMode != amqp.Persistent {
		t.Errorf("delivery mode = %d, want persistent", p.DeliveryMode)
	}
	if p.Headers[RedriveHeader] != int32(2) {
		t.Errorf("redrive header = %#v, want int32(2)", p.Headers[RedriveHeader])
	}
	if _, ok := p.Headers["x-death"]; !ok {
		t.Error("other headers were dropped")
	}
	if orig[RedriveHeader] != int32(1) {
		t.Errorf("the original delivery's headers were mutated: %#v", orig[RedriveHeader])
	}
	if RedriveCount(p.Headers) != 2 {
		t.Error("the stamped header does not read back")
	}
}
