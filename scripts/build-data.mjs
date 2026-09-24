// Builds public/data/first-night.geojson from the source files in data-src/.
//
//  data-src/first-night-7sep1940.csv       the incident list (London Fire Brigade
//                                          records for 7 Sept 1940, via the
//                                          Guardian Datablog), as shared by Matt
//  data-src/espinielli-drops.json          geocodes for the same 843 rows, from
//                                          github.com/espinielli/theblitz (2012)
//  data-src/espinielli-addressesNotFound.txt  rows that repo placed by hand
//  data-src/geocode-fixes.json             our own hand fixes (wins over the above)
//
// Run with `npm run data` (also runs before every build).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

const src = (f) => new URL(`../data-src/${f}`, import.meta.url);
const out = (f) => new URL(`../public/data/${f}`, import.meta.url);

// Greater London, roughly. Anything outside is treated as a bad geocode.
export const START = 16 * 60; // the timeline starts at 16:00 on Saturday 7 September

export const BBOX = { w: -0.55, e: 0.34, s: 51.28, n: 51.70 };
const inBox = (lon, lat) => lon > BBOX.w && lon < BBOX.e && lat > BBOX.s && lat < BBOX.n;

const rows = parse(readFileSync(src('first-night-7sep1940.csv'), 'utf8'), {
  bom: true, relax_column_count: true, skip_empty_lines: true
}).slice(1);
const drops = JSON.parse(readFileSync(src('espinielli-drops.json'), 'utf8'));
const fixes = JSON.parse(readFileSync(src('geocode-fixes.json'), 'utf8'));
// time-notes.json keys are entry numbers or ranges ("70-81")
const timeNotes = new Map();
for (const [k, v] of Object.entries(JSON.parse(readFileSync(src('time-notes.json'), 'utf8')))) {
  if (k.startsWith('_')) continue;
  const [a, b = a] = k.split('-').map(Number);
  for (let i = a; i <= b; i++) timeNotes.set(i, v);
}
const ALL_CLEAR = 4 * 60 + 30; // 04:30 on Sunday 8 September
const approxOrders = new Set(
  [...readFileSync(src('espinielli-addressesNotFound.txt'), 'utf8').matchAll(/^(\d+):/gm)].map((m) => +m[1])
);

/** Normalise the free-text bomb type column. */
export function bombType(raw) {
  const s = raw.toUpperCase().replace(/\s+/g, ' ').trim();
  const ib = /\bIB\b|IBIB|INCEND/.test(s);
  const eb = /\bEB\b|EXPLOSIVE/.test(s);
  if (ib && eb) return 'mixed';
  if (eb) return 'eb';
  if (ib) return 'ib';
  if (/COB|CRUDE OIL/.test(s)) return 'cob';
  return 'other';
}

const OUTCODE = /\b(EC|WC|NW|SE|SW|E|N|W)\s?(\d{1,2})[A-Z]?\b/i;
const outcode = (s) => {
  const m = s?.match(OUTCODE);
  return m ? `${m[1].toUpperCase()}${+m[2]}` : null;
};
// A geocode whose first parts name no street or site only found the district
// (e.g. "London, Greater London SE4, UK"): the point is a district centroid.
const STREETISH = /\b(rd|road|st|street|lane|ln|grove|place|pl|ave|avenue|terrace|way|wharf|close|square|sq|hill|walk|row|gardens|gdns|crescent|cres|park|yard|dock|docks|causeway|green|wall|arsenal|dockyard|school|church|buildings|bridge|embankment|pier|estate|vale|rise|market|station|works|highway|parade|mews|court|ct|basin|reach|approach|broadway|drive|passage|quay)\b/i;

const borough = (name = '') => {
  const m = name.match(/(?:London Borough of|Royal Borough of) ([^,]+)|(City of Westminster|City of London)/);
  return m ? (m[1] ?? m[2]).trim() : null;
};

if (rows.length !== drops.length) throw new Error(`row count ${rows.length} != geocodes ${drops.length}`);

const features = [];
const unlocated = [];
const seen = new Map();

