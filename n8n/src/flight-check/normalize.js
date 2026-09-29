// One AeroDataBox response → complete (found / not found) or fail (no data received).
// actual_arr is the API's revised/runway time; the legal reference (doors open) is
// confirmed by the passenger in the wizard.
const check = $('Has check?').item.json;
const res = $json;
const code = res.statusCode;
const list = Array.isArray(res.body) ? res.body : [];

if (code === 200 && list.length) {
  const f = list.find((x) => (x.departure?.scheduledTime?.local || '').startsWith(check.flight_date)) || list[0];
  const iso = (t) => (t?.utc ? new Date(t.utc.replace(' ', 'T')).toISOString() : null);
  const arrived = /arrived/i.test(f.status || '');
  return {
    json: {
      check_id: check.id,
      outcome: 'found',
      flight: {
        dep_iata: f.departure?.airport?.iata || null,
        arr_iata: f.arrival?.airport?.iata || null,
        airline_iata: f.airline?.iata || null,
        scheduled_dep: iso(f.departure?.scheduledTime),
        actual_dep: iso(f.departure?.runwayTime || f.departure?.revisedTime),
        scheduled_arr: iso(f.arrival?.scheduledTime),
        actual_arr: arrived ? iso(f.arrival?.revisedTime || f.arrival?.runwayTime) : null,
        status: f.status || null,
        distance_km: f.greatCircleDistance?.km ? Math.round(f.greatCircleDistance.km) : null,
      },
      raw: f,
    },
  };
}
if (code === 204 || code === 404 || (code === 200 && !list.length)) {
  return { json: { check_id: check.id, outcome: 'not_found' } };
}
return { json: { check_id: check.id, outcome: 'error', error: `HTTP ${code}` } };
