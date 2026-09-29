-- =====================================================================
-- 0011 — `offer_reply` drafts: decline a voucher / credit / miles / partial
-- offer and ask to be paid in money. Replaces email_draft_context and
-- insert_email_draft (0008) with a shared recipient rule:
--   * initial_claim / follow_up → the airline's curated email contact;
--   * offer_reply → the curated contact if there is one, otherwise the sender of
--     the offer, but only when its domain belongs to the airline (website or a
--     curated contact), so a spoofed "offer" can't make us write to a stranger.
-- No changes to existing tables.
-- =====================================================================

-- Is this address on one of the airline's known domains?
create or replace function airline_email_domain_ok(p_airline_id uuid, p_address text) returns boolean
language sql stable security definer set search_path = public as $$
  with sender as (select lower(split_part(btrim(p_address), '@', 2)) as d),
  known as (
    select regexp_replace(lower(substring(website from '^[a-z]+://([^/:]+)')), '^www\.', '') as d
      from airlines where id = p_airline_id and website is not null
    union
    select regexp_replace(lower(case when channel = 'email' then split_part(value, '@', 2)
                                     else substring(value from '^[a-z]+://([^/:]+)') end), '^www\.', '')
      from airline_contacts where airline_id = p_airline_id
  )
  select exists (select 1 from sender, known
                 where known.d is not null and known.d <> '' and sender.d <> ''
                   and (sender.d = known.d or sender.d like '%.' || known.d))
$$;

-- The offer the passenger may answer: the latest analysed message, if it offered
-- anything other than full payment in money.
create or replace function latest_offer_email(p_claim_id uuid) returns emails
language sql stable security definer set search_path = public as $$
  select e.* from emails e
  join (select (payload->>'email_id')::uuid as email_id, payload
          from claim_events
         where claim_id = p_claim_id and event_type = 'email_analyzed'
         order by id desc limit 1) ev on ev.email_id = e.id
  where coalesce((ev.payload->'settlement_offer'->>'detected')::boolean, false)
    and ev.payload->'settlement_offer'->>'kind' not in ('money_full', 'none')
$$;

-- Where a draft of this template goes: {address, label, in_reply_to} or {reason}.
create or replace function draft_recipient(p_claim_id uuid, p_template text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c claims;
  a airlines;
  contact airline_contacts;
  offer emails;
begin
  select * into c from claims where id = p_claim_id;
  select * into a from airlines where id = c.airline_id;
  select * into contact from airline_contacts
    where airline_id = c.airline_id and purpose = 'compensation' and channel = 'email'
    order by verified_at desc nulls last limit 1;

  if p_template = 'offer_reply' then
    offer := latest_offer_email(c.id);
    if offer.id is null then return jsonb_build_object('reason', 'no_offer_to_answer'); end if;
    if contact.id is not null then
      return jsonb_build_object('address', contact.value, 'label', contact.label, 'in_reply_to', offer.message_id);
    end if;
    if not airline_email_domain_ok(c.airline_id, offer.from_address) then
      return jsonb_build_object('reason', 'unverified_sender');
    end if;
    return jsonb_build_object('address', offer.from_address,
                              'label', coalesce(a.name, 'Airline') || ' (' || split_part(offer.from_address, '@', 2) || ')',
                              'in_reply_to', offer.message_id);
  end if;

  if contact.id is null then return jsonb_build_object('reason', 'no_email_contact'); end if;
  return jsonb_build_object('address', contact.value, 'label', contact.label,
    'in_reply_to', case when p_template = 'follow_up' then
      (select message_id from emails where claim_id = c.id and direction = 'outbound' and status = 'sent'
         and message_id is not null order by sent_at desc limit 1) end);
end $$;

-- ---------------------------------------------------------------------
create or replace function email_draft_context(p_claim_id uuid, p_template text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c claims;
  a airlines;
  p profiles;
  v_first_claim emails;
  v_offer emails;
  v_offer_event jsonb;
  v_recipient jsonb;
  dep airports; arr airports; fin airports;
begin
  if p_template not in ('initial_claim', 'follow_up', 'offer_reply') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_template');
  end if;
  select * into c from claims where id = p_claim_id;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'claim_not_found'); end if;
  if not exists (select 1 from agreements where claim_id = c.id and kind = 'email_authorization') then
    return jsonb_build_object('ok', false, 'reason', 'no_email_authorization');
  end if;
  select * into a from airlines where id = c.airline_id;

  v_recipient := draft_recipient(c.id, p_template);
  if v_recipient ? 'reason' then return jsonb_build_object('ok', false, 'reason', v_recipient->>'reason'); end if;

  -- The first sent email to the airline (if any) is the claim itself.
  select * into v_first_claim from emails
    where claim_id = c.id and direction = 'outbound' and status = 'sent'
    order by sent_at limit 1;

  if p_template = 'initial_claim' then
    if c.status not in ('ready_to_submit', 'documents_pending') then
      return jsonb_build_object('ok', false, 'reason', 'claim_not_ready');
    end if;
    if exists (select 1 from emails where claim_id = c.id and direction = 'outbound'
               and status not in ('failed', 'ignored')) then
      return jsonb_build_object('ok', false, 'reason', 'already_drafted');
    end if;
  else
    if p_template = 'follow_up'
       and (c.status <> 'submitted_airline' or c.submitted_airline_at is null or v_first_claim.id is null) then
      return jsonb_build_object('ok', false, 'reason', 'not_submitted_by_email');
    end if;
    if p_template = 'offer_reply' and c.status not in ('submitted_airline', 'airline_replied') then
      return jsonb_build_object('ok', false, 'reason', 'claim_not_open_with_airline');
    end if;
    if exists (select 1 from emails where claim_id = c.id and direction = 'outbound'
               and status in ('pending_approval', 'approved', 'sending')) then
      return jsonb_build_object('ok', false, 'reason', 'draft_pending');
    end if;
  end if;

  if p_template = 'offer_reply' then
    v_offer := latest_offer_email(c.id);
    select payload->'settlement_offer' into v_offer_event from claim_events
      where claim_id = c.id and event_type = 'email_analyzed' and payload->>'email_id' = v_offer.id::text
      order by id desc limit 1;
  end if;

  select * into p from profiles where id = c.owner_id;
  select * into dep from airports where iata = c.dep_iata;
  select * into arr from airports where iata = c.arr_iata;
  select * into fin from airports where iata = coalesce(c.final_destination_iata, c.arr_iata);

  return jsonb_build_object(
    'ok', true,
    'ai', jsonb_build_object(
      'template', p_template,
      'language', a.preferred_language,
      'airline', a.name,
      'reply_to', 'airclaims_' || c.alias_code || '@airclaims.klivr.com',
      'lead_passenger', (select full_name from claim_passengers where claim_id = c.id and is_lead limit 1),
      'passengers_with_paid_ticket', coalesce((select jsonb_agg(full_name order by is_lead desc, full_name)
                                               from claim_passengers where claim_id = c.id and not is_infant_free), '[]'),
      'flight', jsonb_build_object(
        'number', c.flight_iata,
        'date', c.flight_date,
        'from', coalesce(dep.city || ' (' || dep.iata || ')', c.dep_iata),
        'to', coalesce(arr.city || ' (' || arr.iata || ')', c.arr_iata),
        'final_destination', coalesce(fin.city || ' (' || fin.iata || ')', c.final_destination_iata, c.arr_iata),
        'booking_reference', c.booking_reference),
      'disruption', c.disruption,
      'arrival_delay_minutes', c.reported_arrival_delay_minutes,
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
                    'instruction_details', e.promise_details, 'receipt_attached', e.document_id is not null)
                    order by e.spent_at) from claim_expenses e where e.claim_id = c.id), '[]'),
      'enforcement_body', case when dep.country_code = 'ES'
                               then 'AESA (Agencia Estatal de Seguridad Aérea)'
                               else 'the competent national enforcement body' end,
      'original_claim', case when v_first_claim.id is null then null else jsonb_build_object(
                          'sent_on', v_first_claim.sent_at::date, 'subject', v_first_claim.subject,
                          'airline_reference', c.airline_claim_reference) end,
      -- offer_reply only: what the airline offered and their message (untrusted text, for reference).
      'offer', case when v_offer.id is null then null else jsonb_build_object(
                 'received_on', v_offer.received_at::date,
                 'subject', v_offer.subject,
                 'kind', v_offer_event->>'kind',
                 'amount', v_offer_event->'amount',
                 'currency', v_offer_event->>'currency',
                 'conditions', v_offer_event->>'conditions',
                 'airline_reference', c.airline_claim_reference,
                 'message_excerpt', left(v_offer.body_text, 4000)) end
    ),
    'meta', jsonb_build_object(
      'claim_id', c.id,
      'recipient_label', v_recipient->>'label',
      'notify_email', p.personal_email,
      'notify_locale', p.preferred_locale
    )
  );
