// Real places of central Erbil: the citadel mound, the three Zanyari towers and Samad restaurant
// (positions from OpenStreetMap), plus shop signs with the names of real businesses
// (OpenStreetMap shops, restaurants and offices) on the procedural buildings nearest to them.

import * as THREE from 'three';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { nearestOnNetwork, type RoadGraph } from '../../../shared/roads';
import type { DistrictData } from '../../../shared/types';
import type { Box } from './collision';
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

/** Ground kept free of generated buildings around the landmarks. */
export function landmarkFootprints(district: DistrictData, graph: RoadGraph): Box[] {
  const out: Box[] = [];
  for (const s of spots(district, graph)) {
    if (s.kind === 'citadel') out.push({ cx: s.p.x, cy: s.p.y, ux: 1, uy: 0, hw: CITADEL_R + 15, hd: CITADEL_R + 15 });
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
export function buildSigns(district: DistrictData, graph: RoadGraph, buildings: GenericBuilding[], quality: Quality): THREE.Object3D | null {
  const max = SIGN_COUNT[quality];
  const pois = district.pois ?? [];
  if (!max || !pois.length || !buildings.length) return null;
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
  const grid = new Map<string, GenericBuilding[]>();
  for (const b of buildings) {
    if (b.kind === 2) continue;
    const k = `${Math.floor(b.box.cx / cell)},${Math.floor(b.box.cy / cell)}`;
    (grid.get(k) ?? grid.set(k, []).get(k)!).push(b);
  }
  const used = new Set<GenericBuilding>();
  const picks: { b: GenericBuilding; name: string; sub: string; style: number }[] = [];
  for (const poi of sorted) {
    if (picks.length >= max) break;
    const p = toLocal({ lat: poi.lat, lng: poi.lng }, district.origin);
    let best: GenericBuilding | null = null;
    let bestD = 45;
    const cx = Math.floor(p.x / cell);
    const cy = Math.floor(p.y / cell);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const b of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (used.has(b)) continue;
          const d = Math.hypot(b.box.cx - p.x, b.box.cy - p.y);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
    if (!best) continue;
    used.add(best);
    const name = poi.name_ar || poi.name_en;
    const sub = poi.name_ar && poi.name_en && poi.name_en !== poi.name_ar ? poi.name_en : '';
    picks.push({ b: best, name, sub, style: Math.abs(hash(name)) % BOARDS.length });
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
      // street side of the building: whichever face points most towards the nearest road
      const b = s.b.box;
      const near = nearestOnNetwork(graph, { x: b.cx, y: b.cy });
      if (!near) return;
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
      const w = Math.min(faceW * 0.85, 9);
      const h = Math.min(1.6, w / 4.2);
      const c = { x: b.cx + fx * (half + 0.32), y: b.cy + fy * (half + 0.32) };
      const u0 = col * 0.25;
      const v1 = 1 - row / 16;
      quad(pos, uv, c, fx, fy, 4.35, w, h, u0 + 4 / 2048, v1 - 124 / 2048, u0 + 508 / 2048, v1 - 4 / 2048);
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
    // a broad earth mound with brick walls round the top, as the citadel stands over the city
    const tex = groundTexture('#b89f74', 5);
    tex.repeat.set(6, 2);
    const mound = new THREE.Mesh(new THREE.CylinderGeometry(CITADEL_R - 15, CITADEL_R + 10, 26, 48, 1), new THREE.MeshLambertMaterial({ map: tex }));
    mound.position.set(s.p.x, 13, -s.p.y);
    const wallTex = groundTexture('#c7a77a', 2);
    wallTex.repeat.set(40, 1);
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(CITADEL_R - 14, CITADEL_R - 12, 11, 64, 1, true), new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide }));
    wall.position.set(s.p.x, 26 + 5.5, -s.p.y);
    const top = new THREE.Mesh(new THREE.CircleGeometry(CITADEL_R - 15, 48), new THREE.MeshLambertMaterial({ color: '#a89068' }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(s.p.x, 26.05, -s.p.y);
    // towers along the wall
    const towerGeo = new THREE.CylinderGeometry(4.5, 5.2, 14, 12);
    const towers = new THREE.InstancedMesh(towerGeo, new THREE.MeshLambertMaterial({ color: '#c09c6c' }), 18);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      m.makeTranslation(s.p.x + Math.cos(a) * (CITADEL_R - 13), 26 + 7, -(s.p.y + Math.sin(a) * (CITADEL_R - 13)));
      towers.setMatrixAt(i, m);
    }
    group.add(mound, wall, top, towers);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const r = CITADEL_R + 6;
      boxes.push({ cx: s.p.x + Math.cos(a) * r, cy: s.p.y + Math.sin(a) * r, ux: -Math.sin(a), uy: Math.cos(a), hw: (Math.PI * r) / 24 + 2, hd: 6 });
    }
  }

  const towers = all.filter((x) => x.kind === 'tower');
  if (towers.length) {
    const mat = facadeMaterial('glass', 3, 3.6);
    const mesh = new THREE.InstancedMesh(shadedBox(), mat, towers.length);
    const m = new THREE.Matrix4();
    towers.forEach((t, i) => {
      const yaw = Math.atan2(-t.front.x, t.front.y);
      const h = 68 + i * 6;
      m.compose(new THREE.Vector3(t.p.x, 0, -t.p.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(24, h, 24));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(i % 2 ? '#e8e2d6' : '#f1ece2'));
      boxes.push({ cx: t.p.x, cy: t.p.y, ux: Math.cos(yaw), uy: Math.sin(yaw), hw: 12, hd: 12 });
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
      board.position.set(t.p.x + t.front.x * 12.2, h - 4, -(t.p.y + t.front.y * 12.2));
      board.lookAt(t.p.x + t.front.x * 40, h - 4, -(t.p.y + t.front.y * 40));
      group.add(board);
    });
    mesh.castShadow = quality !== 'low';
    mesh.receiveShadow = true;
    group.add(mesh);
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
