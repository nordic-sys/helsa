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

	amqp "github.com/rabbitmq/amqp091-go"
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
		return nil, fmt.Errorf("amqp dial: %w", err)
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
