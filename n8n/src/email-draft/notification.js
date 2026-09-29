const meta = $('Check draft').first().json.meta;
return [{ json: notification(meta, 'draft') }];
