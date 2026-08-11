// Package pgconv holds small conversion helpers between Go types and pgx's
// pgtype values. The pgtype.* types are needed because they can also represent
// NULL (the Valid flag) — a plain uuid.UUID or time.Time cannot.
package pgconv

import (
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func UUID(u uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: u, Valid: true}
}

func ToUUID(p pgtype.UUID) uuid.UUID {
	return uuid.UUID(p.Bytes)
}

func Timestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// TimestamptzPtr nil → NULL.
func TimestamptzPtr(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}

func Date(t time.Time) pgtype.Date {
	return pgtype.Date{Time: t, Valid: true}
}
