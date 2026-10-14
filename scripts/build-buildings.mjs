// Builds web/public/data/buildings.json from the OpenStreetMap building footprints in
// data/osm/buildings.json.gz (© OpenStreetMap contributors, ODbL), after scripts/build-district.mjs:
//
//   node scripts/build-buildings.mjs
//
// For each footprint: local coordinates on the district's plane, counter-clockwise, simplified; a roof
// height from height / building:levels (estimated from the building type and size when missing); a
// facade style from its type and neighbourhood (old town round the citadel, towers, apartment blocks,
// commercial blocks, houses, public buildings); a wall tint; and the walls that face a street within a few
// metres, which get shop fronts. Footprints that overlap a carriageway are dropped (the street wins).
// Also writes tree positions and park outlines.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url);
const district = JSON.parse(readFileSync(new URL('shared/data/district.json', root), 'utf8'));
const raw = JSON.parse(gunzipSync(readFileSync(new URL('data/osm/buildings.json.gz', root))).toString('utf8')).elements;
const { origin, bounds } = district;

const mLat = 110574;
const mLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
const local = (lat, lon) => [(lon - origin.lng) * mLng, (lat - origin.lat) * mLat];
const citadel = local(district.citadel.lat, district.citadel.lng);
const inBounds = (g) => g.lat >= bounds.south && g.lat <= bounds.north && g.lon >= bounds.west && g.lon <= bounds.east;

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

// ------------------------------------------------------------------ roads (ground level) for the checks

