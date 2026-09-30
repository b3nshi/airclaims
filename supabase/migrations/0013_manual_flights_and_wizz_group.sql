-- =====================================================================
-- 0013 — register flight data by hand (no paid API call), and give the other
-- Wizz Air operators (W4 Malta, W9 UK) the same claim channel and knowledge
-- as W6. No changes to existing table structures.
-- =====================================================================

-- Great-circle distance in km between two airports (haversine).
create or replace function airport_distance_km(p_from char(3), p_to char(3)) returns int
language sql stable set search_path = public as $$
  select round(2 * 6371 * asin(sqrt(
           power(sin(radians(b.latitude - a.latitude) / 2), 2)
           + cos(radians(a.latitude)) * cos(radians(b.latitude)) * power(sin(radians(b.longitude - a.longitude) / 2), 2))))::int
  from airports a, airports b
  where a.iata = p_from and b.iata = p_to and a.latitude is not null and b.latitude is not null
$$;

-- ---------------------------------------------------------------------
-- admin_upsert_flight: a KB editor / admin (or the SQL editor) records what
-- happened to a flight. Timestamps must carry their UTC offset. Marked
-- `final`, the flight is answered from our table and never sent to the API.
-- p: {flight_iata, flight_date, dep_iata, arr_iata, scheduled_dep, scheduled_arr,
--     actual_dep, actual_arr (doors open), status, final, note}
-- ---------------------------------------------------------------------
create or replace function admin_upsert_flight(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_flight text := upper(regexp_replace(coalesce(p->>'flight_iata', ''), '[^A-Za-z0-9]', '', 'g'));
  v_date date := (p->>'flight_date')::date;
  v_dep char(3) := upper(p->>'dep_iata');
  v_arr char(3) := upper(p->>'arr_iata');
  v_final boolean := coalesce((p->>'final')::boolean, false);
  v_id uuid;
  f flights;
  v_delay int;
begin
  -- KB editors/admins through the app, the service role, or a direct SQL session (the Supabase
  -- SQL editor has no request JWT; every API request, even anonymous, carries one).
  if not (is_kb_editor()
          or coalesce(auth.jwt()->>'role', '') = 'service_role'
          or nullif(current_setting('request.jwt.claims', true), '') is null) then
    raise exception 'Not allowed';
  end if;
  if v_flight !~ '^[A-Z0-9]{2}[0-9]{1,4}[A-Z]?$' or v_date is null then raise exception 'Invalid flight number or date'; end if;
  if not exists (select 1 from airports where iata = v_dep) or not exists (select 1 from airports where iata = v_arr) then
    raise exception 'Unknown airport';
  end if;

  insert into flights as fl (flight_iata, flight_date, airline_id, dep_iata, arr_iata, scheduled_dep, scheduled_arr,
                             actual_dep, actual_arr, status, distance_km, source, last_checked_at, data_status)
  values (v_flight, v_date, (select id from airlines where iata = left(v_flight, 2)), v_dep, v_arr,
          nullif(p->>'scheduled_dep', '')::timestamptz, nullif(p->>'scheduled_arr', '')::timestamptz,
          nullif(p->>'actual_dep', '')::timestamptz, nullif(p->>'actual_arr', '')::timestamptz,
          nullif(p->>'status', ''), airport_distance_km(v_dep, v_arr), 'manual', now(),
          case when v_final then 'final'::flight_data_status else 'provisional'::flight_data_status end)
  on conflict (flight_iata, flight_date) do update set
    airline_id = coalesce(excluded.airline_id, fl.airline_id),
    dep_iata = excluded.dep_iata,
    arr_iata = excluded.arr_iata,
    scheduled_dep = coalesce(excluded.scheduled_dep, fl.scheduled_dep),
    scheduled_arr = coalesce(excluded.scheduled_arr, fl.scheduled_arr),
    actual_dep = coalesce(excluded.actual_dep, fl.actual_dep),
    actual_arr = coalesce(excluded.actual_arr, fl.actual_arr),
    status = coalesce(excluded.status, fl.status),
    distance_km = coalesce(excluded.distance_km, fl.distance_km),
    source = 'manual',
    last_checked_at = now(),
    data_status = case when v_final then 'final'::flight_data_status else fl.data_status end
  returning * into f;
  v_id := f.id;

  -- Arrival delay is the legal reference; while unknown, a long departure delay still flags it.
  v_delay := coalesce(f.arrival_delay_minutes,
                      (extract(epoch from (f.actual_dep - f.scheduled_dep)) / 60)::int);
  update flights set candidate = case
      when status ~* '^cancel' or v_delay >= 180 then 'candidate'::candidate_level
      when v_delay > 15 then 'possible'::candidate_level
      else 'none'::candidate_level end
  where id = v_id;

  insert into flight_observations (flight_id, payload)
  values (v_id, jsonb_build_object('source', 'manual', 'by', auth.uid(), 'input', p));

  if v_final then
    update flight_checks set status = 'done', flight_id = v_id, processed_at = now(), locked_at = null
    where flight_iata = v_flight and flight_date = v_date and status in ('pending', 'processing', 'not_found', 'failed');
    update claims set flight_id = v_id where flight_iata = v_flight and flight_date = v_date and flight_id is null;
  end if;

  insert into admin_audit_log (actor_id, table_name, row_id, action, after)
  values (auth.uid(), 'flights', v_id::text, 'upsert_manual', to_jsonb(f) || jsonb_build_object('note', p->>'note'));
  return v_id;
end $$;

revoke execute on function admin_upsert_flight(jsonb) from public, anon;
grant execute on function admin_upsert_flight(jsonb) to authenticated, service_role;

-- Editors can see manual-flight entries in the audit log too.
drop policy "read audit log" on admin_audit_log;
create policy "read audit log" on admin_audit_log for select to authenticated using (
  is_admin() or (is_kb_editor() and table_name in ('airlines', 'airline_contacts', 'airline_knowledge', 'airline_insights', 'flights'))
);

-- ---------------------------------------------------------------------
-- Wizz Air group: W4 (Malta) and W9 (UK) flights are claimed through the same
-- Wizz form. Copy W6's contact and knowledge (editable per airline in /admin).
-- ---------------------------------------------------------------------
insert into airline_groups (name) values ('Wizz Air Group') on conflict (name) do nothing;
update airlines set group_id = (select id from airline_groups where name = 'Wizz Air Group'),
                    website = coalesce(website, 'https://wizzair.com')
where iata in ('W6', 'W4', 'W9');

insert into airline_contacts (airline_id, purpose, channel, label, value, submission_steps, language, notes)
select o.id, c.purpose, c.channel, c.label, c.value, c.submission_steps, c.language,
       'Same form as Wizz Air (W6). ' || coalesce(c.notes, '')
from airline_contacts c
join airlines w on w.id = c.airline_id and w.iata = 'W6'
cross join airlines o
where o.iata in ('W4', 'W9')
on conflict (airline_id, purpose, channel, value) do nothing;

insert into airline_knowledge (airline_id, passenger_tips, drafting_notes, claim_form_notes, attachments_max_mb,
                               stated_reply_days, typical_reply_days_min, typical_reply_days_max, offers_credit_first)
select o.id, k.passenger_tips, k.drafting_notes,
       'Copied from Wizz Air (W6): same claim form for all Wizz operators. ' || coalesce(k.claim_form_notes, ''),
       k.attachments_max_mb, k.stated_reply_days, k.typical_reply_days_min, k.typical_reply_days_max, k.offers_credit_first
from airline_knowledge k
join airlines w on w.id = k.airline_id and w.iata = 'W6'
cross join airlines o
where o.iata in ('W4', 'W9')
on conflict (airline_id) do nothing;
