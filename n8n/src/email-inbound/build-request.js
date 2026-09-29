// The model sees the claim context and the message; it never sees the passenger's email address.
const cfg = $('Load config').first().json;
const ingest = $('Ingest').first().json;
const email = $('Parse email').first().json.email;
const context = { ...ingest.context };
context.summary_language_name =
  new Intl.DisplayNames(['en'], { type: 'language' }).of(context.summary_language || 'es') || 'Spanish';
const MAX_CHARS = 30000;
const text = email.body_text.length > MAX_CHARS
  ? email.body_text.slice(0, MAX_CHARS) + `\n[message truncated: ${email.body_text.length - MAX_CHARS} more characters not shown]`
  : email.body_text;
const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const request = {
  model: cfg.anthropic_model,
  max_tokens: 4000,
  fallbacks: 'default',
  output_config: {
    effort: cfg.anthropic_effort_classify,
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          classification: { type: 'string', enum: ['airline', 'aesa', 'court', 'spam', 'other'] },
          reply_kind: { type: 'string', enum: ['acknowledgement', 'request_info', 'offer', 'decision', 'rejection', 'other'] },
          summary: { type: 'string' },
          settlement_offer: {
            type: 'object',
            properties: {
              detected: { type: 'boolean' },
              kind: { type: 'string', enum: ['none', 'voucher', 'travel_credit', 'miles', 'money_full', 'money_partial', 'other'] },
              amount: nullable('number'),
              currency: nullable('string'),
              conditions: nullable('string'),
            },
            required: ['detected', 'kind', 'amount', 'currency', 'conditions'],
            additionalProperties: false,
          },
          document_request: {
            type: 'object',
            properties: { detected: { type: 'boolean' }, documents: { type: 'array', items: { type: 'string' } } },
            required: ['detected', 'documents'],
            additionalProperties: false,
          },
          airline_reference: nullable('string'),
          needs_user_action: { type: 'boolean' },
          user_action: nullable('string'),
        },
        required: ['classification', 'reply_kind', 'summary', 'settlement_offer', 'document_request',
                   'airline_reference', 'needs_user_action', 'user_action'],
        additionalProperties: false,
      },
    },
  },
  system: __SYSTEM_PROMPT__,
  messages: [{
    role: 'user',
    content: 'Report on this message:\n\n' + JSON.stringify({
      claim: context,
      email: {
        from: email.from_name ? `${email.from_name} <${email.from_address}>` : email.from_address,
        subject: email.subject,
        date: email.received_at,
        attachments: $('Parse email').first().json.attachments.map((a) => a.filename),
        text,
      },
    }, null, 2),
  }],
};
return [{ json: { request } }];
