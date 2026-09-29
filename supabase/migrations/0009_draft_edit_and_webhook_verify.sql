-- =====================================================================
-- 0009 — users can edit or discard a draft before approving it; webhook
-- signatures are verified in the database (secret stays in Supabase Vault,
-- so n8n needs no environment variables or plaintext secrets).
-- No changes to existing tables.
-- =====================================================================

-- Owner edits a draft that is still waiting for approval. The text is theirs:
-- it's sent in their name, so we only bound its size.
create or replace function update_email_draft(p_email_id uuid, p_subject text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid;
begin
  if coalesce(length(btrim(p_subject)), 0) not between 1 and 200
     or coalesce(length(btrim(p_body)), 0) not between 1 and 20000 then
    raise exception 'Subject or body out of bounds';
  end if;

  update emails e
  set subject = btrim(p_subject), body_text = btrim(p_body), body_html = null
  from claims c
  where e.id = p_email_id and e.claim_id = c.id and c.owner_id = auth.uid()
    and e.direction = 'outbound' and e.status = 'pending_approval'
  returning e.claim_id into v_claim;
  if v_claim is null then raise exception 'Email not found or not pending approval'; end if;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (v_claim, 'email_edited', jsonb_build_object('email_id', p_email_id), 'user');
end $$;

-- Owner discards a draft. It's kept (status `ignored`) for the record, and a new
-- draft can be requested: email_draft_context skips ignored emails.
create or replace function discard_email_draft(p_email_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid;
begin
  update emails e
  set status = 'ignored'
  from claims c
  where e.id = p_email_id and e.claim_id = c.id and c.owner_id = auth.uid()
    and e.direction = 'outbound' and e.status = 'pending_approval'
  returning e.claim_id into v_claim;
  if v_claim is null then raise exception 'Email not found or not pending approval'; end if;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (v_claim, 'email_discarded', jsonb_build_object('email_id', p_email_id), 'user');
end $$;

revoke execute on function update_email_draft(uuid, text, text), discard_email_draft(uuid) from public, anon;
grant execute on function update_email_draft(uuid, text, text), discard_email_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- verify_webhook_signature (n8n): same contract as lib/n8n/signature.ts:
--   X-AirClaims-Signature = sha256=hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`)),
--   timestamp within 300 s. Secret: Vault `airclaims_webhook_secret` (see 0008).
-- ---------------------------------------------------------------------
create or replace function verify_webhook_signature(p_timestamp text, p_body text, p_signature text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'airclaims_webhook_secret';
  if v_secret is null or coalesce(p_timestamp, '') !~ '^[0-9]{1,12}$'
     or abs(extract(epoch from now()) - p_timestamp::bigint) > 300 then
    return jsonb_build_object('valid', false);
  end if;
  return jsonb_build_object('valid',
    'sha256=' || encode(hmac(p_timestamp || '.' || coalesce(p_body, ''), v_secret, 'sha256'), 'hex')
      = coalesce(p_signature, ''));
end $$;

revoke execute on function verify_webhook_signature(text, text, text) from public, anon, authenticated;
grant execute on function verify_webhook_signature(text, text, text) to service_role;
