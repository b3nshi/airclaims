// Notification emails to the passenger. New UI locales fall back to Spanish until added here.
const T = {
  es: {
    draft: (r) => [`Tu mensaje para ${r} está listo`, `Hola:\n\nHemos preparado un mensaje en tu nombre para ${r}. No se enviará nada hasta que lo leas y lo apruebes:\n\n{link}\n\nAirClaims`],
    sent: (r, s) => [`Tu mensaje se ha enviado a ${r}`, `Hola:\n\nTu mensaje se ha enviado a ${r} desde el correo de tu reclamación.${s ? ' La aerolínea tiene un mes para responder; te reenviaremos su respuesta.' : ''}\n\n{link}\n\nAirClaims`],
  },
  en: {
    draft: (r) => [`Your message to ${r} is ready`, `Hello,\n\nWe've prepared a message in your name to ${r}. Nothing is sent until you read and approve it:\n\n{link}\n\nAirClaims`],
    sent: (r, s) => [`Your message was sent to ${r}`, `Hello,\n\nYour message was sent to ${r} from your claim email address.${s ? " The airline has one month to reply; we'll forward their answer to you." : ''}\n\n{link}\n\nAirClaims`],
  },
  ca: {
    draft: (r) => [`El teu missatge per a ${r} està a punt`, `Hola:\n\nHem preparat un missatge en nom teu per a ${r}. No s'enviarà res fins que el llegeixis i l'aprovis:\n\n{link}\n\nAirClaims`],
    sent: (r, s) => [`El teu missatge s'ha enviat a ${r}`, `Hola:\n\nEl teu missatge s'ha enviat a ${r} des del correu de la teva reclamació.${s ? " L'aerolínia té un mes per respondre; et reenviarem la seva resposta." : ''}\n\n{link}\n\nAirClaims`],
  },
};
const cfg = $('Load config').first().json;
const notification = (meta, kind, ...args) => {
  const locale = T[meta.notify_locale] ? meta.notify_locale : 'es';
  const [subject, text] = T[locale][kind](meta.recipient_label, ...args);
  const link = `${cfg.app_url}/${locale}/claims/${meta.claim_id}`;
  // Forward Email API payload (sent from the no-reply alias).
  return { from: cfg.notify_from, to: meta.notify_email, subject, text: text.replace('{link}', link) };
};
