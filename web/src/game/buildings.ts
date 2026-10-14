// Erbil's real buildings, from OpenStreetMap footprints (scripts/build-district.mjs writes
// /data/buildings.json): every footprint is extruded to its storey count or measured height, with a
// facade style chosen from what it is and where it stands (stone apartment blocks, commercial blocks
// with shops on the street side, houses, glass towers, the old town round the citadel, public
// buildings). Walls are drawn by the facade shader (facade.ts) in metres; roofs get parapets, water
// tanks, AC condensers and satellite dishes as on Erbil's flat roofs. Geometry is merged per 200 m square
// so the camera skips squares it cannot see. Every wall is also a collision wall.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Box } from './collision';
import { ChunkedInstances } from './chunked';
import { facadeMaterial } from './facade';
import { photoTexture } from './pbr';
import type { Quality } from './world';

export interface BuildingRecord {
  /** footprint, local metres, x y pairs, counter-clockwise */
  p: number[];
  /** roof height, metres */
  h: number;
  /** storey height */
  fh: number;
  /** facade style (facade.ts) */
  s: number;
  /** indices of walls that have shop fronts */
  shop?: number[];
  /** wall tint, 0xRRGGBB */
  c: number;
  /** name, when OpenStreetMap has one */
  n?: string;
}

export interface BuildingFile {
  v: 1;
  buildings: BuildingRecord[];
  trees: number[];
  parks: number[][];
}

let data: BuildingFile | null = null;

export async function loadBuildings(): Promise<void> {
  try {
    const r = await fetch('/data/buildings.json');
    if (r.ok) data = (await r.json()) as BuildingFile;
  } catch {
    data = null;
  }
}

export function buildingData() {
  return data;
}

const CELL = 200;

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  return x / 4294967296;
}

interface Batch {
  pos: number[];
  nor: number[];
  uv: number[];
  style: number[];
  tint: number[];
  roof: number[];
}
const newBatch = (): Batch => ({ pos: [], nor: [], uv: [], style: [], tint: [], roof: [] });

