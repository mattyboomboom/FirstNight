// First Night: the map in the browser. Loads the incident log, draws it with
// MapLibre, and plays it back along a 24-hour timeline.
import maplibregl, { type GeoJSONSource, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type * as GeoJSON from 'geojson';
import { lineStyle, placeLabels } from './basemap';
import { setupBlasts } from './blasts';
import { BEFORE, SOURCES, SPAN, RAID, TYPES, bins, busiest, clock, dayOf, phase, tally, typeInfo, type BombType, type Incident, type Moment } from './data';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const mapEl = $('map');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- base map
// Self-hosted line drawing of London; optional 1940s raster layer if configured
const historicUrl = mapEl.dataset.historic?.trim() ?? '';
const style = lineStyle(mapEl.dataset.basemap!, historicUrl);

const map = new maplibregl.Map({
  container: mapEl,
  style,
  center: [-0.045, 51.495],
  zoom: innerWidth < 700 ? 10.4 : 11.3,
  minZoom: 9, maxZoom: 17.5,
  maxBounds: [[-0.75, 51.25], [0.55, 51.75]],
  attributionControl: { compact: true },
  dragRotate: false, pitchWithRotate: false
});
map.touchZoomRotate.disableRotation();
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

// ---------------------------------------------------------------- state
let T = 0; // timeline minute on show (0 = 16:00 Saturday)
let lastT = T; // for firing blasts as time moves forward
let blast: ReturnType<typeof setupBlasts> | null = null;
let playing = false;
let speed = 12; // map minutes per second
let selected: number | null = null;
const shown = new Set<BombType>(TYPES.map((t) => t.key));
let incidents: Incident[] = [];
let records = 0;

const colorExpr = ['match', ['get', 'type'], ...TYPES.flatMap((t) => [t.key, t.color]), '#999'] as unknown as maplibregl.ExpressionSpecification;

function filters() {
  const types = ['in', ['get', 'type'], ['literal', [...shown]]];
  return {
    dots: ['all', types, ['<=', ['get', 't'], T]],
    flash: ['all', types, ['<=', ['get', 't'], T], ['>', ['get', 't'], T - 25]]
  } as unknown as Record<string, maplibregl.FilterSpecification>;
}

function render() {
  if (!map.getLayer('dots')) return;
  const f = filters();
  map.setFilter('dots', f.dots);
  map.setFilter('dots-ring', ['all', f.dots, ['==', ['get', 'precision'], 'district']] as maplibregl.FilterSpecification);
  map.setFilter('flash', f.flash);
  // older incidents dim; the last 25 minutes glow
  const age = ['-', T, ['get', 't']];
  map.setPaintProperty('dots', 'circle-opacity', ['case', ['==', ['get', 'precision'], 'district'], 0,
    ['interpolate', ['linear'], age, 0, 1, 30, 0.9, 180, 0.62]] as unknown as maplibregl.ExpressionSpecification);
  map.setPaintProperty('flash', 'circle-opacity', ['interpolate', ['linear'], age, 0, 0.55, 25, 0]);
  map.setPaintProperty('flash', 'circle-radius', ['interpolate', ['linear'], ['zoom'], 10, ['interpolate', ['linear'], age, 0, 16, 25, 5], 15, ['interpolate', ['linear'], age, 0, 40, 25, 12]] as unknown as maplibregl.ExpressionSpecification);
  fireBlasts();
  updateClock();
  updateHead();
}

// A flash and blast for every hit the clock passes, while playing or when
// dragging forward a short way (not when jumping)
function fireBlasts() {
  if (blast && !reduceMotion && T > lastT && (playing || T - lastT <= 30)) {
    for (const i of incidents) {
      if (i.t > lastT && i.t <= T && shown.has(i.type)) {
        const f = feats.get(i.id);
        if (f) blast(f.geometry.coordinates as [number, number], i.type);
      }
    }
  }
  lastT = T;
}

// ---------------------------------------------------------------- the story so far
// The stage of the raid is the headline; the time sits under it. The panel
// tells the stage's story when no incident is open.
let shownPhase: Moment | null = null;
const SRC_NAME: Record<string, string> = { lm: 'London Museum', bob: 'Battle of Britain Historical Timeline' };
function showPhase(ph: Moment) {
  if (ph === shownPhase) return;
  shownPhase = ph;
  const title = $('c-title');
  title.textContent = ph.label;
  title.classList.remove('swap'); void title.offsetWidth; title.classList.add('swap');
  $('pp-when').textContent = ph === BEFORE ? 'Saturday 7 September 1940, afternoon' : `${clock(ph.t)} · ${dayOf(ph.t)}`;
  $('pp-detail').textContent = ph.detail;
  const src = ph.src ? SOURCES[ph.src as keyof typeof SOURCES] : null;
  $('pp-src').innerHTML = src ? `Source: <a href="${src.url}">${SRC_NAME[ph.src!]}</a>` : '';
}

// ---------------------------------------------------------------- clock
function updateClock() {
  const s = tally(incidents.filter((i) => shown.has(i.type)), T);
  $('c-time').textContent = clock(T);
  $('c-day').textContent = dayOf(T);
  showPhase(phase(T) ?? BEFORE);
  $('c-count').innerHTML = `<b>${s.total}</b> incident${s.total === 1 ? '' : 's'} logged`;
  $('c-types').innerHTML = TYPES.filter((t) => s[t.key] > 0 && shown.has(t.key))
    .map((t) => `<span><i style="background:${t.color}"></i>${s[t.key]} ${t.short.toLowerCase()}</span>`).join('');
}

// ---------------------------------------------------------------- timeline
const track = $('track');
function updateHead() {
  $('head').style.left = `${(T / SPAN) * 100}%`;
  track.setAttribute('aria-valuenow', String(Math.round(T)));
  track.setAttribute('aria-valuetext', clock(T));
}

function drawHistogram() {
  const svg = $('hist') as unknown as SVGSVGElement;
  const b = bins(incidents);
  const max = Math.max(...b.map((x) => x.ib + x.eb + x.mixed + x.cob + x.other));
  svg.setAttribute('viewBox', `0 0 ${b.length} 100`);
  let html = '';
  b.forEach((x, i) => {
    let y = 100;
    for (const t of TYPES) {
      const h = (x[t.key] / max) * 92;
      if (!h) continue;
      y -= h;
      html += `<rect x="${i + 0.1}" y="${y.toFixed(2)}" width=".8" height="${h.toFixed(2)}" fill="${t.color}"/>`;
    }
  });
  svg.innerHTML = html;
  // hour ticks every two hours from 16:00 Saturday; midnight marked as Sunday
  $('ticks').innerHTML = Array.from({ length: SPAN / 120 + 1 }, (_, k) => k * 120).map((t, k) => {
    const lab = clock(t) === '00:00' ? 'Sun 00:00' : clock(t);
    return `<span class="${k % 2 ? 'minor' : ''}${t === SPAN ? ' end' : ''}" style="left:${(t / SPAN) * 100}%">${lab}</span>`;
  }).join('');
  const marks: (Moment & { busy?: boolean })[] = [...RAID, { ...busiest(incidents), busy: true }];
  $('moments').innerHTML = marks.map((m) =>
    `<button class="moment${m.busy ? ' busy' : ''}" style="left:${(m.t / SPAN) * 100}%" data-t="${m.t}" title="${clock(m.t)} ${m.label}: ${m.detail}" aria-label="${clock(m.t)} ${m.label}"></button>`).join('');
  $('moments').querySelectorAll<HTMLButtonElement>('.moment').forEach((b) =>
    b.addEventListener('click', (e) => { e.stopPropagation(); pause(); T = +b.dataset.t!; render(); }));
}

function scrubTo(clientX: number) {
  const r = track.getBoundingClientRect();
  T = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * SPAN);
  render();
}
track.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.moment')) return;
  pause();
  track.setPointerCapture(e.pointerId);
  scrubTo(e.clientX);
  const move = (ev: PointerEvent) => scrubTo(ev.clientX);
  const up = () => { track.removeEventListener('pointermove', move); track.removeEventListener('pointerup', up); };
  track.addEventListener('pointermove', move);
  track.addEventListener('pointerup', up);
});
track.addEventListener('keydown', (e) => {
  const step = e.shiftKey ? 60 : 10;
  if (e.key === 'ArrowRight') T = Math.min(SPAN, T + step);
  else if (e.key === 'ArrowLeft') T = Math.max(0, T - step);
  else if (e.key === 'Home') T = 0;
  else if (e.key === 'End') T = SPAN;
  else return;
  e.preventDefault(); pause(); render();
});

