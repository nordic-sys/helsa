-- +goose Up
-- A server shared by a household (docs/36, ADR-0008): who may administer it, and
-- whose access has been switched off.
--
--  * role — 'admin' or 'member'. The role lives HERE and is read on every request,
--    never minted into a token: a year-long token carrying a role would keep it for
--    a year after the demotion (docs/36 §2.4).
--  * disabled_at — set: every token of the user is refused. It is NOT a revocation:
--    the tokens stay as they are, and clearing it lets the same phone carry on
--    without being enrolled again (docs/36 §9, A8).
--
-- Both are metadata-only changes (a constant default since PG11 does not rewrite
-- the table), and the samples hypertable is not touched.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member'
    CHECK (role IN ('admin', 'member'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at timestamptz;

-- An existing install: with EXACTLY one user, that user is the one who runs it.
-- With several (left behind by the token tool before 2026-10-27, which made a user
-- per device), nobody is promoted: the machine cannot tell who owns the server, and
-- guessing would hand somebody else the admin role.
UPDATE users SET role = 'admin' WHERE (SELECT count(*) FROM users) = 1;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS disabled_at;
ALTER TABLE users DROP COLUMN IF EXISTS role;
