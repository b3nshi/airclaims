-- =====================================================================
-- 0008 — M4: email drafting and sending (called by n8n with the service role).
-- Principles encoded here, not in the workflows:
--   * the recipient always comes from curated airline_contacts, never from the AI;
--   * only emails the user approved are sent, each at most once;
--   * the first claim email that is sent starts the airline's one-month clock.
-- No changes to existing tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Webhook idempotency (all workflows): first caller with a key wins.
-- ---------------------------------------------------------------------
create table processed_webhooks (
  key         text primary key,
  workflow    text not null,
  created_at  timestamptz not null default now()
);
alter table processed_webhooks enable row level security;  -- service role only

-- Returns {"claimed": true|false} (an object, so n8n can branch on it).
create or replace function claim_webhook_key(p_key text, p_workflow text) returns jsonb
language sql security definer set search_path = public as $$
  with ins as (
    insert into processed_webhooks (key, workflow) values (p_key, p_workflow)
    on conflict (key) do nothing
    returning 1
  )
  select jsonb_build_object('claimed', exists (select 1 from ins))
$$;

-- Let a failed run be retried with the same key.
create or replace function release_webhook_key(p_key text) returns void
language sql security definer set search_path = public as $$
  delete from processed_webhooks where key = p_key
$$;

create or replace function log_claim_event(p_claim_id uuid, p_event_type text, p_payload jsonb) returns void
language sql security definer set search_path = public as $$
  insert into claim_events (claim_id, event_type, payload, actor)
  values (p_claim_id, p_event_type, coalesce(p_payload, '{}'::jsonb), 'system')
$$;

-- ---------------------------------------------------------------------
-- email_draft_context: everything the AI needs to draft, and nothing else.
-- `ai` goes to the model; `meta` stays in n8n (recipient label, notification).
-- ---------------------------------------------------------------------
create or replace function email_draft_context(p_claim_id uuid, p_template text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c claims;
  a airlines;
  contact airline_contacts;
  p profiles;
  v_first_claim emails;
  dep airports; arr airports; fin airports;
begin
  if p_template not in ('initial_claim', 'follow_up') then
    return jsonb_build_object('ok', false, 'reason', 'unknown_template');
  end if;
  select * into c from claims where id = p_claim_id;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'claim_not_found'); end if;
  if not exists (select 1 from agreements where claim_id = c.id and kind = 'email_authorization') then
    return jsonb_build_object('ok', false, 'reason', 'no_email_authorization');
  end if;
  select * into a from airlines where id = c.airline_id;
  select * into contact from airline_contacts
    where airline_id = c.airline_id and purpose = 'compensation' and channel = 'email'
    order by verified_at desc nulls last limit 1;
  if contact.id is null then return jsonb_build_object('ok', false, 'reason', 'no_email_contact'); end if;

  -- The first sent airline email (if any) is the claim itself.
  select * into v_first_claim from emails
    where claim_id = c.id and direction = 'outbound' and status = 'sent' and to_addresses @> array[contact.value]
    order by sent_at limit 1;

  if p_template = 'initial_claim' then
    if c.status not in ('ready_to_submit', 'documents_pending') then
      return jsonb_build_object('ok', false, 'reason', 'claim_not_ready');
    end if;
    if exists (select 1 from emails where claim_id = c.id and direction = 'outbound'
               and status not in ('failed', 'ignored')) then
      return jsonb_build_object('ok', false, 'reason', 'already_drafted');
    end if;
  else -- follow_up
    if c.status <> 'submitted_airline' or c.submitted_airline_at is null or v_first_claim.id is null then
      return jsonb_build_object('ok', false, 'reason', 'not_submitted_by_email');
    end if;
    if exists (select 1 from emails where claim_id = c.id and direction = 'outbound'
               and status in ('pending_approval', 'approved', 'sending')) then
      return jsonb_build_object('ok', false, 'reason', 'draft_pending');
    end if;
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
                          'airline_reference', c.airline_claim_reference) end
    ),
    'meta', jsonb_build_object(
      'claim_id', c.id,
      'recipient_label', contact.label,
      'notify_email', p.personal_email,
      'notify_locale', p.preferred_locale
    )
  );
end $$;

