// Screenshots for a quick visual check. Start `npm run preview` first, then
// `npm run shots` (or `node scripts/shoot.mjs http://localhost:4321/FirstNight/`).
// Images land in tests/shots/ (git-ignored).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4321/FirstNight/';
const dir = new URL('../tests/shots/', import.meta.url);
mkdirSync(dir, { recursive: true });
const opts = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const browser = await chromium.launch({ ...opts, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

async function shot(name, viewport, act) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/tiles|cartocdn|Failed to load resource|AJAXError/i.test(m.text()) && errors.push(`${name}: ${m.text()}`));
  await page.goto(url);
  await page.waitForSelector('body.ready', { timeout: 30000 });
  if (act) await act(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: new URL(`${name}.png`, dir).pathname });
  await page.close();
}

await shot('desktop-all-day', { width: 1440, height: 900 });
await shot('desktop-1805-selected', { width: 1440, height: 900 }, (p) =>
  p.evaluate(() => { window.__firstNight.setTime(125); window.__firstNight.select(300, true); }));
await shot('phone-1805', { width: 390, height: 844 }, (p) => p.evaluate(() => window.__firstNight.setTime(125)));
await shot('desktop-0030-sunday', { width: 1440, height: 900 }, (p) => p.evaluate(() => window.__firstNight.setTime(510)));
await shot('phone-selected', { width: 390, height: 844 }, (p) => p.evaluate(() => window.__firstNight.select(300, true)));
await browser.close();
console.log(errors.length ? `Errors:\n${errors.join('\n')}` : 'No page errors');
