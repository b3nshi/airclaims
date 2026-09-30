-- =====================================================================
-- 0012 — admin area: roles, airline knowledge base, review queue actions,
-- airline stats, audit log. No changes to existing table structures; new
-- policies on airlines / airline_contacts / review_queue / emails / claims.
--
-- Roles live in the user's app_metadata (only the service role can set it):
--   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"roles": ["admin"]}'
--   where email = 'you@example.com';          -- or ["kb_editor"]; takes effect on next sign-in
--   kb_editor: airline knowledge only (no personal data)
--   admin:     everything, incl. the review queue (passengers' emails)
-- =====================================================================

create or replace function has_role(p_role text) returns boolean
language sql stable as $$
  select coalesce((auth.jwt() -> 'app_metadata' -> 'roles') ? p_role, false)
$$;
create or replace function is_admin() returns boolean language sql stable as $$ select has_role('admin') $$;
create or replace function is_kb_editor() returns boolean language sql stable as $$
  select has_role('kb_editor') or has_role('admin')
$$;

-- ---------------------------------------------------------------------
-- Airline knowledge (one row per airline), curated by kb editors.
-- ---------------------------------------------------------------------
create table airline_knowledge (
  airline_id            uuid primary key references airlines(id) on delete cascade,
  passenger_tips        jsonb not null default '{}'::jsonb,  -- per locale: {"es": ["…"], "en": [...]}
  drafting_notes        text,          -- practical notes added to the AI drafting prompt (English)
  claim_form_notes      text,          -- internal: how the form works, fields, quirks
  attachments_max_mb    int check (attachments_max_mb > 0),
  stated_reply_days     int check (stated_reply_days > 0),   -- what the airline commits to
  typical_reply_days_min int check (typical_reply_days_min > 0),
  typical_reply_days_max int check (typical_reply_days_max >= typical_reply_days_min),
  offers_credit_first   boolean,       -- tends to offer vouchers/credit before money
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id) on delete set null
);
create trigger trg_airline_knowledge_updated before update on airline_knowledge
  for each row execute function set_updated_at();

-- Sourced facts about an airline (official pages, claim companies, forums, our own data).
create table airline_insights (
  id           uuid primary key default gen_random_uuid(),
  airline_id   uuid not null references airlines(id) on delete cascade,
  topic        text not null check (topic in ('claim_process', 'payment_practice', 'response_time',
                                              'rejection_pattern', 'punctuality', 'escalation', 'tip', 'other')),
  summary      text not null,          -- in our own words, never copied text
  source_name  text not null,
  source_url   text,
  reliability  text not null check (reliability in ('official', 'enforcement_body', 'competitor', 'forum', 'own_data')),
  observed_on  date not null default current_date,
  verified     boolean not null default false,   -- checked by a person
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index airline_insights_airline_idx on airline_insights (airline_id, topic);

-- ---------------------------------------------------------------------
-- Audit log: who changed what (before/after) on curated data and reviews.
-- ---------------------------------------------------------------------
create table admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,                    -- null = system / migration
  table_name  text not null,
  row_id      text,
  action      text not null,           -- insert | update | delete | link_email
  before      jsonb,
  after       jsonb,
  created_at  timestamptz not null default now()
);
create index admin_audit_log_created_idx on admin_audit_log (created_at desc);

create or replace function audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
begin
  insert into admin_audit_log (actor_id, table_name, row_id, action, before, after)
  values (auth.uid(), tg_table_name,
          coalesce(v_new->>'id', v_old->>'id', v_new->>'airline_id', v_old->>'airline_id'),
          lower(tg_op), v_old, v_new);
  return null;
end $$;

create trigger trg_audit_airlines after insert or update or delete on airlines
  for each row execute function audit_row_change();
create trigger trg_audit_airline_contacts after insert or update or delete on airline_contacts
  for each row execute function audit_row_change();
create trigger trg_audit_airline_knowledge after insert or update or delete on airline_knowledge
  for each row execute function audit_row_change();
create trigger trg_audit_airline_insights after insert or update or delete on airline_insights
  for each row execute function audit_row_change();
-- Review items are created by the system all the time; only human decisions are audited.
create trigger trg_audit_review_queue after update on review_queue
  for each row execute function audit_row_change();

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table airline_knowledge enable row level security;
alter table airline_insights  enable row level security;
alter table admin_audit_log   enable row level security;
revoke all on airline_knowledge, airline_insights, admin_audit_log from anon;

create policy "kb insert airlines" on airlines for insert to authenticated with check (is_kb_editor());
create policy "kb update airlines" on airlines for update to authenticated using (is_kb_editor()) with check (is_kb_editor());

