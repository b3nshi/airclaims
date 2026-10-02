-- =====================================================================
-- 0019 — airline answers belong to a flow, and claim numbers are editable.
--   * airline_responses.purpose: the answer is about the compensation claim or the
--     separate expenses claim (e.g. Wizz: two submissions, two claim numbers, two answers).
--     Only compensation answers move the claim's status.
--   * claims.airline_expenses_reference: the expenses claim's own number (was only in
--     the expenses_submitted event).
--   * update_claim_references: the passenger corrects or adds either number.
--   * set_airline_response_purpose: move an answer to the other flow (it is read again).
-- Schema change: two new columns on existing tables (approved 2026-10-02).
-- =====================================================================

alter table airline_responses
  add column purpose text not null default 'compensation' check (purpose in ('compensation', 'expenses'));

alter table claims add column airline_expenses_reference text;

-- The number already given when the expenses were submitted.
update claims c
set airline_expenses_reference = left(e.payload->>'reference', 100)
from (select distinct on (claim_id) claim_id, payload from claim_events
      where event_type = 'expenses_submitted' and nullif(btrim(payload->>'reference'), '') is not null
      order by claim_id, created_at desc) e
where e.claim_id = c.id and c.airline_expenses_reference is null;

-- ---------------------------------------------------------------------
-- Claim numbers.
-- ---------------------------------------------------------------------
create or replace function record_expenses_submission(p_claim_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ref text := nullif(btrim(p_reference), '');
begin
  if v_ref is not null and length(v_ref) > 100 then raise exception 'Reference too long'; end if;
  update claims set airline_expenses_reference = coalesce(v_ref, airline_expenses_reference)
  where id = p_claim_id and owner_id = auth.uid()
    and status in ('ready_to_submit','documents_pending','submitted_airline','airline_replied');
  if not found then raise exception 'Claim not found or not open'; end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (p_claim_id, 'expenses_submitted', jsonb_build_object('reference', v_ref), 'user');
end $$;

-- Empty clears a number. Only for claims that went (or are going) to the airline.
create or replace function update_claim_references(p_claim_id uuid, p_compensation text, p_expenses text) returns void
language plpgsql security definer set search_path = public as $$
declare
  c claims;
  v_comp text := nullif(btrim(p_compensation), '');
  v_exp text := nullif(btrim(p_expenses), '');
begin
  if length(v_comp) > 100 or length(v_exp) > 100 then raise exception 'Reference too long'; end if;
  select * into c from claims where id = p_claim_id and owner_id = auth.uid() for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status in ('draft', 'withdrawn') then raise exception 'Claim not sent'; end if;
  if c.airline_claim_reference is not distinct from v_comp and c.airline_expenses_reference is not distinct from v_exp then
    return;
  end if;

  update claims set airline_claim_reference = v_comp, airline_expenses_reference = v_exp where id = c.id;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'references_updated', jsonb_build_object(
    'compensation', jsonb_build_object('from', c.airline_claim_reference, 'to', v_comp),
    'expenses', jsonb_build_object('from', c.airline_expenses_reference, 'to', v_exp)), 'user');
end $$;

