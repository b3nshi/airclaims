// Structured output makes the shape reliable; still check before acting on it.
const res = $json;
const fail = (error) => [{ json: { ok: false, error } }];
if (res.statusCode !== 200) return fail(`anthropic_http_${res.statusCode}`);
const msg = res.body || {};
if (msg.stop_reason === 'refusal') return fail(`refusal:${(msg.stop_details && msg.stop_details.category) || 'unknown'}`);
if (msg.stop_reason !== 'end_turn') return fail(`stop_reason:${msg.stop_reason}`);
let a;
try { a = JSON.parse((msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')); }
catch { return fail('invalid_json'); }
if (!a || typeof a.summary !== 'string' || !a.summary.trim()) return fail('empty_summary');
return [{ json: { ok: true, analysis: a } }];
