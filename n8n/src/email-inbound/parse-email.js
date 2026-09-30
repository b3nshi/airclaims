// Forward Email posts mailparser's JSON (https://forwardemail.net/faq#do-you-support-webhooks):
// addresses as {value:[{address,name}]}, attachments with content {type:'Buffer', data:[bytes]}.
const body = $('Webhook').first().json.body || {};
const addresses = (field) =>
  [].concat(field || []).flatMap((f) => (f && f.value) || []).map((v) => String(v.address || '').toLowerCase()).filter(Boolean);

// Plain text for storage and for the model; HTML is kept as-is but never rendered.
const htmlToText = (html) => String(html || '')
  .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
const MAX_BYTES = 10 * 1024 * 1024;
const attachments = (body.attachments || [])
  .map((a, index) => ({ index, filename: String(a.filename || `attachment-${index + 1}`).slice(0, 120),
                        mime: String(a.contentType || '').toLowerCase(), size: a.size || 0 }))
  .filter((a) => ALLOWED.includes(a.mime) && a.size <= MAX_BYTES)
  .slice(0, 10);

const from = ((body.from && body.from.value) || [])[0] || {};
let text = (body.text && String(body.text).trim()) || htmlToText(body.html);

// "Forward as attachment": the original email arrives as a message/rfc822 attachment.
const attachedEmails = (body.attachments || []).filter((a) => /message\/rfc822/i.test(a.contentType || '') && a.content && a.content.data);
for (const a of attachedEmails.slice(0, 3)) {
  text += '\n\n--- Attached message ---\n' + Buffer.from(a.content.data).toString('utf8').slice(0, 50000);
}

// Forwarded by the passenger? (Gmail, Outlook, Apple Mail, in several languages.) SQL only trusts it
// when the sender is the passenger and their mail authenticated.
const subject = String(body.subject || '');
const forwardHint = /^\s*(fwd?|rv|tr|wg|enc|i|doorst)\s*:/i.test(subject)
  || /(-{3,}\s*(forwarded message|mensaje reenviado|missatge reenviat|message transféré|weitergeleitete nachricht)|begin forwarded message|^\s*(from|de|von)\s*:.*\n\s*(sent|date|enviado|fecha|enviat|data|gesendet)\s*:)/im.test(text)
  || attachedEmails.length > 0;

// Forward Email passes mailauth's results (dmarc / spf / dkim).
const result = (x) => String((x && ((x.status && x.status.result) || x.result)) || '').toLowerCase();
const dkimPass = ((body.dkim && body.dkim.results) || []).some((r) => result(r) === 'pass');
const authPass = result(body.dmarc) === 'pass' || (result(body.spf) === 'pass' && dkimPass) || result(body.spf) === 'pass';

// A mail provider asking to confirm a forwarding address (the passenger needs the code/link).
const fromAddress = String(from.address || '').toLowerCase();
const verificationHint = /forwarding-noreply@google\.com$/.test(fromAddress)
  || /(forwarding confirmation|confirmación de reenvío|confirmació de reenviament|confirm.*forward)/i.test(subject);
return [{
  json: {
    email: {
      message_id: body.messageId || null,
      from_address: String(from.address || '').toLowerCase(),
      from_name: from.name || null,
      to_addresses: addresses(body.to),
      cc_addresses: addresses(body.cc),
      recipients: [].concat(body.recipients || [], (body.session && body.session.recipient) || []).map((r) => String(r).toLowerCase()),
      subject: body.subject || '',
      body_text: text,
      body_html: typeof body.html === 'string' ? body.html : null,
      in_reply_to: body.inReplyTo || null,
      received_at: body.date || new Date().toISOString(),
      forward_hint: forwardHint,
      auth_pass: authPass,
      verification_hint: verificationHint,
    },
    attachments,
  },
}];