rows.forEach((r, i) => {
  const [, order, time, address, typeRaw, damage] = r.map((c) => (c ?? '').trim());
  const id = +order;
  const g = drops[i];
  if (g.order !== id) throw new Error(`row ${i}: order ${id} != geocode ${g.order}`);
  const [hh, mm] = time.split(':').map(Number);
  // The log covers one raid, not one calendar day: it runs from the afternoon
  // attack on Saturday 7 September through the night raid into Sunday 8th.
  // Times before 16:00 are read as the Sunday, so t counts minutes from 16:00
  // on the Saturday.
  const clockMin = hh * 60 + mm;
  const sunday = clockMin < START;
  const props = {
    id, time: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`,
    t: sunday ? clockMin + 1440 - START : clockMin - START,
    day: sunday ? 'Sun 8 Sep' : 'Sat 7 Sep',
    address: address.replace(/, London, UK$/, '').replace(/\s+/g, ' '),
    typeRaw: typeRaw || '—', type: bombType(typeRaw), damage,
    timeNote: timeNotes.get(id) ?? (sunday && clockMin > ALL_CLEAR
      ? 'Logged after the all clear at about 04:30 on Sunday 8 September. It may be a fire or unexploded bomb found later that morning.'
      : undefined),
    borough: null, precision: 'street', check: false
  };

  let lon, lat;
  const fix = fixes[id];
  if (fix) {
    if (fix.unlocated) { unlocated.push({ ...props, precision: 'unlocated', note: fix.note }); return; }
    [lat, lon] = fix.latlon; props.precision = 'manual'; props.note = fix.note;
    props.borough = fix.borough ?? null;
  } else {
    let a = +g.location.lat, b = +g.location.lon;
    if (!inBox(b, a) && inBox(a, b)) [a, b] = [b, a]; // lat/lon stored the wrong way round
    if (!inBox(b, a)) throw new Error(`#${id} (${address}) geocoded outside London and has no fix`);
    lat = a; lon = b;
    props.borough = borough(g.location.display_name);
    if (approxOrders.has(id)) props.precision = 'approx';
    else if (!STREETISH.test(g.location.display_name.split(',').slice(0, 2).join(','))) props.precision = 'district';
    const want = outcode(address), got = outcode(g.location.display_name);
    if (want && got && want !== got) props.check = true; // postal district disagrees: worth a look
    props.geocodedAs = g.location.display_name;
  }

  // Several records often share one geocode (same street, or a whole dock).
  // Spread exact duplicates on a small spiral so each can be clicked.
  const key = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const k = seen.get(key) ?? 0;
  seen.set(key, k + 1);
  if (k > 0) {
    const ang = k * 2.4, rad = 0.00012 * Math.sqrt(k); // ~13 m per step
    lat += rad * Math.sin(ang);
    lon += (rad * Math.cos(ang)) / Math.cos((lat * Math.PI) / 180);
  }
  props.shared = key; // records with the same original point
  features.push({
    type: 'Feature', id,
    geometry: { type: 'Point', coordinates: [+lon.toFixed(6), +lat.toFixed(6)] },
    properties: props
  });
});

// How many records share each original point (shown in the detail panel)
for (const f of features) f.properties.sharedCount = seen.get(f.properties.shared);

const geo = {
  type: 'FeatureCollection',
  meta: {
    title: 'London Fire Brigade incidents, 7 September 1940',
    records: rows.length, mapped: features.length, unlocated,
    built: new Date().toISOString().slice(0, 10)
  },
  features
};
mkdirSync(out(''), { recursive: true });
writeFileSync(out('first-night.geojson'), JSON.stringify(geo));

const byType = features.reduce((a, f) => ((a[f.properties.type] = (a[f.properties.type] ?? 0) + 1), a), {});
const count = (p) => features.filter((f) => f.properties.precision === p).length;
console.log(`first-night: ${features.length}/${rows.length} mapped, ${unlocated.length} unlocated`);
console.log('  types', byType);
console.log(`  precision: street ${count('street')}, district ${count('district')}, approx ${count('approx')}, manual ${count('manual')}; postal district mismatches ${features.filter((f) => f.properties.check).length}`);

// A to-do list for hand-checking: everything not placed on its street
const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
const review = features
  .filter((f) => f.properties.precision !== 'street' || f.properties.check)
  .map((f) => {
    const p = f.properties;
    const reason = p.precision !== 'street' ? p.precision : 'postal district differs';
    return [p.id, p.time, p.address, reason, p.geocodedAs ?? p.note, ...f.geometry.coordinates.slice().reverse()].map(esc).join(',');
  });
review.unshift('id,time,address_as_recorded,reason,geocoded_as,lat,lon');
unlocated.forEach((p) => review.push([p.id, p.time, p.address, 'unlocated', p.note, '', ''].map(esc).join(',')));
writeFileSync(src('needs-review.csv'), review.join('\n') + '\n');
console.log(`  wrote data-src/needs-review.csv (${review.length - 1} rows)`);
