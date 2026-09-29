-- =====================================================================
-- 0003 — claim wizard: RPCs for status changes, tighter user privileges,
-- document deletion while editable. No table structure changes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Claims: users may only write claim content. Status, alias, fee and
-- outcome columns are system-managed (RPCs below or n8n).
-- ---------------------------------------------------------------------
revoke insert, update on public.claims from anon, authenticated;
grant insert (owner_id, flight_iata, flight_date, airline_id, flight_id, dep_iata, arr_iata,
              final_destination_iata, booking_reference, disruption, reported_arrival_delay_minutes,
              cancellation_notice_days, care_provided, airline_instructions, reason_given_by_airline,
              compensation_eur)
  on public.claims to authenticated;
grant update (flight_iata, flight_date, airline_id, flight_id, dep_iata, arr_iata,
              final_destination_iata, booking_reference, disruption, reported_arrival_delay_minutes,
              cancellation_notice_days, care_provided, airline_instructions, reason_given_by_airline,
              compensation_eur)
  on public.claims to authenticated;

-- ---------------------------------------------------------------------
-- Documents: users can't set validation results, must attach to their own
-- claim under {owner_id}/{claim_id}/, and can delete while the claim is editable.
-- ---------------------------------------------------------------------
revoke insert, update on public.documents from anon, authenticated;
grant insert (claim_id, owner_id, doc_type, storage_path, mime_type, sha256)
  on public.documents to authenticated;

drop policy "own documents insert" on documents;
create policy "own documents insert" on documents for insert with check (
  owner_id = auth.uid()
  and storage_path like auth.uid()::text || '/' || claim_id::text || '/%'
  and exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()
              and c.status not in ('won','partially_won','lost','withdrawn'))
);
create policy "own editable documents delete" on documents for delete using (
  owner_id = auth.uid()
  and exists (select 1 from claims c where c.id = claim_id and c.owner_id = auth.uid()
              and c.status in ('draft','documents_pending'))
);

create policy "own docs delete" on storage.objects for delete to authenticated
  using (bucket_id = 'claim-documents' and (storage.foldername(name))[1] = auth.uid()::text);

update storage.buckets
set file_size_limit = 10485760,  -- 10 MB
    allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/heic']
where id = 'claim-documents';

-- ---------------------------------------------------------------------
-- submit_claim: after the user signs. Draft → ready_to_submit, or
-- documents_pending while the boarding pass / booking are missing.
-- ---------------------------------------------------------------------
create or replace function submit_claim(p_claim_id uuid) returns claim_status
language plpgsql security definer set search_path = public as $$
declare
  v_old claim_status;
  v_new claim_status;
begin
  select status into v_old from claims
  where id = p_claim_id and owner_id = auth.uid()
  for update;
  if v_old is null then raise exception 'Claim not found'; end if;
  if v_old not in ('draft','documents_pending') then raise exception 'Claim already submitted'; end if;

  if (select count(distinct kind) from agreements
      where claim_id = p_claim_id and user_id = auth.uid()
        and kind in ('terms_of_service','privacy_notice','email_authorization')) < 3 then
    raise exception 'Missing signed agreements';
  end if;
  if not exists (select 1 from claim_passengers where claim_id = p_claim_id and is_lead) then
    raise exception 'Missing lead passenger';
  end if;

  v_new := case when (select count(distinct doc_type) from documents
                      where claim_id = p_claim_id
                        and doc_type in ('boarding_pass','booking_confirmation')) = 2
                then 'ready_to_submit'::claim_status
                else 'documents_pending'::claim_status end;

  if v_new is distinct from v_old then
    update claims set status = v_new where id = p_claim_id;
    insert into claim_events (claim_id, event_type, payload, actor)
    values (p_claim_id, 'status_changed', jsonb_build_object('from', v_old, 'to', v_new), 'user');
  end if;
  return v_new;
end $$;

-- ---------------------------------------------------------------------
-- record_airline_submission: the user submitted the airline's web form
-- themselves and gives us the airline's reference.
-- ---------------------------------------------------------------------
create or replace function record_airline_submission(p_claim_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ref text := nullif(btrim(p_reference), '');
begin
  if v_ref is not null and length(v_ref) > 100 then raise exception 'Reference too long'; end if;

  update claims
  set airline_claim_reference = v_ref, submitted_airline_at = now(), status = 'submitted_airline'
  where id = p_claim_id and owner_id = auth.uid() and status in ('ready_to_submit','documents_pending');
  if not found then raise exception 'Claim not found or not ready to submit'; end if;

  insert into claim_events (claim_id, event_type, payload, actor)
  values (p_claim_id, 'submitted_airline',
          jsonb_build_object('channel', 'web_form', 'reference', v_ref), 'user');
end $$;

-- ---------------------------------------------------------------------
-- airline_claim_channels: which channels an airline accepts for
-- compensation claims, without revealing curated email addresses.
-- ---------------------------------------------------------------------
create or replace function airline_claim_channels(p_airline_id uuid)
returns table (channel contact_channel, label text)
language sql stable security definer set search_path = public as $$
  select channel, label from airline_contacts
  where airline_id = p_airline_id and purpose = 'compensation'
  order by case channel when 'email' then 0 when 'web_form' then 1 else 2 end
$$;

revoke execute on function submit_claim(uuid), record_airline_submission(uuid, text),
  airline_claim_channels(uuid) from public, anon;
grant execute on function submit_claim(uuid), record_airline_submission(uuid, text),
  airline_claim_channels(uuid) to authenticated;
