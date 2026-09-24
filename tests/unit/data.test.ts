import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SPAN, at, bins, busiest, clock, dayOf, phase, tally, DAY, type Incident } from '../../src/map/data';
import { bombType, BBOX } from '../../scripts/build-data.mjs';

const geo = JSON.parse(readFileSync(new URL('../../public/data/first-night.geojson', import.meta.url), 'utf8'));
const inc: Incident[] = geo.features.map((f: { properties: Incident }) => f.properties);

describe('built data', () => {
  it('keeps every log entry, mapped or listed as unlocated', () => {
    expect(geo.features.length + geo.meta.unlocated.length + geo.meta.later.length).toBe(geo.meta.records);
    expect(geo.meta.records).toBe(843);
  });
  it('places every point inside Greater London', () => {
    for (const f of geo.features) {
      const [lon, lat] = f.geometry.coordinates;
      expect(lon > BBOX.w && lon < BBOX.e && lat > BBOX.s && lat < BBOX.n, `#${f.id}`).toBe(true);
    }
  });
  it('has valid times and ids', () => {
    expect(new Set(inc.map((i) => i.id)).size).toBe(inc.length);
    for (const i of inc) expect(i.t >= 0 && i.t <= SPAN).toBe(true);
    expect(SPAN).toBe(14 * 60); // 16:00 Saturday to 06:00 Sunday
  });
});

describe('helpers', () => {
  it('normalises bomb types', () => {
    expect(bombType('EB & IB')).toBe('mixed');
    expect(bombType('IB and EB')).toBe('mixed');
    expect(bombType('Ib')).toBe('ib');
    expect(bombType('IBIB')).toBe('ib');
    expect(bombType('High Explosive Bomb')).toBe('eb');
    expect(bombType('Crude oil bomb')).toBe('cob');
    expect(bombType('-')).toBe('other');
  });
  it('runs the clock from 16:00 Saturday to 15:59 Sunday', () => {
    expect(clock(0)).toBe('16:00');
    expect(clock(at(18, 5))).toBe('18:05');
    expect(clock(at(0, 8, 1))).toBe('00:08');
    expect(clock(99999)).toBe('15:59');
    expect(dayOf(at(23, 59))).toMatch(/^Saturday/);
    expect(dayOf(at(0, 1, 1))).toMatch(/^Sunday/);
    expect(phase(at(21, 0))?.label).toBe('Night raid');
    expect(phase(0)).toBeNull();
  });
  it('reads early-hours entries as Sunday, after the evening ones', () => {
    const first = inc.find((i) => i.id === 1)!; // 00:08
    const last = inc.find((i) => i.id === 843)!; // 23:59
    const arsenal = inc.find((i) => i.id === 81)!; // logged 14:55, corrected to 17:15 Saturday
    expect(arsenal.time).toBe('17:15');
    expect(arsenal.loggedTime).toBe('14:55');
    expect(arsenal.day).toBe('Sat 7 Sep');
    expect(first.day).toBe('Sun 8 Sep');
    expect(first.t).toBeGreaterThan(last.t);
  });
  it('bins and tallies consistently', () => {
    const total = bins(inc).reduce((a, b) => a + b.ib + b.eb + b.mixed + b.cob + b.other, 0);
    expect(total).toBe(inc.length);
    expect(tally(inc, DAY).total).toBe(inc.length);
  });
  it('finds the busiest ten minutes in the evening raid', () => {
    const busy = busiest(inc);
    expect(clock(busy.t)).toBe('18:00');
  });
});
