// Shared types and pure helpers for the first-night map (unit-tested).

export type BombType = 'ib' | 'eb' | 'mixed' | 'cob' | 'other';
export type Precision = 'street' | 'district' | 'approx' | 'manual';

export interface Incident {
  id: number;
  /** Minutes after 16:00 on Saturday 7 Sept 1940 (the timeline's start) */
  t: number;
  /** Time shown (as logged, unless corrected) */
  time: string;
  day: string;
  /** The time as logged, when the time shown has been corrected */
  loggedTime?: string;
  timeNote?: string;
  address: string;
  typeRaw: string;
  type: BombType;
  damage: string;
  borough: string | null;
  precision: Precision;
  check: boolean;
  note?: string;
  geocodedAs?: string;
  shared: string;
  sharedCount: number;
}

export const TYPES: { key: BombType; label: string; short: string; color: string }[] = [
  { key: 'ib', label: 'Incendiary bomb', short: 'Incendiary', color: '#e8a93c' },
  { key: 'eb', label: 'High-explosive bomb', short: 'Explosive', color: '#e0442c' },
  { key: 'mixed', label: 'Explosive and incendiary', short: 'Both', color: '#f47a3d' },
  { key: 'cob', label: 'Crude oil bomb', short: 'Oil bomb', color: '#b07be0' },
  { key: 'other', label: 'Other or not recorded', short: 'Other', color: '#9aa39e' }
];
export const typeInfo = (k: BombType) => TYPES.find((t) => t.key === k)!;

/** Length of the timeline: 24 hours from 16:00 on Saturday 7 September. */
export const DAY = 24 * 60;
/** The timeline's start, in minutes after midnight on the Saturday. */
export const START = 16 * 60;

/** Clock time ("18:05", "02:30") for a timeline minute. */
export function clock(t: number): string {
  const m = (Math.max(0, Math.min(DAY - 1, Math.floor(t))) + START) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Timeline minute for a clock time on the Saturday (d=0) or Sunday (d=1). */
export const at = (hh: number, mm: number, d = 0) => d * DAY + hh * 60 + mm - START;

/** Length of the timeline: from 16:00 Saturday to 06:00 Sunday, after the all clear. */
export const SPAN = at(6, 0, 1);

/** The day on show at timeline minute t. */
export const dayOf = (t: number) => (t + START >= DAY ? 'Sunday 8 September 1940' : 'Saturday 7 September 1940');

/** Counts per bin (default 10 minutes) and type, for the timeline histogram. */
export function bins(items: Pick<Incident, 't' | 'type'>[], size = 10): Record<BombType, number>[] {
  const out = Array.from({ length: Math.ceil(SPAN / size) }, () => ({ ib: 0, eb: 0, mixed: 0, cob: 0, other: 0 }));
  for (const it of items) out[Math.min(out.length - 1, Math.floor(it.t / size))][it.type]++;
  return out;
}

/** Running totals by type up to and including minute t. */
export function tally(items: Pick<Incident, 't' | 'type'>[], t: number) {
  const out = { total: 0, ib: 0, eb: 0, mixed: 0, cob: 0, other: 0 };
  for (const it of items) if (it.t <= t) { out.total++; out[it.type]++; }
  return out;
}

export interface Moment { t: number; label: string; detail: string; src?: string }

/** Sources for the moments, shown as links. */
export const SOURCES = {
  lm: { title: 'London Museum, “Black Saturday: the first day of the Blitz”', url: 'https://www.londonmuseum.org.uk/collections/london-stories/black-saturday-first-day-blitz/' },
  bob: { title: 'Battle of Britain Historical Timeline, 7 September 1940', url: 'https://battleofbritain1940.com/entry/saturday-7-september-1940/' }
} as const;

/** The course of the raid, from published accounts. */
export const RAID: Moment[] = [
  { t: at(16, 43), label: 'Sirens', detail: 'Air-raid sirens sound across London.', src: 'lm' },
  { t: at(17, 0), label: 'First bombs', detail: 'The first bombs fall, on the oil tanks at Thameshaven; Woolwich Arsenal is hit at about 17:15.', src: 'bob' },
  { t: at(18, 30), label: 'All clear', detail: 'The all clear sounds between the two raids.', src: 'lm' },
  { t: at(20, 0), label: 'Night raid', detail: 'The second raid begins: over 300 more bombers.', src: 'lm' },
  { t: at(4, 30, 1), label: 'All clear', detail: 'The last raiders turn for home. The night raid has lasted over eight hours.', src: 'lm' }
];

/** Where the raid stands at minute t: the last moment passed. */
export function phase(t: number): Moment | null {
  let cur: Moment | null = null;
  for (const m of RAID) if (m.t <= t) cur = m;
  return cur;
}

/** The busiest ten minutes in the log. */
export function busiest(items: Pick<Incident, 't'>[]): Moment {
  const b = bins(items.map((i) => ({ t: i.t, type: 'other' as BombType })));
  let best = 0;
  b.forEach((x, i) => { if (x.other > b[best].other) best = i; });
  return {
    t: best * 10,
    label: 'Busiest',
    detail: `The busiest ten minutes in the log: ${b[best].other} incidents between ${clock(best * 10)} and ${clock(best * 10 + 10)}.`
  };
}
