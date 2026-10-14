// Real places of central Erbil: the citadel mound, the three Zanyari towers and Samad restaurant
// (positions from OpenStreetMap), plus shop signs with the names of real businesses
// (OpenStreetMap shops, restaurants and offices) on the procedural buildings nearest to them.

import * as THREE from 'three';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { nearestOnNetwork, type RoadGraph } from '../../../shared/roads';
import type { DistrictData } from '../../../shared/types';
import type { Box } from './collision';
import { buildingData, type BuildingRecord } from './buildings';
import { facadeMaterial as cityFacade } from './facade';
import { groundTexture } from './textures';
import { facadeMaterial, shadedBox, type GenericBuilding, type Quality } from './world';

export const SIGN_COUNT: Record<Quality, number> = { low: 0, medium: 64, high: 128 };

const CITADEL_R = 165;

interface Spot {
  kind: string;
  p: LocalPoint;
  /** unit vector from the place to its street */
  front: { x: number; y: number };
}

function spots(district: DistrictData, graph: RoadGraph): Spot[] {
  return district.landmarks
    .filter((l) => ['citadel', 'restaurant', 'tower'].includes(l.kind))
    .map((l) => {
      let p = toLocal({ lat: l.lat, lng: l.lng }, district.origin);
      const near = nearestOnNetwork(graph, p);
      let fx = 0;
      let fy = 1;
      if (near && near.distance > 0.5) {
        fx = (near.point.x - p.x) / near.distance;
        fy = (near.point.y - p.y) / near.distance;
        // a restaurant fronts its street: move it up to the pavement (the map point is often inside the block)
        if (l.kind === 'restaurant') {
          const back = near.segment.width / 2 + 4.5 + 2 + 9;
          p = { x: near.point.x - fx * back, y: near.point.y - fy * back };
        }
      }
      return { kind: l.kind, p, front: { x: fx, y: fy } };
    });
}

/** The tallest OpenStreetMap building within `r` of a point: centre, roof height and rough radius. */
function nearestTall(list: BuildingRecord[], p: LocalPoint, r: number) {
  let best: { c: LocalPoint; h: number; r: number; d: number } | null = null;
  for (const b of list) {
    if (b.h < 25) continue;
    const n = b.p.length / 2;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += b.p[i * 2]!;
      cy += b.p[i * 2 + 1]!;
    }
    cx /= n;
    cy /= n;
    const d = Math.hypot(cx - p.x, cy - p.y);
    if (d > r || (best && d >= best.d)) continue;
    let rad = 0;
    for (let i = 0; i < n; i++) rad = Math.max(rad, Math.hypot(b.p[i * 2]! - cx, b.p[i * 2 + 1]! - cy));
    best = { c: { x: cx, y: cy }, h: b.h, r: rad * 0.75, d };
  }
  return best;
}

/** Ground kept free of generated buildings around the landmarks (real towers are drawn with the city). */
export function landmarkFootprints(district: DistrictData, graph: RoadGraph): Box[] {
  const out: Box[] = [];
  const real = !!buildingData();
  for (const s of spots(district, graph)) {
    if (real && s.kind === 'tower') continue;
    if (s.kind === 'citadel') out.push({ cx: s.p.x, cy: s.p.y, ux: 1, uy: 0, hw: CITADEL_R * 1.12 * 1.12 + 4, hd: CITADEL_R * 0.88 * 1.12 + 4 });
    else if (s.kind === 'tower') out.push({ cx: s.p.x, cy: s.p.y, ux: s.front.y, uy: -s.front.x, hw: 16, hd: 16 });
    else out.push({ cx: s.p.x, cy: s.p.y, ux: s.front.y, uy: -s.front.x, hw: 13, hd: 11 });
  }
  return out;
}

