-- +goose Up
-- The tokens from before the register (docs/36 §5.3, W4): no `jti`, so no row in
-- device_tokens — not listed, and revocable only by their exact text on the deny-
-- list, which a member whose token sits in a phone's keychain does not have.
--
-- legacy_token_used_at: when one of the member's jti-less tokens was last accepted
-- (at most hourly), so the web can say that such a token is still in use.
-- legacy_tokens_revoked_at: every jti-less token of the member issued at or before
-- this instant is refused. One button revokes all of them without knowing any; the
-- check reads the users row the request already reads, so it costs no lookup.
--
-- Both nullable with no default: a metadata-only change, no table rewrite.
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_token_used_at     timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_tokens_revoked_at timestamptz;

-- +goose Down
ALTER TABLE users DROP COLUMN IF EXISTS legacy_tokens_revoked_at;
ALTER TABLE users DROP COLUMN IF EXISTS legacy_token_used_at;
