// Raw webhook request → the fields verify_webhook_signature checks in Supabase against the
// Vault secret. No secret lives in n8n. The Webhook node must have "Raw Body" enabled.
const headers = $input.first().json.headers || {};
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
return [{
  json: {
    timestamp: String(headers['x-airclaims-timestamp'] || ''),
    signature: String(headers['x-airclaims-signature'] || ''),
    idempotency_key: String(headers['x-airclaims-idempotency-key'] || ''),
    raw,
  },
}];
