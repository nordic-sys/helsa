package queue

import (
	"context"
	"errors"
	"fmt"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// RedriveHeader counts how many times a message has been moved out of the
// dead-letter queue and back onto the main queue. The worker reads it (see
// Consume) so a batch that fails again can say "this has already been retried
// N times", and Redrive raises it by one on every move.
const RedriveHeader = "x-helsa-redriven"

// RepeatThreshold is the redrive count from which a message counts as one that
// keeps failing. It is a label, not a limit: such a message is still moved when
// asked — nothing here retries anything on its own — but the answer counts it,
// so the page can say a button press is unlikely to help.
const RepeatThreshold = 3

// MaxRedrivePerCall caps one Redrive. A dead-letter queue of tens of thousands
// would otherwise hold one HTTP request for minutes; the caller presses again.
const MaxRedrivePerCall = 1000

// ErrRedriveBusy is returned when another Redrive is already running in this process.
var ErrRedriveBusy = errors.New("a redrive is already running")

// RedriveResult is what one Redrive did.
type RedriveResult struct {
	// Moved is the number of messages republished to the main queue AND acknowledged
	// on the dead-letter queue.
	Moved int
	// Remaining is the dead-letter queue's depth afterwards (a passive declare), or
	// -1 when it could not be read.
	Remaining int
	// MaxRedriven is the highest redrive count stamped on a moved message (the new
	// value, so 1 for a message moved for the first time). 0 when nothing moved.
	MaxRedriven int
	// Repeated counts the moved messages whose new redrive count is at least
	// RepeatThreshold.
	Repeated int
	// Stopped is set when the run ended early because a publish was not confirmed
	// or the broker went away. The message being moved at that moment was put back
	// on the dead-letter queue (or will be, when its channel closes).
	Stopped error
}

// redriveOpTimeout bounds each broker round trip of a Redrive.
const redriveOpTimeout = 10 * time.Second

// Redrive moves up to want dead-lettered messages back onto the main queue for
// the worker to try again. want <= 0 means "every message that is in the
// dead-letter queue when the call starts", and either way at most
// MaxRedrivePerCall.
//
// # Why this is safe to press
//
// The worker's writes are idempotent upserts keyed on source_uuid, so a batch
// processed twice stores nothing twice.
//
// # How no message is lost
//
// It runs on a channel of its own in publisher-confirm mode. For each message:
// basic.get (manual ack) from the dead-letter queue → publish the same body and
// properties to the main queue, mandatory, with RedriveHeader raised by one →
// wait for the broker's confirm → only then ack the dead-letter copy. If the
// confirm is a nack, does not come, or the message was returned as unroutable,
// the dead-letter copy is nacked with requeue and the run stops. A crash at any
// point before the ack leaves the copy unacknowledged, and the broker puts an
// unacknowledged message back when its channel closes. The worst case is the
// other way round — confirmed on the main queue, then the ack fails — and that
// leaves the batch in BOTH queues: a duplicate, which the upserts absorb, never
// a loss.
//
// # Why it cannot double-move or loop
//
// The count is fixed at the start (the dead-letter depth then), so a batch that
// fails again while the run is in progress and lands back in the dead-letter
// queue is not picked up a second time by the same call. And one Redrive runs at
// a time: a second concurrent call gets ErrRedriveBusy. That lock is a mutex in
// this process, which is enough because Helsa runs exactly one API instance; two
// API processes could each move a message once — which, again, is a duplicate,
// not a loss.
func (q *Queue) Redrive(ctx context.Context, want int) (RedriveResult, error) {
	if !q.redriveMu.TryLock() {
		return RedriveResult{}, ErrRedriveBusy
	}
	defer q.redriveMu.Unlock()
	// The other process (a member deletion's purge) may be walking the queue: a
	// redrive does not wait for it, it says "busy" like a second redrive would.
	release, err := q.acquire(ctx, 0)
	if errors.Is(err, ErrDLQBusy) {
		return RedriveResult{}, ErrRedriveBusy
	}
	if err != nil {
		return RedriveResult{}, err
	}
	defer release()

	if err := q.Ready(); err != nil {
		return RedriveResult{}, err
	}
	before, err := q.dlqDepth(ctx)
	if err != nil {
		return RedriveResult{}, err
	}
	limit := RedriveLimit(want, before)

	res := RedriveResult{Remaining: -1}
	if limit > 0 {
		res, err = q.redrive(ctx, limit)
		if err != nil {
			return res, err
		}
	}
	if after, err := q.dlqDepth(ctx); err == nil {
		res.Remaining = after
	}
	return res, nil
}

// dlqDepth is a passive declare of the dead-letter queue alone, on a channel of
// its own (a failed passive declare closes its channel). Only the dead-letter
// queue: a redrive must still be able to count — and refuse to ack — when the
// main queue is the thing that is missing.
func (q *Queue) dlqDepth(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, inspectTimeout)
	defer cancel()
	done := make(chan struct {
		n   int
		err error
	}, 1)
	go func() {
		ch, err := q.conn.Channel()
		if err != nil {
			done <- struct {
				n   int
				err error
			}{0, fmt.Errorf("amqp channel: %w", err)}
			return
		}
		defer ch.Close() //nolint:errcheck // already closed after a failed declare
		qi, err := ch.QueueDeclarePassive(q.dlqName, true, false, false, false, nil)
		if err != nil {
			err = fmt.Errorf("inspect %s: %w", q.dlqName, err)
		}
		done <- struct {
			n   int
			err error
		}{qi.Messages, err}
	}()
	select {
	case r := <-done:
		return r.n, r.err
	case <-ctx.Done():
		return 0, fmt.Errorf("rabbitmq did not answer: %w", ctx.Err())
	}
}

