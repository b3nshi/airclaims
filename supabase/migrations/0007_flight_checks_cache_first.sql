-- =====================================================================
-- 0007 — flight checks: never call the API for a flight we already have.
-- A flight can become final after its check was queued (another check, the
-- airport feed in M6, manual entry). Before leasing work, close those checks
-- from our own data; only flights still unknown are handed to the worker.
-- =====================================================================

create or replace function claim_due_flight_checks(p_limit int default 5) returns setof flight_checks
language plpgsql security definer set search_path = public as $$
begin
  -- 1. Cache first: queued flights that are now final in `flights` need no API call.
  with resolved as (
    update flight_checks c
    set status = 'done', flight_id = f.id, processed_at = now(), locked_at = null
    from flights f
    where c.status in ('pending', 'processing')
      and f.flight_iata = c.flight_iata and f.flight_date = c.flight_date
      and f.data_status = 'final'
      and (c.status = 'pending'
           or c.locked_at < now() - make_interval(mins => (flight_check_config()->>'lease_minutes')::int))
    returning c.flight_iata, c.flight_date, f.id as flight_id
  )
  update claims cl set flight_id = r.flight_id
  from resolved r
  where cl.flight_iata = r.flight_iata and cl.flight_date = r.flight_date and cl.flight_id is null;

  -- 2. Lease what is still unknown and due.
  return query
  update flight_checks set status = 'processing', locked_at = now(), attempts = attempts + 1
  where id in (
    select c.id from flight_checks c
    where ((c.status = 'pending' and c.next_attempt_at <= now())
           or (c.status = 'processing'
               and c.locked_at < now() - make_interval(mins => (flight_check_config()->>'lease_minutes')::int)))
      and not exists (select 1 from flights f
                      where f.flight_iata = c.flight_iata and f.flight_date = c.flight_date
                        and f.data_status = 'final')
    order by c.next_attempt_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  )
  returning *;
end $$;

revoke execute on function claim_due_flight_checks(int) from public, anon, authenticated;
grant execute on function claim_due_flight_checks(int) to service_role;