/** Draw a sign panel into a canvas cell: coloured board, white (or dark) lettering fitted to the width. */
function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, text: string, sub: string, bg: string, fg: string) {
  ctx.fillStyle = bg;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x, y, w, h * 0.12);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(x, y + h - 6, w, 6);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  let size = h * (sub ? 0.5 : 0.62);
  ctx.font = `700 ${size}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
  while (ctx.measureText(text).width > w * 0.9 && size > 14) {
    size -= 2;
    ctx.font = `700 ${size}px "IBM Plex Sans Arabic", system-ui, sans-serif`;
  }
  ctx.fillText(text, x + w / 2, y + h * (sub ? 0.4 : 0.52));
  if (sub) {
    ctx.direction = 'ltr';
    let s2 = h * 0.22;
    ctx.font = `600 ${s2}px system-ui, sans-serif`;
    while (ctx.measureText(sub).width > w * 0.9 && s2 > 10) {
      s2 -= 1;
      ctx.font = `600 ${s2}px system-ui, sans-serif`;
    }
    ctx.fillText(sub, x + w / 2, y + h * 0.78);
  }
}

const BOARDS: [string, string][] = [
  ['#b3261e', '#ffffff'],
  ['#1f5f3a', '#ffffff'],
  ['#1d4f8a', '#ffffff'],
  ['#f2efe8', '#1d1f23'],
  ['#e38b1d', '#1d1f23'],
  ['#3a2a6b', '#ffffff'],
  ['#14161a', '#f2c14e'],
  ['#c9302c', '#fff6d8'],
];

/** A quad facing direction (fx, fy) in the local plane, as non-indexed position + uv arrays. */
function quad(pos: number[], uv: number[], c: LocalPoint, fx: number, fy: number, y0: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number) {
  // right-hand vector seen from the front
  const rx = fy;
  const ry = -fx;
  const corners = [
    [c.x - rx * (w / 2), c.y - ry * (w / 2), y0, u0, v0],
    [c.x + rx * (w / 2), c.y + ry * (w / 2), y0, u1, v0],
    [c.x + rx * (w / 2), c.y + ry * (w / 2), y0 + h, u1, v1],
    [c.x - rx * (w / 2), c.y - ry * (w / 2), y0 + h, u0, v1],
  ] as const;
  for (const k of [0, 1, 2, 0, 2, 3]) {
    const p = corners[k]!;
    pos.push(p[0], p[2], -p[1]);
    uv.push(p[3], p[4]);
  }
}

/**
 * Shop signs with real business names. Each sign goes on the street side of the generated building
 * nearest to the business (at most one per building), above the shop floor.
 */
/** A street-facing wall a shop sign can hang on: its centre, outward normal and width. */
export interface SignFace {
  x: number;
  y: number;
  nx: number;
  ny: number;
  w: number;
  /** bottom of the board and the tallest board that fits the sign band */
  z: number;
  hMax: number;
}

/** The street side of a generic box building: whichever face points most towards the nearest road. */
export function boxFaces(graph: RoadGraph, buildings: GenericBuilding[]): SignFace[] {
  const out: SignFace[] = [];
  for (const gb of buildings) {
    if (gb.kind === 2) continue;
    const b = gb.box;
    const near = nearestOnNetwork(graph, { x: b.cx, y: b.cy });
    if (!near) continue;
    const tx = near.point.x - b.cx;
    const ty = near.point.y - b.cy;
    const vx = -b.uy;
    const vy = b.ux;
    const alongU = tx * b.ux + ty * b.uy;
    const alongV = tx * vx + ty * vy;
    let fx: number, fy: number, half: number, faceW: number;
    if (Math.abs(alongV) >= Math.abs(alongU)) {
      const sg = Math.sign(alongV) || 1;
      fx = vx * sg;
      fy = vy * sg;
      half = b.hd;
      faceW = b.hw * 2;
    } else {
      const sg = Math.sign(alongU) || 1;
      fx = b.ux * sg;
      fy = b.uy * sg;
      half = b.hw;
      faceW = b.hd * 2;
    }
    out.push({ x: b.cx + fx * half, y: b.cy + fy * half, nx: fx, ny: fy, w: faceW, z: 4.35, hMax: 1.6 });
  }
  return out;
}

export function buildSigns(district: DistrictData, faces: SignFace[], quality: Quality): THREE.Object3D | null {
  const max = SIGN_COUNT[quality];
  const pois = district.pois ?? [];
  if (!max || !pois.length || !faces.length) return null;
  // spread over the whole map (round robin over 300 m squares), food and shops first in each square
  const rank = (k: string) => (/restaurant|fast_food|cafe|bakery|confectionery/.test(k) ? 0 : k.startsWith('shop') ? 1 : 2);
  const squares = new Map<string, typeof pois>();
  for (const poi of [...pois].sort((a, b) => rank(a.kind) - rank(b.kind))) {
    const q = toLocal({ lat: poi.lat, lng: poi.lng }, district.origin);
    const k = `${Math.floor(q.x / 300)},${Math.floor(q.y / 300)}`;
    (squares.get(k) ?? squares.set(k, []).get(k)!).push(poi);
  }
  const sorted: typeof pois = [];
  for (let round = 0; sorted.length < pois.length && round < 50; round++) for (const list of squares.values()) if (list[round]) sorted.push(list[round]!);
  const cell = 120;
  const grid = new Map<string, SignFace[]>();
  for (const f of faces) {
    if (f.w < 4) continue;
    const k = `${Math.floor(f.x / cell)},${Math.floor(f.y / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(f);
  }
  const used = new Set<SignFace>();
  const picks: { f: SignFace; name: string; sub: string; style: number }[] = [];
  for (const poi of sorted) {
    if (picks.length >= max) break;
    const p = toLocal({ lat: poi.lat, lng: poi.lng }, district.origin);
    let best: SignFace | null = null;
    let bestD = 45;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const f of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (used.has(f)) continue;
          const d = Math.hypot(f.x - p.x, f.y - p.y);
          if (d < bestD) {
            bestD = d;
            best = f;
          }
        }
    if (!best) continue;
    used.add(best);
    const name = poi.name_ar || poi.name_en;
    const sub = poi.name_ar && poi.name_en && poi.name_en !== poi.name_ar ? poi.name_en : '';
    picks.push({ f: best, name, sub, style: Math.abs(hash(name)) % BOARDS.length });
  }
  if (!picks.length) return null;

  // texture atlases of 4 x 16 signs (512 x 128 px each)
  const group = new THREE.Group();
  group.name = 'signs';
  const PER = 64;
  for (let start = 0; start < picks.length; start += PER) {
    const batch = picks.slice(start, start + PER);
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const pos: number[] = [];
    const uv: number[] = [];
    batch.forEach((s, i) => {
      const col = i % 4;
      const row = Math.floor(i / 4);
      const [bg, fg] = BOARDS[s.style]!;
      drawSign(ctx, col * 512 + 4, row * 128 + 4, 504, 120, s.name, s.sub, bg, fg);
      const f = s.f;
      const w = Math.min(f.w * 0.85, 9);
      const h = Math.min(f.hMax, w / 4.2);
      const c = { x: f.x + f.nx * 0.32, y: f.y + f.ny * 0.32 };
      const u0 = col * 0.25;
      const v1 = 1 - row / 16;
      quad(pos, uv, c, f.nx, f.ny, f.z, w, h, u0 + 4 / 2048, v1 - 124 / 2048, u0 + 508 / 2048, v1 - 4 / 2048);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.18 }));
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function labelTexture(lines: { text: string; size: number; font: string }[], bg: string, fg: string, w = 1024, h = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const total = lines.reduce((s, l) => s + l.size * 1.15, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    ctx.font = l.font.replace('$', String(l.size));
    ctx.direction = /[؀-ۿ]/.test(l.text) ? 'rtl' : 'ltr';
    ctx.fillText(l.text, w / 2, y + (l.size * 1.15) / 2);
    y += l.size * 1.15;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** The citadel mound with its walls, the Zanyari towers and Samad restaurant. Returns the group and collision boxes. */
export function buildLandmarks(district: DistrictData, graph: RoadGraph, quality: Quality): { group: THREE.Group; boxes: Box[] } {
  const group = new THREE.Group();
  group.name = 'landmarks';
  const boxes: Box[] = [];
  const all = spots(district, graph);
  const arabic = '"IBM Plex Sans Arabic", system-ui, sans-serif';

  for (const s of all.filter((x) => x.kind === 'citadel')) {
    group.add(buildCitadel(s.p, quality, boxes));
  }

  const towers = all.filter((x) => x.kind === 'tower');
  const real = buildingData();
  if (towers.length) {
    const mat = facadeMaterial('glass', 3, 3.6);
    const mesh = real ? null : new THREE.InstancedMesh(shadedBox(), mat, towers.length);
    const m = new THREE.Matrix4();
    towers.forEach((t, i) => {
      const yaw = Math.atan2(-t.front.x, t.front.y);
      let h = 68 + i * 6;
      let c = t.p;
      let half = 12;
      if (real) {
        // the real tower from OpenStreetMap is drawn with the city: only put its name on the roof
        const rec = nearestTall(real.buildings, t.p, 45);
        if (!rec) return;
        h = rec.h;
        c = rec.c;
        half = rec.r;
      } else if (mesh) {
        m.compose(new THREE.Vector3(t.p.x, 0, -t.p.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(24, h, 24));
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, new THREE.Color(i % 2 ? '#e8e2d6' : '#f1ece2'));
        boxes.push({ cx: t.p.x, cy: t.p.y, ux: Math.cos(yaw), uy: Math.sin(yaw), hw: 12, hd: 12 });
      }
      // rooftop name board facing the street
      const tex = labelTexture(
        [
          { text: 'زانياري', size: 120, font: `700 $px ${arabic}` },
          { text: 'ZANYARI', size: 52, font: '700 $px system-ui, sans-serif' },
        ],
        'rgba(0,0,0,0)',
        '#ffffff',
      );
      const board = new THREE.Mesh(new THREE.PlaneGeometry(22, 5.5), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }));
      board.position.set(c.x + t.front.x * (half + 0.2), h + (real ? 3.2 : -4), -(c.y + t.front.y * (half + 0.2)));
      board.lookAt(c.x + t.front.x * 40, h + (real ? 3.2 : -4), -(c.y + t.front.y * 40));
      group.add(board);
    });
    if (mesh) {
      mesh.castShadow = quality !== 'low';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  for (const s of all.filter((x) => x.kind === 'restaurant')) {
    // Samad: a two-storey restaurant with a big red name board over the entrance
    const yaw = Math.atan2(s.front.x, -s.front.y);
    const body = new THREE.Mesh(new THREE.BoxGeometry(22, 9, 18), new THREE.MeshLambertMaterial({ color: '#e9e1d2' }));
    body.position.set(s.p.x, 4.5, -s.p.y);
    body.rotation.y = yaw;
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(18, 3.4), new THREE.MeshStandardMaterial({ color: '#2a3138', roughness: 0.1, metalness: 0.5 }));
    const fx = s.front.x;
    const fy = s.front.y;
    glass.position.set(s.p.x + fx * 9.02, 1.9, -(s.p.y + fy * 9.02));
    glass.lookAt(s.p.x + fx * 30, 1.9, -(s.p.y + fy * 30));
    const tex = labelTexture(
      [
        { text: 'مطعم صمد', size: 110, font: `700 $px ${arabic}` },
        { text: 'SAMAD RESTAURANT', size: 44, font: '700 $px system-ui, sans-serif' },
      ],
      '#b3261e',
      '#ffffff',
    );
    const board = new THREE.Mesh(new THREE.PlaneGeometry(16, 4), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.25 }));
    board.position.set(s.p.x + fx * 9.1, 6, -(s.p.y + fy * 9.1));
    board.lookAt(s.p.x + fx * 30, 6, -(s.p.y + fy * 30));
    group.add(body, glass, board);
    boxes.push({ cx: s.p.x, cy: s.p.y, ux: Math.cos(yaw), uy: Math.sin(yaw), hw: 11, hd: 9 });
  }
  return { group, boxes };
}