-- Editors see every contact, including the curated emails users never see.
create policy "kb read contacts"   on airline_contacts for select to authenticated using (is_kb_editor());
create policy "kb insert contacts" on airline_contacts for insert to authenticated with check (is_kb_editor());
create policy "kb update contacts" on airline_contacts for update to authenticated using (is_kb_editor()) with check (is_kb_editor());
create policy "kb delete contacts" on airline_contacts for delete to authenticated using (is_kb_editor());

create policy "kb knowledge" on airline_knowledge for all to authenticated
  using (is_kb_editor()) with check (is_kb_editor());
create policy "kb insights" on airline_insights for all to authenticated
  using (is_kb_editor()) with check (is_kb_editor());

-- Personal data: admins only.
create policy "admin read review queue"   on review_queue for select to authenticated using (is_admin());
create policy "admin update review queue" on review_queue for update to authenticated using (is_admin()) with check (is_admin());
create policy "admin read emails" on emails for select to authenticated using (is_admin());
create policy "admin read claims" on claims for select to authenticated using (is_admin());

create policy "read audit log" on admin_audit_log for select to authenticated using (
  is_admin() or (is_kb_editor() and table_name in ('airlines', 'airline_contacts', 'airline_knowledge', 'airline_insights'))
);

-- ---------------------------------------------------------------------
-- Passenger-facing tips (users never read airline_knowledge directly).
-- ---------------------------------------------------------------------
create or replace function airline_passenger_tips(p_airline_id uuid, p_locale text) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array(select jsonb_array_elements_text(
           coalesce(passenger_tips -> p_locale, passenger_tips -> 'en', passenger_tips -> 'es', '[]'::jsonb))), '{}')
  from airline_knowledge where airline_id = p_airline_id
$$;

