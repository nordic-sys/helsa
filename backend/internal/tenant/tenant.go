// Package tenant carries "whose rows may this database work touch" through a
// context, from the code that knows it — the auth middleware for a request, the
// worker for a queued batch — to the connection pool, which hands it to PostgreSQL
// as the `helsa.user_id` setting the row-level policies read (docs/36 §4.8.8).
//
// It is its own package, not part of auth or store, because both sides need it and
// neither may import the other.
package tenant

import (
	"context"

	"github.com/google/uuid"
)

type key struct{}

// With returns a context whose database work is done as user. uuid.Nil means
// nobody: the policies then return no rows at all.
func With(ctx context.Context, user uuid.UUID) context.Context {
	return context.WithValue(ctx, key{}, user)
}

// From reports the user database work in ctx is done as, if any.
func From(ctx context.Context) (uuid.UUID, bool) {
	u, ok := ctx.Value(key{}).(uuid.UUID)
	return u, ok && u != uuid.Nil
}

// Setting is the value of helsa.user_id for ctx: the user's id, or "" for nobody.
func Setting(ctx context.Context) string {
	if u, ok := From(ctx); ok {
		return u.String()
	}
	return ""
}
