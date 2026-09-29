// Only the claim data (`ai`) goes to the model; `meta` (notification address etc.) stays here.
const cfg = $('Load config').first().json;
const parsed = $('Parse request').first().json;
const ai = { ...$json.ai };
ai.language_name = new Intl.DisplayNames(['en'], { type: 'language' }).of(ai.language || 'en') || 'English';
const request = {
  model: cfg.anthropic_model,
  max_tokens: 16000,
  fallbacks: 'default',
  output_config: {
    effort: cfg.anthropic_effort,
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: { subject: { type: 'string' }, body: { type: 'string' } },
        required: ['subject', 'body'],
        additionalProperties: false,
      },
    },
  },
  system: __SYSTEM_PROMPT__,
  messages: [{ role: 'user', content: 'Draft the email for this claim:\n\n' + JSON.stringify(ai, null, 2) }],
};
return [{ json: { request, meta: $json.meta, ai, template: parsed.template, idempotency_key: parsed.idempotency_key } }];
