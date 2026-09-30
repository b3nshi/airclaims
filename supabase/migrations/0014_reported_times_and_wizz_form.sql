-- =====================================================================
-- 0014 — the wizard asks for times, not durations.
--   * claims: the times the passenger reports (local wall-clock time at the
--     airport concerned) — shown again when editing, and evidence for AESA.
--     The delay in minutes is still computed and stored as before.
--   * airports: time zones, so local times convert correctly.
--   * Wizz Air: the claim-submission form, the category to choose and how to
--     use the claim alias (as reported by a passenger on 2026-09-30).
-- Schema change: new nullable columns on claims (approved 2026-09-30).
-- =====================================================================

alter table claims
  add column reported_scheduled_dep_local timestamp,   -- at the departure airport
  add column reported_scheduled_arr_local timestamp,   -- at the final destination
  add column reported_actual_dep_local    timestamp,   -- at the departure airport
  add column reported_actual_arr_local    timestamp,   -- at the final destination (doors open)
  add column arrival_time_estimated       boolean not null default false;  -- from departure time + scheduled duration

-- Users may write them like the rest of the claim content (column grants, 0003).
grant insert (reported_scheduled_dep_local, reported_scheduled_arr_local, reported_actual_dep_local,
              reported_actual_arr_local, arrival_time_estimated) on public.claims to authenticated;
grant update (reported_scheduled_dep_local, reported_scheduled_arr_local, reported_actual_dep_local,
              reported_actual_arr_local, arrival_time_estimated) on public.claims to authenticated;

-- ---------------------------------------------------------------------
-- Airport time zones (single-zone countries + island exceptions).
-- Multi-zone countries (US, CA, BR, RU…) stay null until curated.
-- ---------------------------------------------------------------------
update airports a set timezone = z.tz
from (values
  ('AT','Europe/Vienna'),('BE','Europe/Brussels'),('BG','Europe/Sofia'),('HR','Europe/Zagreb'),('CY','Asia/Nicosia'),
  ('CZ','Europe/Prague'),('DK','Europe/Copenhagen'),('EE','Europe/Tallinn'),('FI','Europe/Helsinki'),('FR','Europe/Paris'),
  ('DE','Europe/Berlin'),('GR','Europe/Athens'),('HU','Europe/Budapest'),('IE','Europe/Dublin'),('IT','Europe/Rome'),
  ('LV','Europe/Riga'),('LT','Europe/Vilnius'),('LU','Europe/Luxembourg'),('MT','Europe/Malta'),('NL','Europe/Amsterdam'),
  ('PL','Europe/Warsaw'),('PT','Europe/Lisbon'),('RO','Europe/Bucharest'),('SK','Europe/Bratislava'),('SI','Europe/Ljubljana'),
  ('ES','Europe/Madrid'),('SE','Europe/Stockholm'),('IS','Atlantic/Reykjavik'),('NO','Europe/Oslo'),('CH','Europe/Zurich'),
  ('GB','Europe/London'),('GP','America/Guadeloupe'),('MQ','America/Martinique'),('GF','America/Cayenne'),
  ('RE','Indian/Reunion'),('YT','Indian/Mayotte'),('MF','America/Marigot'),
  ('MA','Africa/Casablanca'),('TR','Europe/Istanbul'),('IL','Asia/Jerusalem'),('AE','Asia/Dubai'),('QA','Asia/Qatar'),
  ('RS','Europe/Belgrade'),('AL','Europe/Tirane'),('BA','Europe/Sarajevo'),('ME','Europe/Podgorica'),('MK','Europe/Skopje'),
  ('MD','Europe/Chisinau'),('GE','Asia/Tbilisi'),('AM','Asia/Yerevan'),('EG','Africa/Cairo'),('TN','Africa/Tunis'),
  ('DZ','Africa/Algiers'),('JO','Asia/Amman'),('LB','Asia/Beirut'),('SA','Asia/Riyadh'),('UA','Europe/Kyiv'),
  ('BY','Europe/Minsk'),('AZ','Asia/Baku'),('KW','Asia/Kuwait'),('BH','Asia/Bahrain'),('OM','Asia/Muscat')
) as z(cc, tz)
where a.country_code = z.cc and a.timezone is null;

update airports set timezone = 'Atlantic/Canary'
where iata in ('LPA','TFS','TFN','ACE','FUE','SPC','VDE','GMZ');
update airports set timezone = 'Atlantic/Madeira' where iata in ('FNC','PXO');
update airports set timezone = 'Atlantic/Azores' where iata in ('PDL','TER','HOR','SMA','PIX','FLW','GRW','CVU');