-- ---------------------------------------------------------------------
-- insert_email_draft: the AI's text + our recipient → pending_approval.
-- ---------------------------------------------------------------------
create or replace function insert_email_draft(p_claim_id uuid, p_template text, p_subject text, p_body text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  c claims;
  contact airline_contacts;
  v_id uuid;
  v_in_reply_to text;
  v_attachments jsonb := '[]';
begin
  if coalesce(length(btrim(p_subject)), 0) not between 5 and 200
     or coalesce(length(btrim(p_body)), 0) not between 200 and 20000 then
    raise exception 'Draft subject or body out of bounds';
  end if;
  select * into c from claims where id = p_claim_id for update;
  select * into contact from airline_contacts
    where airline_id = c.airline_id and purpose = 'compensation' and channel = 'email'
    order by verified_at desc nulls last limit 1;
  if contact.id is null then raise exception 'No email contact for this airline'; end if;

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
  else
    select message_id into v_in_reply_to from emails
     where claim_id = c.id and direction = 'outbound' and status = 'sent' and message_id is not null
     order by sent_at desc limit 1;
  end if;

  insert into emails (claim_id, direction, status, classification, from_address, to_addresses,
                      recipient_label, subject, body_text, attachments, in_reply_to)
  values (c.id, 'outbound', 'pending_approval', 'airline',
          'airclaims_' || c.alias_code || '@airclaims.klivr.com', array[contact.value],
          contact.label, btrim(p_subject), btrim(p_body), v_attachments, v_in_reply_to)
  returning id into v_id;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'email_drafted', jsonb_build_object('email_id', v_id, 'template', p_template), 'ai');
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Sending. Approved → sending (lease) → sent | failed. At most once: a
-- message stuck in `sending` is never retried, it's failed for a human.
-- ---------------------------------------------------------------------
create or replace function claim_approved_emails(p_limit int default 5) returns table (
  id uuid, claim_id uuid, from_address text, sender_name text, to_addresses text[], cc_addresses text[],
  subject text, body_text text, attachments jsonb, in_reply_to text
)
language plpgsql security definer set search_path = public as $$
begin
  with stuck as (
    update emails e set status = 'failed'
    where e.status = 'sending' and e.approved_at < now() - interval '30 minutes'
    returning e.id, e.claim_id
  )
  insert into claim_events (claim_id, event_type, payload, actor)
  select s.claim_id, 'email_failed', jsonb_build_object('email_id', s.id, 'error', 'send not confirmed'), 'system'
  from stuck s;

  return query
  with leased as (
    update emails e set status = 'sending'
    where e.id in (select x.id from emails x
                   where x.status = 'approved' and x.direction = 'outbound'
                   order by x.approved_at
                   limit greatest(1, least(p_limit, 20))
                   for update skip locked)
    returning e.*
  )
  select l.id, l.claim_id, l.from_address,
         (select full_name from claim_passengers cp where cp.claim_id = l.claim_id and cp.is_lead limit 1),
         l.to_addresses, l.cc_addresses, l.subject, l.body_text, l.attachments, l.in_reply_to
  from leased l;
end $$;

create or replace function mark_email_sent(p_email_id uuid, p_message_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e emails;
  c claims;
  v_submitted boolean := false;
begin
  update emails set status = 'sent', sent_at = now(), message_id = p_message_id
  where id = p_email_id and status = 'sending'
  returning * into e;
  if e.id is null then return null; end if;  -- idempotent

  insert into claim_events (claim_id, event_type, payload, actor)
  values (e.claim_id, 'email_sent', jsonb_build_object('email_id', e.id, 'recipient', e.recipient_label), 'system');

  select * into c from claims where id = e.claim_id for update;
  if c.submitted_airline_at is null and c.status in ('ready_to_submit', 'documents_pending') then
    update claims set status = 'submitted_airline', submitted_airline_at = now() where id = c.id;
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', 'submitted_airline'), 'system');
    v_submitted := true;
  end if;

  return (select jsonb_build_object(
            'claim_id', c.id, 'recipient_label', e.recipient_label, 'claim_submitted', v_submitted,
            'notify_email', p.personal_email, 'notify_locale', p.preferred_locale)
          from profiles p where p.id = c.owner_id);
end $$;

create or replace function mark_email_failed(p_email_id uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid;
begin
  update emails set status = 'failed' where id = p_email_id and status = 'sending' returning claim_id into v_claim;
  if v_claim is not null then
    insert into claim_events (claim_id, event_type, payload, actor)
    values (v_claim, 'email_failed', jsonb_build_object('email_id', p_email_id, 'error', left(p_error, 500)), 'system');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Poke n8n when the user approves (Supabase pg_net + Vault). The body is
-- empty, so the HMAC is over `${timestamp}.{}`; n8n leases work itself.
-- Setup (once, SQL editor):
--   select vault.create_secret('https://labs.klivr.com/webhook', 'airclaims_n8n_base_url');
--   select vault.create_secret('<same as N8N_WEBHOOK_SECRET>', 'airclaims_webhook_secret');
-- Never blocks the approval: without secrets or pg_net, the 5-minute sweep sends it.
-- ---------------------------------------------------------------------
create extension if not exists pg_net;

create or replace function notify_email_approved() returns trigger
language plpgsql security definer set search_path = public, extensions as $$  -- hmac() lives in extensions on Supabase
declare
  v_url text;
  v_secret text;
  v_ts text := extract(epoch from now())::bigint::text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'airclaims_n8n_base_url';
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'airclaims_webhook_secret';
    if v_url is not null and v_secret is not null then
      perform net.http_post(
        url := rtrim(v_url, '/') || '/airclaim-email-send',
        body := '{}'::jsonb,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'X-AirClaims-Timestamp', v_ts,
          'X-AirClaims-Signature', 'sha256=' || encode(hmac(v_ts || '.{}', v_secret, 'sha256'), 'hex'),
          'X-AirClaims-Idempotency-Key', 'email-send:' || new.id)
      );
    end if;
  exception when others then
    raise warning 'notify_email_approved: %', sqlerrm;
  end;
  return null;
end $$;

create trigger trg_email_approved
after update of status on emails
for each row
when (new.status = 'approved' and old.status is distinct from 'approved')
execute function notify_email_approved();

-- ---------------------------------------------------------------------
revoke execute on function claim_webhook_key(text, text), release_webhook_key(text),
  log_claim_event(uuid, text, jsonb), email_draft_context(uuid, text),
  insert_email_draft(uuid, text, text, text), claim_approved_emails(int),
  mark_email_sent(uuid, text), mark_email_failed(uuid, text), notify_email_approved()
  from public, anon, authenticated;
grant execute on function claim_webhook_key(text, text), release_webhook_key(text),
  log_claim_event(uuid, text, jsonb), email_draft_context(uuid, text),
  insert_email_draft(uuid, text, text, text), claim_approved_emails(int),
  mark_email_sent(uuid, text), mark_email_failed(uuid, text)
  to service_role;
