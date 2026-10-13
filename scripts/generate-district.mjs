// Generates shared/data/district.json: the schematic Sixty Meter Street district.
//
// The development environment used to build this demo could not reach
// OpenStreetMap, so this file draws the district from Erbil's well-known
// ring-and-radial layout instead: the 40 m and 60 m ring roads are arcs centred
// on the Citadel, crossed by Mosul Road and local streets. It is a believable,
// playable approximation, not a survey. `npm run osm:fetch` replaces it with
// real OpenStreetMap geometry in the same format when network access allows.
//
// Usage: node scripts/generate-district.mjs

import { writeFileSync } from 'node:fs';

const CITADEL = { lat: 36.19115, lng: 44.00915 };
const DEG = Math.PI / 180;
const mLat = (lat) => {
  const p = lat * DEG;
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
};
const mLng = (lat) => {
  const p = lat * DEG;
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
};

// Offsets in metres from the Citadel -> lat/lng (rounded to ~1 cm).
const fromCitadel = (east, north) => [
  +(CITADEL.lat + north / mLat(CITADEL.lat)).toFixed(7),
  +(CITADEL.lng + east / mLng(CITADEL.lat)).toFixed(7),
];
// Bearing in degrees clockwise from north.
const polar = (r, bearing) => fromCitadel(r * Math.sin(bearing * DEG), r * Math.cos(bearing * DEG));

const arc = (r, fromBearing, toBearing, step = 2) => {
  const pts = [];
  const n = Math.max(2, Math.ceil(Math.abs(toBearing - fromBearing) / step));
  for (let i = 0; i <= n; i++) pts.push(polar(r, fromBearing + ((toBearing - fromBearing) * i) / n));
  return pts;
};
const radial = (bearing, r0, r1) => [polar(r0, bearing), polar(r1, bearing)];

// District centre sits on the Sixty Meter ring, west-north-west of the Citadel.
const CENTRE_BEARING = 285;
const RING_60 = 2300;
const RING_40 = 1520;
const origin = polar(RING_60, CENTRE_BEARING);

const roads = [
  {
    id: 'sixty-meter',
    name_ar: 'شارع الستين متري',
    name_en: 'Sixty Meter Street',
    kind: 'arterial',
    width: 30,
    coords: arc(RING_60, 255, 318),
  },
  {
    id: 'forty-meter',
    name_ar: 'شارع الأربعين متري',
    name_en: 'Forty Meter Street',
    kind: 'primary',
    width: 20,
    coords: arc(RING_40, 262, 306),
  },
  {
    id: 'mosul-road',
    name_ar: 'طريق الموصل',
    name_en: 'Mosul Road',
    kind: 'primary',
    width: 22,
    coords: radial(271, RING_40 - 40, 3420),
  },
  {
    id: 'street-18',
    name_ar: 'شارع 18 (تخطيطي)',
    name_en: 'Street 18 (schematic)',
    kind: 'secondary',
    width: 14,
    coords: arc(1920, 258, 312),
  },
  {
    id: 'industrial-1',
    name_ar: 'الشارع الصناعي الأول',
    name_en: 'Industrial Street 1',
    kind: 'secondary',
    width: 16,
    coords: arc(2780, 256, 314),
  },
  {
    id: 'industrial-2',
    name_ar: 'الشارع الصناعي الثاني',
    name_en: 'Industrial Street 2',
    kind: 'local',
    width: 14,
    coords: arc(3240, 262, 300),
  },
  {
    id: 'market-street',
    name_ar: 'شارع السوق',
    name_en: 'Market Street',
    kind: 'secondary',
    width: 14,
    coords: radial(259, RING_40 - 30, 3000),
  },
  {
    id: 'park-street',
    name_ar: 'شارع الحديقة',
    name_en: 'Park Street',
    kind: 'secondary',
    width: 14,
    coords: radial(284, RING_40 - 30, 3300),
  },
  {
    id: 'office-avenue',
    name_ar: 'جادة المكاتب',
    name_en: 'Office Avenue',
    kind: 'secondary',
    width: 16,
    coords: radial(297, RING_40 - 30, 3280),
  },
  {
    id: 'north-link',
    name_ar: 'الطريق الشمالي',
    name_en: 'North Link',
    kind: 'local',
    width: 12,
    coords: radial(310, 1900, 2800),
  },
  {
    id: 'warehouse-lane',
    name_ar: 'زقاق المستودعات',
    name_en: 'Warehouse Lane',
    kind: 'local',
    width: 12,
    coords: radial(264, 2280, 3260),
  },
];

const zones = [
  { kind: 'commercial', name_en: 'Sixty Meter commercial strip', inner: RING_40 + 30, outer: RING_60 + 160, from: 256, to: 316 },
  { kind: 'industrial', name_en: 'Western industrial area', inner: RING_60 + 160, outer: 3400, from: 256, to: 316 },
].map((z) => ({
  kind: z.kind,
  name_en: z.name_en,
  polygon: [...arc(z.inner, z.from, z.to, 4), ...arc(z.outer, z.to, z.from, 4)],
}));

const landmarks = [
  { name_ar: 'شارع الستين متري', name_en: 'Sixty Meter Street', kind: 'street', at: polar(RING_60, 285) },
  { name_ar: 'تقاطع الستين مع طريق الموصل', name_en: 'Sixty Meter / Mosul Road junction', kind: 'junction', at: polar(RING_60, 271) },
  { name_ar: 'شارع الأربعين متري', name_en: 'Forty Meter Street', kind: 'street', at: polar(RING_40, 285) },
  { name_ar: 'طريق الموصل', name_en: 'Mosul Road', kind: 'street', at: polar(2600, 271) },
  { name_ar: 'المنطقة الصناعية الغربية', name_en: 'Western industrial area', kind: 'area', at: polar(3000, 280) },
  { name_ar: 'شارع السوق', name_en: 'Market Street', kind: 'street', at: polar(2000, 259) },
  { name_ar: 'جادة المكاتب', name_en: 'Office Avenue', kind: 'street', at: polar(2100, 297) },
].map((l) => ({ name_ar: l.name_ar, name_en: l.name_en, kind: l.kind, lat: l.at[0], lng: l.at[1] }));

// Bounds: every road point plus a margin.
const all = roads.flatMap((r) => r.coords);
const pad = 0.0012;
const bounds = {
  south: Math.min(...all.map((p) => p[0])) - pad,
  north: Math.max(...all.map((p) => p[0])) + pad,
  west: Math.min(...all.map((p) => p[1])) - pad,
  east: Math.max(...all.map((p) => p[1])) + pad,
};

const district = {
  id: 'erbil-sixty-meter',
  name_ar: 'منطقة شارع الستين — أربيل',
  name_en: 'Sixty Meter Street district — Erbil',
  source: 'schematic',
  sourceNote:
    "Schematic layout drawn from Erbil's ring-and-radial street pattern around the Citadel. Positions are approximate; run `npm run osm:fetch` to replace with OpenStreetMap geometry.",
  attribution: 'Street layout: schematic approximation. Basemap © OpenStreetMap contributors.',
  citadel: { lat: CITADEL.lat, lng: CITADEL.lng },
  origin: { lat: origin[0], lng: origin[1] },
  bounds,
  roads,
  zones,
  landmarks,
};

writeFileSync(new URL('../shared/data/district.json', import.meta.url), JSON.stringify(district, null, 1) + '\n');
console.log(`district.json: ${roads.length} roads, origin ${origin.join(', ')}`);
