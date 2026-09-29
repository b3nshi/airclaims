-- =====================================================================
-- AirClaims (airclaims.klivr.com) — initial schema
-- Target: Supabase (Postgres 15+), EU region
-- Conventions:
--   * Users read/write their own data through RLS.
--   * n8n uses the service_role key (bypasses RLS) for system writes:
--     flight monitoring, inbound email, AI validation, status changes.
--   * Reference data (airlines, airports, flights, weather, disruptions,
--     scorecard) is readable by any authenticated user.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type disruption_type   as enum ('delay','cancellation','denied_boarding','missed_connection');
create type claim_status      as enum ('draft','documents_pending','validating','ready_to_submit',
                                       'submitted_airline','airline_replied','escalated_aesa',
                                       'escalated_court','won','partially_won','lost','withdrawn');
create type candidate_level   as enum ('none','possible','candidate');        -- >15m / >=180m arrival delay
create type contact_channel   as enum ('email','web_form','postal','phone');
create type contact_purpose   as enum ('compensation','expenses','refund','baggage','general','legal');
create type expense_category  as enum ('ground_transport','meal','hotel','phone','rebooking','other');
create type document_type     as enum ('boarding_pass','booking_confirmation','id_document',
                                       'receipt','airline_correspondence','other');
create type validation_status as enum ('pending','passed','needs_review','failed');
create type agreement_type    as enum ('terms_of_service','privacy_notice','email_authorization','story_publication');
create type email_direction   as enum ('inbound','outbound');
create type email_status      as enum ('draft','pending_approval','approved','sending','sent','failed',
                                       'received','forwarded','ignored');
create type email_class       as enum ('user','airline','aesa','court','spam','other','unclassified');
create type risk_flag_type    as enum ('severe_weather','atc_strike','airport_strike','airline_staff_strike',
                                       'atc_restriction','security','other');
create type payment_status    as enum ('requested','paid','declined','waived','refunded');
create type referral_status   as enum ('pending','qualified','rejected');

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

-- Non-guessable short code (no 0/o/1/l to avoid confusion)
create or replace function random_code(len int default 6) returns text language plpgsql as $$
declare chars text := 'abcdefghijkmnpqrstuvwxyz23456789'; result text := '';
begin
  for i in 1..len loop
    result := result || substr(chars, 1 + floor(random() * length(chars))::int, 1);
  end loop;
  return result;
end $$;

-- ---------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------
create table profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  full_name          text,
  preferred_locale   text not null default 'es' check (preferred_locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  personal_email     text,                      -- where we forward airline mail
  referral_code      text unique not null default random_code(8),
  referred_by        uuid references profiles(id),
  marketing_consent  boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_profiles_updated before update on profiles for each row execute function set_updated_at();

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, personal_email, preferred_locale)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'locale', 'es'));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();

-- ---------------------------------------------------------------------
-- Reference data: airports & airlines (knowledge base)
-- ---------------------------------------------------------------------
create table airports (
  iata          char(3) primary key,
  icao          char(4) unique,
  name          text not null,
  city          text,
  country_code  char(2) not null,
  latitude      double precision,
  longitude     double precision,
  timezone      text,
  eu261_scope   boolean not null default false,   -- EU + IS/NO/CH
  monitored     boolean not null default false    -- airclaim-finder polls it
);

create table airline_groups (
  id    uuid primary key default gen_random_uuid(),
  name  text unique not null                       -- e.g. IAG, Lufthansa Group
);

