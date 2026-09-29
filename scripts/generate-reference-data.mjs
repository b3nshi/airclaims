#!/usr/bin/env node
// Regenerates supabase/migrations/0004_seed_reference_data.sql.
//   node scripts/generate-reference-data.mjs [path/to/airports.csv]
// Airports: OurAirports (public domain) — https://ourairports.com/data/
// Airlines: curated list below (EU/BCN-relevant carriers); extend by hand.
// Once 0004 is applied, don't regenerate it: put additions in a new migration.
import fs from "node:fs";

const AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const OUT = new URL("../supabase/migrations/0004_seed_reference_data.sql", import.meta.url);

// EU261 applies to EU member states incl. outermost regions (listed separately by
// ISO code in OurAirports), plus Iceland, Norway and Switzerland.
const EU261_COUNTRIES = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT",
  "NL","PL","PT","RO","SK","SI","ES","SE",
  "GP","MQ","GF","RE","YT","MF", // French outermost regions
  "IS","NO","CH",
]);

// [iata, icao, name, AOC country, preferred claim language]
const AIRLINES = [
  ["VY","VLG","Vueling","ES","es"], ["IB","IBE","Iberia","ES","es"], ["I2","IBS","Iberia Express","ES","es"],
  ["UX","AEA","Air Europa","ES","es"], ["YW","ANE","Air Nostrum","ES","es"], ["V7","VOE","Volotea","ES","es"],
  ["NT","IBB","Binter Canarias","ES","es"], ["E9","EVE","Iberojet","ES","es"], ["2W","WFL","World2fly","ES","es"],
  ["PU","PUE","Plus Ultra","ES","es"],
  ["FR","RYR","Ryanair","IE","en"], ["AL","MAY","Malta Air","MT","en"], ["RR","RYS","Buzz","PL","en"],
  ["OE","LDM","Lauda Europe","MT","en"], ["EI","EIN","Aer Lingus","IE","en"],
  ["U2","EZY","easyJet UK","GB","en"], ["EC","EJU","easyJet Europe","AT","en"], ["DS","EZS","easyJet Switzerland","CH","en"],
  ["W9","WUK","Wizz Air UK","GB","en"], ["W4","WMT","Wizz Air Malta","MT","en"],
  ["HV","TRA","Transavia","NL","en"], ["TO","TVF","Transavia France","FR","en"], ["KL","KLM","KLM","NL","en"],
  ["AF","AFR","Air France","FR","en"], ["LH","DLH","Lufthansa","DE","en"], ["EW","EWG","Eurowings","DE","en"],
  ["LX","SWR","Swiss","CH","en"], ["OS","AUA","Austrian Airlines","AT","en"], ["SN","BEL","Brussels Airlines","BE","en"],
  ["WK","EDW","Edelweiss","CH","en"], ["4Y","OCN","Discover Airlines","DE","en"], ["DE","CFG","Condor","DE","en"],
  ["X3","TUI","TUIfly","DE","en"], ["TB","JAF","TUI fly Belgium","BE","en"], ["BY","TOM","TUI Airways","GB","en"],
  ["LS","EXS","Jet2","GB","en"], ["BA","BAW","British Airways","GB","en"],
  ["AZ","ITY","ITA Airways","IT","en"], ["NO","NOS","Neos","IT","en"], ["XZ","AEZ","Aeroitalia","IT","en"],
  ["A3","AEE","Aegean Airlines","GR","en"], ["GQ","SEH","Sky Express","GR","en"], ["TP","TAP","TAP Air Portugal","PT","en"],
  ["SK","SAS","SAS","SE","en"], ["DY","NAX","Norwegian","NO","en"], ["AY","FIN","Finnair","FI","en"],
  ["FI","ICE","Icelandair","IS","en"], ["LO","LOT","LOT Polish Airlines","PL","en"], ["BT","BTI","airBaltic","LV","en"],
  ["OU","CTN","Croatia Airlines","HR","en"], ["QS","TVS","Smartwings","CZ","en"], ["RO","ROT","TAROM","RO","en"],
  ["FB","LZB","Bulgaria Air","BG","en"], ["LG","LGL","Luxair","LU","en"], ["KM","KMM","KM Malta Airlines","MT","en"],
  ["JU","ASL","Air Serbia","RS","en"], ["TK","THY","Turkish Airlines","TR","en"], ["PC","PGT","Pegasus","TR","en"],
  ["AT","RAM","Royal Air Maroc","MA","en"], ["3O","MAC","Air Arabia Maroc","MA","en"], ["AH","DAH","Air Algérie","DZ","en"],
  ["TU","TAR","Tunisair","TN","en"], ["MS","MSR","EgyptAir","EG","en"], ["LY","ELY","El Al","IL","en"],
  ["EK","UAE","Emirates","AE","en"], ["EY","ETD","Etihad Airways","AE","en"], ["QR","QTR","Qatar Airways","QA","en"],
  ["SV","SVA","Saudia","SA","en"], ["ET","ETH","Ethiopian Airlines","ET","en"],
  ["AA","AAL","American Airlines","US","en"], ["DL","DAL","Delta Air Lines","US","en"], ["UA","UAL","United Airlines","US","en"],
  ["AC","ACA","Air Canada","CA","en"], ["TS","TSC","Air Transat","CA","en"],
  ["AV","AVA","Avianca","CO","es"], ["LA","LAN","LATAM Airlines","CL","es"], ["AR","ARG","Aerolíneas Argentinas","AR","es"],
  ["SQ","SIA","Singapore Airlines","SG","en"], ["CX","CPA","Cathay Pacific","HK","en"], ["KE","KAL","Korean Air","KR","en"],
  ["CA","CCA","Air China","CN","en"], ["MU","CES","China Eastern","CN","en"], ["HU","CHH","Hainan Airlines","CN","en"],
];

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const sql = (v) => (v === null || v === undefined || v === "" ? "null" : `'${String(v).replace(/'/g, "''")}'`);

