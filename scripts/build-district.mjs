// Builds shared/data/district.json from the OpenStreetMap extract in data/osm (fetched by
// .github/workflows/osm-fetch.yml; © OpenStreetMap contributors, ODbL):
//
//   node scripts/build-district.mjs
//
// - streets: motorway, trunk, primary, secondary and tertiary roads with their slip roads, clipped to
//   the play area (Sixty Meter Street / Kurdistan Street around the Iskan tunnel, Zanyari, the citadel
//   and Samad restaurant to the north)
// - tunnels and bridges: tunnel ways sit 6.2 m below ground, bridges 6.5 m above; the ways leading
//   into them become ramps (split off at the ramp length) whose height changes linearly
// - named places (shops, restaurants, offices...) for shop signs, and a few landmarks
// - aliases: long stretches of real streets standing in for the road ids the demo data uses

import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url);
const read = (p) => JSON.parse(gunzipSync(readFileSync(new URL(p, root))).toString('utf8')).elements;
const streets = read('data/osm/streets.json.gz');
const places = read('data/osm/places.json.gz');
const current = JSON.parse(readFileSync(new URL('shared/data/district.json', root), 'utf8'));

const BOX = { south: 36.17, west: 43.962, north: 36.206, east: 44.026 };
const TUNNEL_Z = -6.2;
const BRIDGE_Z = 6.5;
const RAMP = { tunnel: 115, bridge: 125 };

const KIND = {
  motorway: 'arterial',
  trunk: 'arterial',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'local',
};
const DEFAULT_LANES = { arterial: 3, primary: 2, secondary: 2, local: 2 };

const inBox = (g) => g.lat >= BOX.south && g.lat <= BOX.north && g.lon >= BOX.west && g.lon <= BOX.east;
const mPerLat = 111132;
const mPerLng = 111320 * Math.cos((((BOX.south + BOX.north) / 2) * Math.PI) / 180);
const dist = (a, b) => Math.hypot((a.lat - b.lat) * mPerLat, (a.lon - b.lon) * mPerLng);

// ------------------------------------------------------------------ ways in the play area

const ways = [];
for (const w of streets) {
  const hw = w.tags.highway;
  const base = hw.replace(/_link$/, '');
  if (!KIND[base] || !w.geometry || w.geometry.length < 2) continue;
  if (w.tags.area === 'yes' || w.tags.access === 'private') continue;
  // clip to the box, keeping the longest run of points inside it
  let best = [];
  let run = [];
  w.geometry.forEach((g, i) => {
    // shared vertices have identical coordinates in the extract: use them as node ids
    if (inBox(g)) run.push({ ...g, node: w.nodes?.[i] ?? `${g.lat.toFixed(7)},${g.lon.toFixed(7)}` });
    else {
      if (run.length > best.length) best = run;
      run = [];
    }
  });
  if (run.length > best.length) best = run;
  if (best.length < 2) continue;
  const kind = KIND[base];
  const link = hw.endsWith('_link');
  const oneway = w.tags.oneway === 'yes' || w.tags.oneway === '1' || link || hw === 'motorway';
  const lanes = Number(w.tags.lanes) || (link ? 1 : oneway ? Math.max(1, Math.round(DEFAULT_LANES[kind] / 1.5)) : DEFAULT_LANES[kind] * 2);
  const width = Math.max(5.5, Math.min(26, lanes * 3.4 + (oneway ? 1.2 : 2)));
  const layer = Number(w.tags.layer) || 0;
  const tunnel = w.tags.tunnel === 'yes' || (layer < 0 && w.tags.tunnel !== 'no');
  const bridge = !tunnel && (w.tags.bridge === 'yes' || w.tags.bridge === 'viaduct' || layer > 0);
  ways.push({
    id: `osm-${w.id}`,
    tags: w.tags,
    kind,
    width: +width.toFixed(1),
    oneway,
    tunnel,
    bridge,
    pts: best,
    name_ar: w.tags['name:ar'] || w.tags.name || '',
    name_en: w.tags['name:en'] || w.tags.name || '',
  });
}

// ------------------------------------------------------------------ ramps into tunnels and onto bridges

const byNode = new Map();
const index = (w) => {
  for (const end of [w.pts[0], w.pts[w.pts.length - 1]]) {
    if (end.node === undefined) continue;
    if (!byNode.has(end.node)) byNode.set(end.node, []);
    byNode.get(end.node).push(w);
  }
};
ways.forEach(index);

const splitAt = (w, metres) => {
  // returns [first, rest]; first covers `metres` from pts[0]
  let acc = 0;
  for (let i = 0; i < w.pts.length - 1; i++) {
    const a = w.pts[i];
    const b = w.pts[i + 1];
    const l = dist(a, b);
    if (acc + l >= metres) {
      const t = (metres - acc) / l;
      const mid = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t, node: `split-${w.id}-${metres}` };
      return [
        { ...w, pts: [...w.pts.slice(0, i + 1), mid] },
        { ...w, id: `${w.id}-b`, pts: [mid, ...w.pts.slice(i + 1)] },
      ];
    }
    acc += l;
  }
  return [w, null];
};
const lengthOf = (pts) => pts.slice(1).reduce((s, p, i) => s + dist(pts[i], p), 0);

