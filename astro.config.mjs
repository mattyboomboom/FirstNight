// @ts-check
import { defineConfig } from 'astro/config';

// Where the site is hosted. The defaults publish to GitHub Pages at
// https://mattyboomboom.github.io/FirstNight/. For a custom domain or Vercel,
// build with SITE_URL set to the full origin and BASE_PATH=/.
const site = process.env.SITE_URL ?? 'https://mattyboomboom.github.io';
const base = process.env.BASE_PATH ?? '/FirstNight';

export default defineConfig({
  site,
  base,
  build: { inlineStylesheets: 'auto' },
  compressHTML: true
});
