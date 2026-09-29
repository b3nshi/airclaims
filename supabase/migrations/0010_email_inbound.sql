-- =====================================================================
-- 0010 — M5: inbound email (Forward Email → n8n → here).
--   * match the claim by alias (or by In-Reply-To of one of our messages);
--   * idempotent on Message-ID (Forward Email retries until it gets a 200);
--   * mail from the passenger themself, to support@, or matching no claim goes
--     to a human review queue — never answered automatically;
--   * the AI analysis only classifies and summarises: status changes it can
--     trigger are limited and logged, and offers are surfaced, never accepted.
-- New table review_queue; no changes to existing tables.
-- =====================================================================

create table review_queue (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('unmatched_email', 'user_email', 'support_email',
                                             'email_needs_attention', 'email_draft_failed')),
  email_id     uuid references emails(id) on delete cascade,
  claim_id     uuid references claims(id) on delete cascade,
  status       text not null default 'open' check (status in ('open', 'done')),
  note         text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
create index review_queue_open_idx on review_queue (created_at) where status = 'open';
alter table review_queue enable row level security;   -- admins via service role / Studio

-- ---------------------------------------------------------------------
-- ingest_inbound_email: store the message once, find its claim, decide
-- whether the AI should look at it. p: {message_id, from_address, from_name,
-- to_addresses[], cc_addresses[], recipients[], subject, body_text, body_html,
-- in_reply_to, received_at}
-- ---------------------------------------------------------------------
-- Arrays in the webhook payload, tolerating missing or malformed fields.
create or replace function jsonb_text_array(p jsonb) returns text[]
language sql immutable as $$
  select case when jsonb_typeof(p) = 'array'
              then coalesce(array(select jsonb_array_elements_text(p)), '{}') else '{}' end
$$;

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
  v_email_id uuid;
  v_status email_status := 'received';
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

  -- Our own senders (no-reply, other aliases) looping back: keep, don't process.
  v_ours := v_from like '%@airclaims.klivr.com';
  if v_ours then v_status := 'ignored'; end if;

  insert into emails (claim_id, direction, status, classification, from_address, to_addresses, cc_addresses,
                      subject, body_text, body_html, message_id, in_reply_to, received_at)
  values (c.id, 'inbound', v_status, case when v_from_user then 'user'::email_class else 'unclassified'::email_class end,
          v_from, jsonb_text_array(p->'to_addresses'), jsonb_text_array(p->'cc_addresses'),
          left(p->>'subject', 500), p->>'body_text', p->>'body_html', v_message_id,
          nullif(p->>'in_reply_to', ''), coalesce((p->>'received_at')::timestamptz, now()))
  on conflict (message_id) do nothing
  returning id into v_email_id;
  if v_email_id is null then return jsonb_build_object('status', 'duplicate'); end if;

  if c.id is not null then
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'email_received', jsonb_build_object('email_id', v_email_id, 'from_user', v_from_user), 'system');
  end if;

  if not v_ours then
    if v_support then
      insert into review_queue (kind, email_id, claim_id) values ('support_email', v_email_id, c.id);
    elsif c.id is null then
      insert into review_queue (kind, email_id) values ('unmatched_email', v_email_id);
    elsif v_from_user then
      insert into review_queue (kind, email_id, claim_id) values ('user_email', v_email_id, c.id);
    end if;
  end if;

  return jsonb_build_object(
    'status', 'stored',
    'email_id', v_email_id,
    'claim_id', c.id,
    'owner_id', c.owner_id,
    -- The AI only looks at third-party mail about a known claim.
    'needs_ai', c.id is not null and not v_from_user and not v_ours and not v_support,
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
-- attach_inbound_files: files already uploaded to Storage by n8n.
-- p_files: [{storage_path, filename, mime, size, sha256}]
-- ---------------------------------------------------------------------
create or replace function attach_inbound_files(p_email_id uuid, p_files jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  e emails;
  c claims;
  f jsonb;
begin
  select * into e from emails where id = p_email_id and direction = 'inbound';
  if e.id is null then raise exception 'Inbound email not found'; end if;
  update emails set attachments = coalesce(p_files, '[]') where id = e.id;
  if e.claim_id is null then return; end if;

  select * into c from claims where id = e.claim_id;
  for f in select * from jsonb_array_elements(coalesce(p_files, '[]')) loop
    if f->>'storage_path' like c.owner_id::text || '/' || c.id::text || '/%' then
      insert into documents (claim_id, owner_id, doc_type, storage_path, mime_type, sha256)
      values (c.id, c.owner_id,
              case when e.classification = 'user' then 'other'::document_type else 'airline_correspondence'::document_type end,
              f->>'storage_path', f->>'mime', f->>'sha256')
      on conflict (storage_path) do nothing;
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- apply_inbound_analysis: store the AI's reading and act on the obvious.
-- p: {classification, summary, reply_kind, settlement_offer{detected,kind,amount,currency,
--     conditions}, document_request{detected,documents[]}, airline_reference,
--     needs_user_action, user_action}
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

  -- Obvious status change: a substantive airline answer to a submitted claim.
  if v_class = 'airline' and c.status = 'submitted_airline'
     and v_reply in ('decision', 'offer', 'rejection', 'request_info') then
    update claims set status = 'airline_replied' where id = c.id;
    insert into claim_events (claim_id, event_type, payload, actor)
    values (c.id, 'status_changed', jsonb_build_object('from', c.status, 'to', 'airline_replied', 'email_id', e.id), 'ai');
    v_status_changed := true;
  end if;
  -- The airline's own reference, if we didn't have one (e.g. from an acknowledgement).
  if v_class = 'airline' and v_ref is not null and c.airline_claim_reference is null then
    update claims set airline_claim_reference = left(v_ref, 100) where id = c.id;
  end if;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (c.id, 'email_analyzed', jsonb_build_object(
    'email_id', e.id, 'classification', v_class, 'reply_kind', v_reply,
    'settlement_offer', p->'settlement_offer', 'document_request', p->'document_request',
    'needs_user_action', coalesce((p->>'needs_user_action')::boolean, false),
    'user_action', left(p->>'user_action', 500)), 'ai');

  -- Offers, AESA/court mail and anything needing a decision get a human look too.
  if v_offer or v_docs or v_class in ('aesa', 'court') then
    insert into review_queue (kind, email_id, claim_id, note)
    values ('email_needs_attention', e.id, c.id,
            concat_ws(', ', case when v_offer then 'settlement offer' end,
                            case when v_docs then 'document request' end,
                            case when v_class in ('aesa', 'court') then v_class::text end));
  end if;

  return jsonb_build_object('forward', v_class <> 'spam', 'status_changed', v_status_changed);
end $$;

create or replace function mark_email_forwarded(p_email_id uuid) returns void
language sql security definer set search_path = public as $$
  update emails set status = 'forwarded' where id = p_email_id and direction = 'inbound' and status = 'received'
$$;

revoke execute on function jsonb_text_array(jsonb) from public, anon;
revoke execute on function ingest_inbound_email(jsonb), attach_inbound_files(uuid, jsonb),
  apply_inbound_analysis(uuid, jsonb), mark_email_forwarded(uuid) from public, anon, authenticated;
grant execute on function ingest_inbound_email(jsonb), attach_inbound_files(uuid, jsonb),
  apply_inbound_analysis(uuid, jsonb), mark_email_forwarded(uuid) to service_role;