// ---------------------------------------------------------------- playback
const playBtn = $<HTMLButtonElement>('play');
let last = 0;
function frame(now: number) {
  if (!playing) return;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // Hurry through quiet stretches (nothing in the next 20 minutes)
  const quiet = !incidents.some((i) => shown.has(i.type) && i.t > T && i.t <= T + 20);
  T += dt * speed * (quiet ? 6 : 1);
  if (T >= SPAN) { T = SPAN; pause(); }
  render();
  requestAnimationFrame(frame);
}
function play() {
  if (T >= SPAN) T = 0;
  lastT = T;
  playing = true;
  playBtn.textContent = '❚❚'; playBtn.setAttribute('aria-label', 'Pause'); playBtn.classList.add('on');
  document.body.classList.add('playing');
  last = performance.now();
  requestAnimationFrame(frame);
}
function pause() {
  playing = false;
  playBtn.textContent = '▶'; playBtn.setAttribute('aria-label', 'Play'); playBtn.classList.remove('on');
  document.body.classList.remove('playing');
}
playBtn.addEventListener('click', () => (playing ? pause() : play()));

// ---------------------------------------------------------------- title card
function leaveCover() { document.body.classList.remove('at-cover'); }
$('cv-start').addEventListener('click', () => { leaveCover(); T = 0; lastT = 0; render(); setTimeout(play, 500); });
$('cv-all').addEventListener('click', () => { leaveCover(); T = SPAN; lastT = T; render(); });
document.addEventListener('keydown', (e) => {
  if (e.key === ' ' && !(e.target as HTMLElement).closest('input,button,[role=slider]')) {
    e.preventDefault();
    if (document.body.classList.contains('at-cover')) $('cv-start').click();
    else if (playing) pause(); else play();
  }
});
$('speed').querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => {
  speed = +b.dataset.speed!;
  $('speed').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
}));