/**
 * Erbil Citadel, approximately: an oval mound about 26 m high with steep earth slopes, its rim lined
 * with the backs of old brick houses (a continuous wall of different heights with small windows),
 * half-round buttresses, and the main gate on the south side with the ramp up to it. Proportions
 * follow the real citadel (about 430 x 340 m); the houses are generic, not a survey.
 */
function buildCitadel(c: LocalPoint, quality: Quality, boxes: Box[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'citadel';
  const A = CITADEL_R * 1.12;
  const B = CITADEL_R * 0.88;
  const TOP = 26;
  const at = (t: number, k: number) => ({ x: c.x + Math.cos(t) * A * k, y: c.y + Math.sin(t) * B * k });
  // mound: rings from the foot to the rim, the slope steepening towards the top, a little uneven
  const rings = [1.12, 1.06, 1.0, 0.95, 0.93];
  const heights = [0, 6, 16, 24.5, TOP];
  const N = 96;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  rings.forEach((k, r) => {
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * Math.PI * 2;
      const wob = r > 0 && r < rings.length - 1 ? 1 + 0.012 * Math.sin(t * 7 + r) + 0.008 * Math.sin(t * 19) : 1;
      const p = at(t, k * wob);
      pos.push(p.x, heights[r]!, -p.y);
      uv.push((i / N) * 40, heights[r]! / 6);
    }
  });
  for (let r = 0; r < rings.length - 1; r++)
    for (let i = 0; i < N; i++) {
      const a0 = r * (N + 1) + i;
      const b0 = a0 + N + 1;
      idx.push(a0, a0 + 1, b0, b0, a0 + 1, b0 + 1);
    }
  const moundGeo = new THREE.BufferGeometry();
  moundGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  moundGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  moundGeo.setIndex(idx);
  moundGeo.computeVertexNormals();
  const earth = groundTexture('#b39a70', 5);
  earth.wrapS = earth.wrapT = THREE.RepeatWrapping;
  const mound = new THREE.Mesh(moundGeo, new THREE.MeshLambertMaterial({ map: earth, side: THREE.DoubleSide }));
  mound.receiveShadow = true;
  const top = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshLambertMaterial({ color: '#a89270' }));
  top.scale.set(A * 0.93, B * 0.93, 1);
  top.rotation.x = -Math.PI / 2;
  top.position.set(c.x, TOP + 0.02, -c.y);
  g.add(mound, top);

  // rim: segments of old house walls, each its own height, set slightly in and out
  const wpos: number[] = [];
  const wnor: number[] = [];
  const wuv: number[] = [];
  const style: number[] = [];
  const tint: number[] = [];
  const roof: number[] = [];
  const brick = [new THREE.Color('#c49a68'), new THREE.Color('#b98d5c'), new THREE.Color('#cfa877'), new THREE.Color('#ad8456')];
  const SEG = 72;
  let u = 0;
  const gateAt = Math.PI * 1.5; // south
  for (let i = 0; i < SEG; i++) {
    const t0 = (i / SEG) * Math.PI * 2;
    const t1 = ((i + 1) / SEG) * Math.PI * 2;
    const k = 0.93 + 0.006 * Math.sin(i * 2.3);
    const p0 = at(t0, k);
    const p1 = at(t1, k);
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const nearGate = Math.abs(Math.atan2(Math.sin(t0 - gateAt), Math.cos(t0 - gateAt))) < 0.06;
    const h = nearGate ? 20 : 9 + ((i * 37) % 7) + (i % 5 === 0 ? 3 : 0);
    // outward normal of the ring
    const mx = (p0.x + p1.x) / 2 - c.x;
    const my = (p0.y + p1.y) / 2 - c.y;
    const ml = Math.hypot(mx, my) || 1;
    const nx = mx / ml;
    const ny = my / ml;
    const col = brick[i % brick.length]!;
    const base = TOP - 2.5;
    const verts = [
      [p0.x, base, p0.y, u, 0],
      [p1.x, base, p1.y, u + len, 0],
      [p1.x, base + h, p1.y, u + len, h],
      [p0.x, base + h, p0.y, u, h],
    ];
    for (const k2 of [0, 2, 1, 0, 3, 2]) {
      const v = verts[k2]!;
      wpos.push(v[0]!, v[1]!, -v[2]!);
      wnor.push(nx, 0, -ny);
      wuv.push(v[3]!, v[4]!);
      style.push(4, (i % 13) / 13, 3.2, 0);
      tint.push(col.r, col.g, col.b);
      roof.push(h - 0.8);
    }
    u += len;
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(wnor, 3));
  wg.setAttribute('uv', new THREE.Float32BufferAttribute(wuv, 2));
  wg.setAttribute('aStyle', new THREE.Float32BufferAttribute(style, 4));
  wg.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 3));
  wg.setAttribute('aRoof', new THREE.Float32BufferAttribute(roof, 1));
  const rim = new THREE.Mesh(wg, cityFacade(quality === 'low' ? 'low' : quality === 'medium' ? 'medium' : 'high', 'plaster'));
  rim.castShadow = quality !== 'low';
  rim.receiveShadow = true;
  g.add(rim);

  // half-round buttresses against the slope, and the gate tower with its arch and ramp
  const butGeo = new THREE.CylinderGeometry(3.2, 4.6, 16, 14, 1, false, 0, Math.PI);
  const buts = new THREE.InstancedMesh(butGeo, new THREE.MeshLambertMaterial({ color: '#b48b5c' }), 24);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 24; i++) {
    const t = (i / 24) * Math.PI * 2 + 0.07;
    const p = at(t, 0.945);
    const ang = Math.atan2(Math.sin(t) * A, Math.cos(t) * B);
    m.compose(new THREE.Vector3(p.x, TOP - 6, -p.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang + Math.PI / 2), new THREE.Vector3(1, 1, 1));
    buts.setMatrixAt(i, m);
  }
  buts.castShadow = quality !== 'low';
  g.add(buts);
  const gp = at(gateAt, 0.95);
  const gate = new THREE.Mesh(new THREE.BoxGeometry(16, 22, 9), new THREE.MeshLambertMaterial({ color: '#c39a69' }));
  gate.position.set(gp.x, TOP - 2.5 + 11, -gp.y + 0.5);
  const arch = new THREE.Mesh(new THREE.CircleGeometry(3.6, 20, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#2a2018' }));
  arch.position.set(gp.x, TOP - 2.5 + 6, -(gp.y - 4.6));
  arch.rotation.y = Math.PI;
  const archLow = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 6), new THREE.MeshBasicMaterial({ color: '#2a2018' }));
  archLow.position.set(gp.x, TOP - 2.5 + 3, -(gp.y - 4.6));
  archLow.rotation.y = Math.PI;
  // ramp from the street up to the gate
  const rampLen = 70;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(12, 1, Math.hypot(rampLen, TOP)), new THREE.MeshLambertMaterial({ color: '#b7ab97' }));
  ramp.position.set(gp.x, TOP / 2 - 0.5, -(gp.y - 4.5 - rampLen / 2));
  ramp.rotation.x = -Math.atan2(TOP, rampLen);
  g.add(gate, arch, archLow, ramp);

  // collision: a ring of walls at the foot of the mound
  for (let i = 0; i < 32; i++) {
    const t0 = (i / 32) * Math.PI * 2;
    const t1 = ((i + 1) / 32) * Math.PI * 2;
    const p0 = at(t0, 1.1);
    const p1 = at(t1, 1.1);
    const len = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    boxes.push({ cx: (p0.x + p1.x) / 2, cy: (p0.y + p1.y) / 2, ux: (p1.x - p0.x) / len, uy: (p1.y - p0.y) / len, hw: len / 2 + 1, hd: 3 });
  }
  return g;
}