let out = ways.filter((w) => !w.tunnel && !w.bridge);
const graded = ways.filter((w) => w.tunnel || w.bridge);
for (const w of graded) w.elev = w.pts.map(() => (w.tunnel ? TUNNEL_Z : BRIDGE_Z));
const done = new Set();
for (const g of graded) {
  const level = g.tunnel ? TUNNEL_Z : BRIDGE_Z;
  const ramp = g.tunnel ? RAMP.tunnel : RAMP.bridge;
  for (const end of [g.pts[0], g.pts[g.pts.length - 1]]) {
    // follow the street away from the structure, turning the first `ramp` metres into a slope
    let node = end.node;
    let left = ramp;
    let from = level;
    while (left > 0.5 && node !== undefined) {
      const next = (byNode.get(node) ?? []).find(
        (w) => !w.tunnel && !w.bridge && !done.has(w.id) && (w.name_en === g.name_en || w.tags.highway === g.tags.highway),
      );
      if (!next) break;
      done.add(next.id);
      // orient so the slope starts at the shared node
      let w = next;
      const reversed = w.pts[0].node !== node;
      if (reversed) w = { ...w, pts: [...w.pts].reverse() };
      const len = lengthOf(w.pts);
      let part = w;
      let rest = null;
      if (len > left + 5) [part, rest] = splitAt(w, left);
      const partLen = Math.min(len, left);
      const to = from * (1 - partLen / left);
      let acc = 0;
      part.elev = part.pts.map((p, i) => {
        if (i > 0) acc += dist(part.pts[i - 1], p);
        return +(from + (to - from) * Math.min(1, acc / partLen)).toFixed(2);
      });
      // keep the way's original direction (one-way streets)
      const restore = (x) => (x && reversed ? { ...x, pts: [...x.pts].reverse(), elev: x.elev ? [...x.elev].reverse() : undefined } : x);
      out = out.filter((x) => x.id !== next.id);
      out.push(restore(part));
      if (rest) out.push(restore({ ...rest, id: `${next.id}-flat` }));
      node = rest ? undefined : w.pts[w.pts.length - 1].node;
      left -= partLen;
      from = to;
    }
  }
}
out.push(...graded);

// drop tiny fragments
out = out.filter((w) => lengthOf(w.pts) > 6);

// keep only the largest connected network (clipping at the edges leaves stray pieces)
{
  const parent = new Map();
  const find = (k) => {
    while (parent.get(k) !== k) {
      parent.set(k, parent.get(parent.get(k)));
      k = parent.get(k);
    }
    return k;
  };
  // vertices only join roads at the same level (as in shared/roads.ts)
  const key = (w, i) => `${w.pts[i].lat.toFixed(6)},${w.pts[i].lon.toFixed(6)}|${Math.round((w.elev?.[i] ?? 0) / 1.5)}`;
  for (const w of out) w.pts.forEach((_, i) => parent.has(key(w, i)) || parent.set(key(w, i), key(w, i)));
  for (const w of out) for (let i = 1; i < w.pts.length; i++) parent.set(find(key(w, i)), find(key(w, 0)));
  const size = new Map();
  for (const w of out) size.set(find(key(w, 0)), (size.get(find(key(w, 0))) ?? 0) + 1);
  const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const before = out.length;
  out = out.filter((w) => find(key(w, 0)) === main);
  console.log(`network: kept ${out.length} of ${before} ways`);
}

const roads = out.map((w) => ({
  id: w.id,
  name_ar: w.name_ar,
  name_en: w.name_en,
  kind: w.kind,
  width: w.width,
  ...(w.oneway ? { oneway: true } : {}),
  coords: w.pts.map((g) => [+g.lat.toFixed(7), +g.lon.toFixed(7)]),
  ...(w.elev && w.elev.some((z) => Math.abs(z) > 0.05) ? { elev: w.elev } : {}),
  ...(w.tunnel ? { tunnel: true } : {}),
  ...(w.bridge ? { bridge: true } : {}),
}));

// ------------------------------------------------------------------ aliases for the demo data's road ids

