// Files whose upload succeeded (failed uploads carry an `error` and are left out).
const prepared = $('Prepare attachments').all();
const files = $input.all()
  .map((item, i) => ({ ok: !item.json.error, file: prepared[i] && prepared[i].json }))
  .filter((x) => x.ok && x.file)
  .map((x) => x.file);
return [{ json: { email_id: $('Ingest').first().json.email_id, files } }];