const segs = [];
for (const r of district.roads) {
  const pts = r.coords.map(([lat, lon]) => local(lat, lon));
  for (let i = 0; i < pts.length - 1; i++) {
    const z = (r.elev?.[i] ?? 0) + (r.elev?.[i + 1] ?? 0);
    segs.push({ a: pts[i], b: pts[i + 1], w: r.width, kind: r.kind, below: z < -1 && r.tunnel });
  }
}
const CELL = 60;
const grid = new Map();
for (const s of segs) {
  const pad = s.w / 2 + 20;
  for (let cx = Math.floor((Math.min(s.a[0], s.b[0]) - pad) / CELL); cx <= Math.floor((Math.max(s.a[0], s.b[0]) + pad) / CELL); cx++)
    for (let cy = Math.floor((Math.min(s.a[1], s.b[1]) - pad) / CELL); cy <= Math.floor((Math.max(s.a[1], s.b[1]) + pad) / CELL); cy++) {
      const k = `${cx},${cy}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(s);
    }
}
const near = (x, y) => grid.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? [];
function project(p, s) {
  const dx = s.b[0] - s.a[0];
  const dy = s.b[1] - s.a[1];
  const l2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy) / l2));
  const q = [s.a[0] + t * dx, s.a[1] + t * dy];
  return { q, d: Math.hypot(p[0] - q[0], p[1] - q[1]) };
}

// ------------------------------------------------------------------ footprints

function area(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function simplify(p) {
  // drop near-duplicate and nearly collinear points
  let out = p.filter((q, i) => i === 0 || Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) > 0.3);
  if (out.length > 3 && Math.hypot(out[0][0] - out.at(-1)[0], out[0][1] - out.at(-1)[1]) < 0.3) out.pop();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[(i - 1 + out.length) % out.length];
      const b = out[i];
      const c = out[(i + 1) % out.length];
      const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      if (Math.abs(cross) / len < 0.25) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

const STYLE = { stone: 0, commercial: 1, house: 2, tower: 3, old: 4, concrete: 5, grid: 6 };
const TINTS = {
  stone: [0xefe6d4, 0xe8dcc4, 0xf2ece0, 0xe3d6bd, 0xd9cdb6],
  commercial: [0xd8d6d0, 0xc9ccd0, 0xe6e0d4, 0xbfc4c9, 0xd4c7b0],
  house: [0xe9dfca, 0xf0e9d8, 0xe2d2b5, 0xd8c7a6, 0xf3efe6, 0xe6d5c3, 0xcfd6d2],
  tower: [0xffffff, 0xf2f4f6, 0xe6ecef],
  old: [0xcfae7d, 0xc49d6b, 0xd6b98c, 0xb88f5e],
  concrete: [0xcfccc5, 0xbdb9b1, 0xd9d4ca],
  grid: [0xc8c4bc, 0xbdb9b2],
};
const PUBLIC = /^(school|university|college|hospital|public|government|civic|mosque|church|train_station|stadium|kindergarten)$/;

const buildings = [];
const trees = [];
const parks = [];
let dropped = 0;

for (const e of raw) {
  const t = e.tags ?? {};
  if (e.type === 'node' && t.natural === 'tree') {
    if (!inBounds(e)) continue;
    const q = local(e.lat, e.lon);
    // never a tree in the road
    if (near(q[0], q[1]).some((sg) => !sg.below && project(q, sg).d < sg.w / 2 + 0.8)) continue;
    trees.push(...q.map((v) => +v.toFixed(1)));
    continue;
  }
  const geom = e.geometry ?? e.members?.find((m) => m.role === 'outer')?.geometry;
  if (!geom || geom.length < 4 || !geom.some(inBounds)) continue;
  let p = geom.map((g) => local(g.lat, g.lon));
  if (t.leisure || (t.landuse && t.landuse === 'grass')) {
    if (t.leisure === 'park' || t.leisure === 'garden' || t.landuse === 'grass') parks.push(simplify(p).flat().map((v) => +v.toFixed(1)));
    continue;
  }
  if (!t.building || t.building === 'roof' || t.building === 'construction' || t.location === 'underground') continue;
  p = simplify(p);
  if (p.length < 3) continue;
  let a = area(p);
  if (a < 0) {
    p.reverse();
    a = -a;
  }
  if (a < 12) continue;
  const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
  const cy = p.reduce((s, q) => s + q[1], 0) / p.length;

  // a footprint that reaches into a carriageway is dropped (the road geometry is the reference)
  let overlaps = false;
  for (const q of [...p, [cx, cy]]) {
    for (const s of near(q[0], q[1])) {
      if (s.below) continue;
      if (project(q, s).d < s.w / 2 - 0.5) overlaps = true;
    }
    if (overlaps) break;
  }
  if (overlaps) {
    dropped++;
    continue;
  }

  const kind = t.building;
  const levelsTag = parseFloat(t['building:levels']);
  const heightTag = parseFloat(t.height);
  const key = `${e.type}${e.id}`;
  const r = hash(key);
  const dCitadel = Math.hypot(cx - citadel[0], cy - citadel[1]);
  let distMain = Infinity;
  for (const s of near(cx, cy)) if (s.kind !== 'local') distMain = Math.min(distMain, project([cx, cy], s).d - s.w / 2);

  let style;
  const name = `${t.name ?? ''} ${t['name:en'] ?? ''}`;
  // known complexes: Empire World's residential wings are stone-clad blocks, its business towers glass
  // Empire World (reference photo): the four curved business towers around the main one are deep
  // concrete grids; the main tower (Empire Business Tower 1) is drawn as its own model (landmarks.ts)
  const empireMain = /Empire Business Tower 1\b/.test(name);
  if (/Empire Residential|Wings/i.test(name)) style = 'stone';
  else if (/Empire Business Tower [2-5]\b/.test(name)) style = 'grid';
  else if (/ئیمپایەر|Empire.*(Business|Tower)/i.test(name)) style = 'tower';
  else if (PUBLIC.test(kind) || PUBLIC.test(t.amenity ?? '')) style = 'concrete';
  else if (dCitadel < 520 && !(levelsTag >= 5)) style = 'old';
  else if (levelsTag >= 12 || heightTag >= 40) style = 'tower';
  else if (/^(commercial|retail|office|hotel|mall|supermarket)$/.test(kind)) style = levelsTag >= 10 ? 'tower' : 'commercial';
  else if (/^(apartments|residential)$/.test(kind) && (levelsTag >= 4 || a > 500)) style = 'stone';
  else if (/^(house|detached|semidetached_house|terrace|bungalow)$/.test(kind)) style = 'house';
  else if (a > 900) style = distMain < 25 ? 'commercial' : 'stone';
  else if (a > 350 && distMain < 25) style = r < 0.6 ? 'commercial' : 'stone';
  else style = 'house';

  let levels = levelsTag;
  if (!(levels > 0)) {
    if (heightTag > 0) levels = Math.max(1, Math.round(heightTag / 3.3));
    else
      levels = {
        old: 1 + Math.floor(r * 2),
        house: distMain < 25 ? 2 + Math.floor(r * 2) : 1 + Math.floor(r * 2.4),
        stone: 4 + Math.floor(r * 4),
        commercial: 3 + Math.floor(r * 3) + (distMain < 15 ? 1 : 0),
        tower: 14 + Math.floor(r * 10),
        concrete: 2 + Math.floor(r * 2),
      }[style];
  }
  let fh = style === 'tower' ? 3.6 : style === 'house' || style === 'old' ? 3.1 : 3.3;
  if (style === 'grid' && heightTag > 0 && levelsTag > 0) fh = +Math.min(4.4, heightTag / levelsTag).toFixed(2);

  // shop fronts on walls that face a main street close by (not on houses set back in quiet streets)
  const shop = [];
  if ((style !== 'tower' || levels < 30) && style !== 'grid') {
    for (let i = 0; i < p.length; i++) {
      const A = p[i];
      const B = p[(i + 1) % p.length];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (len < 4.5) continue;
      const nx = (B[1] - A[1]) / len;
      const ny = -(B[0] - A[0]) / len;
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      for (const s of near(mid[0], mid[1])) {
        if (s.below) continue;
        const { q, d } = project(mid, s);
        const gap = d - s.w / 2;
        if (gap < 0 || gap > (s.kind === 'local' ? 9 : 16)) continue;
        const facing = ((q[0] - mid[0]) * nx + (q[1] - mid[1]) * ny) / (d || 1);
        if (facing < 0.75) continue;
        if (style === 'house' && s.kind === 'local' && r > 0.35) continue;
        if (style === 'old' && r > 0.6) continue;
        shop.push(i);
        break;
      }
    }
  }
  const h = (shop.length ? 4.4 + (levels - 1) * fh : levels * fh) + (style === 'tower' ? 0 : 0);
  const height = heightTag > 0 ? Math.max(heightTag, 3) : h;
  const tints = TINTS[style];
  const rec = {
    p: p.flat().map((v) => +v.toFixed(1)),
    h: +height.toFixed(1),
    fh,
    s: STYLE[style],
    c: tints[Math.floor(hash(key + 'c') * tints.length)],
  };
  if (shop.length) rec.shop = shop;
  if (t.name) rec.n = t['name:ar'] || t.name;
  if (empireMain) rec.lm = 'empire-main';
  buildings.push(rec);
}

mkdirSync(new URL('web/public/data/', root), { recursive: true });
writeFileSync(new URL('web/public/data/buildings.json', root), JSON.stringify({ v: 1, buildings, trees, parks }));
const count = (s) => buildings.filter((b) => b.s === s).length;
console.log(
  `buildings ${buildings.length} (dropped ${dropped} over roads): stone ${count(0)}, commercial ${count(1)}, house ${count(2)}, tower ${count(3)}, old ${count(4)}, public ${count(5)}; with shops ${buildings.filter((b) => b.shop).length}; trees ${trees.length / 2}; parks ${parks.length}`,
);
