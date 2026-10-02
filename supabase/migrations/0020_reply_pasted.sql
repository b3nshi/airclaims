-- =====================================================================
-- 0020 — the passenger confirms they pasted a reply into the airline's web form.
-- Paste-texts (emails with status `draft`) are never sent by us, so this event is
-- how the answer flow knows the reply went out. Event only; no schema change.
-- =====================================================================

create or replace function mark_reply_pasted(p_email_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  e emails;
begin
  select m.* into e from emails m join claims c on c.id = m.claim_id
  where m.id = p_email_id and c.owner_id = auth.uid() and m.direction = 'outbound' and m.status = 'draft';
  if e.id is null then raise exception 'Reply not found'; end if;
  if exists (select 1 from claim_events where claim_id = e.claim_id and event_type = 'reply_pasted'
             and payload->>'email_id' = e.id::text) then
    return;  -- idempotent
  end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (e.claim_id, 'reply_pasted', jsonb_build_object('email_id', e.id), 'user');
end $$;

revoke execute on function mark_reply_pasted(uuid) from public, anon;
grant execute on function mark_reply_pasted(uuid) to authenticated;
