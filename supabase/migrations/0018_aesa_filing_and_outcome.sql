-- =====================================================================
-- 0018 — the last stages of a claim's lifecycle, recorded by the passenger:
--   * they filed the claim with AESA (or the national enforcement body);
--   * the outcome: paid in full, partly paid, or rejected for good.
-- No table structure changes.
-- =====================================================================

create or replace function mark_aesa_filed(p_claim_id uuid, p_filed_on date, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c claims;
  v_ref text := nullif(btrim(p_reference), '');
begin
  select * into c from claims where id = p_claim_id and owner_id = auth.uid() for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status not in ('submitted_airline', 'airline_replied') then raise exception 'Claim not with the airline'; end if;
  if p_filed_on is null or p_filed_on > current_date or p_filed_on < c.flight_date then raise exception 'Invalid date'; end if;
  if v_ref is not null and length(v_ref) > 100 then raise exception 'Reference too long'; end if;

  update claims set status = 'escalated_aesa' where id = c.id;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', 'escalated_aesa'), 'user'),
         (c.id, 'aesa_filed', jsonb_build_object('filed_on', p_filed_on, 'reference', v_ref), 'user');
end $$;

-- p_outcome: won (paid in full) | partially_won | lost. Never used to accept an offer on the
-- passenger's behalf: they record what actually happened.
create or replace function record_claim_outcome(p_claim_id uuid, p_outcome text, p_amount_received numeric) returns void
language plpgsql security definer set search_path = public as $$
declare
  c claims;
begin
  select * into c from claims where id = p_claim_id and owner_id = auth.uid() for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status not in ('submitted_airline', 'airline_replied', 'escalated_aesa', 'escalated_court') then
    raise exception 'Claim not open';
  end if;
  if p_outcome not in ('won', 'partially_won', 'lost') then raise exception 'Invalid outcome'; end if;
  if p_amount_received is not null and (p_amount_received < 0 or p_amount_received > 100000) then
    raise exception 'Invalid amount';
  end if;

  update claims
  set status = p_outcome::claim_status,
      resolved_at = now(),
      amount_received_eur = case when p_outcome = 'lost' then 0 else p_amount_received end
  where id = c.id;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', p_outcome), 'user'),
         (c.id, 'outcome_recorded', jsonb_build_object('outcome', p_outcome, 'amount_received_eur', p_amount_received), 'user');
  -- Someone checks every recorded outcome (fees, stats).
  insert into review_queue (kind, claim_id, note) values ('email_needs_attention', c.id, 'outcome recorded: ' || p_outcome);
end $$;

revoke execute on function mark_aesa_filed(uuid, date, text), record_claim_outcome(uuid, text, numeric) from public, anon;
grant execute on function mark_aesa_filed(uuid, date, text), record_claim_outcome(uuid, text, numeric) to authenticated;
