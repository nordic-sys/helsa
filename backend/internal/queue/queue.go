// Package queue abstracts the RabbitMQ in/out wiring: the API publishes here
// (on the write path, after the 202), the worker consumes from here. The
// topology is durable + manual ack, with a dead-letter queue for messages that
// cannot be processed (poison messages).
//
// See docs/05-backend-go.md §4 (ingestion pipeline).
package queue

import (
	"context"
	"fmt"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"github.com/nordic-sys/helsa/backend/internal/config"
)

type Queue struct {
	conn    *amqp.Connection
	ch      *amqp.Channel
	name    string // main queue
	dlqName string // dead-letter queue
}

// Open connects and declares the topology (idempotent).
func Open(url, name string) (*Queue, error) {
	conn, err := amqp.Dial(url)
	if err != nil {
		// ⚠️ The AMQP client quotes the whole URL when it cannot parse it, password
		// included — and this line ends up in `docker compose logs`, which people
		// paste into issues. The redaction covers the string url.Parse refused too.
		return nil, fmt.Errorf("amqp dial %s: %w", config.RedactURL(url), config.RedactURLError(err, url))
	}
	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("amqp channel: %w", err)
	}

	dlqName := name + ".dlq"
	// Dead-letter queue: this is where a nacked (requeue=false) poison message lands.
	if _, err := ch.QueueDeclare(dlqName, true, false, false, false, nil); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("declare dlq: %w", err)
	}
	// Main queue: durable; on the default exchange the routing key is the queue
	// name. Dead-lettering goes to the default ("") exchange with the dlqName
	// routing key.
	args := amqp.Table{
		"x-dead-letter-exchange":    "",
		"x-dead-letter-routing-key": dlqName,
	}
	if _, err := ch.QueueDeclare(name, true, false, false, false, args); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("declare queue: %w", err)
	}

	return &Queue{conn: conn, ch: ch, name: name, dlqName: dlqName}, nil
}

func (q *Queue) Close() error {
	if q.conn != nil {
		return q.conn.Close()
	}
	return nil
}

// Ready backs readyz: is the connection/channel still open?
func (q *Queue) Ready() error {
	if q.conn == nil || q.conn.IsClosed() {
		return fmt.Errorf("rabbitmq connection closed")
	}
	return nil
}

// Publish puts a message on the main queue (persistent, so it survives a broker restart).
func (q *Queue) Publish(ctx context.Context, body []byte) error {
	return q.ch.PublishWithContext(ctx, "", q.name, false, false, amqp.Publishing{
		ContentType:  "application/json",
		DeliveryMode: amqp.Persistent,
		Body:         body,
	})
}

// Consume blocks and calls the handler for every message.
// Handler returns nil → ack; returns an error → nack(requeue=false) →
// dead-letter (so there is no infinite retry loop).
func (q *Queue) Consume(ctx context.Context, prefetch int, handler func(context.Context, []byte) error) error {
	if err := q.ch.Qos(prefetch, 0, false); err != nil {
		return fmt.Errorf("qos: %w", err)
	}
	deliveries, err := q.ch.Consume(q.name, "", false, false, false, false, nil)
	if err != nil {
		return fmt.Errorf("consume: %w", err)
	}
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case d, ok := <-deliveries:
			if !ok {
				return fmt.Errorf("delivery channel closed")
			}
			if err := handler(ctx, d.Body); err != nil {
				_ = d.Nack(false, false) // poison → dead-letter
				continue
			}
			_ = d.Ack(false)
		}
	}
}

// Depth is what a passive declare can tell about the two queues.
//
// ⚠️ `Ready` is the broker's message count from queue.declare-ok, which is the
// messages WAITING to be delivered — the ones a consumer holds unacknowledged are
// not in it, and plain AMQP has no way to ask for them (only the management HTTP
// API does, and the code does not depend on it). The status endpoint therefore
// reports the in-flight batches as an upper bound, prefetch × consumers.
type Depth struct {
	Name      string
	Ready     int
	Consumers int

	DLQName  string
	DLQReady int
}

// inspectTimeout bounds one Inspect. A broker whose TCP connection died silently
// would otherwise hold the status request until the heartbeat noticed.
const inspectTimeout = 3 * time.Second

// Inspect reads both queues' depth with a passive declare.
//
// It opens a channel of its own and closes it afterwards, rather than borrowing the
// publishing channel: AMQP closes a channel on any failed passive declare (a queue
// that does not exist is a 404 channel exception), and on the publishing channel
// that would turn a status lookup into a broken POST /ingest.
func (q *Queue) Inspect(ctx context.Context) (Depth, error) {
	if err := q.Ready(); err != nil {
		return Depth{}, err
	}
	type result struct {
		d   Depth
		err error
	}
	done := make(chan result, 1)
	go func() {
		d, err := q.inspect()
		done <- result{d, err}
	}()
	ctx, cancel := context.WithTimeout(ctx, inspectTimeout)
	defer cancel()
	select {
	case r := <-done:
		return r.d, r.err
	case <-ctx.Done():
		// The goroutine finishes on its own once the library gives up; its result
		// lands in the buffered channel and is dropped.
		return Depth{}, fmt.Errorf("rabbitmq did not answer: %w", ctx.Err())
	}
}

func (q *Queue) inspect() (Depth, error) {
	ch, err := q.conn.Channel()
	if err != nil {
		return Depth{}, fmt.Errorf("amqp channel: %w", err)
	}
	defer ch.Close() //nolint:errcheck // already closed after a failed declare
	main, err := ch.QueueDeclarePassive(q.name, true, false, false, false, nil)
	if err != nil {
		return Depth{}, fmt.Errorf("inspect %s: %w", q.name, err)
	}
	dlq, err := ch.QueueDeclarePassive(q.dlqName, true, false, false, false, nil)
	if err != nil {
		return Depth{}, fmt.Errorf("inspect %s: %w", q.dlqName, err)
	}
	return Depth{
		Name: q.name, Ready: main.Messages, Consumers: main.Consumers,
		DLQName: q.dlqName, DLQReady: dlq.Messages,
	}, nil
}