// ---------------------------------------------------------------- legend
$('legend').querySelectorAll<HTMLInputElement>('input[value]').forEach((cb) => cb.addEventListener('change', () => {
  cb.checked ? shown.add(cb.value as BombType) : shown.delete(cb.value as BombType);
  render();
}));
if (historicUrl) {
  const lab = $('legend').querySelector<HTMLElement>('label.base')!;
  lab.hidden = false;
  $<HTMLInputElement>('historic').addEventListener('change', (e) => {
    map.setLayoutProperty('historic', 'visibility', (e.target as HTMLInputElement).checked ? 'visible' : 'none');
  });
}

// ---------------------------------------------------------------- details panel
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const PLACED: Record<string, string> = {
  street: 'Placed on the street named in the log, not the exact building.',
  district: 'Could only be placed on the district, not the street.',
  approx: 'Placed by hand from a 1908 map; the street has since gone or been renamed.',
  manual: 'Placed by hand.'
};

function showIncident(id: number | null) {
  selected = id;
  const intro = $('p-intro'), box = $('p-incident');
  if (map.getSource('sel')) {
    const inc = incidents.find((i) => i.id === id);
    const f = inc ? feats.get(inc.id) : undefined;
    (map.getSource('sel') as GeoJSONSource).setData({ type: 'FeatureCollection', features: f ? [f] : [] });
  }
  if (id === null) {
    intro.hidden = false; box.hidden = true; $('p-close').hidden = true;
    document.body.classList.remove('has-sel');
    return;
  }
  const i = incidents.find((x) => x.id === id)!;
  const t = typeInfo(i.type);
  const same = incidents.filter((x) => x.shared === i.shared && x.id !== i.id);
  box.innerHTML = `
    <p class="meta">Log entry ${i.id} of ${records} · ${i.borough ? esc(i.borough) : 'London'}</p>
    <h2><span class="t">${i.time}</span><span class="d">${i.day === 'Sun 8 Sep' ? 'Sunday 8 September' : 'Saturday 7 September'}${i.loggedTime ? ` · corrected; logged as ${i.loggedTime}` : ''}</span> ${esc(i.address)}</h2>
    ${i.timeNote ? `<p class="warn">${esc(i.timeNote)}</p>` : ''}
    <p class="chip" style="--c:${t.color}"><i></i>${t.label}</p>
    <blockquote>${i.damage ? esc(i.damage) : '<em>No details recorded.</em>'}</blockquote>
    <p class="small">London Fire Brigade record. ${PLACED[i.precision]}${i.note ? ' ' + esc(i.note) : ''}</p>
    ${same.length ? `<h3>${same.length} more at this spot</h3><ul class="same">${same.map((s) =>
      `<li><button data-id="${s.id}"><b>${s.time}</b> ${esc(s.address)} <i style="background:${typeInfo(s.type).color}"></i></button></li>`).join('')}</ul>` : ''}
    <p class="nav"><button data-step="-1">← Previous</button><button data-step="1">Next →</button></p>`;
  box.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => b.addEventListener('click', () => select(+b.dataset.id!)));
  box.querySelectorAll<HTMLButtonElement>('[data-step]').forEach((b) => b.addEventListener('click', () => {
    const k = incidents.findIndex((x) => x.id === id) + +b.dataset.step!;
    if (k >= 0 && k < incidents.length) select(incidents[k].id, true);
  }));
  intro.hidden = true; box.hidden = false; $('p-close').hidden = false;
  document.body.classList.add('has-sel');
  $('p-scroll').scrollTop = 0;
}

