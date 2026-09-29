// Guardrails on the model's output. A rejected draft is never stored; the run is logged.
const prep = $('Build request').first().json;
const res = $json;
const fail = (error) => [{ json: { ok: false, error, claim_id: prep.meta.claim_id, template: prep.template, idempotency_key: prep.idempotency_key } }];

if (res.statusCode !== 200) return fail(`anthropic_http_${res.statusCode}`);
const msg = res.body || {};
if (msg.stop_reason === 'refusal') return fail(`refusal:${msg.stop_details?.category ?? 'unknown'}`);
if (msg.stop_reason !== 'end_turn') return fail(`stop_reason:${msg.stop_reason}`);
const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
let draft;
try { draft = JSON.parse(text); } catch { return fail('invalid_json'); }

const subject = String(draft.subject || '').trim();
const body = String(draft.body || '').trim();
const ai = prep.ai;
const problems = [];
if (subject.length < 5 || subject.length > 200) problems.push('subject_length');
if (body.length < 200 || body.length > 20000) problems.push('body_length');
if (!body.includes(ai.reply_to)) problems.push('missing_reply_to');
if (ai.lead_passenger && !body.includes(ai.lead_passenger)) problems.push('missing_signature');
// The alias domain (airclaims.klivr.com) is expected; any other mention of the service is not.
const prose = (subject + ' ' + body).split(ai.reply_to).join(' ');
if (/\b(law ?firm|lawyers?|attorneys?|solicitors?|abogad[oa]s?|bufete|despacho de abogados|advocats?|AirClaims)\b/i.test(prose)) {
  problems.push('forbidden_wording');
}
const total = ai.compensation_total_eur;
if (total && !body.replace(/[.\s]/g, '').includes(String(Math.round(total)))) problems.push('missing_amount');
if (problems.length) return fail(problems.join(','));

return [{ json: { ok: true, subject, body, claim_id: prep.meta.claim_id, template: prep.template, meta: prep.meta, idempotency_key: prep.idempotency_key } }];
