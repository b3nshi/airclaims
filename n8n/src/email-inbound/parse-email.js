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
const text = (body.text && String(body.text).trim()) || htmlToText(body.html);
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
    },
    attachments,
  },
}];