const source = process.argv[2];
const csv = source ? fs.readFileSync(source, "utf8") : await (await fetch(AIRPORTS_URL)).text();

const rank = { large_airport: 0, medium_airport: 1 };
const byIata = new Map();
for (const a of parseCsv(csv)) {
  if (!(a.type in rank) || a.scheduled_service !== "yes" || !/^[A-Z]{3}$/.test(a.iata_code)) continue;
  const prev = byIata.get(a.iata_code);
  if (!prev || rank[a.type] < rank[prev.type]) byIata.set(a.iata_code, a);
}
const seenIcao = new Set();
const airports = [...byIata.values()]
  .sort((a, b) => a.iata_code.localeCompare(b.iata_code))
  .map((a) => {
    let icao = [a.icao_code, a.gps_code].find((c) => /^[A-Z]{4}$/.test(c)) ?? null;
    if (icao && seenIcao.has(icao)) icao = null;
    if (icao) seenIcao.add(icao);
    const scope = EU261_COUNTRIES.has(a.iso_country);
    return `(${[sql(a.iata_code), sql(icao), sql(a.name), sql(a.municipality), sql(a.iso_country),
      Number(a.latitude_deg).toFixed(4), Number(a.longitude_deg).toFixed(4), scope].join(",")})`;
  });

const airlines = AIRLINES.map(([iata, icao, name, cc, lang]) =>
  `(${[sql(iata), sql(icao), sql(name), sql(cc), EU261_COUNTRIES.has(cc), sql(lang)].join(",")})`);

const out = `-- =====================================================================
-- 0004 — reference data (generated by scripts/generate-reference-data.mjs)
-- Airports: OurAirports (public domain), large/medium with scheduled service.
-- Airlines: curated list. Existing rows (BCN, Wizz Air) are left untouched.
-- =====================================================================

insert into airports (iata, icao, name, city, country_code, latitude, longitude, eu261_scope) values
${airports.join(",\n")}
on conflict (iata) do nothing;

insert into airlines (iata, icao, name, country_code, is_eu_carrier, preferred_language) values
${airlines.join(",\n")}
on conflict do nothing;

-- Wizz Air web-form steps in every UI locale (0001 only had English).
update airline_contacts
set submission_steps = submission_steps
  || '{"es":["Abre el formulario de reclamación de Wizz Air (enlace de arriba).","Usa tu alias de AirClaims como correo de contacto.","Pega el texto de reclamación que hemos preparado.","Pide el pago en dinero, no en crédito WIZZ.","Adjunta la tarjeta de embarque, la reserva y los recibos.","Guarda la referencia de la reclamación y añádela aquí."],"ca":["Obre el formulari de reclamació de Wizz Air (enllaç de dalt).","Fes servir el teu àlies d''AirClaims com a correu de contacte.","Enganxa el text de reclamació que hem preparat.","Demana el pagament en diners, no en crèdit WIZZ.","Adjunta la targeta d''embarcament, la reserva i els rebuts.","Desa la referència de la reclamació i afegeix-la aquí."]}'::jsonb
where label = 'Wizz Air – Claims & Compensation';
`;
fs.writeFileSync(OUT, out);
console.log(`airports: ${airports.length} (${airports.filter((r) => r.endsWith(",true)")).length} in EU261 scope), airlines: ${airlines.length}`);
