const req = $('Read request').first().json;
if (!$json.valid) return [{ json: { valid: false } }];
let body;
try { body = JSON.parse(req.raw || '{}'); } catch { return [{ json: { valid: false } }]; }
const uuidRe = /^[0-9a-f-]{36}$/i;
if (!uuidRe.test(body.claim_id || '') || !['initial_claim', 'follow_up', 'offer_reply', 'challenge'].includes(body.template)) {
  return [{ json: { valid: false } }];
}
// challenge: a reply to an airline answer the passenger reported, with the options they chose.
if (body.template === 'challenge' && !uuidRe.test(body.response_id || '')) return [{ json: { valid: false } }];
return [{
  json: {
    valid: true,
    claim_id: body.claim_id,
    template: body.template,
    response_id: body.response_id || null,
    options: body.template === 'challenge' && body.options && typeof body.options === 'object' ? body.options : {},
    idempotency_key: req.idempotency_key || `email-draft:${body.template}:${body.claim_id}`,
  },
}];
