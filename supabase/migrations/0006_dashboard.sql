-- =====================================================================
-- 0006 — dashboard: withdraw a claim; keep claims.expenses_total_eur in sync.
-- No table structure changes.
-- =====================================================================

-- The terms promise users can withdraw from their dashboard at any time.
create or replace function withdraw_claim(p_claim_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_old claim_status;
begin
  select status into v_old from claims where id = p_claim_id and owner_id = auth.uid() for update;
  if v_old is null then raise exception 'Claim not found'; end if;
  if v_old in ('won','partially_won','lost','withdrawn') then raise exception 'Claim already closed'; end if;

  -- resolved_at stays null: a withdrawal isn't an outcome (keeps the scorecard honest).
  update claims set status = 'withdrawn' where id = p_claim_id;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (p_claim_id, 'status_changed', jsonb_build_object('from', v_old, 'to', 'withdrawn'), 'user');
end $$;

revoke execute on function withdraw_claim(uuid) from public, anon;
grant execute on function withdraw_claim(uuid) to authenticated;

-- expenses_total_eur is system-managed (not user-writable since 0003): EUR expenses only;
-- other currencies are listed separately in the UI.
create or replace function sync_claim_expenses_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_claim uuid := coalesce(new.claim_id, old.claim_id);
begin
  update claims
  set expenses_total_eur = coalesce((select sum(amount) from claim_expenses
                                     where claim_id = v_claim and currency = 'EUR'), 0)
  where id = v_claim;
  if tg_op = 'UPDATE' and new.claim_id is distinct from old.claim_id then
    update claims
    set expenses_total_eur = coalesce((select sum(amount) from claim_expenses
                                       where claim_id = old.claim_id and currency = 'EUR'), 0)
    where id = old.claim_id;
  end if;
  return null;
end $$;

create trigger trg_claim_expenses_total
after insert or update or delete on claim_expenses
for each row execute function sync_claim_expenses_total();

update claims c
set expenses_total_eur = coalesce((select sum(amount) from claim_expenses e
                                   where e.claim_id = c.id and e.currency = 'EUR'), 0);
