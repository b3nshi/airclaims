-- =====================================================================
-- 0005 — flight checks: our `flights` table is the source of truth; a flight
-- we don't have (final) data for is queued and confirmed with ONE API call,
-- made once it has landed. Every user check goes through request_flight_check.
-- =====================================================================

-- provisional: seen before landing (times may change) · final: landed/cancelled/diverted
create type flight_data_status as enum ('provisional','final');
alter table flights add column data_status flight_data_status not null default 'provisional';

create type flight_check_status as enum ('pending','processing','done','not_found','failed');

create table flight_checks (
  id               uuid primary key default gen_random_uuid(),
  flight_iata      text not null,
  flight_date      date not null,
  status           flight_check_status not null default 'pending',
  attempts         int not null default 0,              -- API calls made for this flight
  next_attempt_at  timestamptz not null,
  locked_at        timestamptz,                         -- worker lease while processing
  flight_id        uuid references flights(id) on delete set null,
  last_error       text,
  requested_by     uuid references profiles(id) on delete set null,  -- rate limiting only
  requested_at     timestamptz not null default now(),
  processed_at     timestamptz,
  unique (flight_iata, flight_date)
);
create index flight_checks_due_idx on flight_checks (next_attempt_at) where status = 'pending';
alter table flight_checks enable row level security;   -- no policies: RPCs + service role only

-- Tunables (kept here so the reform / provider changes need one migration, not code).
create or replace function flight_check_config() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'first_call_hour_after_departure_day', 12,  -- first call: noon (Madrid) the day after departure
    'not_landed_retry_after_arrival_hours', 3,  -- API said "not landed yet": retry after scheduled arrival + 3h
    'not_found_retry_hours', 24,                -- provider data can lag: one retry, then not_found
    'max_not_found_attempts', 2,
    'error_retry_minutes', 60,                  -- 429/5xx: no data received
    'max_error_attempts', 5,
    'user_new_checks_per_day', 20,
    'lease_minutes', 10
  )
$$;

