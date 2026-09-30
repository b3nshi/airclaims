const res = $json;
const fail = (error) => [{ json: { ok: false, error } }];
if (res.statusCode !== 200) return fail(`anthropic_http_${res.statusCode}`);
const msg = res.body || {};
if (msg.stop_reason === 'refusal') return fail(`refusal:${(msg.stop_details && msg.stop_details.category) || 'unknown'}`);
if (msg.stop_reason !== 'end_turn') return fail(`stop_reason:${msg.stop_reason}`);
let a;
try { a = JSON.parse((msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')); }
catch { return fail('invalid_json'); }
if (!a || typeof a.summary !== 'string' || !a.summary.trim() || !Array.isArray(a.options)) return fail('incomplete');
// Never present accepting a voucher/partial offer as an option.
a.options = a.options.filter((o) => o.code !== 'accept_payment' || a.kind === 'payment_confirmed');
return [{ json: { ok: true, analysis: a } }];
