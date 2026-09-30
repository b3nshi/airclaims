const meta = $json;
return [{ json: notification(meta, 'answer', meta.summary || '') }];