create table airlines (
  id                  uuid primary key default gen_random_uuid(),
  iata                char(2) unique,
  icao                char(3) unique,
  name                text not null,
  group_id            uuid references airline_groups(id),
  country_code        char(2),                     -- AOC country: EU carrier or not
  is_eu_carrier       boolean not null default false,
  preferred_language  text not null default 'en',  -- language to write claims in
  logo_path           text,                        -- Supabase Storage (public bucket)
  website             text,
  notes               text,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_airlines_updated before update on airlines for each row execute function set_updated_at();

create table airline_contacts (
  id           uuid primary key default gen_random_uuid(),
  airline_id   uuid not null references airlines(id) on delete cascade,
  purpose      contact_purpose not null,
  channel      contact_channel not null,
  label        text not null,                      -- shown to users, e.g. 'Wizz Air – Customer Relations'
  value        text not null,                      -- email address, form URL, postal address
  submission_steps jsonb not null default '{}'::jsonb, -- per locale: {"es":["Paso 1..."],"en":[...]}
  language     text,
  notes        text,
  verified_at  timestamptz,
  unique (airline_id, purpose, channel, value)
);

-- ---------------------------------------------------------------------
-- Flights, monitoring, weather, disruptions
-- ---------------------------------------------------------------------
create table flights (
  id                      uuid primary key default gen_random_uuid(),
  flight_iata             text not null,                     -- e.g. W62345
  flight_date             date not null,                     -- scheduled departure date (local)
  airline_id              uuid references airlines(id),
  dep_iata                char(3) references airports(iata),
  arr_iata                char(3) references airports(iata),
  scheduled_dep           timestamptz,
  actual_dep              timestamptz,
  scheduled_arr           timestamptz,
  actual_arr              timestamptz,                       -- doors-open is the legal reference
  arrival_delay_minutes   int generated always as
                            (case when actual_arr is not null and scheduled_arr is not null
                                  then (extract(epoch from (actual_arr - scheduled_arr)) / 60)::int end) stored,
  status                  text,                              -- scheduled / active / landed / cancelled ...
  distance_km             int,                               -- great-circle
  candidate               candidate_level not null default 'none',
  source                  text not null default 'aerodatabox',
  last_checked_at         timestamptz,
  created_at              timestamptz not null default now(),
  unique (flight_iata, flight_date)
);
create index flights_candidate_idx on flights (candidate, flight_date desc);
create index flights_route_idx on flights (dep_iata, arr_iata, flight_date);

create table flight_observations (                             -- every poll, for audit/evidence
  id           bigint generated always as identity primary key,
  flight_id    uuid not null references flights(id) on delete cascade,
  observed_at  timestamptz not null default now(),
  payload      jsonb not null
);

create table weather_observations (
  id              bigint generated always as identity primary key,
  airport_iata    char(3) not null references airports(iata),
  observed_at     timestamptz not null,
  metar_raw       text not null,
  flags           jsonb not null default '{}'::jsonb,         -- {thunderstorm:true, visibility_m:400, wind_kt:45}
  source          text not null default 'aviationweather.gov',
  unique (airport_iata, observed_at)
);

create table disruption_events (                               -- strikes, ATC restrictions, etc.
  id              uuid primary key default gen_random_uuid(),
  flag_type       risk_flag_type not null,
  title           text not null,
  country_codes   char(2)[] not null default '{}',
  airport_iatas   char(3)[] not null default '{}',
  airline_ids     uuid[] not null default '{}',
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  source_url      text,
  confirmed       boolean not null default false,             -- human-confirmed after AI extraction
  created_at      timestamptz not null default now()
);

create table flight_risk_flags (
  id           uuid primary key default gen_random_uuid(),
  flight_id    uuid not null references flights(id) on delete cascade,
  flag_type    risk_flag_type not null,
  excuses_airline boolean not null,                           -- ATC/weather yes; own staff strike no
  evidence     jsonb not null default '{}'::jsonb,           -- METAR ids, disruption_event id, notes
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Claims
-- ---------------------------------------------------------------------
create table claims (
  id                        uuid primary key default gen_random_uuid(),
  owner_id                  uuid not null references profiles(id) on delete cascade,
  flight_id                 uuid references flights(id),
  airline_id                uuid references airlines(id),
  -- what the user reported (kept even if we match a flight)
  flight_iata               text not null,
  flight_date               date not null,
  dep_iata                  char(3),
  arr_iata                  char(3),
  final_destination_iata    char(3),
  booking_reference         text,
  disruption                disruption_type not null default 'delay',
  reported_arrival_delay_minutes int,
  cancellation_notice_days  int,
  -- what happened at the airport
  care_provided             jsonb not null default '{}'::jsonb, -- {meals:false, hotel:false, transport:false}
  airline_instructions      text,                                -- e.g. "staff told us to take an Uber home and claim it"
  reason_given_by_airline   text,
  -- claim mechanics
  alias_code                text unique not null default random_code(6),
  status                    claim_status not null default 'draft',
  compensation_eur          numeric(8,2),                        -- per EU261 band x eligible passengers
  expenses_total_eur        numeric(8,2) not null default 0,
  airline_claim_reference   text,
  submitted_airline_at      timestamptz,
  aesa_deadline             date generated always as (((submitted_airline_at at time zone 'Europe/Madrid') + interval '1 year')::date) stored,  -- AT TIME ZONE keeps it immutable
  resolved_at               timestamptz,
  amount_received_eur       numeric(8,2),
  fee_pct_locked            numeric(4,2),                        -- set at resolution
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create trigger trg_claims_updated before update on claims for each row execute function set_updated_at();
create index claims_owner_idx on claims (owner_id);
create index claims_flight_idx on claims (flight_id);

-- Alias as the full address, for n8n lookups
create or replace view claim_aliases as
  select id as claim_id, owner_id, 'airclaims_' || alias_code || '@airclaims.klivr.com' as alias_email
  from claims;

create table claim_passengers (
  id               uuid primary key default gen_random_uuid(),
  claim_id         uuid not null references claims(id) on delete cascade,
  full_name        text not null,
  is_lead          boolean not null default false,
  is_infant_free   boolean not null default false,   -- free tickets are excluded (Art. 3.3)
  compensation_eur numeric(8,2)
);

create table claim_expenses (
  id                 uuid primary key default gen_random_uuid(),
  claim_id           uuid not null references claims(id) on delete cascade,
  category           expense_category not null,
  amount             numeric(8,2) not null check (amount >= 0),
  currency           char(3) not null default 'EUR',
  spent_at           timestamptz,
  description        text,
  airline_promised   boolean not null default false,   -- staff instructed/promised reimbursement
  promise_details    text,                             -- who, when, where, written proof?
  document_id        uuid                              -- FK added after documents table
);

-- ---------------------------------------------------------------------
-- Documents (private bucket: claim-documents/{owner_id}/{claim_id}/...)
-- ---------------------------------------------------------------------
create table documents (
  id                 uuid primary key default gen_random_uuid(),
  claim_id           uuid not null references claims(id) on delete cascade,
  owner_id           uuid not null references profiles(id) on delete cascade,
  doc_type           document_type not null,
  storage_path       text not null unique,
  mime_type          text,
  sha256             text,
  validation         validation_status not null default 'pending',
  extracted          jsonb,          -- AI extraction: {name, flight, date, pnr, amount...}
  validation_result  jsonb,          -- comparisons + confidence + reasons
  retention_until    date,           -- set when claim resolves (retention policy)
  created_at         timestamptz not null default now()
);
alter table claim_expenses add constraint claim_expenses_document_fk
  foreign key (document_id) references documents(id) on delete set null;

-- ---------------------------------------------------------------------
-- Agreements (e-signature evidence)
-- ---------------------------------------------------------------------
create table agreements (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  claim_id         uuid references claims(id) on delete cascade,
  kind             agreement_type not null,
  version          text not null,           -- e.g. 'email-auth-v1'
  locale           text not null,
  signed_name      text not null,
  signed_at        timestamptz not null default now(),
  ip_address       inet,
  user_agent       text,
  document_sha256  text not null            -- hash of the exact rendered text/PDF
);

-- ---------------------------------------------------------------------
-- Emails + timeline
-- ---------------------------------------------------------------------
create table emails (
  id              uuid primary key default gen_random_uuid(),
  claim_id        uuid references claims(id) on delete cascade,  -- null = unmatched inbound
  direction       email_direction not null,
  status          email_status not null,
  classification  email_class not null default 'unclassified',
  from_address    text not null,
  to_addresses    text[] not null,                               -- hidden from user until sent
  recipient_label text,                                          -- shown before sending
  cc_addresses    text[] not null default '{}',
  subject         text,
  body_text       text,
  body_html       text,
  attachments     jsonb not null default '[]'::jsonb,           -- [{storage_path, filename, mime}]
  ai_summary      text,
  message_id      text unique,
  in_reply_to     text,
  approved_by     uuid references profiles(id),
  approved_at     timestamptz,
  sent_at         timestamptz,
  received_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index emails_claim_idx on emails (claim_id, created_at);

create table claim_events (
  id          bigint generated always as identity primary key,
  claim_id    uuid not null references claims(id) on delete cascade,
  event_type  text not null,              -- status_changed, email_received, document_validated...
  payload     jsonb not null default '{}'::jsonb,
  actor       text not null default 'system',  -- system | user | admin | ai
  created_at  timestamptz not null default now()
);
create index claim_events_claim_idx on claim_events (claim_id, created_at);

-- User can approve only their own pending drafts; everything else goes via n8n.
create or replace function approve_email(p_email_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update emails e set status = 'approved', approved_by = auth.uid(), approved_at = now()
  from claims c
  where e.id = p_email_id and e.claim_id = c.id and c.owner_id = auth.uid()
    and e.direction = 'outbound' and e.status = 'pending_approval';
  if not found then raise exception 'Email not found or not pending approval'; end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  select claim_id, 'email_approved', jsonb_build_object('email_id', p_email_id), 'user'
  from emails where id = p_email_id;
end $$;

-- ---------------------------------------------------------------------
-- Referrals, payments, fee
-- ---------------------------------------------------------------------
create table referrals (
  id               uuid primary key default gen_random_uuid(),
  referrer_id      uuid not null references profiles(id) on delete cascade,
  referred_user_id uuid not null unique references profiles(id) on delete cascade,
  status           referral_status not null default 'pending',  -- qualified once referred claim is submitted
  created_at       timestamptz not null default now()
);

create table payments (
  id                  uuid primary key default gen_random_uuid(),
  claim_id            uuid not null references claims(id) on delete cascade,
  base_amount_eur     numeric(8,2) not null,   -- compensation only, not expenses
  fee_pct             numeric(4,2) not null,
  amount_eur          numeric(8,2) not null,   -- VAT included
  status              payment_status not null default 'requested',
  stripe_session_id   text unique,
  invoice_number      text,                    -- issued in Xolo
  paid_at             timestamptz,
  created_at          timestamptz not null default now()
);

-- Defined after payments: SQL function bodies are validated at creation.
-- Fee rule (easy to change): 15% minus 1 point per extra passenger,
-- per previous paid claim, per qualified referral; floor 10%. VAT included.
create or replace function compute_fee_pct(p_claim_id uuid) returns numeric
language sql stable as $$
  with c as (select id, owner_id from claims where id = p_claim_id),
  extra_pax as (select greatest(count(*) - 1, 0) n from claim_passengers where claim_id = p_claim_id),
  prev_claims as (select count(*) n from payments p join claims c2 on c2.id = p.claim_id, c
                  where c2.owner_id = c.owner_id and c2.id <> c.id and p.status = 'paid'),
  refs as (select count(*) n from referrals r, c where r.referrer_id = c.owner_id and r.status = 'qualified')
  select greatest(10, 15 - (select n from extra_pax) - (select n from prev_claims) - (select n from refs))::numeric
$$;

-- ---------------------------------------------------------------------
-- Success stories
-- ---------------------------------------------------------------------
create table success_stories (
  id                 uuid primary key default gen_random_uuid(),
  claim_id           uuid not null unique references claims(id) on delete cascade,
  consent_publish    boolean not null default false,
  consent_show_name  boolean not null default false,
  consent_relay      boolean not null default false,  -- others may message them via our relay
  display_name       text,                            -- "Laura M." or null => anonymous
  story              text,
  locale             text not null default 'es',
  published          boolean not null default false,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Public scorecard (homepage, filter by airline)
-- ---------------------------------------------------------------------
create or replace view airline_scorecard as
select
  a.id as airline_id, a.name, a.iata, a.logo_path,
  count(c.id)                                                     as total_claims,
  count(c.id) filter (where c.status in ('won','partially_won'))  as won_claims,
  count(c.id) filter (where c.status = 'lost')                    as lost_claims,
  round(100.0 * count(c.id) filter (where c.status in ('won','partially_won'))
        / nullif(count(c.id) filter (where c.status in ('won','partially_won','lost')), 0), 1) as success_rate_pct,
  count(c.id) filter (where c.status = 'escalated_aesa')          as in_aesa,
  round(avg(extract(epoch from (c.resolved_at - c.submitted_airline_at)) / 86400)
        filter (where c.resolved_at is not null), 1)              as avg_days_to_resolution,
  (select count(*) from flights f where f.airline_id = a.id and f.candidate = 'candidate') as flights_3h_plus
from airlines a
left join claims c on c.airline_id = a.id
group by a.id;

-- Public list of detected disruptions (for SEO pages): no personal data
create or replace view public_disrupted_flights as
select f.flight_iata, f.flight_date, a.name as airline, f.dep_iata, f.arr_iata,
       f.arrival_delay_minutes, f.status, f.distance_km,
       case when f.distance_km <= 1500 then 250
            when f.distance_km <= 3500 then 400 else 600 end as max_compensation_eur,
       (select count(*) from claims c where c.flight_id = f.id) as claims_count,
       exists (select 1 from flight_risk_flags r where r.flight_id = f.id and r.excuses_airline) as extraordinary_flag
from flights f left join airlines a on a.id = f.airline_id
where f.candidate in ('possible','candidate');

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table profiles            enable row level security;
alter table claims              enable row level security;
alter table claim_passengers    enable row level security;
alter table claim_expenses      enable row level security;
alter table documents           enable row level security;
alter table agreements          enable row level security;
alter table emails              enable row level security;
alter table claim_events        enable row level security;
alter table referrals           enable row level security;
alter table payments            enable row level security;
alter table success_stories     enable row level security;
alter table airports            enable row level security;
alter table airline_groups      enable row level security;
alter table airlines            enable row level security;
alter table airline_contacts    enable row level security;
alter table flights             enable row level security;
alter table flight_observations enable row level security;
alter table weather_observations enable row level security;
alter table disruption_events   enable row level security;
alter table flight_risk_flags   enable row level security;

-- Own profile
create policy "own profile read"   on profiles for select using (id = auth.uid());
create policy "own profile update" on profiles for update using (id = auth.uid());

-- Claims: users create/edit drafts; status changes after draft happen via n8n
create policy "own claims read"   on claims for select using (owner_id = auth.uid());
create policy "own claims insert" on claims for insert with check (owner_id = auth.uid() and status = 'draft');
create policy "own draft update"  on claims for update
  using (owner_id = auth.uid() and status in ('draft','documents_pending'))
  with check (owner_id = auth.uid() and status in ('draft','documents_pending'));

-- Child tables of a claim
create policy "own passengers" on claim_passengers for all
  using (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()));
create policy "own expenses" on claim_expenses for all
  using (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()));
create policy "own documents read"   on documents for select using (owner_id = auth.uid());
create policy "own documents insert" on documents for insert with check (owner_id = auth.uid());
create policy "own agreements read"   on agreements for select using (user_id = auth.uid());
create policy "own agreements insert" on agreements for insert with check (user_id = auth.uid());
-- No direct select on emails for users: they read through my_emails, which
-- hides the exact recipient address until the email has been sent.
create or replace view my_emails as
select e.id, e.claim_id, e.direction, e.status, e.classification,
       case when e.direction = 'inbound' or e.status = 'sent' then e.from_address end as from_address,
       case when e.direction = 'inbound' or e.status = 'sent' then e.to_addresses end as to_addresses,
       e.recipient_label, e.subject, e.body_text, e.body_html, e.attachments, e.ai_summary,
       e.approved_at, e.sent_at, e.received_at, e.created_at
from emails e
join claims c on c.id = e.claim_id
where c.owner_id = auth.uid();   -- owner-privileged view, filtered by caller
revoke all on my_emails from anon;
grant select on my_emails to authenticated;
create policy "own events read" on claim_events for select
  using (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()));
create policy "own referrals read" on referrals for select using (referrer_id = auth.uid() or referred_user_id = auth.uid());
create policy "own payments read" on payments for select
  using (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()));
create policy "own story" on success_stories for all
  using (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()));
create policy "published stories public" on success_stories for select using (published);

-- Reference data: any logged-in user
create policy "auth read airports"   on airports            for select to authenticated using (true);
create policy "auth read groups"     on airline_groups      for select to authenticated using (true);
create policy "auth read airlines"   on airlines            for select to authenticated using (true);
-- Web forms and phones are public guidance; curated email addresses stay server-side
create policy "auth read contacts"   on airline_contacts    for select to authenticated using (channel <> 'email');
create policy "auth read flights"    on flights             for select to authenticated using (true);
create policy "auth read weather"    on weather_observations for select to authenticated using (true);
create policy "auth read disruptions" on disruption_events  for select to authenticated using (confirmed);
create policy "auth read risk flags" on flight_risk_flags   for select to authenticated using (true);
-- flight_observations: service role only (no policy)

-- Scorecard + disrupted flights are public (homepage/SEO, anonymous visitors)
grant select on airline_scorecard, public_disrupted_flights to anon, authenticated;

-- ---------------------------------------------------------------------
-- Storage buckets
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('claim-documents', 'claim-documents', false),
  ('airline-logos',   'airline-logos',   true)
on conflict (id) do nothing;

-- Users upload/read only inside claim-documents/{their uid}/...
create policy "own docs upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "own docs read" on storage.objects for select to authenticated
  using (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------
-- Seed: Barcelona + your first airline
-- ---------------------------------------------------------------------
insert into airports (iata, icao, name, city, country_code, latitude, longitude, timezone, eu261_scope, monitored)
values ('BCN','LEBL','Josep Tarradellas Barcelona-El Prat','Barcelona','ES',41.2974,2.0833,'Europe/Madrid',true,true);

insert into airlines (iata, icao, name, country_code, is_eu_carrier, preferred_language, website)
values ('W6','WZZ','Wizz Air','HU',true,'en','https://wizzair.com');

insert into airline_contacts (airline_id, purpose, channel, label, value, submission_steps)
select id, 'compensation', 'web_form', 'Wizz Air – Claims & Compensation',
       'https://www.wizzair.com/en-gb/help-centre/my-wizz-account/claims-and-compensation',
       '{"en":["Open the Wizz Air claim form (link above).","Use your AirClaims alias as contact email.","Paste the claim text we prepared.","Request payment in money, not WIZZ credit.","Attach boarding pass, booking and receipts.","Save the claim reference and add it to your case here."]}'::jsonb
from airlines where iata = 'W6';   -- TODO verify steps against the live form