function select(id: number, fly = false) {
  const i = incidents.find((x) => x.id === id);
  if (!i) return;
  if (i.t > T) { T = i.t; render(); } // make sure it is on the map
  showIncident(id);
  const f = feats.get(id);
  if (fly && f) {
    // keep the point clear of the panel (right on desktop, bottom sheet on phones)
    const phone = innerWidth <= 760;
    const panel = $('panel').getBoundingClientRect();
    const padding = phone ? { top: 120, bottom: innerHeight - panel.top + 20, left: 20, right: 20 } : { top: 40, bottom: 120, left: 40, right: innerWidth - panel.left + 20 };
    map.easeTo({ center: f.geometry.coordinates as [number, number], zoom: Math.max(map.getZoom(), 13), padding, duration: reduceMotion ? 0 : 700 });
  }
}
$('p-close').addEventListener('click', () => showIncident(null));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected !== null) showIncident(null); });

// ---------------------------------------------------------------- load data
type Feat = GeoJSON.Feature<GeoJSON.Point, Incident>;
const feats = new Map<number, Feat>();

map.on('load', async () => {
  const geo = (await (await fetch(mapEl.dataset.src!)).json()) as GeoJSON.FeatureCollection<GeoJSON.Point, Incident> & { meta: { records: number } };
  incidents = geo.features.map((f) => f.properties).sort((a, b) => a.t - b.t || a.id - b.id);
  geo.features.forEach((f) => feats.set(f.properties.id, f as Feat));
  records = geo.meta.records;
  $('n-records').textContent = String(incidents.length);

  map.addSource('incidents', { type: 'geojson', data: geo });
  map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'flash', type: 'circle', source: 'incidents', paint: { 'circle-color': colorExpr, 'circle-blur': 1 } });
  map.addLayer({
    id: 'dots', type: 'circle', source: 'incidents',
    paint: {
      'circle-color': colorExpr,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, ['match', ['get', 'type'], 'ib', 1.8, 2.6], 13, ['match', ['get', 'type'], 'ib', 4, 5.5], 17, ['match', ['get', 'type'], 'ib', 8, 11]],
      'circle-stroke-color': '#12171b',
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0, 13, 0.8]
    }
  });
  // district-only placements: hollow rings
  map.addLayer({
    id: 'dots-ring', type: 'circle', source: 'incidents',
    paint: {
      'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': colorExpr, 'circle-stroke-width': 1.4,
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 3, 13, 6, 17, 11]
    }
  });
  map.addLayer({
    id: 'sel', type: 'circle', source: 'sel',
    paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#f4efe2', 'circle-stroke-width': 2, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 9, 7, 13, 11, 17, 17] }
  });

  for (const layer of ['dots', 'dots-ring']) {
    map.on('click', layer, (e) => {
      const f = e.features?.[0] as MapGeoJSONFeature | undefined;
      if (f) { pause(); select(+f.properties.id); }
    });
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
  }
  map.on('click', (e) => {
    if (!map.queryRenderedFeatures(e.point, { layers: ['dots', 'dots-ring'] }).length) showIncident(null);
  });

  placeLabels(map, mapEl.dataset.places!, geo.features.map((f) => f.geometry.coordinates as [number, number]));
  blast = setupBlasts(map);
  drawHistogram();
  render();
  document.body.classList.add('ready');
  // test hook for the screenshot script
  (window as unknown as { __firstNight: unknown }).__firstNight = { setTime: (m: number) => { leaveCover(); T = m; render(); }, select: (id: number, fly?: boolean) => { leaveCover(); select(id, fly); } };
});