/** Build the city's buildings. Returns the scene group, collision walls and street-facing shop walls. */
export function buildCity(quality: Quality, reserved: Box[]) {
  const group = new THREE.Group();
  group.name = 'city';
  const walls: Box[] = [];
  const shopWalls: { x: number; y: number; nx: number; ny: number; len: number; ux: number; uy: number; b: number }[] = [];
  if (!data) return { group, walls, shopWalls };

  // walls batched per square and surface (stone-like or smooth plaster); roofs per square
  const wallBatches = new Map<string, { stone: Batch; plaster: Batch }>();
  const roofBatches = new Map<string, { pos: number[]; nor: number[]; uv: number[] }>();
  const tanks: THREE.Matrix4[] = [];
  const acs: THREE.Matrix4[] = [];
  const dishes: THREE.Matrix4[] = [];
  const awnings: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const tint = new THREE.Color();
  const blocked = (x: number, y: number) =>
    reserved.some((r) => {
      const dx = x - r.cx;
      const dy = y - r.cy;
      return Math.abs(dx * r.ux + dy * r.uy) < r.hw + 3 && Math.abs(-dx * r.uy + dy * r.ux) < r.hd + 3;
    });

  data.buildings.forEach((b, bi) => {
    const n = b.p.length / 2;
    if (n < 3) return;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < n; i++) {
      cx += b.p[i * 2]!;
      cy += b.p[i * 2 + 1]!;
    }
    cx /= n;
    cy /= n;
    // merchant plots and landmarks stay clear
    if (blocked(cx, cy)) return;
    const key = `${Math.floor(cx / CELL)},${Math.floor(cy / CELL)}`;
    let wb = wallBatches.get(key);
    if (!wb) wallBatches.set(key, (wb = { stone: newBatch(), plaster: newBatch() }));
    const batch = b.s === 2 || b.s === 5 ? wb.plaster : wb.stone;
    tint.setHex(b.c);
    const shops = new Set(b.shop ?? []);
    const parapet = b.s === 3 ? 1.2 : 0.9;
    const top = b.h + parapet;
    let u = 0;
    for (let i = 0; i < n; i++) {
      const ax = b.p[i * 2]!;
      const ay = b.p[i * 2 + 1]!;
      const bx = b.p[((i + 1) % n) * 2]!;
      const by = b.p[((i + 1) % n) * 2 + 1]!;
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 0.05) continue;
      // outward normal of a counter-clockwise footprint: (dy, -dx)
      const nx = (by - ay) / len;
      const ny = -(bx - ax) / len;
      const shop = shops.has(i) ? 1 : 0;
      const base = -0.4;
      const verts = [
        [ax, base, ay, u, base],
        [bx, base, by, u + len, base],
        [bx, top, by, u + len, top],
        [ax, top, ay, u, top],
      ];
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const v = verts[k]!;
        batch.pos.push(v[0]!, v[1]!, -v[2]!);
        batch.nor.push(nx, 0, -ny);
        batch.uv.push(v[3]!, v[4]!);
        batch.style.push(b.s, (bi % 997) / 997, b.fh, shop);
        batch.tint.push(tint.r, tint.g, tint.b);
        batch.roof.push(b.h);
      }
      u += len;
      walls.push({ cx: (ax + bx) / 2 + nx * 0.15, cy: (ay + by) / 2 + ny * 0.15, ux: (bx - ax) / len, uy: (by - ay) / len, hw: len / 2, hd: 0.3, id: `w${bi}` });
      if (shop) {
        shopWalls.push({ x: (ax + bx) / 2, y: (ay + by) / 2, nx, ny, len, ux: (bx - ax) / len, uy: (by - ay) / len, b: bi });
        // fabric awnings over some of the shop units
        if (quality !== 'low') {
          for (let s = 2.5; s < len - 2; s += 5) {
            if (hash(bi * 31 + s * 7) < 0.45) continue;
            const px = ax + ((bx - ax) / len) * s + nx * 0.7;
            const py = ay + ((by - ay) / len) * s + ny * 0.7;
            q.setFromAxisAngle(up, Math.atan2(nx, -ny));
            m.compose(new THREE.Vector3(px, 3.15, -py), q, new THREE.Vector3(1, 1, 1));
            const h = hash(bi * 13 + s);
            awnings.push({ m: m.clone(), c: new THREE.Color(h < 0.3 ? '#8e2a22' : h < 0.55 ? '#2c4e6e' : h < 0.75 ? '#3d5f35' : h < 0.9 ? '#b8862a' : '#d8d2c4') });
          }
        }
      }
    }
    // roof
    const contour = [];
    for (let i = 0; i < n; i++) contour.push(new THREE.Vector2(b.p[i * 2]!, b.p[i * 2 + 1]!));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    let rb = roofBatches.get(key);
    if (!rb) roofBatches.set(key, (rb = { pos: [], nor: [], uv: [] }));
    for (const t of tris)
      for (const k of t) {
        const pt = contour[k]!;
        rb.pos.push(pt.x, b.h, -pt.y);
        rb.nor.push(0, 1, 0);
        rb.uv.push(pt.x / 4, pt.y / 4);
      }
    // roof clutter: water tanks and AC condensers on homes and blocks, dishes on some
    if (quality !== 'low' && b.s !== 3) {
      let area = 0;
      for (let i = 0; i < n; i++) area += b.p[i * 2]! * b.p[((i + 1) % n) * 2 + 1]! - b.p[((i + 1) % n) * 2]! * b.p[i * 2 + 1]!;
      area = Math.abs(area) / 2;
      const count = Math.min(6, Math.floor(area / 60));
      for (let k = 0; k < count; k++) {
        // a point inside: pull the centroid a little towards a vertex
        const vi = Math.floor(hash(bi * 7 + k) * n);
        const t = 0.15 + hash(bi * 11 + k) * 0.45;
        const x = cx + (b.p[vi * 2]! - cx) * t;
        const y = cy + (b.p[vi * 2 + 1]! - cy) * t;
        q.setFromAxisAngle(up, hash(bi + k * 3) * Math.PI);
        m.compose(new THREE.Vector3(x, b.h, -y), q, new THREE.Vector3(1, 1, 1));
        const r = hash(bi * 17 + k);
        (r < 0.5 ? tanks : r < 0.85 ? acs : dishes).push(m.clone());
      }
    }
  });

  const quality3 = quality === 'low' ? 'low' : quality === 'medium' ? 'medium' : 'high';
  const stoneMat = facadeMaterial(quality3, 'plaster');
  const plasterMat = facadeMaterial(quality3, 'plaster_smooth');
  const toGeo = (bt: Batch) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(bt.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(bt.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(bt.uv, 2));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(bt.style, 4));
    g.setAttribute('aTint', new THREE.Float32BufferAttribute(bt.tint, 3));
    g.setAttribute('aRoof', new THREE.Float32BufferAttribute(bt.roof, 1));
    g.computeBoundingSphere();
    return g;
  };
  for (const wb of wallBatches.values()) {
    for (const [bt, mat] of [
      [wb.stone, stoneMat],
      [wb.plaster, plasterMat],
    ] as const) {
      if (!bt.pos.length) continue;
      const mesh = new THREE.Mesh(toGeo(bt), mat);
      mesh.castShadow = quality !== 'low';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  const roofTex = photoTexture('paving', 'col');
  const roofMat = new THREE.MeshLambertMaterial({ color: '#b9b2a6', map: roofTex ?? undefined });
  for (const rb of roofBatches.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(rb.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(rb.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(rb.uv, 2));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, roofMat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // roof clutter and awnings, instanced per square
  const plane = (mm: THREE.Matrix4) => ({ x: mm.elements[12]!, y: -mm.elements[14]! });
  const tankGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.35, 12);
  tankGeo.translate(0, 0.68, 0);
  const acGeo = new THREE.BoxGeometry(1, 0.8, 0.45);
  acGeo.translate(0, 0.4, 0);
  const dishGeo = new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.6);
  dishGeo.rotateX(-1.1);
  dishGeo.translate(0, 0.9, 0);
  const add = (geo: THREE.BufferGeometry, color: string, list: THREE.Matrix4[], colors?: (i: number) => THREE.Color) => {
    if (!list.length) return;
    const ci = new ChunkedInstances(geo, new THREE.MeshLambertMaterial({ color }), list.map(plane), group, { castShadow: quality === 'high' });
    list.forEach((mm, i) => {
      ci.setMatrixAt(i, mm);
      if (colors) ci.setColorAt(i, colors(i));
    });
    ci.finish();
  };
  add(tankGeo, '#ffffff', tanks, (i) => new THREE.Color(hash(i * 5) < 0.55 ? '#1f2022' : '#e8e6e0'));
  add(acGeo, '#cfd0cc', acs);
  add(dishGeo, '#e9e9e6', dishes);
  if (awnings.length) {
    const awningGeo = new THREE.BoxGeometry(4.4, 0.08, 1.4);
    awningGeo.rotateX(0.32);
    add(awningGeo, '#ffffff', awnings.map((a) => a.m), (i) => awnings[i]!.c);
  }
  // parks and gardens: grass on the ground; real trees (OpenStreetMap) as broadleaf trees
  if (data.parks.length) {
    const shapes: THREE.BufferGeometry[] = [];
    for (const poly of data.parks) {
      if (poly.length < 6) continue;
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i < poly.length; i += 2) pts.push(new THREE.Vector2(poly[i]!, poly[i + 1]!));
      const tris = THREE.ShapeUtils.triangulateShape(pts, []);
      const pos: number[] = [];
      for (const t of tris) for (const k of t) pos.push(pts[k]!.x, 0.04, -pts[k]!.y);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      shapes.push(g);
    }
    if (shapes.length) {
      const g = mergeGeometries(shapes);
      g.computeVertexNormals();
      const grass = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#6f7f45', polygonOffset: true, polygonOffsetFactor: -1 }));
      grass.receiveShadow = true;
      group.add(grass);
    }
  }
  if (data.trees.length && quality !== 'low') {
    const trunk = new THREE.CylinderGeometry(0.14, 0.22, 3.2, 6);
    trunk.translate(0, 1.6, 0);
    const crown = new THREE.IcosahedronGeometry(2.3, 1);
    const cp = crown.attributes.position!;
    for (let i = 0; i < cp.count; i++) {
      const k = 0.85 + 0.3 * hash(i * 7 + 3);
      cp.setXYZ(i, cp.getX(i) * k, cp.getY(i) * k * 0.85, cp.getZ(i) * k);
    }
    crown.computeVertexNormals();
    crown.translate(0, 4.6, 0);
    const at: THREE.Matrix4[] = [];
    for (let i = 0; i < data.trees.length; i += 2) {
      const sc = 0.75 + hash(i) * 0.6;
      q.setFromAxisAngle(up, hash(i + 1) * 6.28);
      at.push(new THREE.Matrix4().compose(new THREE.Vector3(data.trees[i]!, 0, -data.trees[i + 1]!), q, new THREE.Vector3(sc, sc, sc)));
    }
    const shade = { castShadow: quality === 'high' };
    const tr = new ChunkedInstances(trunk, new THREE.MeshLambertMaterial({ color: '#6b5844' }), at.map(plane), group, shade);
    const cr = new ChunkedInstances(crown, new THREE.MeshLambertMaterial({ color: '#56703a', flatShading: true }), at.map(plane), group, shade);
    at.forEach((mm, i) => {
      tr.setMatrixAt(i, mm);
      cr.setMatrixAt(i, mm);
      cr.setColorAt(i, new THREE.Color().setHSL(0.24 + hash(i * 3) * 0.06, 0.32, 0.3 + hash(i * 5) * 0.08));
    });
    tr.finish();
    cr.finish();
  }
  return { group, walls, shopWalls };
}
