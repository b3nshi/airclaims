-- =====================================================================
-- 0017 — when the passenger can't give the airline their claim address
-- (e.g. Wizz's form replies to the account email), they forward the
-- airline's emails to it — once, or with a mail filter for the airline's
-- domain. Every airline answer, whatever its route, becomes an
-- `airline_responses` entry and gets the same reading and reply options:
--   * reported   — pasted on the dashboard (0016)
--   * forwarded  — forwarded by the passenger to their claim address
--   * inbound    — sent by the airline straight to the claim address
-- Forwarded mail only counts when the passenger's mail authenticated
-- (DMARC/SPF/DKIM pass reported by Forward Email); otherwise a person reviews it.
-- Mail-provider forwarding confirmations (Gmail) are passed straight to the
-- passenger. The analysis now runs as a queue (lease), like flight checks.
-- Changes: new columns on airline_responses (added in 0016, not yet live).
-- =====================================================================

alter table airline_responses
  add column source     text not null default 'reported' check (source in ('reported', 'forwarded', 'inbound')),
  add column email_id   uuid references emails(id) on delete set null,
  add column attempts   int not null default 0,
  add column locked_at  timestamptz;
create index airline_responses_pending_idx on airline_responses (created_at) where status = 'pending';

-- ---------------------------------------------------------------------
-- Inbound ingest (replaces 0010). New inputs from the n8n parser:
--   p.forward_hint       — looks like a forward (Fwd:/RV:/TR:/WG:, "Forwarded message", attached .eml…)
--   p.auth_pass          — Forward Email's DMARC/SPF/DKIM check passed for the sender
--   p.verification_hint  — a mail provider's forwarding confirmation (e.g. Gmail's code)
-- Returns `mode`: analyze | forwarded | verification | none (and `needs_ai` = mode 'analyze').
-- ---------------------------------------------------------------------
create or replace function ingest_inbound_email(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_from text := lower(btrim(coalesce(p->>'from_address', '')));
  v_addresses text[];
  v_message_id text;
  v_code text;
  v_support boolean;
  c claims;
  pr profiles;
  v_owner_email text;
  v_from_user boolean := false;
  v_ours boolean;
  v_forward boolean;
  v_auth boolean := coalesce((p->>'auth_pass')::boolean, false);
  v_verification boolean;
  v_open boolean;
  v_email_id uuid;
  v_received timestamptz := coalesce((p->>'received_at')::timestamptz, now());
  v_status email_status := 'received';
  v_mode text := 'none';
begin
  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into v_addresses
  from unnest(jsonb_text_array(p->'recipients') || jsonb_text_array(p->'to_addresses')
              || jsonb_text_array(p->'cc_addresses')) x;

  v_message_id := coalesce(nullif(btrim(p->>'message_id'), ''),
    '<' || encode(digest(concat_ws('|', v_from, p->>'subject', p->>'received_at', left(p->>'body_text', 2000)), 'sha256'), 'hex')
    || '@inbound.airclaims.klivr.com>');
  if exists (select 1 from emails where message_id = v_message_id) then
    return jsonb_build_object('status', 'duplicate');
  end if;

  select substring(a from '^airclaims_([a-z0-9]{6})@airclaims\.klivr\.com$') into v_code
  from unnest(v_addresses) a
  where a ~ '^airclaims_[a-z0-9]{6}@airclaims\.klivr\.com$'
  limit 1;
  v_support := 'support@airclaims.klivr.com' = any(v_addresses);

  if v_code is not null then
    select * into c from claims where alias_code = v_code;
  end if;
  if c.id is null and nullif(p->>'in_reply_to', '') is not null then
    select cl.* into c from emails e join claims cl on cl.id = e.claim_id
    where e.direction = 'outbound' and e.message_id = p->>'in_reply_to' limit 1;
  end if;

  if c.id is not null then
    select * into pr from profiles where id = c.owner_id;
    select lower(email) into v_owner_email from auth.users where id = c.owner_id;
    v_from_user := v_from in (lower(coalesce(pr.personal_email, '')), coalesce(v_owner_email, ''));
  end if;
  v_open := c.id is not null and c.status not in ('draft', 'won', 'partially_won', 'lost', 'withdrawn');

  v_ours := v_from like '%@airclaims.klivr.com';
  v_forward := v_from_user and coalesce((p->>'forward_hint')::boolean, false);
  v_verification := c.id is not null and not v_from_user and not v_ours
                    and coalesce((p->>'verification_hint')::boolean, false);
  if v_ours then v_status := 'ignored'; end if;

  insert into emails (claim_id, direction, status, classification, from_address, to_addresses, cc_addresses,
                      subject, body_text, body_html, message_id, in_reply_to, received_at)
  values (c.id, 'inbound', v_status,
          case when v_from_user then 'user'::email_class when v_verification then 'other'::email_class
               else 'unclassified'::email_class end,
          v_from, jsonb_text_array(p->'to_addresses'), jsonb_text_array(p->'cc_addresses'),
          left(p->>'subject', 500), p->>'body_text', p->>'body_html', v_message_id,
          nullif(p->>'in_reply_to', ''), v_received)
  on conflict (message_id) do nothing
  returning id into v_email_id;
  if v_email_id is null then return jsonb_build_object('status', 'duplicate'); end if;

  if c.id is not null then
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'email_received',
            jsonb_build_object('email_id', v_email_id, 'from_user', v_from_user, 'forwarded', v_forward), 'system');
  end if;

  if v_ours then
    v_mode := 'none';
  elsif v_support then
    insert into review_queue (kind, email_id, claim_id) values ('support_email', v_email_id, c.id);
  elsif c.id is null then
    insert into review_queue (kind, email_id) values ('unmatched_email', v_email_id);
  elsif v_forward and v_auth and v_open then
    -- The passenger forwarded the airline's answer: read it like any other airline answer.
    insert into airline_responses (claim_id, reported_by, channel, received_on, airline_text, source, email_id)
    values (c.id, c.owner_id, 'email', v_received::date, left(p->>'body_text', 20000), 'forwarded', v_email_id);
    v_mode := 'forwarded';
  elsif v_from_user then
    insert into review_queue (kind, email_id, claim_id, note)
    values ('user_email', v_email_id, c.id,
            case when v_forward and not v_auth then 'forward: sender authentication did not pass'
                 when v_forward then 'forward on a claim that is not open' end);
  elsif v_verification then
    v_mode := 'verification';   -- pass it straight to the passenger (they need the code/link)
  else
    v_mode := 'analyze';
  end if;

  return jsonb_build_object(
    'status', 'stored',
    'email_id', v_email_id,
    'claim_id', c.id,
    'owner_id', c.owner_id,
    'mode', v_mode,
    'needs_ai', v_mode = 'analyze',
    'context', case when c.id is null then null else jsonb_build_object(
      'airline', (select name from airlines where id = c.airline_id),
      'flight', c.flight_iata,
      'flight_date', c.flight_date,
      'claim_status', c.status,
      'compensation_claimed_eur', c.compensation_eur,
      'expenses_claimed_eur', c.expenses_total_eur,
      'airline_reference_known', c.airline_claim_reference,
      'summary_language', coalesce(pr.preferred_locale, 'es')) end,
    'meta', case when c.id is null then null else jsonb_build_object(
      'claim_id', c.id,
      'notify_email', pr.personal_email,
      'notify_locale', pr.preferred_locale,
      'alias', 'airclaims_' || c.alias_code || '@airclaims.klivr.com') end
  );
