// Replaces shared/data/district.json with real OpenStreetMap street geometry
// (© OpenStreetMap contributors, ODbL) around the current district origin.
//
//   npm run osm:fetch                 # 2.4 km × 2.8 km around the existing origin
//   npm run osm:fetch -- 36.19 43.98 36.21 44.00   # south west north east
//
// Needs internet access to the Overpass API. The development environment this
// demo was built in could not reach it, so this script has not been run yet;
// review the result (npm test, then look at the game and the admin map) before
// committing it. Existing merchant coordinates are kept; any that end up off
// the new roads can be moved on the dashboard map.

import { readFileSync, writeFileSync } from 'node:fs';

const file = new URL('../shared/data/district.json', import.meta.url);
const current = JSON.parse(readFileSync(file, 'utf8'));
const args = process.argv.slice(2).map(Number);
const bbox = args.length === 4 ? { south: args[0], west: args[1], north: args[2], east: args[3] } : current.bounds;

const KINDS = {
  motorway: ['arterial', 30],
  trunk: ['arterial', 30],
  primary: ['primary', 22],
  secondary: ['secondary', 16],
  tertiary: ['secondary', 14],
  unclassified: ['local', 12],
  residential: ['local', 10],
  living_street: ['local', 8],
  service: ['local', 7],
};

const query = `[out:json][timeout:60];
way["highway"~"^(${Object.keys(KINDS).join('|')})$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
out geom tags;`;

const res = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'erbil-delivery-world-demo/0.1' },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`Overpass error ${res.status}: ${await res.text()}`);
const data = await res.json();

const roads = data.elements
  .filter((e) => e.type === 'way' && e.geometry?.length > 1)
  .map((w) => {
    const [kind, width] = KINDS[w.tags.highway] ?? ['local', 10];
    const lanes = Number(w.tags.lanes);
    return {
      id: `osm-${w.id}`,
      name_ar: w.tags['name:ar'] ?? w.tags.name ?? '',
      name_en: w.tags['name:en'] ?? w.tags.name ?? '',
      kind,
      width: Number.isFinite(lanes) && lanes > 0 ? Math.max(6, Math.min(36, lanes * 3.5)) : width,
      oneway: w.tags.oneway === 'yes',
      coords: w.geometry.map((g) => [+g.lat.toFixed(7), +g.lon.toFixed(7)]),
    };
  });

if (roads.length < 5) throw new Error(`Only ${roads.length} roads found; check the bounding box`);

console.log(`fetched ${roads.length} ways`);
const out = {
  ...current,
  source: 'osm',
  sourceNote: `Street geometry from OpenStreetMap (ODbL), fetched ${new Date().toISOString().slice(0, 10)} for bbox ${bbox.south},${bbox.west},${bbox.north},${bbox.east}.`,
  attribution: 'Street data © OpenStreetMap contributors (ODbL).',
  bounds: bbox,
  roads,
};
writeFileSync(file, JSON.stringify(out, null, 1) + '\n');
console.log('wrote shared/data/district.json — note: seed placements reference road ids such as "sixty-meter"; update server/seed.ts to OSM way ids before resetting the demo.');
