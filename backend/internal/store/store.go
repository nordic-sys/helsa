// Package store bundles the persistence connections: the Postgres/Timescale
// connection pool (pgx) and the Redis client. The sqlc-generated query layer
// (internal/db) is used through the pgxpool.Pool.
package store

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/nordic-sys/helsa/backend/internal/config"
)

type Store struct {
	DB    *pgxpool.Pool
	Redis *redis.Client
}

// Open builds the pool + redis connections and pings both.
func Open(ctx context.Context, cfg *config.Config) (*Store, error) {
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("pgxpool new: %w", err)
	}
	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("postgres ping: %w", err)
	}

	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
	})
	if err := rdb.Ping(pingCtx).Err(); err != nil {
		pool.Close()
		_ = rdb.Close()
		return nil, fmt.Errorf("redis ping: %w", err)
	}

	return &Store{DB: pool, Redis: rdb}, nil
}

func (s *Store) Close() {
	if s.DB != nil {
		s.DB.Close()
	}
	if s.Redis != nil {
		_ = s.Redis.Close()
	}
}

// Ready backs readyz: a quick check that the DB and Redis are alive.
func (s *Store) Ready(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := s.DB.Ping(ctx); err != nil {
		return fmt.Errorf("postgres: %w", err)
	}
	if err := s.Redis.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	return nil
}