end $$;

-- ---------------------------------------------------------------------
-- Direct airline mail (replaces 0010): same as before, plus a substantive
-- answer from the airline/AESA/court becomes an airline_responses entry.
-- ---------------------------------------------------------------------
create or replace function apply_inbound_analysis(p_email_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  e emails;
  c claims;
  v_class email_class;
  v_reply text := coalesce(p->>'reply_kind', 'other');
  v_offer boolean := coalesce((p->'settlement_offer'->>'detected')::boolean, false);
  v_docs boolean := coalesce((p->'document_request'->>'detected')::boolean, false);
  v_ref text := nullif(btrim(p->>'airline_reference'), '');
  v_status_changed boolean := false;
begin
  select * into e from emails where id = p_email_id and direction = 'inbound' for update;
  if e.id is null or e.claim_id is null then raise exception 'Inbound claim email not found'; end if;
  if e.ai_summary is not null then return jsonb_build_object('forward', false, 'reason', 'already_analyzed'); end if;

  v_class := case when p->>'classification' in ('airline', 'aesa', 'court', 'spam', 'other')
                  then (p->>'classification')::email_class else 'other'::email_class end;
  update emails set classification = v_class, ai_summary = left(p->>'summary', 2000) where id = e.id;

  select * into c from claims where id = e.claim_id for update;

  if v_class = 'airline' and c.status = 'submitted_airline'
     and v_reply in ('decision', 'offer', 'rejection', 'request_info') then
    update claims set status = 'airline_replied' where id = c.id;
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', 'airline_replied', 'email_id', e.id), 'ai');
    v_status_changed := true;
  end if;
  if v_class = 'airline' and v_ref is not null and c.airline_claim_reference is null then
    update claims set airline_claim_reference = left(v_ref, 100) where id = c.id;
  end if;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'email_analyzed', jsonb_build_object(
    'email_id', e.id, 'classification', v_class, 'reply_kind', v_reply,
    'settlement_offer', p->'settlement_offer', 'document_request', p->'document_request',
    'needs_user_action', coalesce((p->>'needs_user_action')::boolean, false),
    'user_action', left(p->>'user_action', 500)), 'ai');

  if v_offer or v_docs or v_class in ('aesa', 'court') then
    insert into review_queue (kind, email_id, claim_id, note)
    values ('email_needs_attention', e.id, c.id,
            concat_ws(', ', case when v_offer then 'settlement offer' end,
                            case when v_docs then 'document request' end,
                            case when v_class in ('aesa', 'court') then v_class::text end));
  end if;

  -- One "airline's answer" flow for every route: options and a reply, on the dashboard.
  if v_class in ('airline', 'aesa', 'court') and v_reply <> 'acknowledgement'
     and c.status not in ('draft', 'won', 'partially_won', 'lost', 'withdrawn')
     and not exists (select 1 from airline_responses where email_id = e.id) then
    insert into airline_responses (claim_id, reported_by, channel, received_on, airline_text, source, email_id)
    values (c.id, c.owner_id, 'email', coalesce(e.received_at, now())::date, left(e.body_text, 20000), 'inbound', e.id);
  end if;

  return jsonb_build_object('forward', v_class <> 'spam', 'status_changed', v_status_changed);
