// One item per accepted attachment, as binary for the Storage upload.
// Matched claims: {owner}/{claim}/…  (their private folder); unmatched: _inbound/{email}/…
const ingest = $('Ingest').first().json;
const raw = ($('Webhook').first().json.body || {}).attachments || [];
const folder = ingest.claim_id ? `${ingest.owner_id}/${ingest.claim_id}` : `_inbound/${ingest.email_id}`;
const EXT = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' };
const out = [];
for (const a of $('Parse email').first().json.attachments) {
  const data = raw[a.index] && raw[a.index].content && raw[a.index].content.data;
  if (!data) continue;
  const path = `${folder}/${ingest.email_id}-${a.index + 1}.${EXT[a.mime]}`;
  const binary = await this.helpers.prepareBinaryData(Buffer.from(data), a.filename, a.mime);
  out.push({ json: { storage_path: path, filename: a.filename, mime: a.mime, size: a.size }, binary: { data: binary } });
}
return out;
