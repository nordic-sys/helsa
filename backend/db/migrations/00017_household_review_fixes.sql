-- +goose Up
-- Fixes from the second technical review of the household work (docs/36 §10.4).

-- S1: a member could not queue their own deletion. INSERT … ON CONFLICT and
-- RETURNING both need a SELECT policy on the rows they touch, and a member had only
-- an INSERT policy, so DELETE /v1/me failed with a row-security error and rolled the
-- disable back. A member may see their own job — it says nothing they do not know.
DROP POLICY IF EXISTS own_select ON deletion_jobs;
CREATE POLICY own_select ON deletion_jobs FOR SELECT
  USING (user_id = (SELECT NULLIF(current_setting('helsa.user_id', true), '')::uuid));

-- S2: the C2 rule (an admin gives a code only to a member with no live credential)
-- was checked at issuance only. An admin could issue two codes before onboarding,
-- hand one over and keep the other — redeeming it later as the member, without
-- stopping their phone. Now, in the same statement as the redemption:
--   * a code issued by SOMEBODY ELSE (an admin; created_by set and not the member) is
--     refused if the member already has a live credential;
--   * once a credential exists, every other unused code that somebody else issued
--     for the member is revoked. Codes the member made for themselves stay.
-- Codes from the operator's CLI (created_by NULL) are not limited: the operator has
-- the database anyway, and the first admin's first sign-in depends on them.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION redeem_code(p_hash bytea, p_purpose text, p_token_id uuid,
                                       p_label text, p_kind text, p_expires timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user uuid;
  v_by   uuid;
BEGIN
  UPDATE enrolment_codes c SET used_at = now(), used_label = p_label
  WHERE c.code_hash = p_hash AND c.purpose = p_purpose
    AND c.used_at IS NULL AND c.revoked_at IS NULL AND c.expires_at > now()
    AND EXISTS (SELECT 1 FROM users u WHERE u.id = c.user_id AND u.disabled_at IS NULL)
  RETURNING c.user_id, c.created_by INTO v_user, v_by;
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;
  -- Serialise with every other redemption for this member, so that two admin codes
  -- redeemed at the same moment cannot both see "no live credential yet".
  PERFORM pg_advisory_xact_lock(hashtext('helsa.redeem.' || v_user::text));
  IF v_by IS NOT NULL AND v_by <> v_user
     AND EXISTS (SELECT 1 FROM device_tokens t
                 WHERE t.user_id = v_user AND t.revoked_at IS NULL AND t.expires_at > now()) THEN
    -- The code stays spent: it was somebody else's, and it is refused like any other.
    INSERT INTO account_events (user_id, actor_id, kind, detail)
    VALUES (v_user, v_by, 'code_refused', jsonb_build_object('purpose', p_purpose, 'reason', 'member_has_a_device'));
    RETURN NULL;
  END IF;
  INSERT INTO device_tokens (id, user_id, label, kind, created_by, expires_at)
  VALUES (p_token_id, v_user, p_label, p_kind, NULL, p_expires);
  UPDATE enrolment_codes SET revoked_at = now()
  WHERE user_id = v_user AND used_at IS NULL AND revoked_at IS NULL
    AND created_by IS NOT NULL AND created_by <> v_user;
  INSERT INTO account_events (user_id, actor_id, kind, detail)
  VALUES (v_user, v_user, 'code_redeemed',
          jsonb_build_object('purpose', p_purpose, 'label', p_label, 'token_id', p_token_id));
  RETURN v_user;
END $$;
-- +goose StatementEnd

-- +goose Down
DROP POLICY IF EXISTS own_select ON deletion_jobs;
-- (redeem_code keeps its stricter body: the 00015 one is the bug.)