-- ---------------------------------------------------------------------
-- Review queue actions (admin)
-- ---------------------------------------------------------------------
create or replace function admin_resolve_review(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  update review_queue
  set status = 'done', resolved_at = now(), note = nullif(btrim(coalesce(p_note, note)), '')
  where id = p_id and status = 'open';
  if not found then raise exception 'Review item not found or already done'; end if;
end $$;

-- An unmatched email that belongs to a claim (e.g. the airline wrote to the wrong address).
create or replace function admin_link_email_to_claim(p_email_id uuid, p_alias_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid;
begin
  if not is_admin() then raise exception 'Not allowed'; end if;
  select id into v_claim from claims where alias_code = lower(btrim(p_alias_code));
  if v_claim is null then raise exception 'No claim with that alias code'; end if;

  update emails set claim_id = v_claim where id = p_email_id and direction = 'inbound' and claim_id is null;
  if not found then raise exception 'Email not found or already linked'; end if;

  update review_queue set claim_id = v_claim where email_id = p_email_id;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (v_claim, 'email_received', jsonb_build_object('email_id', p_email_id, 'linked_by_admin', true), 'admin');
  insert into admin_audit_log (actor_id, table_name, row_id, action, after)
  values (auth.uid(), 'emails', p_email_id::text, 'link_email', jsonb_build_object('claim_id', v_claim));
  return v_claim;
end $$;

-- ---------------------------------------------------------------------
-- admin_airline_stats: our own outcomes per airline (no personal data).
-- ---------------------------------------------------------------------
create or replace function admin_airline_stats() returns table (
  airline_id uuid, iata text, name text,
  claims_total int, claims_open int, submitted int, won int, partially_won int, lost int, withdrawn int,
  success_rate_pct numeric, replies int, avg_days_first_reply numeric, median_days_first_reply numeric,
  overdue_replies int, avg_days_to_resolution numeric,
  offers_total int, offers_credit int, offers_money_partial int, offers_money_full int,
  flights_3h_plus int, knowledge_updated_at timestamptz, contacts_last_verified timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_kb_editor() then raise exception 'Not allowed'; end if;
  return query
  with first_reply as (
    select c.id as claim_id,
           (select min(e.received_at) from emails e
             where e.claim_id = c.id and e.direction = 'inbound' and e.classification = 'airline'
               and e.received_at > c.submitted_airline_at) as replied_at
    from claims c where c.submitted_airline_at is not null
  ),
  offers as (
    select c.airline_id, ev.payload->'settlement_offer'->>'kind' as kind
    from claim_events ev join claims c on c.id = ev.claim_id
    where ev.event_type = 'email_analyzed' and coalesce((ev.payload->'settlement_offer'->>'detected')::boolean, false)
  )
  select a.id, a.iata::text, a.name,
    count(c.id)::int,
    count(c.id) filter (where c.status not in ('won','partially_won','lost','withdrawn'))::int,
    count(c.id) filter (where c.submitted_airline_at is not null)::int,
    count(c.id) filter (where c.status = 'won')::int,
    count(c.id) filter (where c.status = 'partially_won')::int,
    count(c.id) filter (where c.status = 'lost')::int,
    count(c.id) filter (where c.status = 'withdrawn')::int,
    round(100.0 * count(c.id) filter (where c.status in ('won','partially_won'))
          / nullif(count(c.id) filter (where c.status in ('won','partially_won','lost')), 0), 1),
    count(fr.replied_at)::int,
    round(avg(extract(epoch from (fr.replied_at - c.submitted_airline_at)) / 86400)::numeric, 1),
    round((percentile_cont(0.5) within group (order by extract(epoch from (fr.replied_at - c.submitted_airline_at)) / 86400))::numeric, 1),
    count(c.id) filter (where c.status = 'submitted_airline' and fr.replied_at is null
                          and c.submitted_airline_at < now() - interval '1 month')::int,
    round(avg(extract(epoch from (c.resolved_at - c.submitted_airline_at)) / 86400)
          filter (where c.resolved_at is not null)::numeric, 1),
    (select count(*) from offers o where o.airline_id = a.id)::int,
    (select count(*) from offers o where o.airline_id = a.id and o.kind in ('voucher','travel_credit','miles'))::int,
    (select count(*) from offers o where o.airline_id = a.id and o.kind = 'money_partial')::int,
    (select count(*) from offers o where o.airline_id = a.id and o.kind = 'money_full')::int,
    (select count(*) from flights f where f.airline_id = a.id and f.candidate = 'candidate')::int,
    (select k.updated_at from airline_knowledge k where k.airline_id = a.id),
    (select max(ac.verified_at) from airline_contacts ac where ac.airline_id = a.id)
  from airlines a
  left join claims c on c.airline_id = a.id
  left join first_reply fr on fr.claim_id = c.id
  where a.is_active
  group by a.id
  order by count(c.id) desc, a.name;
end $$;

-- ---------------------------------------------------------------------
-- Drafting: add the airline's practical notes to what the AI sees.
-- ---------------------------------------------------------------------
alter function email_draft_context(uuid, text) rename to email_draft_context_core;
revoke execute on function email_draft_context_core(uuid, text) from public, anon, authenticated, service_role;

create or replace function email_draft_context(p_claim_id uuid, p_template text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := email_draft_context_core(p_claim_id, p_template);
  v_notes text;
begin
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  select k.drafting_notes into v_notes
  from claims c join airline_knowledge k on k.airline_id = c.airline_id where c.id = p_claim_id;
  if nullif(btrim(v_notes), '') is not null then
    r := jsonb_set(r, '{ai,airline_notes}', to_jsonb(left(v_notes, 4000)));
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------
revoke execute on function airline_passenger_tips(uuid, text), admin_resolve_review(uuid, text),
  admin_link_email_to_claim(uuid, text), admin_airline_stats(), email_draft_context(uuid, text),
  audit_row_change() from public, anon;
grant execute on function airline_passenger_tips(uuid, text), admin_resolve_review(uuid, text),
  admin_link_email_to_claim(uuid, text), admin_airline_stats() to authenticated;
revoke execute on function email_draft_context(uuid, text) from authenticated;
grant execute on function email_draft_context(uuid, text) to service_role;

-- ---------------------------------------------------------------------
-- Seed: Wizz Air knowledge (research 2026-09-30; summaries in our own words).
-- ---------------------------------------------------------------------
insert into airline_knowledge (airline_id, passenger_tips, drafting_notes, claim_form_notes,
                               stated_reply_days, typical_reply_days_min, typical_reply_days_max, offers_credit_first)
select id,
  jsonb_build_object(
    'es', jsonb_build_array(
      'Elige el pago en dinero, no en crédito WIZZ. Puedes rechazar el crédito: según el EU261 la compensación se paga en dinero salvo que aceptes otra cosa.',
      'Guarda la referencia que Wizz muestra al enviar el formulario y añádela aquí.',
      'Wizz se compromete a responder en 30 días, pero es habitual que tarde de 6 a 14 semanas. Si pasado un mes no hay respuesta, puedes acudir a AESA.',
      'Si Wizz alega circunstancias extraordinarias, tiene que demostrarlo: no es motivo para aceptar sin más.'),
    'en', jsonb_build_array(
      'Choose payment in money, not WIZZ credit. You can refuse credit: under EU261 compensation is paid in money unless you agree otherwise.',
      'Keep the reference Wizz shows after you submit the form and add it here.',
      'Wizz commits to answering within 30 days, but 6 to 14 weeks is common. If there is no answer after a month, you can go to AESA.',
      'If Wizz cites extraordinary circumstances, it has to prove them: it is not a reason to give up.'),
    'ca', jsonb_build_array(
      'Tria el pagament en diners, no en crèdit WIZZ. Pots rebutjar el crèdit: segons l''EU261 la compensació es paga en diners tret que acceptis una altra cosa.',
      'Desa la referència que Wizz mostra en enviar el formulari i afegeix-la aquí.',
      'Wizz es compromet a respondre en 30 dies, però és habitual que trigui de 6 a 14 setmanes. Si passat un mes no hi ha resposta, pots anar a AESA.',
      'Si Wizz al·lega circumstàncies extraordinàries, les ha de demostrar: no és motiu per rendir-se.')),
  'Wizz Air frequently offers WIZZ credit instead of money. State explicitly that compensation must be paid by bank transfer and that WIZZ credit or vouchers are not accepted. Put the flight number and booking reference in the subject line.',
  'Claims go through the online form in the Help Centre (Claims and compensation > EC261). Wizz states it answers within 30 days. Unverified: whether a WIZZ account login is required, attachment limits, and the exact form fields; check on the live form and update the submission steps.',
  30, 42, 98, true
from airlines where iata = 'W6'
on conflict (airline_id) do nothing;

insert into airline_insights (airline_id, topic, summary, source_name, source_url, reliability, observed_on, verified)
select a.id, v.topic, v.summary, v.source_name, v.source_url, v.reliability, v.observed_on::date, false
from airlines a,
(values
  ('claim_process', 'Wizz says EC261 claims are submitted through the online form in its Help Centre and that it replies within 30 days. (Page blocks automated access; seen via search results, confirm on the live page.)',
   'Wizz Air Help Centre – EC261 regulation', 'https://www.wizzair.com/en-gb/help-centre/my-wizz-account/claims-and-compensation/ec261-regulation', 'official', '2026-09-30'),
  ('response_time', 'A Spanish claims guide (April 2026) reports Wizz usually takes 6 to 14 weeks to answer, and advises going to AESA after 8 to 10 weeks without a satisfactory answer.',
   'Equipaje Nómada – Reclamar a Wizz Air', 'https://equipajenomada.com/reclamar-wizzair-retraso-cancelacion/', 'competitor', '2026-04-01'),
  ('payment_practice', 'Claim guides report Wizz frequently offers WIZZ credit (usable only for future bookings) instead of money; passengers can refuse and ask for payment in money, escalating to the enforcement body of the departure country if Wizz insists.',
   'Wise Flight – Wizz Air EU261 compensation', 'https://wise-flight.info/en/blog/wizz-air-eu261-compensation-claim', 'competitor', '2026-04-13'),
  ('payment_practice', 'A Spanish guide also notes Wizz sometimes offers in-app credit or discount vouchers instead of the monetary compensation, which passengers do not have to accept.',
   'Equipaje Nómada – Reclamar a Wizz Air', 'https://equipajenomada.com/reclamar-wizzair-retraso-cancelacion/', 'competitor', '2026-04-01'),
  ('punctuality', 'AirAdvisor data for 12 Dec 2025 – 2 Mar 2026 (38,564 Wizz flights): 1.1% arrived 3+ hours late, 1.2% were cancelled, 8.3% had delays over 1 hour.',
   'AirAdvisor – Wizz Air compensation', 'https://airadvisor.com/en/airlines/wizz-air-refund-compensation', 'competitor', '2026-03-02'),
  ('rejection_pattern', 'Commonly reported rejection grounds: arrival delay under 3 hours, cancellation notified more than 14 days ahead, extraordinary circumstances (weather, ATC strikes), and having already accepted a voucher.',
   'AirAdvisor – Wizz Air compensation', 'https://airadvisor.com/en/airlines/wizz-air-refund-compensation', 'competitor', '2026-03-02'),
  ('rejection_pattern', 'Forum report (Dec 2025): Wizz rejected a claim because the schedule change was notified more than 14 days before departure; the passenger had been rebooked automatically without explicitly accepting it.',
   'MoneySavingExpert forum – Wizz Air EU261 claim advice', 'https://forums.moneysavingexpert.com/discussion/6647833/wizz-air-eu261-claim-advice', 'forum', '2025-12-27'),
  ('escalation', 'For flights departing Spain the enforcement body is AESA (binding decisions for flights from 2 June 2023). For other departure countries, the national body applies (e.g. Hungary, Poland, Germany, Austria have their own ADR/NEB).',
   'Wise Flight – Wizz Air EU261 compensation', 'https://wise-flight.info/en/blog/wizz-air-eu261-compensation-claim', 'competitor', '2026-04-13')
) as v(topic, summary, source_name, source_url, reliability, observed_on)
where a.iata = 'W6';
