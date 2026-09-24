#!/usr/bin/env bash
# Builds the self-hosted, line-drawn base map from an OpenStreetMap extract.
#
#   scripts/build-basemap.sh path/to/greater-london-latest.osm.pbf
#
# Needs osmium-tool, tippecanoe (2.x, for PMTiles output) and node.
#   macOS:  brew install osmium-tool tippecanoe
#   Ubuntu: apt install osmium-tool tippecanoe
#
# Get the extract (ODbL, © OpenStreetMap contributors) from
# https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html
#
# Writes:
#   public/basemap/london.pmtiles   water, parks, railways, roads (z9–15)
#   public/data/places.json         district names, drawn as HTML labels
# Only needs re-running to refresh the map; both outputs are committed.
set -euo pipefail
PBF=${1:?usage: build-basemap.sh greater-london-latest.osm.pbf}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK="$ROOT/.basemap-work"
mkdir -p "$WORK" "$ROOT/public/basemap" "$ROOT/public/data"
BBOX=-0.75,51.25,0.55,51.75   # matches the map's maxBounds

echo "clip to the map area"
osmium extract -b "$BBOX" "$PBF" -o "$WORK/london.pbf" --overwrite -s smart

echo "pick out the layers"
osmium tags-filter "$WORK/london.pbf" -o "$WORK/roads.pbf" --overwrite \
  w/highway=motorway,motorway_link,trunk,trunk_link,primary,primary_link,secondary,secondary_link,tertiary,tertiary_link,residential,unclassified,living_street,pedestrian
osmium tags-filter "$WORK/london.pbf" -o "$WORK/rail.pbf" --overwrite w/railway=rail
osmium tags-filter "$WORK/london.pbf" -o "$WORK/water.pbf" --overwrite \
  nwr/natural=water nwr/waterway=riverbank,dock nwr/landuse=basin,reservoir
osmium tags-filter "$WORK/london.pbf" -o "$WORK/rivers.pbf" --overwrite w/waterway=river,canal
osmium tags-filter "$WORK/london.pbf" -o "$WORK/parks.pbf" --overwrite \
  nwr/leisure=park,common,recreation_ground,nature_reserve nwr/landuse=cemetery,recreation_ground,forest nwr/natural=wood,heath
osmium tags-filter "$WORK/london.pbf" -o "$WORK/places.pbf" --overwrite n/place=town,suburb,quarter,neighbourhood,village

exp() { osmium export "$WORK/$1.pbf" -f geojsonseq --overwrite -o "$WORK/$1.geojsonl" --geometry-types="$2"; }
exp roads linestring
exp rail linestring
exp rivers linestring
exp water polygon
exp parks polygon
exp places point

echo "slim the features and set zoom levels"
node "$ROOT/scripts/basemap-features.mjs" "$WORK"

echo "tile"
tippecanoe -o "$ROOT/public/basemap/london.pmtiles" --force \
  -Z9 -z15 --no-tile-size-limit --simplification=4 --detect-shared-borders \
  --drop-smallest-as-needed \
  -j '{
    "roads": ["any", ["==", "c", "major"], ["all", ["==", "c", "secondary"], [">=", "$zoom", 10]], ["all", ["==", "c", "tertiary"], [">=", "$zoom", 11]], [">=", "$zoom", 12]],
    "rail": ["any", ["==", "c", "main"], [">=", "$zoom", 13]],
    "rivers": ["any", ["==", "c", "river"], [">=", "$zoom", 11]],
    "water": ["any", ["==", "c", "river"], [">=", "$zoom", 11]],
    "parks": [">=", "$zoom", 10]
  }' \
  -n "London line map" -A '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' \
  -L water:"$WORK/water.out.geojsonl" \
  -L rivers:"$WORK/rivers.out.geojsonl" \
  -L parks:"$WORK/parks.out.geojsonl" \
  -L rail:"$WORK/rail.out.geojsonl" \
  -L roads:"$WORK/roads.out.geojsonl" \
  -P

ls -lh "$ROOT/public/basemap/london.pmtiles" "$ROOT/public/data/places.json"
