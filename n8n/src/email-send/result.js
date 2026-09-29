// Any non-2xx is a failure. It is never retried automatically: it may have gone out.
const built = $('Build message').item.json;
const code = $json.statusCode;
if (code >= 200 && code < 300) {
  return { json: { email_id: built.email_id, ok: true, message_id: ($json.body && $json.body.messageId) || built.message_id } };
}
const detail = String(($json.body && ($json.body.message || $json.body.error)) || '').slice(0, 300);
return { json: { email_id: built.email_id, ok: false, error: `forwardemail_http_${code}: ${detail}` } };
