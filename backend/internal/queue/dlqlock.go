package queue

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// # One hand in the dead-letter queue at a time, across processes (docs/36 §10.4, S7)
//
// A redrive runs in the API, a member deletion's dead-letter purge in the worker.
// Each holds messages unacknowledged while it works on them, and a message a redrive
// holds is invisible to a purge counting the queue: the purge could finish, the
// redrive's publish fail, and the deleted member's batch go back into the queue for
// good. redriveMu only ever excluded the same process. This lock is shared, in
// Redis, and held until every delivery is settled.

// ErrDLQBusy: the other process has its hand in the dead-letter queue.
var ErrDLQBusy = errors.New("the dead-letter queue is being worked on by another process")

const dlqLockKey = "helsa:dlq:lock"

// dlqLockTTL bounds a lock whose holder died; a walk of the queue takes seconds.
const dlqLockTTL = 5 * time.Minute

// UseSharedLock makes Redrive and PurgeDeadLetters take the cross-process lock in
// rdb. Without it (tests, a single process) only the in-process mutex applies.
func (q *Queue) UseSharedLock(rdb *redis.Client) { q.lock = rdb }

var releaseIfOurs = redis.NewScript(`
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`)

// acquire takes the shared lock, waiting up to wait for it. The returned func
// releases it — only if it is still ours (a lock that expired and was taken by the
// other process is not deleted from under it).
func (q *Queue) acquire(ctx context.Context, wait time.Duration) (func(), error) {
	if q.lock == nil {
		return func() {}, nil
	}
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	token := hex.EncodeToString(b)
	deadline := time.Now().Add(wait)
	for {
		ok, err := q.lock.SetNX(ctx, dlqLockKey, token, dlqLockTTL).Result()
		if err != nil {
			return nil, fmt.Errorf("dead-letter lock: %w", err)
		}
		if ok {
			return func() { _ = releaseIfOurs.Run(context.WithoutCancel(ctx), q.lock, []string{dlqLockKey}, token).Err() }, nil
		}
		if time.Now().After(deadline) {
			return nil, ErrDLQBusy
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(250 * time.Millisecond):
		}
	}
}