// RedriveLimit is how many messages one call moves: what was asked for (all,
// when want <= 0), no more than were waiting at the start, and no more than
// MaxRedrivePerCall.
func RedriveLimit(want, ready int) int {
	n := ready
	if want > 0 && want < n {
		n = want
	}
	if n > MaxRedrivePerCall {
		n = MaxRedrivePerCall
	}
	if n < 0 {
		n = 0
	}
	return n
}

// redrive is the loop. An error return means nothing at all could be moved
// (no channel, no confirm mode); a failure part-way is res.Stopped.
func (q *Queue) redrive(ctx context.Context, limit int) (RedriveResult, error) {
	res := RedriveResult{Remaining: -1}
	ch, err := q.conn.Channel()
	if err != nil {
		return res, fmt.Errorf("amqp channel: %w", err)
	}
	defer ch.Close() //nolint:errcheck // may already be closed by a channel exception
	if err := ch.Confirm(false); err != nil {
		return res, fmt.Errorf("confirm mode: %w", err)
	}
	// A mandatory publish the broker cannot route comes back as basic.return, and
	// is STILL confirmed with an ack afterwards. The library delivers the return
	// before it processes that ack, so a non-blocking look after the confirm sees it.
	returns := ch.NotifyReturn(make(chan amqp.Return, 1))

	for res.Moved < limit {
		d, ok, err := ch.Get(q.dlqName, false)
		if err != nil {
			res.Stopped = fmt.Errorf("get from %s: %w", q.dlqName, err)
			break
		}
		if !ok {
			break // emptied by someone else in the meantime
		}
		n := RedriveCount(d.Headers) + 1
		if err := q.publishConfirmed(ctx, ch, returns, Republish(d, n)); err != nil {
			// Back to the dead-letter queue. If even this nack fails, the channel is
			// gone, and closing it returns the message to the queue anyway.
			_ = d.Nack(false, true)
			res.Stopped = err
			break
		}
		if err := d.Ack(false); err != nil {
			// Confirmed on the main queue, still in the dead-letter queue: a duplicate.
			res.Stopped = fmt.Errorf("ack the dead-letter copy after a confirmed publish (the batch is now in both queues): %w", err)
			break
		}
		res.Moved++
		if n > res.MaxRedriven {
			res.MaxRedriven = n
		}
		if n >= RepeatThreshold {
			res.Repeated++
		}
	}
	return res, nil
}

func (q *Queue) publishConfirmed(ctx context.Context, ch *amqp.Channel, returns <-chan amqp.Return, p amqp.Publishing) error {
	return q.publishTo(ctx, ch, returns, q.name, p)
}

// publishTo publishes to target and waits for the broker's confirm.
func (q *Queue) publishTo(ctx context.Context, ch *amqp.Channel, returns <-chan amqp.Return, target string, p amqp.Publishing) error {
	ctx, cancel := context.WithTimeout(ctx, redriveOpTimeout)
	defer cancel()
	dc, err := ch.PublishWithDeferredConfirmWithContext(ctx, "", target, true, false, p)
	if err != nil {
		return fmt.Errorf("publish to %s: %w", target, err)
	}
	acked, err := dc.WaitContext(ctx)
	if err != nil {
		return fmt.Errorf("confirm from %s: %w", target, err)
	}
	if !acked {
		return fmt.Errorf("the broker refused the publish to %s (nack)", target)
	}
	select {
	case r := <-returns:
		return fmt.Errorf("the broker could not route the message to %s: %d %s", target, r.ReplyCode, r.ReplyText)
	default:
	}
	return nil
}

// Republish builds the main-queue copy of a dead-lettered delivery: the same
// body and properties, the headers copied, and RedriveHeader set to n. It is
// always persistent, whatever the original said, because a batch that is being
// rescued must survive a broker restart.
func Republish(d amqp.Delivery, n int) amqp.Publishing {
	h := amqp.Table{}
	for k, v := range d.Headers {
		h[k] = v
	}
	h[RedriveHeader] = int32(n)
	return amqp.Publishing{
		Headers:         h,
		ContentType:     d.ContentType,
		ContentEncoding: d.ContentEncoding,
		DeliveryMode:    amqp.Persistent,
		Priority:        d.Priority,
		CorrelationId:   d.CorrelationId,
		ReplyTo:         d.ReplyTo,
		MessageId:       d.MessageId,
		Timestamp:       d.Timestamp,
		Type:            d.Type,
		UserId:          d.UserId,
		AppId:           d.AppId,
		Body:            d.Body,
	}
}

// RedriveCount reads RedriveHeader. A message without it — every batch the API
// published, and every one dead-lettered before redrive existed — has 0. AMQP
// field tables carry integers in several widths, and a header set by hand
// (management UI, a script) may be any of them, or a numeric string.
func RedriveCount(h amqp.Table) int {
	switch v := h[RedriveHeader].(type) {
	case int:
		return nonNeg(int64(v))
	case int8:
		return nonNeg(int64(v))
	case int16:
		return nonNeg(int64(v))
	case int32:
		return nonNeg(int64(v))
	case int64:
		return nonNeg(v)
	case uint8:
		return int(v)
	case uint16:
		return int(v)
	case uint32:
		return nonNeg(int64(v))
	case string:
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			return n
		}
	}
	return 0
}

func nonNeg(v int64) int {
	if v < 0 {
		return 0
	}
	return int(v)
}
