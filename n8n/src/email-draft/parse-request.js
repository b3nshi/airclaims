const req = $('Read request').first().json;
if (!$json.valid) return [{ json: { valid: false } }];
let body;
try { body = JSON.parse(req.raw || '{}'); } catch { return [{ json: { valid: false } }]; }
if (!/^[0-9a-f-]{36}$/i.test(body.claim_id || '') || !['initial_claim', 'follow_up', 'offer_reply'].includes(body.template)) {
  return [{ json: { valid: false } }];
}
return [{
  json: {
    valid: true,
    claim_id: body.claim_id,
    template: body.template,
    idempotency_key: req.idempotency_key || `email-draft:${body.template}:${body.claim_id}`,
  },
}];