-- ---------------------------------------------------------------------
-- Report an answer (pasted by the passenger) for one of the two flows.
-- Replaces the 0016 signature.
-- ---------------------------------------------------------------------
drop function report_airline_response(uuid, text, date, text, text);
create function report_airline_response(p_claim_id uuid, p_purpose text, p_channel text, p_received_on date,
                                        p_airline_text text, p_explanation text, p_reference text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c claims;
  v_id uuid;
  v_ref text := nullif(btrim(p_reference), '');
begin
  select * into c from claims where id = p_claim_id and owner_id = auth.uid() for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status in ('draft', 'won', 'partially_won', 'lost', 'withdrawn') then raise exception 'Claim not open with the airline'; end if;
  if p_purpose not in ('compensation', 'expenses') then raise exception 'Invalid purpose'; end if;
  if p_channel not in ('web_form', 'email', 'letter', 'phone', 'chat', 'other') then raise exception 'Invalid channel'; end if;
  if p_received_on is null or p_received_on > current_date or p_received_on < c.flight_date then raise exception 'Invalid date'; end if;
  if length(v_ref) > 100 then raise exception 'Reference too long'; end if;
  if coalesce(length(btrim(p_airline_text)), 0) + coalesce(length(btrim(p_explanation)), 0) = 0 then
    raise exception 'Nothing to report';
  end if;

  insert into airline_responses (claim_id, reported_by, purpose, channel, received_on, airline_text, user_explanation)
  values (c.id, auth.uid(), p_purpose, p_channel, p_received_on, left(nullif(btrim(p_airline_text), ''), 20000),
          left(nullif(btrim(p_explanation), ''), 5000))
  returning id into v_id;

  -- The claim number the answer gives (typed by the passenger) becomes that flow's number.
  if v_ref is not null then
    if p_purpose = 'compensation' then
      update claims set airline_claim_reference = v_ref where id = c.id;
    else
      update claims set airline_expenses_reference = v_ref where id = c.id;
    end if;
  end if;

  -- The airline has answered the compensation claim. If the claim hadn't been marked as sent
  -- (e.g. the airline's form refused it on the spot), the answer's date is when the passenger claimed.
  if p_purpose = 'compensation' and c.status in ('ready_to_submit', 'documents_pending', 'submitted_airline') then
    update claims
    set status = 'airline_replied',
        submitted_airline_at = coalesce(submitted_airline_at, (p_received_on + time '12:00') at time zone 'Europe/Madrid')
    where id = c.id;
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', 'airline_replied', 'response_id', v_id), 'user');
  end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'airline_response_reported',
          jsonb_build_object('response_id', v_id, 'channel', p_channel, 'purpose', p_purpose), 'user');
  return v_id;
end $$;

-- The passenger moves an answer to the other flow; it is read again with the right context.
create or replace function set_airline_response_purpose(p_response_id uuid, p_purpose text) returns void
language plpgsql security definer set search_path = public as $$
declare
  r airline_responses;
begin
  if p_purpose not in ('compensation', 'expenses') then raise exception 'Invalid purpose'; end if;
  select * into r from airline_responses where id = p_response_id and reported_by = auth.uid() for update;
  if r.id is null then raise exception 'Response not found'; end if;
  if r.purpose = p_purpose then return; end if;
  update airline_responses
  set purpose = p_purpose, status = 'pending', attempts = 0, locked_at = null, analysis = null, analyzed_at = null
  where id = r.id;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (r.claim_id, 'airline_response_moved', jsonb_build_object('response_id', r.id, 'from', r.purpose, 'to', p_purpose), 'user');
end $$;

-- ---------------------------------------------------------------------
-- n8n: the model knows which flow the answer is about (and, for answers that
-- reached us by email, says so — they arrive as compensation by default).
-- ---------------------------------------------------------------------
create or replace function airline_response_context(p_response_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r airline_responses;
  c claims;
  pr profiles;
begin
  select * into r from airline_responses where id = p_response_id;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if r.status = 'analyzed' then return jsonb_build_object('ok', false, 'reason', 'already_analyzed'); end if;
  select * into c from claims where id = r.claim_id;
  select * into pr from profiles where id = c.owner_id;
  return jsonb_build_object(
    'ok', true,
    'ai', jsonb_build_object(
      'claim', claim_facts_json(c.id) || jsonb_build_object('airline_expenses_reference', c.airline_expenses_reference),
      'airline_answer', jsonb_build_object('channel', r.channel, 'received_on', r.received_on, 'text', r.airline_text,
                                           'source', r.source,
                                           -- reported: chosen by the passenger; otherwise our default, to be checked
                                           'purpose', r.purpose, 'purpose_confirmed', r.source = 'reported'),
      'passenger_explanation', r.user_explanation,
      'known_airline_patterns', coalesce((select jsonb_agg(i.summary) from airline_insights i
                                          where i.verified
                                            and i.topic in ('rejection_pattern', 'payment_practice', 'claim_process')
                                            and i.airline_id in (select o.id from airlines o, airlines me
                                                                 where me.id = c.airline_id
                                                                   and (o.id = me.id or o.group_id = me.group_id))), '[]'),
      'summary_language', coalesce(pr.preferred_locale, 'es')),
    'meta', jsonb_build_object('claim_id', c.id, 'response_id', r.id)
  );
end $$;

drop function apply_airline_response_analysis(uuid, jsonb);
create function apply_airline_response_analysis(p_response_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r airline_responses;
  c claims;
  pr profiles;
begin
  update airline_responses
  set analysis = p, status = 'analyzed', analyzed_at = now(), locked_at = null,
      -- An emailed answer about the expenses claim moves to that flow (the passenger can move it back).
      purpose = case when source <> 'reported' and p->>'concerns' = 'expenses' then 'expenses' else purpose end
  where id = p_response_id and status <> 'analyzed'
  returning * into r;
  if r.id is null then return null; end if;  -- idempotent

  select * into c from claims where id = r.claim_id for update;
  -- A forwarded or direct answer to the compensation claim that is substantive means the airline has replied.
  if r.source <> 'reported' and r.purpose = 'compensation'
     and c.status in ('ready_to_submit', 'documents_pending', 'submitted_airline')
     and p->>'kind' in ('auto_rejection', 'rejection', 'offer', 'request_info', 'payment_confirmed') then
    update claims
    set status = 'airline_replied',
        submitted_airline_at = coalesce(submitted_airline_at, (r.received_on + time '12:00') at time zone 'Europe/Madrid')
    where id = c.id;
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', 'airline_replied', 'response_id', r.id), 'ai');
  end if;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (r.claim_id, 'airline_response_analyzed', jsonb_build_object(
    'response_id', r.id, 'source', r.source, 'kind', p->>'kind', 'purpose', r.purpose,
    'reasons', (select jsonb_agg(x->>'code') from jsonb_array_elements(coalesce(p->'reasons', '[]')) x)), 'ai');
  insert into review_queue (kind, email_id, claim_id, note)
  values ('email_needs_attention', r.email_id, r.claim_id,
          'airline answer (' || r.source || ', ' || r.purpose || '): ' || coalesce(p->>'kind', 'unknown'));

  select * into pr from profiles where id = c.owner_id;
  return jsonb_build_object(
    'claim_id', c.id, 'source', r.source, 'summary', left(p->>'summary', 1000),
    -- Passengers who reported it on the dashboard are already looking at it.
    'notify', r.source <> 'reported',
    'notify_email', pr.personal_email, 'notify_locale', pr.preferred_locale,
    'recipient_label', coalesce((select name from airlines where id = c.airline_id), c.flight_iata));
end $$;

-- The reply is about the same flow as the answer (and quotes that flow's claim number).
create or replace function challenge_draft_context(p_claim_id uuid, p_response_id uuid, p_options jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c claims;
  r airline_responses;
  pr profiles;
  v_recipient jsonb;
begin
  select * into c from claims where id = p_claim_id;
  select * into r from airline_responses where id = p_response_id and claim_id = p_claim_id;
  if c.id is null or r.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if c.status in ('draft', 'won', 'partially_won', 'lost', 'withdrawn') then
    return jsonb_build_object('ok', false, 'reason', 'claim_not_open_with_airline');
  end if;
  if not exists (select 1 from agreements where claim_id = c.id and kind = 'email_authorization') then
    return jsonb_build_object('ok', false, 'reason', 'no_email_authorization');
  end if;
  if exists (select 1 from emails where claim_id = c.id and direction = 'outbound'
             and status in ('pending_approval', 'approved', 'sending')) then
    return jsonb_build_object('ok', false, 'reason', 'draft_pending');
  end if;
  select * into pr from profiles where id = c.owner_id;
  v_recipient := challenge_recipient(c.id);

  return jsonb_build_object(
    'ok', true,
    'ai', claim_facts_json(c.id) || jsonb_build_object(
      'template', 'challenge',
      'delivery', v_recipient->>'mode',   -- email | paste (into the airline's form)
      'answer_purpose', r.purpose,        -- compensation | expenses
      'airline_expenses_reference', c.airline_expenses_reference,
      'airline_answer', jsonb_build_object('channel', r.channel, 'received_on', r.received_on, 'text', left(r.airline_text, 8000)),
      'answer_analysis', r.analysis - 'options',
      'passenger_explanation', r.user_explanation,
      'options', jsonb_build_object(
        'request_evidence', coalesce((p_options->>'request_evidence')::boolean, false),
        'contest_delay', coalesce((p_options->>'contest_delay')::boolean, false),
        'decline_offer', coalesce((p_options->>'decline_offer')::boolean, false),
        'mention_aesa', coalesce((p_options->>'mention_aesa')::boolean, false),
        'include_expenses', coalesce((p_options->>'include_expenses')::boolean, false),
        'deadline_days', least(greatest(coalesce((p_options->>'deadline_days')::int, 14), 7), 30),
        'passenger_notes', left(p_options->>'passenger_notes', 2000))),
    'meta', jsonb_build_object('claim_id', c.id, 'recipient_label', v_recipient->>'label',
                               'notify_email', pr.personal_email, 'notify_locale', pr.preferred_locale)
  );
end $$;

revoke execute on function report_airline_response(uuid, text, text, date, text, text, text),
  update_claim_references(uuid, text, text), set_airline_response_purpose(uuid, text),
  apply_airline_response_analysis(uuid, jsonb) from public, anon;
grant execute on function report_airline_response(uuid, text, text, date, text, text, text),
  update_claim_references(uuid, text, text), set_airline_response_purpose(uuid, text) to authenticated;
revoke execute on function apply_airline_response_analysis(uuid, jsonb) from authenticated;
grant execute on function apply_airline_response_analysis(uuid, jsonb) to service_role;
