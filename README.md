# First Night: London, 7 September 1940

A proof of concept for an interactive map of the London Blitz. It plays back, minute by minute, every incident the London Fire Brigade logged on 7 September 1940, the first day of the Blitz: 843 entries of incendiary, high-explosive and oil bombs, each with the brigade's note on the damage.

Built with [Astro](https://astro.build), TypeScript and [MapLibre GL](https://maplibre.org). Needs Node 22.12 or newer.

```sh
npm install
npm run dev        # local dev server at http://localhost:4321/FirstNight/
npm run build      # rebuilds the data, then the static site in dist/
npm run preview    # serve the built site
npm run check      # type-check
npm test           # unit tests, including checks on the built data
npm run shots      # screenshots into tests/shots/ (run preview first)
```

## Deploying

Same as Normandy44: every push to `main` runs `.github/workflows/deploy.yml`, which type-checks, tests, builds and publishes to GitHub Pages at <https://mattyboomboom.github.io/FirstNight/>. Set **Settings → Pages → Source** to **GitHub Actions**. For a custom domain, build with `SITE_URL=https://your-domain` and `BASE_PATH=/`.

## The data

`npm run data` builds `public/data/first-night.geojson` from `data-src/`:

| File | What it is |
|---|---|
| `first-night-7sep1940.csv` | The incident log (London Fire Brigade records via the Guardian Datablog), from the public spreadsheet |
| `espinielli-drops.json` | Coordinates for the same rows from [espinielli/theblitz](https://github.com/espinielli/theblitz) (2012) |
| `espinielli-addressesNotFound.txt` | Rows that project placed by hand from a 1908 map |
| `geocode-fixes.json` | Our hand fixes; these win over everything else |
| `needs-review.csv` | Generated: every entry not placed on its own street, for checking by hand |

The build swaps the coordinates the old project stored the wrong way round, applies the fixes, groups the bomb types (`EB & IB`, `IB and EB` → both), and marks how precisely each point is placed: street, district only (drawn as a hollow ring), approximate, or placed by hand. To fix a point, add its log number to `geocode-fixes.json` with `latlon` and a `note`, and rebuild.

## Base map

The map underneath is a line drawing of London made from OpenStreetMap, hosted with the site, so there is no tile service or API key. It lives in `public/basemap/london.pmtiles` (about 16 MB, committed) with district names in `public/data/places.json`. To rebuild it, download `greater-london-latest.osm.pbf` from [Geofabrik](https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html), then:

```sh
brew install osmium-tool tippecanoe
scripts/build-basemap.sh path/to/greater-london-latest.osm.pbf
```

The colours and line widths are in `src/map/basemap.ts`.

## Historic base map (optional)

Copy `.env.example` to `.env` and set `PUBLIC_HISTORIC_TILES` to a National Library of Scotland tile URL from MapTiler Cloud (free for non-commercial use). A "1940s map" toggle then appears in the legend.

## Layout

```
src/
  pages/            index (the map), about (data and credits), 404
  components/Atlas.astro   map page markup
  map/main.ts       MapLibre map, playback, timeline, details panel
  map/basemap.ts    line-map style and district labels
  map/data.ts       types and pure helpers (tested)
  styles/           app.css; fonts.css and fonts/ shared with Normandy44
scripts/            build-data.mjs, build-basemap.sh, shoot.mjs
tests/unit/         vitest
```

## Licences

The incident log and geocodes are used for a non-commercial, educational project. Some of the 2012 coordinates came from Google's geocoder; before any wider launch, re-geocode with an open source (OS Open Names, Nominatim) so the whole dataset can be redistributed.
