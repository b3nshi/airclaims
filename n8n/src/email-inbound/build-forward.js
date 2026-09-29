// Forward to the passenger's personal email with our reading of it (if any) and the original
// message. Offers are explained, never accepted. Replies go to support@, not to the airline.
const cfg = $('Load config').first().json;
const ingest = $('Ingest').first().json;
const meta = ingest.meta;
const email = $('Parse email').first().json.email;
const checked = $('Check analysis').isExecuted ? $('Check analysis').first().json : { ok: false };
const a = checked.ok ? checked.analysis : null;

const T = {
  es: {
    intro: (f, fl) => `Has recibido un mensaje de ${f} sobre tu reclamación del vuelo ${fl}.`,
    summary: 'Resumen', original: 'Mensaje original',
    offer: {
      money_full: (x) => `La aerolínea indica que te pagará ${x}. Comprueba que el pago te llega en dinero y por el importe completo.`,
      other: (x) => `Incluye una oferta${x ? ` (${x})` : ''}. No tienes que aceptarla: según el EU261 puedes pedir la compensación en dinero. Nunca aceptamos nada en tu nombre.`,
    },
    docs: (d) => `Piden: ${d}. Súbelo en tu panel.`,
    action: 'Qué hacer', dashboard: 'Tu reclamación',
    noreply: 'No respondas a este correo para contestar a la aerolínea: usa tu panel. Si respondes, llegará a nuestro equipo de soporte.',
    kinds: { voucher: 'bono', travel_credit: 'crédito de viaje', miles: 'millas', money_partial: 'dinero, menos de lo reclamado', other: 'otra', money_full: 'dinero' },
  },
  en: {
    intro: (f, fl) => `You received a message from ${f} about your claim for flight ${fl}.`,
    summary: 'Summary', original: 'Original message',
    offer: {
      money_full: (x) => `The airline says it will pay you ${x}. Check that the payment reaches you in money and for the full amount.`,
      other: (x) => `It includes an offer${x ? ` (${x})` : ''}. You don't have to accept it: under EU261 you can ask to be paid in money. We never accept anything on your behalf.`,
    },
    docs: (d) => `They ask for: ${d}. Upload it in your dashboard.`,
    action: 'What to do', dashboard: 'Your claim',
    noreply: "Don't reply to this email to answer the airline: use your dashboard. Replies reach our support team.",
    kinds: { voucher: 'voucher', travel_credit: 'travel credit', miles: 'miles', money_partial: 'money, less than claimed', other: 'other', money_full: 'money' },
  },
  ca: {
    intro: (f, fl) => `Has rebut un missatge de ${f} sobre la teva reclamació del vol ${fl}.`,
    summary: 'Resum', original: 'Missatge original',
    offer: {
      money_full: (x) => `L'aerolínia indica que et pagarà ${x}. Comprova que el pagament t'arriba en diners i per l'import complet.`,
      other: (x) => `Inclou una oferta${x ? ` (${x})` : ''}. No l'has d'acceptar: segons l'EU261 pots demanar la compensació en diners. Mai no acceptem res en nom teu.`,
    },
    docs: (d) => `Demanen: ${d}. Puja-ho al teu tauler.`,
    action: 'Què cal fer', dashboard: 'La teva reclamació',
    noreply: "No responguis aquest correu per contestar l'aerolínia: fes servir el teu tauler. Si respons, arribarà al nostre equip de suport.",
    kinds: { voucher: 'val', travel_credit: 'crèdit de viatge', miles: 'milles', money_partial: 'diners, menys del reclamat', other: 'altra', money_full: 'diners' },
  },
};
const locale = T[meta.notify_locale] ? meta.notify_locale : 'es';
const t = T[locale];
const link = `${cfg.app_url}/${locale}/claims/${meta.claim_id}`;
const sender = email.from_name || email.from_address;

const lines = [t.intro(sender, ingest.context.flight)];
if (a) {
  lines.push('', `${t.summary}: ${a.summary}`);
  const o = a.settlement_offer || {};
  if (o.detected) {
    const amount = o.amount != null ? `${o.amount} ${o.currency || ''}`.trim() : '';
    const desc = [t.kinds[o.kind] || '', amount, o.conditions || ''].filter(Boolean).join(', ');
    lines.push('', o.kind === 'money_full' ? t.offer.money_full(amount || t.kinds.money_full) : t.offer.other(desc));
  }
  if (a.document_request && a.document_request.detected && a.document_request.documents.length) {
    lines.push('', t.docs(a.document_request.documents.join(', ')));
  }
  if (a.needs_user_action && a.user_action) lines.push('', `${t.action}: ${a.user_action}`);
}
lines.push('', `${t.dashboard}: ${link}`, '', t.noreply, '', `---- ${t.original} ----`,
  `From: ${email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address}`,
  `Date: ${email.received_at}`, `Subject: ${email.subject}`, '', email.body_text);

const raw = ($('Webhook').first().json.body || {}).attachments || [];
const attachments = $('Parse email').first().json.attachments
  .filter((x) => raw[x.index] && raw[x.index].content && raw[x.index].content.data)
  .map((x) => ({ filename: x.filename, content: Buffer.from(raw[x.index].content.data).toString('base64'), encoding: 'base64', contentType: x.mime }));

return [{
  json: {
    email_id: ingest.email_id,
    payload: {
      from: cfg.notify_from,
      to: meta.notify_email,
      replyTo: cfg.support_email,
      subject: `[AirClaims] ${email.subject || ingest.context.flight}`.slice(0, 250),
      text: lines.join('\n'),
      attachments,
    },
  },
}];
