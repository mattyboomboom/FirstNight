// Flash-and-blast effects for each hit as the timeline plays. They run in
// real time (about 1.5 s each), whatever the playback speed, and are drawn as
// CSS-animated HTML markers so they can glow and ripple over the map.
import maplibregl, { type Map as MLMap } from 'maplibre-gl';
import type { BombType } from './data';

const MAX_LIVE = 90; // don't pile up more than this at once
let live = 0;
let glow = 0; // ambient sky glow, 0–1
let lastShake = 0;

/** Visual weight of each kind of bomb. */
const KIND: Record<BombType, { cls: string; glow: number; shake: boolean }> = {
  eb: { cls: 'he', glow: 0.16, shake: true },
  mixed: { cls: 'he', glow: 0.16, shake: true },
  cob: { cls: 'oil', glow: 0.12, shake: false },
  ib: { cls: 'ib', glow: 0.05, shake: false },
  other: { cls: 'ib', glow: 0.03, shake: false }
};

export function setupBlasts(map: MLMap) {
  const sky = document.createElement('div');
  sky.id = 'skyglow';
  map.getContainer().appendChild(sky);
  // the sky glow decays smoothly between hits
  const decay = () => {
    glow *= 0.94;
    sky.style.opacity = Math.min(0.75, glow).toFixed(3);
    requestAnimationFrame(decay);
  };
  requestAnimationFrame(decay);

  return function blast(lngLat: [number, number], type: BombType) {
    const k = KIND[type];
    glow = Math.min(1, glow + k.glow);
    if (live >= MAX_LIVE) return;
    const el = document.createElement('div');
    // effects grow with the zoom, so a blast reads the same size on the ground
    const s = Math.max(0.55, Math.min(2.4, Math.pow(1.45, map.getZoom() - 12)));
    el.className = `blast ${k.cls}`;
    el.style.setProperty('--s', s.toFixed(2));
    el.innerHTML = '<i class="glow"></i><i class="ring"></i><i class="ring r2"></i><i class="core"></i>';
    const m = new maplibregl.Marker({ element: el }).setLngLat(lngLat).addTo(map);
    live++;
    setTimeout(() => { m.remove(); live--; }, 1600);
    if (k.shake && map.getZoom() >= 12.5 && performance.now() - lastShake > 350) {
      lastShake = performance.now();
      const c = map.getContainer();
      c.classList.remove('shake');
      void c.offsetWidth; // restart the animation
      c.classList.add('shake');
    }
  };
}
