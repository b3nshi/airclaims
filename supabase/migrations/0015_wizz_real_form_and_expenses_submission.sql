-- =====================================================================
-- 0015 — Wizz's real claim flow (walked through by a passenger, 2026-09-30):
-- compensation and expenses are separate submissions; the compensation form
-- has no free text and no contact-email field; expenses have their own form
-- with a text, typed receipts and bank details.
-- Adds record_expenses_submission (event only). No table structure changes.
-- =====================================================================

-- The passenger submitted the separate expenses claim (e.g. Wizz) and got a reference.
create or replace function record_expenses_submission(p_claim_id uuid, p_reference text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ref text := nullif(btrim(p_reference), '');
begin
  if v_ref is not null and length(v_ref) > 100 then raise exception 'Reference too long'; end if;
  if not exists (select 1 from claims where id = p_claim_id and owner_id = auth.uid()
                 and status in ('ready_to_submit','documents_pending','submitted_airline','airline_replied')) then
    raise exception 'Claim not found or not open';
  end if;
  insert into claim_events (claim_id, event_type, payload, actor)
  values (p_claim_id, 'expenses_submitted', jsonb_build_object('reference', v_ref), 'user');
end $$;

revoke execute on function record_expenses_submission(uuid, text) from public, anon;
grant execute on function record_expenses_submission(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Wizz Air (W6, W4, W9)
-- ---------------------------------------------------------------------
update airline_contacts c
set value = 'https://www.wizzair.com/en-gb/information-and-services/compliments-and-complaints',
    label = 'Wizz Air – Compensation claim',
    verified_at = '2026-09-30',
    notes = 'Form after login. Delay, cancellation, denied boarding > Delayed flight > Compensation I am legally entitled to by EU law. '
         || 'No free-text field and no contact/secondary email: Wizz replies to the account email. Status: https://www.wizzair.com/en-gb/profile/claims',
    submission_steps = jsonb_build_object(
      'es', jsonb_build_array(
        'Abre el formulario con el botón de arriba e inicia sesión con tu cuenta WIZZ.',
        'Elige «Delay, cancellation, denied boarding» y después «Delayed flight» (o la opción que corresponda: cancelado, desviado, embarque denegado).',
        'Elige «Compensation I am legally entitled to by EU law». Los gastos se reclaman aparte (ver más abajo).',
        'Indica que reclamas para ti (o eres uno de los reclamantes) e introduce tu localizador de reserva.',
        'Selecciona el vuelo ORIGINAL (el de la fecha y hora de tu reserva). Si solo ves el reprogramado, despliega «Can''t find the flight? See others below».',
        'Elige tu idioma y envía. Haz capturas de pantalla de cada paso, sobre todo de cualquier mensaje que diga que no te corresponde compensación.',
        'Guarda el número de reclamación y añádelo aquí. Wizz responde al correo de tu cuenta: reenvía sus correos al correo de tu reclamación.'),
      'en', jsonb_build_array(
        'Open the form with the button above and sign in with your WIZZ account.',
        'Choose "Delay, cancellation, denied boarding", then "Delayed flight" (or the option that applies: cancelled, diverted, denied boarding).',
        'Choose "Compensation I am legally entitled to by EU law". Expenses are claimed separately (see below).',
        'Say you are claiming for yourself (or are one of the claimants) and enter your booking reference.',
        'Select the ORIGINAL flight (the date and time on your booking). If you only see the rescheduled one, expand "Can''t find the flight? See others below".',
        'Choose your language and submit. Take screenshots of every step, especially any message saying you are not entitled to compensation.',
        'Keep the claim number and add it here. Wizz replies to your account email: forward its emails to your claim address.'),
      'ca', jsonb_build_array(
        'Obre el formulari amb el botó de dalt i inicia sessió amb el teu compte WIZZ.',
        'Tria «Delay, cancellation, denied boarding» i després «Delayed flight» (o l''opció que correspongui: cancel·lat, desviat, embarcament denegat).',
        'Tria «Compensation I am legally entitled to by EU law». Les despeses es reclamen a part (vegeu més avall).',
        'Indica que reclames per a tu (o ets un dels reclamants) i introdueix el localitzador de la reserva.',
        'Selecciona el vol ORIGINAL (el de la data i hora de la reserva). Si només veus el reprogramat, desplega «Can''t find the flight? See others below».',
        'Tria el teu idioma i envia. Fes captures de pantalla de cada pas, sobretot de qualsevol missatge que digui que no et correspon compensació.',
        'Desa el número de reclamació i afegeix-lo aquí. Wizz respon al correu del teu compte: reenvia els seus correus al correu de la teva reclamació.'))
from airlines a
where a.id = c.airline_id and a.iata in ('W6','W4','W9') and c.channel = 'web_form' and c.purpose = 'compensation';

insert into airline_contacts (airline_id, purpose, channel, label, value, submission_steps, notes, verified_at)
select a.id, 'expenses', 'web_form', 'Wizz Air – Expenses claim',
  'https://www.wizzair.com/en-gb/information-and-services/compliments-and-complaints',
  jsonb_build_object(
    'es', jsonb_build_array(
      'Abre el mismo formulario, inicia sesión y elige «Delay, cancellation, denied boarding» > «Delayed flight» > «Expenses incurred due to my flight».',
      'Pega el texto de gastos que hemos preparado (Wizz exige enviar la compensación y los gastos por separado).',
      'Sube cada recibo con su tipo (Meals And Refreshments, Hotels And Accommodation, Alternate Transport, Local Transport, Telephone Calls), moneda e importe.',
      'Rellena tus datos bancarios (país, moneda, IBAN, BIC, titular, banco) para que te lo paguen en dinero.',
      'Marca la casilla de confirmación, envía y guarda el número de reclamación de gastos para añadirlo aquí.'),
    'en', jsonb_build_array(
      'Open the same form, sign in and choose "Delay, cancellation, denied boarding" > "Delayed flight" > "Expenses incurred due to my flight".',
      'Paste the expenses text we prepared (Wizz requires compensation and expenses to be submitted separately).',
      'Upload each receipt with its type (Meals And Refreshments, Hotels And Accommodation, Alternate Transport, Local Transport, Telephone Calls), currency and amount.',
      'Fill in your bank details (country, currency, IBAN, BIC, account holder, bank) so you are paid in money.',
      'Tick the confirmation box, submit, and keep the expenses claim number to add it here.'),
    'ca', jsonb_build_array(
      'Obre el mateix formulari, inicia sessió i tria «Delay, cancellation, denied boarding» > «Delayed flight» > «Expenses incurred due to my flight».',
      'Enganxa el text de despeses que hem preparat (Wizz exigeix enviar la compensació i les despeses per separat).',
      'Puja cada rebut amb el seu tipus (Meals And Refreshments, Hotels And Accommodation, Alternate Transport, Local Transport, Telephone Calls), moneda i import.',
      'Omple les dades bancàries (país, moneda, IBAN, BIC, titular, banc) perquè te''l paguin en diners.',
      'Marca la casella de confirmació, envia i desa el número de reclamació de despeses per afegir-lo aquí.')),
  'Separate submission from compensation. Free-text field, typed receipts, bank details. Status: https://www.wizzair.com/en-gb/profile/claims',
  '2026-09-30'
from airlines a where a.iata in ('W6','W4','W9')
on conflict (airline_id, purpose, channel, value) do nothing;

update airline_knowledge k
set passenger_tips = jsonb_build_object(
      'es', jsonb_build_array(
        'Wizz exige reclamar la compensación y los gastos por separado: son dos envíos con dos números de reclamación.',
        'Selecciona tu vuelo ORIGINAL. Si Wizz calcula el retraso sobre el vuelo reprogramado, puede decirte que fue mucho menor de lo que fue.',
        'Si el formulario dice que no te corresponde compensación o alega «circunstancias extraordinarias» sin decir cuáles, haz capturas: la aerolínea tiene que decir cuál fue y demostrarlo.',
        'Wizz responde al correo de tu cuenta, no al de tu reclamación: reenvíanos sus correos (o crea un filtro en tu correo que reenvíe los de wizzair.com).',
        'Puedes ver el estado de tus reclamaciones en wizzair.com/en-gb/profile/claims.',
        'Elige siempre el pago en dinero, no crédito WIZZ.'),
      'en', jsonb_build_array(
        'Wizz requires compensation and expenses to be claimed separately: two submissions, two claim numbers.',
        'Select your ORIGINAL flight. If Wizz measures the delay against the rescheduled flight, it may say it was much shorter than it was.',
        'If the form says you are not entitled or cites "extraordinary circumstances" without saying which, take screenshots: the airline has to say what it was and prove it.',
        'Wizz replies to your account email, not your claim address: forward its emails to us (or set a filter that forwards mail from wizzair.com).',
        'You can check your claims'' status at wizzair.com/en-gb/profile/claims.',
        'Always choose payment in money, not WIZZ credit.'),
      'ca', jsonb_build_array(
        'Wizz exigeix reclamar la compensació i les despeses per separat: dos enviaments amb dos números de reclamació.',
        'Selecciona el teu vol ORIGINAL. Si Wizz calcula el retard sobre el vol reprogramat, et pot dir que va ser molt menor del que va ser.',
        'Si el formulari diu que no et correspon compensació o al·lega «circumstàncies extraordinàries» sense dir quines, fes captures: l''aerolínia ha de dir quina va ser i demostrar-ho.',
        'Wizz respon al correu del teu compte, no al de la reclamació: reenvia''ns els seus correus (o crea un filtre que reenviï els de wizzair.com).',
        'Pots veure l''estat de les reclamacions a wizzair.com/en-gb/profile/claims.',
        'Tria sempre el pagament en diners, no crèdit WIZZ.')),
    claim_form_notes = 'Form (after login): https://www.wizzair.com/en-gb/information-and-services/compliments-and-complaints. '
      || 'Categories: Delay, cancellation, denied boarding / Booking, reservation, account / Bag related issues / Service complaints. '
      || 'Delay category options: Delayed flight / Cancelled flight / Flight diversion / Denied boarding; each splits into '
      || '"Compensation I am legally entitled to by EU law" and "Expenses incurred due to my flight" — must be submitted separately. '
      || 'Compensation path: who is claiming > booking reference > select flight (original may be under "Can''t find the flight? See others below") > language. '
      || 'No free text, no contact/secondary email (replies go to the account email). The form may show an automatic eligibility '
      || 'verdict (delay length from its records; "extraordinary circumstance" without details). Expenses path: free text, receipts '
      || 'typed as Meals And Refreshments / Hotels And Accommodation / Alternate Transport / Local Transport / Telephone Calls, '
      || 'with currency and amount, then bank details (country, currency, IBAN, BIC, holder, bank) and a certification box. '
      || 'Status page: https://www.wizzair.com/en-gb/profile/claims'
from airlines a where a.id = k.airline_id and a.iata in ('W6','W4','W9');

insert into airline_insights (airline_id, topic, summary, source_name, source_url, reliability, observed_on, verified)
select a.id, v.topic, v.summary, 'Walked through by an AirClaims user on the live form',
       'https://www.wizzair.com/en-gb/information-and-services/compliments-and-complaints', 'own_data', '2026-09-30', true
from airlines a,
(values
  ('claim_process', 'Compensation and expenses must be submitted separately. The compensation path has no free-text field and no way to add a contact or secondary email; the expenses path has free text, typed receipts and bank details.'),
  ('rejection_pattern', 'For a flight rescheduled to the next day (W4 6020, 19 → 20 Sep 2026), the form showed an arrival delay of 35 minutes measured against the rescheduled flight, and an automatic "not eligible" message.'),
  ('rejection_pattern', 'The form then stated the flight was disrupted by an extraordinary circumstance and no compensation is due, without saying what the circumstance was.'),
  ('claim_process', 'The claim status can be checked at https://www.wizzair.com/en-gb/profile/claims.')
) as v(topic, summary)
where a.iata = 'W6';
