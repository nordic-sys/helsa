package queue

import (
	"context"
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

// PurgeDeadLetters removes from the dead-letter queue every batch drop says to,
// and puts the rest back — the member-deletion job's way of making sure that a
// deleted member's stuck batch does not sit there forever, waiting for somebody to
// redrive it into a database that no longer has its owner (docs/36 §9, C21).
//
// It walks the queue ONCE: as many messages as it held when the walk began. A kept
// message is republished to the dead-letter queue with a confirm before its
// original is acknowledged, exactly like a redrive, so a failure half-way leaves a
// duplicate at worst, never a loss. The order of the kept ones changes (each goes
// to the back); the dead-letter queue promises none.
//
// It takes the redrive lock: a redrive moving messages out while this moves them
// round would count both wrong.
func (q *Queue) PurgeDeadLetters(ctx context.Context, drop func(body []byte) bool) (removed int, err error) {
	q.redriveMu.Lock()
	defer q.redriveMu.Unlock()
	depth, err := q.dlqDepth(ctx)
	if err != nil {
		return 0, err
	}
	if depth == 0 {
		return 0, nil
	}
	ch, err := q.conn.Channel()
	if err != nil {
		return 0, fmt.Errorf("amqp channel: %w", err)
	}
	defer ch.Close() //nolint:errcheck // may already be closed by a channel exception
	if err := ch.Confirm(false); err != nil {
		return 0, fmt.Errorf("confirm mode: %w", err)
	}
	returns := ch.NotifyReturn(make(chan amqp.Return, 1))
	for i := 0; i < depth; i++ {
		d, ok, err := ch.Get(q.dlqName, false)
		if err != nil {
			return removed, fmt.Errorf("get from %s: %w", q.dlqName, err)
		}
		if !ok {
			break
		}
		if drop(d.Body) {
			if err := d.Ack(false); err != nil {
				return removed, fmt.Errorf("ack a purged batch: %w", err)
			}
			removed++
			continue
		}
		p := Republish(d, RedriveCount(d.Headers))
		if err := q.publishTo(ctx, ch, returns, q.dlqName, p); err != nil {
			_ = d.Nack(false, true)
			return removed, err
		}
		if err := d.Ack(false); err != nil {
			return removed, fmt.Errorf("ack the original of a kept batch (it is now in the queue twice): %w", err)
		}
	}
	return removed, nil
}