end $$;

-- ---------------------------------------------------------------------
-- Analysis queue (n8n): lease one pending answer at a time.
-- ---------------------------------------------------------------------
create or replace function claim_pending_airline_response() returns setof airline_responses
language sql security definer set search_path = public as $$
  update airline_responses set locked_at = now(), attempts = attempts + 1
  where id = (select id from airline_responses
              where status = 'pending' and attempts < 3
                and (locked_at is null or locked_at < now() - interval '10 minutes')
              order by created_at
              limit 1
              for update skip locked)
  returning *
$$;

drop function apply_airline_response_analysis(uuid, jsonb);
create function apply_airline_response_analysis(p_response_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  r airline_responses;
  c claims;
  pr profiles;
begin
  update airline_responses set analysis = p, status = 'analyzed', analyzed_at = now(), locked_at = null
  where id = p_response_id and status <> 'analyzed'
  returning * into r;
  if r.id is null then return null; end if;  -- idempotent

  select * into c from claims where id = r.claim_id for update;
  -- A forwarded or direct answer that is substantive means the airline has replied.
  if r.source <> 'reported' and c.status in ('ready_to_submit', 'documents_pending', 'submitted_airline')
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
    'response_id', r.id, 'source', r.source, 'kind', p->>'kind',
    'reasons', (select jsonb_agg(x->>'code') from jsonb_array_elements(coalesce(p->'reasons', '[]')) x)), 'ai');
  insert into review_queue (kind, email_id, claim_id, note)
  values ('email_needs_attention', r.email_id, r.claim_id, 'airline answer (' || r.source || '): ' || coalesce(p->>'kind', 'unknown'));

  select * into pr from profiles where id = c.owner_id;
  return jsonb_build_object(
    'claim_id', c.id, 'source', r.source, 'summary', left(p->>'summary', 1000),
    -- Passengers who reported it on the dashboard are already looking at it.
    'notify', r.source <> 'reported',
    'notify_email', pr.personal_email, 'notify_locale', pr.preferred_locale,
    'recipient_label', coalesce((select name from airlines where id = c.airline_id), c.flight_iata));
end $$;

create or replace function fail_airline_response_analysis(p_response_id uuid, p_error text) returns void
language sql security definer set search_path = public as $$
  update airline_responses
  set status = case when attempts >= 3 then 'failed' else 'pending' end,
      locked_at = null,
      analysis = case when attempts >= 3 then jsonb_build_object('error', left(p_error, 500)) else analysis end
  where id = p_response_id and status = 'pending'
$$;

-- The passenger asks us to try reading a failed answer again.
create or replace function retry_airline_response(p_response_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update airline_responses set status = 'pending', attempts = 0, locked_at = null, analysis = null
  where id = p_response_id and reported_by = auth.uid() and status in ('pending', 'failed');
  if not found then raise exception 'Response not found'; end if;
end $$;

revoke execute on function claim_pending_airline_response(), apply_airline_response_analysis(uuid, jsonb),
  retry_airline_response(uuid) from public, anon, authenticated;
grant execute on function claim_pending_airline_response(), apply_airline_response_analysis(uuid, jsonb),
  fail_airline_response_analysis(uuid, text) to service_role;
grant execute on function retry_airline_response(uuid) to authenticated;

-- The model also learns how the answer reached us (a forwarded email starts with forward headers).
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
      'airline_answer', jsonb_build_object('channel', r.channel, 'received_on', r.received_on, 'text', r.airline_text,
                                           'source', r.source),
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
