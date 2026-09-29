// Forward Email API payload for one approved email. Attachments are downloaded through
// short-lived signed URLs, so the Storage service key stays in the n8n credential.
const cfg = $('Load config').first().json;
const e = $('Has email?').item.json;
const signed = Array.isArray($json.body) ? $json.body : [];
const messageId = `<${e.id}@airclaims.klivr.com>`; // unique per email; stored for threading
try {
  const attachments = [];
  for (const a of e.attachments || []) {
    const s = signed.find((x) => x.path === a.storage_path && x.signedURL);
    if (!s) throw new Error(`no signed URL for ${a.filename}`);
    const data = await this.helpers.httpRequest({ url: `${cfg.supabase_url}/storage/v1${s.signedURL}`, encoding: 'arraybuffer' });
    attachments.push({ filename: a.filename, content: Buffer.from(data).toString('base64'), encoding: 'base64', contentType: a.mime || undefined });
  }
  const name = String(e.sender_name || '').replace(/["<>\r\n]/g, '').trim();
  const payload = {
    from: name ? `"${name}" <${e.from_address}>` : e.from_address,
    to: e.to_addresses,
    replyTo: e.from_address,
    subject: e.subject,
    text: e.body_text,
    messageId,
    attachments,
  };
  if (e.cc_addresses && e.cc_addresses.length) payload.cc = e.cc_addresses;
  if (e.in_reply_to) Object.assign(payload, { inReplyTo: e.in_reply_to, references: e.in_reply_to });
  return { json: { email_id: e.id, ready: true, message_id: messageId, payload } };
} catch (err) {
  return { json: { email_id: e.id, ready: false, error: `attachments: ${String(err && err.message || err).slice(0, 300)}` } };
}
