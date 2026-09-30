-- =====================================================================
-- 0016 — "The airline answered": the passenger reports the airline's answer
-- (a web form's automatic verdict, an email, a letter, a call), explains
-- what happened in their own words, and gets an AI reading of it plus a
-- reply they choose the contents of (ask for proof of the extraordinary
-- circumstance, contest the delay calculation, decline an offer, mention AESA…).
--   * The reply is an email draft to approve when the airline has an email
--     contact; otherwise a text to paste into the airline's form (status
--     `draft`: editable, copyable, never sent by us).
--   * Nothing is accepted or sent without the passenger.
-- New table airline_responses; no changes to existing table structures.
-- =====================================================================

create table airline_responses (
  id                uuid primary key default gen_random_uuid(),
  claim_id          uuid not null references claims(id) on delete cascade,
  reported_by       uuid not null references profiles(id) on delete cascade,
  channel           text not null check (channel in ('web_form', 'email', 'letter', 'phone', 'chat', 'other')),
  received_on       date not null,
  airline_text      text,          -- what the airline said, pasted by the passenger
  user_explanation  text,          -- what happened, in the passenger's own words
  status            text not null default 'pending' check (status in ('pending', 'analyzed', 'failed')),
  analysis          jsonb,         -- AI reading (see airline-response prompt)
  analyzed_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index airline_responses_claim_idx on airline_responses (claim_id, created_at desc);
alter table airline_responses enable row level security;
revoke all on airline_responses from anon;
create policy "own responses read" on airline_responses for select using (reported_by = auth.uid());
create policy "admin read responses" on airline_responses for select to authenticated using (is_admin());
-- Writes go through report_airline_response (users) and the analysis RPCs (n8n).
revoke insert, update, delete on airline_responses from authenticated;

-- ---------------------------------------------------------------------
-- The claim's facts for the model (no personal email, no airline address).
-- ---------------------------------------------------------------------
create or replace function claim_facts_json(p_claim_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'language', a.preferred_language,
    'airline', a.name,
    'reply_to', 'airclaims_' || c.alias_code || '@airclaims.klivr.com',
    'lead_passenger', (select full_name from claim_passengers where claim_id = c.id and is_lead limit 1),
    'passengers_with_paid_ticket', coalesce((select jsonb_agg(full_name order by is_lead desc, full_name)
                                             from claim_passengers where claim_id = c.id and not is_infant_free), '[]'),
    'flight', jsonb_build_object(
      'number', c.flight_iata, 'date', c.flight_date,
      'from', coalesce(dep.city || ' (' || dep.iata || ')', c.dep_iata),
      'to', coalesce(arr.city || ' (' || arr.iata || ')', c.arr_iata),
      'final_destination', coalesce(fin.city || ' (' || fin.iata || ')', c.final_destination_iata, c.arr_iata),
      'booking_reference', c.booking_reference),
    'disruption', c.disruption,
    'arrival_delay_minutes', c.reported_arrival_delay_minutes,
    'reported_times', jsonb_build_object(
      'scheduled_departure_local', c.reported_scheduled_dep_local, 'actual_departure_local', c.reported_actual_dep_local,
      'scheduled_arrival_local', c.reported_scheduled_arr_local, 'actual_arrival_local', c.reported_actual_arr_local,
      'arrival_is_estimate', c.arrival_time_estimated),
    'flight_data', (select jsonb_build_object('scheduled_departure', f.scheduled_dep, 'actual_departure', f.actual_dep,
                                              'scheduled_arrival', f.scheduled_arr, 'actual_arrival', f.actual_arr,
                                              'status', f.status, 'source', f.source)
                    from flights f where f.id = c.flight_id),
    'cancellation_notice_days', c.cancellation_notice_days,
    'alternative_flight', c.care_provided->'rerouting',
    'care_provided_by_airline', c.care_provided - 'rerouting',
    'reason_given_by_airline', c.reason_given_by_airline,
    'staff_instructions', c.airline_instructions,
    'compensation_per_passenger_eur', (select max(compensation_eur) from claim_passengers where claim_id = c.id),
    'compensation_total_eur', c.compensation_eur,
    'expenses', coalesce((select jsonb_agg(jsonb_build_object(
                  'category', e.category, 'amount', e.amount, 'currency', e.currency, 'date', e.spent_at::date,
                  'description', e.description, 'airline_instructed', e.airline_promised,
                  'receipt_attached', e.document_id is not null) order by e.spent_at)
                from claim_expenses e where e.claim_id = c.id), '[]'),
    'claim_submitted_on', c.submitted_airline_at::date,
    'airline_reference', c.airline_claim_reference,
    'enforcement_body', case when dep.country_code = 'ES' then 'AESA (Agencia Estatal de Seguridad Aérea)'
                             else 'the competent national enforcement body' end,
    'departs_spain', dep.country_code = 'ES'
  )
  from claims c
  left join airlines a on a.id = c.airline_id
  left join airports dep on dep.iata = c.dep_iata
  left join airports arr on arr.iata = c.arr_iata
  left join airports fin on fin.iata = coalesce(c.final_destination_iata, c.arr_iata)
  where c.id = p_claim_id
$$;

-- ---------------------------------------------------------------------
-- Users: report the airline's answer.
-- ---------------------------------------------------------------------
create or replace function report_airline_response(p_claim_id uuid, p_channel text, p_received_on date,
                                                   p_airline_text text, p_explanation text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c claims;
  v_id uuid;
begin
  select * into c from claims where id = p_claim_id and owner_id = auth.uid() for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status in ('draft', 'won', 'partially_won', 'lost', 'withdrawn') then raise exception 'Claim not open with the airline'; end if;
  if p_channel not in ('web_form', 'email', 'letter', 'phone', 'chat', 'other') then raise exception 'Invalid channel'; end if;
  if p_received_on is null or p_received_on > current_date or p_received_on < c.flight_date then raise exception 'Invalid date'; end if;
  if coalesce(length(btrim(p_airline_text)), 0) + coalesce(length(btrim(p_explanation)), 0) = 0 then
    raise exception 'Nothing to report';
  end if;

  insert into airline_responses (claim_id, reported_by, channel, received_on, airline_text, user_explanation)
  values (c.id, auth.uid(), p_channel, p_received_on, left(nullif(btrim(p_airline_text), ''), 20000),
          left(nullif(btrim(p_explanation), ''), 5000))
  returning id into v_id;

  -- The airline has answered. If the claim hadn't been marked as sent (e.g. the airline's form
  -- refused it on the spot), the date of that answer is when the passenger went to the airline.
  if c.status in ('ready_to_submit', 'documents_pending', 'submitted_airline') then
    update claims
    set status = 'airline_replied',
        submitted_airline_at = coalesce(submitted_airline_at, (p_received_on + time '12:00') at time zone 'Europe/Madrid')
    where id = c.id;
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', 'airline_replied', 'response_id', v_id), 'user');
  end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'airline_response_reported', jsonb_build_object('response_id', v_id, 'channel', p_channel), 'user');
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- n8n: read the answer (context in, analysis out).
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
      'claim', claim_facts_json(c.id),
      'airline_answer', jsonb_build_object('channel', r.channel, 'received_on', r.received_on, 'text', r.airline_text),
      'passenger_explanation', r.user_explanation,
      -- Verified patterns for this airline or its group (W4/W9 share Wizz's knowledge).
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

create or replace function apply_airline_response_analysis(p_response_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  r airline_responses;
begin
  update airline_responses set analysis = p, status = 'analyzed', analyzed_at = now()
  where id = p_response_id and status <> 'analyzed'
  returning * into r;
  if r.id is null then return; end if;  -- idempotent
  insert into claim_events (claim_id, event_type, payload, actor)
  values (r.claim_id, 'airline_response_analyzed', jsonb_build_object(
    'response_id', r.id, 'kind', p->>'kind',
    'reasons', (select jsonb_agg(x->>'code') from jsonb_array_elements(coalesce(p->'reasons', '[]')) x)), 'ai');
  -- A person looks at every airline answer too.
  insert into review_queue (kind, claim_id, note)
  values ('email_needs_attention', r.claim_id, 'airline answer reported: ' || coalesce(p->>'kind', 'unknown'));
end $$;

create or replace function fail_airline_response_analysis(p_response_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update airline_responses set status = 'failed', analysis = jsonb_build_object('error', left(p_error, 500))
  where id = p_response_id and status = 'pending'
$$;

-- ---------------------------------------------------------------------
-- The reply ("challenge"): context for the drafting model, and the draft.
-- p_options: {request_evidence, contest_delay, decline_offer, mention_aesa,
--             include_expenses, deadline_days, passenger_notes}
-- ---------------------------------------------------------------------
create or replace function challenge_recipient(p_claim_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('mode', 'email', 'address', ac.value, 'label', ac.label)
       from claims c join airline_contacts ac on ac.airline_id = c.airline_id
      where c.id = p_claim_id and ac.purpose = 'compensation' and ac.channel = 'email'
      order by ac.verified_at desc nulls last limit 1),
    (select jsonb_build_object('mode', 'paste', 'label',
              coalesce((select ac.label from airline_contacts ac where ac.airline_id = c.airline_id
                          and ac.channel = 'web_form' order by ac.purpose limit 1), a.name, 'Airline'))
       from claims c left join airlines a on a.id = c.airline_id where c.id = p_claim_id))
$$;

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

create or replace function insert_challenge_draft(p_claim_id uuid, p_response_id uuid, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c claims;
  v_recipient jsonb;
  v_id uuid;
begin
  if coalesce(length(btrim(p_subject)), 0) not between 5 and 200
     or coalesce(length(btrim(p_body)), 0) not between 200 and 20000 then
    raise exception 'Draft subject or body out of bounds';
  end if;
  select * into c from claims where id = p_claim_id for update;
  if not exists (select 1 from airline_responses where id = p_response_id and claim_id = c.id) then
    raise exception 'Response not found';
  end if;
  if exists (select 1 from emails where claim_id = c.id and direction = 'outbound'
             and status in ('pending_approval', 'approved', 'sending')) then
    raise exception 'A draft already exists';
  end if;
  v_recipient := challenge_recipient(c.id);

  insert into emails (claim_id, direction, status, classification, from_address, to_addresses,
                      recipient_label, subject, body_text, in_reply_to)
  values (c.id, 'outbound',
          -- A text to paste into a form is never sent by us: it stays a draft.
          case when v_recipient->>'mode' = 'email' then 'pending_approval'::email_status else 'draft'::email_status end,
          'airline', 'airclaims_' || c.alias_code || '@airclaims.klivr.com',
          case when v_recipient->>'mode' = 'email' then array[v_recipient->>'address'] else '{}'::text[] end,
          v_recipient->>'label', btrim(p_subject), btrim(p_body),
          (select message_id from emails where claim_id = c.id and direction = 'outbound' and status = 'sent'
             and message_id is not null order by sent_at desc limit 1))
  returning id into v_id;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'email_drafted', jsonb_build_object('email_id', v_id, 'template', 'challenge',
                                                    'response_id', p_response_id, 'delivery', v_recipient->>'mode'), 'ai');
  return v_id;
end $$;

-- Paste-texts (status `draft`) can be edited and discarded like drafts awaiting approval.
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
    and e.direction = 'outbound' and e.status in ('pending_approval', 'draft')
  returning e.claim_id into v_claim;
  if v_claim is null then raise exception 'Email not found or not editable'; end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (v_claim, 'email_edited', jsonb_build_object('email_id', p_email_id), 'user');
end $$;

create or replace function discard_email_draft(p_email_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid;
begin
  update emails e
  set status = 'ignored'
  from claims c
  where e.id = p_email_id and e.claim_id = c.id and c.owner_id = auth.uid()
    and e.direction = 'outbound' and e.status in ('pending_approval', 'draft')
  returning e.claim_id into v_claim;
  if v_claim is null then raise exception 'Email not found or not editable'; end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (v_claim, 'email_discarded', jsonb_build_object('email_id', p_email_id), 'user');
end $$;

-- ---------------------------------------------------------------------
revoke execute on function claim_facts_json(uuid), report_airline_response(uuid, text, date, text, text),
  airline_response_context(uuid), apply_airline_response_analysis(uuid, jsonb), fail_airline_response_analysis(uuid, text),
  challenge_recipient(uuid), challenge_draft_context(uuid, uuid, jsonb), insert_challenge_draft(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function report_airline_response(uuid, text, date, text, text) to authenticated;
grant execute on function airline_response_context(uuid), apply_airline_response_analysis(uuid, jsonb),
  fail_airline_response_analysis(uuid, text), challenge_draft_context(uuid, uuid, jsonb),
  insert_challenge_draft(uuid, uuid, text, text) to service_role;