end $$;

-- ---------------------------------------------------------------------
create or replace function insert_email_draft(p_claim_id uuid, p_template text, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c claims;
  v_recipient jsonb;
  v_id uuid;
  v_attachments jsonb := '[]';
begin
  if coalesce(length(btrim(p_subject)), 0) not between 5 and 200
     or coalesce(length(btrim(p_body)), 0) not between 200 and 20000 then
    raise exception 'Draft subject or body out of bounds';
  end if;
  select * into c from claims where id = p_claim_id for update;
  v_recipient := draft_recipient(c.id, p_template);
  if v_recipient ? 'reason' then raise exception 'No recipient: %', v_recipient->>'reason'; end if;

  -- Same guard as email_draft_context, under the claim row lock: one open draft at a time.
  if exists (select 1 from emails where claim_id = c.id and direction = 'outbound'
             and (status in ('pending_approval', 'approved', 'sending')
                  or (p_template = 'initial_claim' and status not in ('failed', 'ignored')))) then
    raise exception 'A draft already exists';
  end if;

  if p_template = 'initial_claim' then
    select coalesce(jsonb_agg(jsonb_build_object(
             'document_id', d.id, 'storage_path', d.storage_path, 'mime', d.mime_type,
             'filename', d.doc_type || '-' || d.n || '.' || split_part(d.storage_path, '.', 2))), '[]')
      into v_attachments
      from (select *, row_number() over (partition by doc_type order by created_at) as n
              from documents
             where claim_id = c.id and doc_type in ('boarding_pass', 'booking_confirmation', 'receipt')) d;
  end if;

  insert into emails (claim_id, direction, status, classification, from_address, to_addresses,
                      recipient_label, subject, body_text, attachments, in_reply_to)
  values (c.id, 'outbound', 'pending_approval', 'airline',
          'airclaims_' || c.alias_code || '@airclaims.klivr.com', array[v_recipient->>'address'],
          v_recipient->>'label', btrim(p_subject), btrim(p_body), v_attachments, v_recipient->>'in_reply_to')
  returning id into v_id;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'email_drafted', jsonb_build_object('email_id', v_id, 'template', p_template), 'ai');
  return v_id;
end $$;

revoke execute on function airline_email_domain_ok(uuid, text), latest_offer_email(uuid),
  draft_recipient(uuid, text), email_draft_context(uuid, text), insert_email_draft(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function email_draft_context(uuid, text), insert_email_draft(uuid, text, text, text) to service_role;
