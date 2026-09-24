// Step of build-basemap.sh: keeps only the properties the style uses and
// writes the place labels.
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const work = process.argv[2];
const ROAD = {
  motorway: ['major', 9], trunk: ['major', 9], primary: ['major', 9],
  secondary: ['secondary', 10], tertiary: ['tertiary', 11],
  residential: ['minor', 12], unclassified: ['minor', 12], living_street: ['minor', 13], pedestrian: ['minor', 13]
};

async function each(name, fn) {
  const out = createWriteStream(`${work}/${name}.out.geojsonl`);
  const rl = createInterface({ input: createReadStream(`${work}/${name}.geojsonl`) });
  let n = 0;
  for await (const line of rl) {
    const f = JSON.parse(line.replace(/^\x1e/, ''));
    const r = fn(f.properties ?? {}, f);
    if (!r) continue;
    // (zoom levels are applied by the -j filter in build-basemap.sh; this
    // tippecanoe build drops features that carry a per-feature minzoom)
    const [props] = r;
    out.write(JSON.stringify({ type: 'Feature', geometry: f.geometry, properties: props }) + '\n');
    n++;
  }
  out.end();
  console.log(`  ${name}: ${n}`);
}

await each('roads', (p) => {
  const base = String(p.highway).replace(/_link$/, '');
  const r = ROAD[base];
  if (!r) return null;
  if (p.area === 'yes') return null;
  return [{ c: r[0], ...(p.tunnel && p.tunnel !== 'no' ? { tunnel: 1 } : {}) }, r[1]];
});
await each('rail', (p) => {
  if (p.tunnel && p.tunnel !== 'no') return null; // the Underground in tunnel is not drawn
  if (p.service) return [{ c: 'siding' }, 13];
  return [{ c: 'main' }, 9];
});
await each('rivers', (p) => [{ c: p.waterway }, p.waterway === 'river' ? 9 : 11]);
await each('water', (p) => {
  const big = p.water === 'river' || p.water === 'tidal' || p.waterway === 'riverbank' || p.waterway === 'dock' || p.water === 'dock';
  return [{ c: big ? 'river' : 'lake' }, big ? 9 : 11];
});
await each('parks', () => [{}, 10]);

// Place labels: a small file loaded directly, not tiled
const places = [];
const rank = { town: 1, suburb: 2, quarter: 3, village: 3, neighbourhood: 4 };
const rl = createInterface({ input: createReadStream(`${work}/places.geojsonl`) });
for await (const line of rl) {
  const f = JSON.parse(line.replace(/^\x1e/, ''));
  const p = f.properties ?? {};
  if (!p.name || !rank[p.place]) continue;
  const [lon, lat] = f.geometry.coordinates;
  places.push({ n: p.name, r: rank[p.place], c: [+lon.toFixed(5), +lat.toFixed(5)] });
}
places.sort((a, b) => a.r - b.r || a.n.localeCompare(b.n));
writeFileSync(new URL('../public/data/places.json', import.meta.url), JSON.stringify(places));
console.log(`  places: ${places.length}`);