const street = (name) => out.filter((w) => w.name_en === name && !w.elev && !w.tunnel && !w.bridge);
/** The longest chain of connected ground-level ways of one street. */
function chain(name) {
  const parts = street(name);
  if (!parts.length) return null;
  const starts = new Map(parts.map((w) => [w.pts[0].node, w]));
  let best = null;
  for (const w0 of parts) {
    const pts = [...w0.pts];
    const seen = new Set([w0.id]);
    for (;;) {
      const nxt = starts.get(pts[pts.length - 1].node);
      if (!nxt || seen.has(nxt.id)) break;
      seen.add(nxt.id);
      pts.push(...nxt.pts.slice(1));
    }
    const len = lengthOf(pts);
    if (!best || len > best.len) best = { pts, len, width: w0.width };
  }
  return best;
}
const ALIASES = {
  'sixty-meter': ['Kurdistan Street'],
  'forty-meter': ['Barzani Nemir Street'],
  'mosul-road': ['Mosul Road'],
  'street-18': ['Iskan Street'],
  'industrial-1': ['Karkuk Street'],
  'industrial-2': ['Qasmlo Street'],
  'market-street': ['Qalat Street'],
  'park-street': ['Sultan Muzaffar Street'],
  'office-avenue': ['Taran Street'],
  'north-link': ['Sir John Major Street', 'Mala Afandi Street'],
  'warehouse-lane': ['Brayati Street', 'Ali Hazhar Street'],
};
const aliases = {};
const used = new Set();
for (const [id, names] of Object.entries(ALIASES)) {
  let c = null;
  for (const n of names) {
    c = chain(n);
    if (c && c.len > 250) break;
  }
  if (!c || c.len < 250) {
    // fall back to the longest unused named street
    const named = [...new Set(out.filter((w) => w.name_en && !used.has(w.name_en)).map((w) => w.name_en))];
    c = named.map(chain).filter(Boolean).sort((a, b) => b.len - a.len)[0];
  }
  used.add(names[0]);
  aliases[id] = { coords: c.pts.map((g) => [+g.lat.toFixed(7), +g.lon.toFixed(7)]), width: c.width };
  console.log(`alias ${id}: ${Math.round(c.len)} m`);
}

// ------------------------------------------------------------------ named places and landmarks

const ll = (e) => ({ lat: e.lat ?? e.center?.lat, lng: e.lon ?? e.center?.lon });
const pois = [];
for (const e of places) {
  const t = e.tags;
  const kind = t.shop ? `shop:${t.shop}` : t.amenity ? `amenity:${t.amenity}` : t.office ? 'office' : t.tourism ? `tourism:${t.tourism}` : null;
  if (!kind) continue;
  const p = ll(e);
  if (p.lat === undefined || !inBox({ lat: p.lat, lon: p.lng })) continue;
  if (/parking|bench|waste|toilets|atm|fuel|place_of_worship|school|kindergarten/.test(kind)) continue;
  const name_ar = t['name:ar'] || t.name || '';
  const name_en = t['name:en'] || '';
  if (!name_ar && !name_en) continue;
  pois.push({ name_ar, name_en, kind, lat: +p.lat.toFixed(7), lng: +p.lng.toFixed(7) });
}
const landmarks = [
  { name_ar: 'قلعة أربيل', name_en: 'Erbil Citadel', kind: 'citadel', lat: 36.19115, lng: 44.00915 },
  { name_ar: 'مطعم صمد', name_en: 'Samad Restaurant', kind: 'restaurant', lat: 36.2041468, lng: 44.0090829 },
  // the three Zanyari apartment towers (OpenStreetMap buildings "zaniary tower A/B/C")
  { name_ar: 'برج زانياري A', name_en: 'Zanyari Tower A', kind: 'tower', lat: 36.1746704, lng: 44.0078291 },
  { name_ar: 'برج زانياري B', name_en: 'Zanyari Tower B', kind: 'tower', lat: 36.1749417, lng: 44.0074043 },
  { name_ar: 'برج زانياري C', name_en: 'Zanyari Tower C', kind: 'tower', lat: 36.17472, lng: 44.0069164 },
  // Empire World: the Empire Business Towers and the Empire Residential Wings (OpenStreetMap buildings)
  { name_ar: 'إمباير وورلد', name_en: 'Empire World', kind: 'district', lat: 36.2003, lng: 43.9692 },
  { name_ar: 'نفق الإسكان — شارع الستين', name_en: 'Iskan tunnel, Sixty Meter Street', kind: 'tunnel', lat: 36.1766877, lng: 44.0195374 },
];

const origin = { lat: 36.188, lng: 44.012 };
const district = {
  ...current,
  id: 'erbil-centre',
  name_ar: 'وسط أربيل — شارع الستين والإسكان',
  name_en: 'Central Erbil — Sixty Meter Street and Iskan',
  source: 'osm',
  sourceNote: `Street geometry from OpenStreetMap (ODbL), extract in data/osm, built ${new Date().toISOString().slice(0, 10)} by scripts/build-district.mjs for bbox ${BOX.south},${BOX.west},${BOX.north},${BOX.east}. Tunnel and bridge heights and ramp lengths are estimates.`,
  attribution: 'Map data © OpenStreetMap contributors (ODbL).',
  origin,
  bounds: BOX,
  roads,
  aliases,
  zones: [
    {
      kind: 'commercial',
      name_en: 'Central Erbil',
      polygon: [
        [BOX.south, BOX.west],
        [BOX.south, BOX.east],
        [BOX.north, BOX.east],
        [BOX.north, BOX.west],
      ],
    },
  ],
  landmarks,
  pois,
};
writeFileSync(new URL('shared/data/district.json', root), JSON.stringify(district) + '\n');
console.log(`roads ${roads.length} (${roads.filter((r) => r.elev).length} graded, ${roads.filter((r) => r.tunnel).length} tunnels, ${roads.filter((r) => r.bridge).length} bridges), pois ${pois.length}`);
