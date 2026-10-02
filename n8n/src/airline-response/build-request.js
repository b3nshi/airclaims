// The model sees the claim facts, the airline's answer and the passenger's explanation.
const cfg = $('Load config').first().json;
const ai = { ...$json.ai };
ai.summary_language_name =
  new Intl.DisplayNames(['en'], { type: 'language' }).of(ai.summary_language || 'es') || 'Spanish';
const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });
const request = {
  model: cfg.anthropic_model,
  max_tokens: 8000,
  fallbacks: 'default',
  output_config: {
    effort: cfg.anthropic_effort,
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          concerns: { type: 'string', enum: ['compensation', 'expenses', 'both', 'unclear'] },
          kind: { type: 'string', enum: ['auto_rejection', 'rejection', 'offer', 'request_info', 'acknowledgement', 'payment_confirmed', 'other'] },
          airline_position: { type: 'string' },
          reasons: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['delay_too_short', 'extraordinary_unspecified', 'extraordinary_named', 'notice_over_14_days',
                                               'alternative_flight_offered', 'not_on_flight', 'missing_documents', 'time_limit', 'other'] },
                detail: { type: 'string' },
              },
              required: ['code', 'detail'],
              additionalProperties: false,
            },
          },
          airline_measured_delay_minutes: nullable('number'),
          conflicts: { type: 'array', items: { type: 'string' } },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                code: { type: 'string', enum: ['request_evidence', 'contest_delay_calculation', 'contest_notice', 'decline_offer',
                                               'send_documents', 'accept_payment', 'wait', 'go_to_aesa'] },
                recommended: { type: 'boolean' },
                explanation: { type: 'string' },
              },
              required: ['code', 'recommended', 'explanation'],
              additionalProperties: false,
            },
          },
          aesa_advice: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['concerns', 'kind', 'airline_position', 'reasons', 'airline_measured_delay_minutes', 'conflicts', 'options', 'aesa_advice', 'summary'],
        additionalProperties: false,
      },
    },
  },
  system: __SYSTEM_PROMPT__,
  messages: [{ role: 'user', content: 'Analyse this airline answer:\n\n' + JSON.stringify(ai, null, 2) }],
};
return [{ json: { request } }];