-- ---------------------------------------------------------------------
-- Wizz Air (W6, W4, W9): the claim form and how to fill it in.
-- ---------------------------------------------------------------------
update airline_contacts c
set value = 'https://www.wizzair.com/en-gb/help-centre/my-wizz-account/claims-and-compensation/claim-submission',
    verified_at = '2026-09-30',
    notes = 'Login with a WIZZ account required. Categories seen on 2026-09-30: Delay, cancellation, denied boarding / '
         || 'Booking, reservation, account / Bag related issues / Service complaints. Compensation goes under the first one. '
         || 'Unverified: whether reimbursement of expenses is asked separately inside that category.',
    submission_steps = jsonb_build_object(
      'es', jsonb_build_array(
        'Abre el formulario de reclamación de Wizz Air con el botón de arriba e inicia sesión con tu cuenta WIZZ (créala con tu propio correo si no tienes).',
        'Elige la categoría «Delay, cancellation, denied boarding» (retraso, cancelación, denegación de embarque).',
        'Como correo de contacto, escribe el correo de tu reclamación (airclaims_…), no el personal, para que podamos seguir las respuestas.',
        'Pega el texto de reclamación que hemos preparado y elige el pago en dinero (transferencia), no en crédito WIZZ.',
        'Adjunta la tarjeta de embarque, la reserva y los recibos de tus gastos.',
        'Si el formulario pide por separado la compensación y el reembolso de gastos, envía las dos.',
        'Guarda el número de reclamación (o números) que te dé Wizz y añádelo aquí. Si Wizz te responde a tu correo personal, reenvíalo al correo de tu reclamación.'),
      'en', jsonb_build_array(
        'Open the Wizz Air claim form with the button above and sign in with your WIZZ account (create one with your own email if you don''t have one).',
        'Choose the category "Delay, cancellation, denied boarding".',
        'As contact email, enter your claim address (airclaims_…), not your personal email, so we can track the answers.',
        'Paste the claim text we prepared and choose payment in money (bank transfer), not WIZZ credit.',
        'Attach your boarding pass, booking confirmation and receipts for your expenses.',
        'If the form asks for compensation and reimbursement of expenses separately, submit both.',
        'Keep the claim number (or numbers) Wizz gives you and add it here. If Wizz replies to your personal email, forward it to your claim address.'),
      'ca', jsonb_build_array(
        'Obre el formulari de reclamació de Wizz Air amb el botó de dalt i inicia sessió amb el teu compte WIZZ (crea''l amb el teu correu si no en tens).',
        'Tria la categoria «Delay, cancellation, denied boarding» (retard, cancel·lació, denegació d''embarcament).',
        'Com a correu de contacte, escriu el correu de la teva reclamació (airclaims_…), no el personal, perquè puguem seguir les respostes.',
        'Enganxa el text de reclamació que hem preparat i tria el pagament en diners (transferència), no en crèdit WIZZ.',
        'Adjunta la targeta d''embarcament, la reserva i els rebuts de les teves despeses.',
        'Si el formulari demana per separat la compensació i el reemborsament de despeses, envia totes dues.',
        'Desa el número de reclamació (o números) que et doni Wizz i afegeix-lo aquí. Si Wizz et respon al correu personal, reenvia''l al correu de la teva reclamació.'))
from airlines a
where a.id = c.airline_id and a.iata in ('W6', 'W4', 'W9') and c.channel = 'web_form' and c.purpose = 'compensation';

update airline_knowledge k
set claim_form_notes = 'Form: Help Centre > Claims and compensation > Claim submission. WIZZ account login required. '
    || 'Categories (seen 2026-09-30): Delay, cancellation, denied boarding (compensation) / Booking, reservation, account '
    || '(payments, WIZZ credit) / Bag related issues / Service complaints. Wizz replies to the contact email given in the claim '
    || 'and issues a claim ID. To verify: whether the contact email can differ from the account email, and whether expenses '
    || 'are a separate sub-claim.'
from airlines a
where a.id = k.airline_id and a.iata in ('W6', 'W4', 'W9');

insert into airline_insights (airline_id, topic, summary, source_name, source_url, reliability, observed_on, verified)
select id, 'claim_process',
  'The claim form requires a WIZZ account and asks to choose a category: Delay, cancellation, denied boarding; Booking, reservation, account; Bag related issues; Service complaints. EU261 compensation goes under the first.',
  'Seen by an AirClaims user on the live form', 'https://www.wizzair.com/en-gb/help-centre/my-wizz-account/claims-and-compensation/claim-submission',
  'own_data', '2026-09-30', true
from airlines where iata = 'W6';

-- ---------------------------------------------------------------------
-- Drafting: tell the model when the arrival time is an estimate, and pass
-- the reported local times (replaces the 0012 wrapper, same signature).
-- ---------------------------------------------------------------------
create or replace function email_draft_context(p_claim_id uuid, p_template text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb := email_draft_context_core(p_claim_id, p_template);
  v_notes text;
  c claims;
begin
  if not coalesce((r->>'ok')::boolean, false) then return r; end if;
  select * into c from claims where id = p_claim_id;
  select k.drafting_notes into v_notes from airline_knowledge k where k.airline_id = c.airline_id;
  if nullif(btrim(v_notes), '') is not null then
    r := jsonb_set(r, '{ai,airline_notes}', to_jsonb(left(v_notes, 4000)));
  end if;
  r := jsonb_set(r, '{ai,reported_times}', jsonb_build_object(
         'scheduled_departure_local', c.reported_scheduled_dep_local,
         'actual_departure_local', c.reported_actual_dep_local,
         'scheduled_arrival_local', c.reported_scheduled_arr_local,
         'actual_arrival_local', c.reported_actual_arr_local,
         'arrival_is_estimate', c.arrival_time_estimated));
  return r;
end $$;