-- ---------------------------------------------------------------------
-- request_flight_check (users): answer from `flights` when final; otherwise
-- queue the flight once (unique per flight/date). `trigger` tells the app
-- to poke the worker because this request created the check.
-- ---------------------------------------------------------------------
create or replace function request_flight_check(p_flight_iata text, p_flight_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := flight_check_config();
  v_flight text := upper(regexp_replace(coalesce(p_flight_iata, ''), '[^A-Za-z0-9]', '', 'g'));
  v_today date := (now() at time zone 'Europe/Madrid')::date;
  f flights;
  c flight_checks;
  v_created boolean := false;
  v_flight_json jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if v_flight !~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$' or p_flight_date is null
     or p_flight_date > v_today or p_flight_date < v_today - interval '6 years' then
    return jsonb_build_object('status', 'invalid', 'trigger', false, 'flight', null);
  end if;

  select * into f from flights where flight_iata = v_flight and flight_date = p_flight_date;
  v_flight_json := case when f.id is null then null else to_jsonb(f) end;
  if f.data_status = 'final' then
    return jsonb_build_object('status', 'final', 'trigger', false, 'flight', to_jsonb(f));
  end if;

  select * into c from flight_checks where flight_iata = v_flight and flight_date = p_flight_date;
  if c.id is null then
    if (select count(*) from flight_checks
        where requested_by = auth.uid() and requested_at > now() - interval '1 day')
       >= (cfg->>'user_new_checks_per_day')::int then
      return jsonb_build_object('status', 'rate_limited', 'trigger', false, 'flight', v_flight_json);
    end if;
    insert into flight_checks (flight_iata, flight_date, requested_by, flight_id, next_attempt_at)
    values (v_flight, p_flight_date, auth.uid(), f.id,
            greatest(now(), ((p_flight_date + 1)::timestamp
                             + make_interval(hours => (cfg->>'first_call_hour_after_departure_day')::int))
                            at time zone 'Europe/Madrid'))
    on conflict (flight_iata, flight_date) do nothing
    returning * into c;
    v_created := c.id is not null;
    if not v_created then  -- lost a race with another user: same check
      select * into c from flight_checks where flight_iata = v_flight and flight_date = p_flight_date;
    end if;
  end if;

  return jsonb_build_object(
    'status', c.status,
    'trigger', v_created and c.next_attempt_at <= now(),
    'flight', v_flight_json  -- provisional data (e.g. from the airport feed) if any
  );
end $$;

-- ---------------------------------------------------------------------
-- Worker (service role): lease due checks. SKIP LOCKED + lease means two
-- runs never call the API for the same flight.
-- ---------------------------------------------------------------------
create or replace function claim_due_flight_checks(p_limit int default 5) returns setof flight_checks
language sql security definer set search_path = public as $$
  update flight_checks set status = 'processing', locked_at = now(), attempts = attempts + 1
  where id in (
    select id from flight_checks
    where (status = 'pending' and next_attempt_at <= now())
       or (status = 'processing'
           and locked_at < now() - make_interval(mins => (flight_check_config()->>'lease_minutes')::int))
    order by next_attempt_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning *
$$;

-- ---------------------------------------------------------------------
-- Worker: store the API result. Idempotent (only acts on a leased check).
-- p_flight: {dep_iata, arr_iata, airline_iata, scheduled_dep, actual_dep,
--            scheduled_arr, actual_arr, status, distance_km}
-- ---------------------------------------------------------------------
create or replace function complete_flight_check(p_check_id uuid, p_found boolean, p_flight jsonb, p_raw jsonb)
returns flight_check_status
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := flight_check_config();
  c flight_checks;
  v_final boolean;
  v_flight_id uuid;
  v_sched_arr timestamptz := nullif(p_flight->>'scheduled_arr', '')::timestamptz;
  v_status text := coalesce(p_flight->>'status', '');
begin
  select * into c from flight_checks where id = p_check_id and status = 'processing' for update;
  if c.id is null then return null; end if;

  if not p_found then
    update flight_checks
    set status = case when c.attempts >= (cfg->>'max_not_found_attempts')::int
                      then 'not_found'::flight_check_status else 'pending'::flight_check_status end,
        next_attempt_at = now() + make_interval(hours => (cfg->>'not_found_retry_hours')::int),
        processed_at = now(), locked_at = null
    where id = c.id
    returning status into c.status;
    return c.status;
  end if;

  v_final := v_status ~* '^(arrived|canceled|cancelled|diverted)'
             or v_sched_arr < now() - interval '24 hours';  -- long past: nothing better will come

  insert into flights as fl (flight_iata, flight_date, airline_id, dep_iata, arr_iata, scheduled_dep, actual_dep,
                             scheduled_arr, actual_arr, status, distance_km, source, last_checked_at, data_status)
  values (
    c.flight_iata, c.flight_date,
    (select id from airlines where iata = p_flight->>'airline_iata'),
    (select iata from airports where iata = p_flight->>'dep_iata'),   -- unknown airport → null, no FK error
    (select iata from airports where iata = p_flight->>'arr_iata'),
    nullif(p_flight->>'scheduled_dep', '')::timestamptz,
    nullif(p_flight->>'actual_dep', '')::timestamptz,
    v_sched_arr,
    nullif(p_flight->>'actual_arr', '')::timestamptz,
    nullif(v_status, ''),
    nullif(p_flight->>'distance_km', '')::int,
    'aerodatabox', now(),
    case when v_final then 'final'::flight_data_status else 'provisional'::flight_data_status end
  )
  on conflict (flight_iata, flight_date) do update set
    airline_id = coalesce(excluded.airline_id, fl.airline_id),
    dep_iata = coalesce(excluded.dep_iata, fl.dep_iata),
    arr_iata = coalesce(excluded.arr_iata, fl.arr_iata),
    scheduled_dep = coalesce(excluded.scheduled_dep, fl.scheduled_dep),
    actual_dep = coalesce(excluded.actual_dep, fl.actual_dep),
    scheduled_arr = coalesce(excluded.scheduled_arr, fl.scheduled_arr),
    actual_arr = coalesce(excluded.actual_arr, fl.actual_arr),
    status = coalesce(excluded.status, fl.status),
    distance_km = coalesce(excluded.distance_km, fl.distance_km),
    source = excluded.source,
    last_checked_at = now(),
    data_status = case when fl.data_status = 'final' then fl.data_status else excluded.data_status end
  returning id into v_flight_id;

  -- Delay classification used by the finder, scorecard and SEO pages.
  update flights set candidate = case
      when status ~* '^cancel' or arrival_delay_minutes >= 180 then 'candidate'::candidate_level
      when arrival_delay_minutes > 15 then 'possible'::candidate_level
      else 'none'::candidate_level end
  where id = v_flight_id;

  insert into flight_observations (flight_id, payload) values (v_flight_id, coalesce(p_raw, p_flight));

  if v_final then
    update flight_checks set status = 'done', flight_id = v_flight_id, processed_at = now(), locked_at = null
    where id = c.id;
    update claims set flight_id = v_flight_id
    where flight_iata = c.flight_iata and flight_date = c.flight_date and flight_id is null;
    return 'done';
  end if;

  -- Not landed yet: one more call after the scheduled arrival.
  update flight_checks
  set status = 'pending', flight_id = v_flight_id, locked_at = null, processed_at = now(),
      next_attempt_at = greatest(now() + interval '1 hour',
        coalesce(v_sched_arr, now()) + make_interval(hours => (cfg->>'not_landed_retry_after_arrival_hours')::int))
  where id = c.id;
  return 'pending';
end $$;

-- Worker: the API call failed without data (429, 5xx, timeout).
create or replace function fail_flight_check(p_check_id uuid, p_error text) returns flight_check_status
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := flight_check_config();
  v_status flight_check_status;
begin
  update flight_checks
  set status = case when attempts >= (cfg->>'max_error_attempts')::int
                    then 'failed'::flight_check_status else 'pending'::flight_check_status end,
      next_attempt_at = now() + make_interval(mins => (cfg->>'error_retry_minutes')::int * attempts),
      last_error = left(p_error, 500), locked_at = null
  where id = p_check_id and status = 'processing'
  returning status into v_status;
  return v_status;
end $$;

revoke execute on function request_flight_check(text, date), claim_due_flight_checks(int),
  complete_flight_check(uuid, boolean, jsonb, jsonb), fail_flight_check(uuid, text), flight_check_config()
  from public, anon, authenticated;
grant execute on function request_flight_check(text, date) to authenticated;
grant execute on function claim_due_flight_checks(int), complete_flight_check(uuid, boolean, jsonb, jsonb),
  fail_flight_check(uuid, text) to service_role;
