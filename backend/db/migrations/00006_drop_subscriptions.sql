-- +goose Up
-- The `subscriptions` table was never created by a migration: the stale init
-- script in deploy/ wrote it into the database, running BEFORE goose. ADR-0002
-- (the personal direction) then ended the SaaS/billing line, so the table was
-- never needed in the first place.
--
-- It is empty, nothing references it, and the code does not know about it. The
-- root cause of the drift was fixed on the deploy/ side (the init no longer
-- defines a schema); this migration clears away what was left, so that the
-- schema history records it too.
DROP TABLE IF EXISTS subscriptions;

-- +goose Down
-- There is deliberately no way back: the table was left behind by a decision
-- that has since been reversed, and recreating it would be pointless.
SELECT 1;
