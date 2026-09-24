// The line-drawn base map: self-hosted vector tiles (public/basemap/london.pmtiles,
// built by scripts/build-basemap.sh from OpenStreetMap) and HTML place labels.
// No tile service or API key needed.
import maplibregl, { type LayerSpecification, type Map as MLMap, type StyleSpecification } from 'maplibre-gl';
import { Protocol } from 'pmtiles';

let registered = false;
const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const INK = {
  bg: '#12171b', park: '#161f19', water: '#1a2a34', waterEdge: '#294250', canal: '#274050',
  rail: '#46423b', minor: '#283036', tertiary: '#323b41', secondary: '#3d474d', major: '#525b5e'
};

/** Line widths by zoom: [zoom, width] pairs. */
const w = (...stops: number[]) => ['interpolate', ['exponential', 1.6], ['zoom'], ...stops] as unknown as number;

export function lineStyle(pmtilesUrl: string, historicUrl = ''): StyleSpecification {
  if (!registered) {
    maplibregl.addProtocol('pmtiles', new Protocol().tile);
    registered = true;
  }
  const road = (id: string, c: string, color: string, width: number, minzoom: number): LayerSpecification => ({
    id, type: 'line', source: 'osm', 'source-layer': 'roads', minzoom,
    filter: ['all', ['==', ['get', 'c'], c], ['!', ['has', 'tunnel']]],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': width }
  });
  return {
    version: 8,
    sources: {
      osm: { type: 'vector', url: `pmtiles://${new URL(pmtilesUrl, location.href).href}`, attribution: OSM },
      ...(historicUrl
        ? { historic: { type: 'raster' as const, tileSize: 256, tiles: [historicUrl], attribution: 'Historic map: <a href="https://maps.nls.uk/">National Library of Scotland</a>' } }
        : {})
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': INK.bg } },
      { id: 'parks', type: 'fill', source: 'osm', 'source-layer': 'parks', paint: { 'fill-color': INK.park } },
      { id: 'water', type: 'fill', source: 'osm', 'source-layer': 'water', paint: { 'fill-color': INK.water, 'fill-outline-color': INK.waterEdge } },
      {
        id: 'canals', type: 'line', source: 'osm', 'source-layer': 'rivers', filter: ['==', ['get', 'c'], 'canal'],
        paint: { 'line-color': INK.canal, 'line-width': w(11, 0.6, 16, 3) }
      },
      road('roads-minor', 'minor', INK.minor, w(12, 0.3, 14, 0.8, 17, 3.5), 12),
      road('roads-tertiary', 'tertiary', INK.tertiary, w(11, 0.4, 14, 1.1, 17, 5), 11),
      road('roads-secondary', 'secondary', INK.secondary, w(10, 0.5, 14, 1.4, 17, 6), 10),
      road('roads-major', 'major', INK.major, w(9, 0.6, 12, 1.2, 14, 2, 17, 8), 9),
      {
        id: 'rail', type: 'line', source: 'osm', 'source-layer': 'rail', filter: ['==', ['get', 'c'], 'main'],
        paint: { 'line-color': INK.rail, 'line-width': w(9, 0.5, 14, 1.3, 17, 2.5), 'line-dasharray': [3, 2] }
      },
      ...(historicUrl
        ? [{ id: 'historic', type: 'raster' as const, source: 'historic', layout: { visibility: 'none' as const }, paint: { 'raster-saturation': -0.35, 'raster-brightness-max': 0.62, 'raster-opacity': 0.95 } }]
        : [])
    ]
  };
}

interface Place { n: string; r: number; c: [number, number] }
/** Zoom at which each rank of place (1 town … 4 neighbourhood) is labelled. */
const SHOW_AT = { 1: 9, 2: 10.6, 3: 12.6, 4: 14 } as Record<number, number>;

/**
 * District names as HTML labels (no font server needed). Placed after each
 * move, most important first, skipping any that would overlap.
 */
export async function placeLabels(map: MLMap, url: string) {
  let places: Place[] = [];
  try { places = await (await fetch(url)).json(); } catch { return; }
  const layer = document.createElement('div');
  layer.className = 'places';
  map.getCanvasContainer().appendChild(layer);
  const pool = new Map<string, HTMLDivElement>();

  const place = () => {
    const z = map.getZoom();
    const { width, height } = map.getCanvas().getBoundingClientRect();
    // keep clear of the clock, panel, legend and timeline
    const c = map.getCanvas().getBoundingClientRect();
    const taken: [number, number, number, number][] = ['clock', 'panel', 'legend', 'bar']
      .map((id) => document.getElementById(id)?.getBoundingClientRect())
      .filter((r): r is DOMRect => !!r && r.width > 0)
      .map((r) => [r.left - c.left - 6, r.top - c.top - 6, r.right - c.left + 6, r.bottom - c.top + 6]);
    const used = new Set<string>();
    for (const p of places) {
      if (z < SHOW_AT[p.r]) continue;
      const pt = map.project(p.c);
      if (pt.x < -40 || pt.y < -20 || pt.x > width + 40 || pt.y > height + 20) continue;
      const cw = p.n.length * (p.r <= 2 ? 7.4 : 6.4) + 8, ch = p.r <= 2 ? 16 : 14;
      const box: [number, number, number, number] = [pt.x - cw / 2, pt.y - ch / 2, pt.x + cw / 2, pt.y + ch / 2];
      if (box[0] < 2 || box[2] > width - 2 || box[1] < 2 || box[3] > height - 2) continue;
      if (taken.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
      taken.push(box);
      const key = `${p.n}|${p.c}`;
      used.add(key);
      let el = pool.get(key);
      if (!el) {
        el = document.createElement('div');
        el.className = `place r${p.r}`;
        el.textContent = p.n;
        pool.set(key, el);
      }
      el.style.transform = `translate(${pt.x.toFixed(1)}px,${pt.y.toFixed(1)}px) translate(-50%,-50%)`;
      if (!el.isConnected) layer.appendChild(el);
    }
    for (const [key, el] of pool) if (!used.has(key)) el.remove();
  };
  // Re-place on every frame of a move (cheap: a few hundred labels at most)
  let raf = 0;
  map.on('move', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(place); });
  map.on('moveend', place);
  place();
}
