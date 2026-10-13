// Static environment generated from the district data: ground, roads with
// curbs, median and zebra crossings, procedural buildings with shopfronts and
// rooftop tanks, street furniture and parked cars. Road geometry comes from the
// map data; buildings, cars and props are decorative and procedurally placed.
// Merchant buildings are added separately (merchants.ts) because they change at runtime.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { distanceToRoadEdge, type RoadGraph } from '../../../shared/roads';
import type { DistrictData } from '../../../shared/types';
import { BoxGrid, boxesOverlap, pointInPolygon, type Box } from './collision';
import { parkedCarGeometries } from './models';
import { facadeTexture, groundTexture, roadTexture, sidewalkTexture, type FacadeStyle } from './textures';

export type Quality = 'low' | 'medium' | 'high';

/** local (x east, y north) -> three.js (x, y up, z south) */
export const v3 = (p: LocalPoint, h = 0) => new THREE.Vector3(p.x, h, -p.y);

const ROAD_Y: Record<string, number> = { arterial: 0.1, primary: 0.09, secondary: 0.08, local: 0.07 };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function ribbon(points: LocalPoint[], width: number, y: number, tile: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let along = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const prev = points[i - 1] ?? p;
    const next = points[i + 1] ?? p;
    let tx = next.x - prev.x;
    let ty = next.y - prev.y;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    if (i > 0) along += Math.hypot(p.x - prev.x, p.y - prev.y);
    const h = width / 2;
    pos.push(p.x + nx * h, y, -(p.y + ny * h), p.x - nx * h, y, -(p.y - ny * h));
    uv.push(0, along / tile, 1, along / tile);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Material for flat, horizontal surfaces. Their lighting is uniform anyway, so
 * below "high" quality an unlit material with the lit colour baked in looks the
 * same and costs far less per pixel on phones. "high" keeps Lambert for shadows.
 */
export function surfaceMaterial(quality: Quality, params: { map?: THREE.Texture; color?: string; polygonOffsetFactor?: number }) {
  const po = params.polygonOffsetFactor ? { polygonOffset: true, polygonOffsetFactor: params.polygonOffsetFactor } : {};
  const map = params.map ? { map: params.map } : {};
  if (quality === 'high') return new THREE.MeshLambertMaterial({ ...map, color: params.color ?? '#ffffff', ...po });
  const color = new THREE.Color(params.color ?? '#ffffff').multiplyScalar(0.84);
  return new THREE.MeshBasicMaterial({ ...map, color, ...po });
}

/** Unit box (base at y=0) whose vertex colours darken towards the ground: cheap contact shading. */
function shadedBox() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position!;
  const col: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const v = 0.72 + 0.28 * Math.min(1, y * 1.6);
    col.push(v, v, v);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Lambert facade whose texture tiles by the instance's real size (no stretched windows). */
function facadeMaterial(style: FacadeStyle, bay: number, floor: number) {
  const mat = new THREE.MeshLambertMaterial({ map: facadeTexture(style), vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 instScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        float horiz = abs(normal.x) > 0.5 ? instScale.z : instScale.x;
        if (abs(normal.y) > 0.5) { vMapUv = vec2(0.02, 0.02); }
        else { vMapUv = vMapUv * vec2(max(1.0, floor(horiz / ${bay.toFixed(1)} + 0.5)), max(1.0, floor(instScale.y / ${floor.toFixed(1)} + 0.5))); }
      #endif`,
    );
  };
  return mat;
}

export interface GenericBuilding {
  box: Box;
  height: number;
  kind: 0 | 1 | 2;
  index: number;
  podium: number;
}

export interface WorldOptions {
  quality: Quality;
  /** areas kept free for merchant buildings */
  reserved: Box[];
  /** points where no parked car may stand (pickup and drop-off kerbs) */
  keepClear?: LocalPoint[];
}

const PALETTE: string[][] = [
  ['#dfe6eb', '#d5dde3', '#e4e7e6'],
  ['#ece3d2', '#e6d8bf', '#efe9dd', '#ddd0b8', '#e9dcc4', '#d9d2c4', '#e3d6c0'],
  ['#e2e0db', '#d6d4ce', '#e6e2d8'],
];

interface PropOwner {
  b: GenericBuilding;
  mesh: 0 | 1;
  i: number;
  m: THREE.Matrix4;
}

export class World {
  readonly group = new THREE.Group();
  readonly grid = new BoxGrid(40);
  readonly buildings: GenericBuilding[] = [];
  readonly parked: Box[] = [];
  readonly zonesLocal: { kind: string; poly: LocalPoint[] }[];
  readonly boundsLocal: { minX: number; maxX: number; minY: number; maxY: number };
  private instanced: THREE.InstancedMesh[] = [];
  private podiumMesh: THREE.InstancedMesh | null = null;
  private capMesh: THREE.InstancedMesh | null = null;
  private propMeshes: THREE.InstancedMesh[] = [];
  private propOwners: PropOwner[] = [];
  private parkedMeshes: THREE.InstancedMesh[] = [];
  private parkedMatrices: THREE.Matrix4[] = [];
  private hidden = new Set<GenericBuilding>();

  constructor(
    readonly district: DistrictData,
    readonly graph: RoadGraph,
    readonly opts: WorldOptions,
  ) {
    const b = district.bounds;
    const sw = toLocal({ lat: b.south, lng: b.west }, district.origin);
    const ne = toLocal({ lat: b.north, lng: b.east }, district.origin);
    this.boundsLocal = { minX: sw.x, maxX: ne.x, minY: sw.y, maxY: ne.y };
    this.zonesLocal = district.zones.map((z) => ({
      kind: z.kind,
      poly: z.polygon.map(([lat, lng]) => toLocal({ lat, lng }, district.origin)),
    }));
    this.buildGround();
    this.buildRoads();
    this.buildBuildings();
    this.buildStreetFurniture();
    this.buildParkedCars();
  }

  zoneAt(p: LocalPoint): string {
    for (const z of this.zonesLocal) if (pointInPolygon(p.x, p.y, z.poly)) return z.kind;
    return 'residential';
  }

  private junctions() {
    return this.graph.nodes.filter((n) => new Set(n.edges.map((e) => e.road)).size >= 2);
  }

  private buildGround() {
    const { minX, maxX, minY, maxY } = this.boundsLocal;
    const margin = 600;
    const w = maxX - minX + margin * 2;
    const h = maxY - minY + margin * 2;
    const tex = groundTexture('#c9b893', 3);
    tex.repeat.set(w / 40, h / 40);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), surfaceMaterial(this.opts.quality, { map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, 0, -(minY + maxY) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    if (this.opts.quality !== 'low') {
      const colors: Record<string, string> = { commercial: '#cfc6b3', industrial: '#c4b392', residential: '#cbbf9f' };
      for (const z of this.zonesLocal) {
        const shape = new THREE.Shape(z.poly.map((p) => new THREE.Vector2(p.x, p.y)));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), surfaceMaterial(this.opts.quality, { color: colors[z.kind] ?? '#cbbf9f' }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.02;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
  }

  private addMerged(geos: THREE.BufferGeometry[], material: THREE.Material) {
    if (!geos.length) return;
    const m = new THREE.Mesh(mergeGeometries(geos), material);
    m.receiveShadow = true;
    this.group.add(m);
  }

  private buildRoads() {
    const q = this.opts.quality;
    const walkMat = q === 'high' ? surfaceMaterial('high', { map: sidewalkTexture() }) : surfaceMaterial(q, { color: '#c2bcb0' });
    const mats = new Map<string, THREE.Material>();
    const sideGeos: THREE.BufferGeometry[] = [];
    const curbGeos: THREE.BufferGeometry[] = [];
    const medianGeos: THREE.BufferGeometry[] = [];
    const medianTop: THREE.BufferGeometry[] = [];
    for (const { road, points } of this.graph.polylines) {
      sideGeos.push(ribbon(points, road.width + 9, 0.05, 4));
      curbGeos.push(ribbon(points, road.width + 0.7, 0.06, 4));
      let mat = mats.get(road.kind);
      if (!mat) {
        mat = surfaceMaterial(q, { map: roadTexture(road.kind), polygonOffsetFactor: -1 });
        mats.set(road.kind, mat);
      }
      const mesh = new THREE.Mesh(ribbon(points, road.width, ROAD_Y[road.kind] ?? 0.08, road.width * 1.2), mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (road.kind === 'arterial') {
        medianGeos.push(ribbon(points, 3.4, 0.24, 4));
        medianTop.push(ribbon(points, 2.6, 0.26, 4));
      }
    }
    this.addMerged(sideGeos, walkMat);
    this.addMerged(curbGeos, surfaceMaterial(q, { color: '#d9d5cc' }));
    this.addMerged(medianGeos, surfaceMaterial(q, { color: '#cfcac0' }));
    this.addMerged(medianTop, surfaceMaterial(q, { color: '#76805a' }));

    // plain asphalt over junctions hides crossing lane markings; zebras on each approach
    const discs: THREE.BufferGeometry[] = [];
    const zebras: THREE.BufferGeometry[] = [];
    for (const n of this.junctions()) {
      const roads = [...new Set(n.edges.map((e) => e.road))];
      const widths = roads.map((id) => this.district.roads.find((r) => r.id === id)?.width ?? 12);
      const r = Math.max(...widths) / 2 + 1;
      const g = new THREE.CircleGeometry(r, 28);
      g.rotateX(-Math.PI / 2);
      g.translate(n.x, 0.12, -n.y);
      discs.push(g);
      for (const e of n.edges) {
        const other = this.graph.nodes[e.to]!;
        const len = Math.hypot(other.x - n.x, other.y - n.y);
        if (len < r + 10) continue;
        const ux = (other.x - n.x) / len;
        const uy = (other.y - n.y) / len;
        const roadW = this.district.roads.find((x) => x.id === e.road)?.width ?? 12;
        const c = { x: n.x + ux * (r + 2.5), y: n.y + uy * (r + 2.5) };
        for (let k = -roadW / 2 + 1; k <= roadW / 2 - 1; k += 1.2) {
          const s = new THREE.PlaneGeometry(0.6, 3.2);
          s.rotateX(-Math.PI / 2);
          s.rotateY(Math.atan2(ux, -uy));
          s.translate(c.x - uy * k, 0.13, -(c.y + ux * k));
          zebras.push(s);
        }
      }
    }
    this.addMerged(discs, surfaceMaterial(q, { color: '#3d3e41', polygonOffsetFactor: -2 }));
    this.addMerged(zebras, surfaceMaterial(q, { color: '#e6e3da', polygonOffsetFactor: -3 }));
  }

  /** Is the box clear of every road (with a margin)? */
  private clearOfRoads(box: Box, margin: number) {
    const pts: LocalPoint[] = [
      { x: box.cx, y: box.cy },
      ...[
        [1, 1],
        [1, -1],
        [-1, -1],
        [-1, 1],
      ].map(([su, sv]) => ({
        x: box.cx + box.ux * box.hw * su! - box.uy * box.hd * sv!,
        y: box.cy + box.uy * box.hw * su! + box.ux * box.hd * sv!,
      })),
    ];
    return pts.every((p) => distanceToRoadEdge(this.graph, p) > margin);
  }

  private segs(points: LocalPoint[]) {
    return points.slice(1).map((p, i) => ({ a: points[i]!, b: p, len: Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y) }));
  }

  private pointAt(segs: { a: LocalPoint; b: LocalPoint; len: number }[], s: number) {
    let rest = s;
    for (const seg of segs) {
      if (rest <= seg.len) {
        const t = seg.len ? rest / seg.len : 0;
        return {
          p: { x: seg.a.x + (seg.b.x - seg.a.x) * t, y: seg.a.y + (seg.b.y - seg.a.y) * t },
          t: { x: (seg.b.x - seg.a.x) / (seg.len || 1), y: (seg.b.y - seg.a.y) / (seg.len || 1) },
        };
      }
      rest -= seg.len;
    }
    const last = segs[segs.length - 1]!;
    return { p: last.b, t: { x: (last.b.x - last.a.x) / (last.len || 1), y: (last.b.y - last.a.y) / (last.len || 1) } };
  }

  private buildBuildings() {
    const rand = rng(20261013);
    const density = this.opts.quality === 'low' ? 0.55 : this.opts.quality === 'medium' ? 0.8 : 1;
    const placed: GenericBuilding[] = [];
    const counts: [number, number, number] = [0, 0, 0];
    let podiums = 0;

    for (const { road, points } of this.graph.polylines) {
      for (const side of [1, -1] as const) {
        const segs = this.segs(points);
        const total = segs.reduce((s, x) => s + x.len, 0);
        let s = 16 + rand() * 10;
        while (s < total - 16) {
          const zone = this.zoneAt(this.pointAt(segs, s).p);
          const industrial = zone === 'industrial';
          const w = industrial ? 26 + rand() * 30 : 11 + rand() * 13;
          const d = industrial ? 22 + rand() * 24 : 13 + rand() * 12;
          const setback = industrial ? 8 + rand() * 8 : 1.5 + rand() * 2.5;
          const mid = this.pointAt(segs, s + w / 2);
          const nx = -mid.t.y * side;
          const ny = mid.t.x * side;
          const off = road.width / 2 + 4.5 + setback + d / 2;
          const box: Box = { cx: mid.p.x + nx * off, cy: mid.p.y + ny * off, ux: mid.t.x, uy: mid.t.y, hw: w / 2, hd: d / 2 };
          s += w + 1 + rand() * 4;
          if (rand() > density) continue;
          if (this.opts.reserved.some((r) => boxesOverlap(r, box, 6))) continue;
          if (this.grid.anyOverlap(box, 1)) continue;
          if (!this.clearOfRoads(box, 2.5)) continue;
          let height: number;
          let kind: 0 | 1 | 2;
          if (industrial) {
            height = 8 + rand() * 5;
            kind = 2;
          } else if (zone === 'commercial' && road.kind === 'arterial' && rand() < 0.16) {
            height = 30 + Math.floor(rand() * 9) * 3.6;
            kind = 0;
          } else {
            // Erbil commercial streets: mostly 2–5 storeys over a shop floor
            const floors = zone === 'commercial' ? 2 + Math.floor(rand() * 4) : 2 + Math.floor(rand() * 2);
            height = 4.2 + floors * 3.3;
            kind = 1;
          }
          const gb: GenericBuilding = { box, height, kind, index: counts[kind]++, podium: -1 };
          if (kind === 1 && zone === 'commercial') gb.podium = podiums++;
          placed.push(gb);
          this.grid.add(box);
        }
      }
    }
    this.buildings.push(...placed);

    const materials: THREE.Material[] = [facadeMaterial('glass', 3, 3.6), facadeMaterial('plaster', 6, 3.3), facadeMaterial('industrial', 8, 40)];
    const geo = shadedBox();
    const m = new THREE.Matrix4();
    const color = new THREE.Color();
    for (let k = 0 as 0 | 1 | 2; k <= 2; k = (k + 1) as 0 | 1 | 2) {
      const list = placed.filter((b) => b.kind === k);
      const mesh = new THREE.InstancedMesh(geo, materials[k]!, Math.max(1, list.length));
      mesh.count = list.length;
      for (const b of list) {
        mesh.setMatrixAt(b.index, this.matrixFor(b, m));
        const pal = PALETTE[k]!;
        color.set(pal[Math.floor(rand() * pal.length)]!);
        mesh.setColorAt(b.index, color);
      }
      mesh.castShadow = this.opts.quality === 'high';
      mesh.receiveShadow = true;
      this.instanced[k] = mesh;
      this.group.add(mesh);
    }

    const withPodium = placed.filter((b) => b.podium >= 0);
    const pod = new THREE.InstancedMesh(geo, facadeMaterial('shopfront', 4.5, 4.2), Math.max(1, withPodium.length));
    pod.count = withPodium.length;
    for (const b of withPodium) pod.setMatrixAt(b.podium, this.podiumMatrix(b, m));
    pod.receiveShadow = true;
    this.podiumMesh = pod;
    this.group.add(pod);

    const caps = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xb3ab9e, vertexColors: true }), Math.max(1, placed.length));
    caps.count = placed.length;
    placed.forEach((b, i) => caps.setMatrixAt(i, this.capMatrix(b, m)));
    this.capMesh = caps;
    this.group.add(caps);

    if (this.opts.quality !== 'low') this.buildRoofProps(placed, rand);
  }

  private quat(b: GenericBuilding) {
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(b.box.uy, b.box.ux));
  }
  private matrixFor(b: GenericBuilding, m: THREE.Matrix4) {
    return m.compose(new THREE.Vector3(b.box.cx, 0, -b.box.cy), this.quat(b), new THREE.Vector3(b.box.hw * 2, b.height, b.box.hd * 2));
  }
  private podiumMatrix(b: GenericBuilding, m: THREE.Matrix4) {
    return m.compose(new THREE.Vector3(b.box.cx, 0, -b.box.cy), this.quat(b), new THREE.Vector3(b.box.hw * 2 + 0.3, 4.2, b.box.hd * 2 + 0.3));
  }
  private capMatrix(b: GenericBuilding, m: THREE.Matrix4) {
    return m.compose(new THREE.Vector3(b.box.cx, b.height, -b.box.cy), this.quat(b), new THREE.Vector3(b.box.hw * 2 + 0.25, 0.7, b.box.hd * 2 + 0.25));
  }

  /** Water tanks and AC condensers on the roofs — a defining feature of Erbil's skyline. */
  private buildRoofProps(placed: GenericBuilding[], rand: () => number) {
    const tankGeo = new THREE.CylinderGeometry(0.62, 0.62, 1.35, 12);
    tankGeo.translate(0, 0.68, 0);
    const acGeo = new THREE.BoxGeometry(1, 0.8, 0.45);
    acGeo.translate(0, 0.4, 0);
    const tanks: THREE.Matrix4[] = [];
    const tankColors: THREE.Color[] = [];
    const acs: THREE.Matrix4[] = [];
    for (const b of placed) {
      if (b.kind === 0 && rand() < 0.7) continue;
      const n = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const lu = (rand() * 2 - 1) * (b.box.hw - 1.2);
        const lv = (rand() * 2 - 1) * (b.box.hd - 1.2);
        const x = b.box.cx + b.box.ux * lu - b.box.uy * lv;
        const y = b.box.cy + b.box.uy * lu + b.box.ux * lv;
        const m = new THREE.Matrix4().compose(new THREE.Vector3(x, b.height + 0.7, -y), this.quat(b), new THREE.Vector3(1, 1, 1));
        if (rand() < 0.6) {
          this.propOwners.push({ b, mesh: 0, i: tanks.length, m });
          tanks.push(m);
          tankColors.push(new THREE.Color(rand() < 0.55 ? '#1f2022' : '#e8e6e0'));
        } else {
          this.propOwners.push({ b, mesh: 1, i: acs.length, m });
          acs.push(m);
        }
      }
    }
    const t = new THREE.InstancedMesh(tankGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), Math.max(1, tanks.length));
    t.count = tanks.length;
    tanks.forEach((m, i) => {
      t.setMatrixAt(i, m);
      t.setColorAt(i, tankColors[i]!);
    });
    const a = new THREE.InstancedMesh(acGeo, new THREE.MeshLambertMaterial({ color: '#cfd0cc' }), Math.max(1, acs.length));
    a.count = acs.length;
    acs.forEach((m, i) => a.setMatrixAt(i, m));
    this.propMeshes = [t, a];
    this.group.add(t, a);
  }

  /**
   * Hide generic buildings and parked cars that a (moved or new) merchant now
   * occupies, and bring back ones that are free again. Collision follows visibility.
   */
  updateReserved(reserved: Box[]) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const m = new THREE.Matrix4();
    let changed = false;
    this.buildings.forEach((b, i) => {
      const blocked = reserved.some((r) => boxesOverlap(r, b.box, 4));
      if (blocked === this.hidden.has(b)) return;
      changed = true;
      if (blocked) this.hidden.add(b);
      else this.hidden.delete(b);
      b.box.enabled = !blocked;
      this.instanced[b.kind]!.setMatrixAt(b.index, blocked ? zero : this.matrixFor(b, m));
      this.capMesh?.setMatrixAt(i, blocked ? zero : this.capMatrix(b, m));
      if (b.podium >= 0) this.podiumMesh?.setMatrixAt(b.podium, blocked ? zero : this.podiumMatrix(b, m));
      for (const o of this.propOwners) if (o.b === b) this.propMeshes[o.mesh]?.setMatrixAt(o.i, blocked ? zero : o.m);
    });
    this.parked.forEach((p, idx) => {
      const blocked = reserved.some((r) => boxesOverlap(r, p, 2));
      if (blocked === (p.enabled === false)) return;
      changed = true;
      p.enabled = !blocked;
      for (const pm of this.parkedMeshes) pm.setMatrixAt(idx, blocked ? zero : this.parkedMatrices[idx]!);
    });
    if (changed) {
      for (const mesh of [...this.instanced, ...this.propMeshes, ...this.parkedMeshes]) mesh.instanceMatrix.needsUpdate = true;
      if (this.capMesh) this.capMesh.instanceMatrix.needsUpdate = true;
      if (this.podiumMesh) this.podiumMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private buildStreetFurniture() {
    const rand = rng(77);
    const step = this.opts.quality === 'low' ? 70 : this.opts.quality === 'medium' ? 45 : 34;
    const palms: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    const junctions = this.junctions();
    const nearJunction = (p: LocalPoint) => junctions.some((j) => Math.hypot(j.x - p.x, j.y - p.y) < 28);
    for (const { road, points } of this.graph.polylines) {
      if (road.kind === 'local') continue;
      const segs = this.segs(points);
      const total = segs.reduce((s, x) => s + x.len, 0);
      for (let s = 10; s < total - 10; s += step) {
        const { p, t } = this.pointAt(segs, s);
        if (nearJunction(p)) continue;
        for (const side of [1, -1]) {
          const nx = -t.y * side;
          const ny = t.x * side;
          const at = { x: p.x + nx * (road.width / 2 + 1.4), y: p.y + ny * (road.width / 2 + 1.4) };
          if (this.opts.reserved.some((r) => Math.hypot(r.cx - at.x, r.cy - at.y) < Math.hypot(r.hw, r.hd) + 8)) continue;
          // the lamp arm (+X in the model) reaches over the carriageway, towards -n
          const m = new THREE.Matrix4().compose(v3(at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-ny, -nx)), new THREE.Vector3(1, 1, 1));
          lamps.push(m);
        }
        if (road.kind === 'arterial') {
          const m = new THREE.Matrix4();
          const sc = 0.9 + rand() * 0.25;
          m.compose(v3(p, 0.25), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6), new THREE.Vector3(sc, sc, sc));
          palms.push(m);
        }
      }
    }

    // date palm: tapered trunk, drooping fronds
    const trunk = new THREE.CylinderGeometry(0.2, 0.3, 8, 7, 4);
    trunk.translate(0, 4, 0);
    const fronds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 9; i++) {
      const f = new THREE.PlaneGeometry(0.7, 3.6, 1, 3);
      const pos = f.attributes.position!;
      for (let k = 0; k < pos.count; k++) {
        const y = pos.getY(k) + 1.8;
        pos.setZ(k, -0.06 * y * y);
      }
      f.translate(0, 1.8, 0);
      f.rotateX(-Math.PI / 2 + 0.55);
      f.rotateY((i / 9) * Math.PI * 2);
      f.translate(0, 7.9, 0);
      fronds.push(f);
    }
    const crown = mergeGeometries(fronds);
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x7b6650 }), Math.max(1, palms.length));
    const crowns = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0x4f6b3a, side: THREE.DoubleSide }), Math.max(1, palms.length));
    trunks.count = crowns.count = palms.length;
    palms.forEach((m, i) => {
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    });
    trunks.castShadow = crowns.castShadow = this.opts.quality === 'high';
    this.group.add(trunks, crowns);

    const pole = new THREE.CylinderGeometry(0.08, 0.12, 9, 6);
    pole.translate(0, 4.5, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5);
    arm.rotateZ(Math.PI / 2);
    arm.translate(1.15, 8.9, 0);
    const head = new THREE.BoxGeometry(0.75, 0.14, 0.32);
    head.translate(2.25, 8.82, 0);
    const lampMesh = new THREE.InstancedMesh(mergeGeometries([pole, arm, head]), new THREE.MeshLambertMaterial({ color: 0x5d6268 }), Math.max(1, lamps.length));
    lampMesh.count = lamps.length;
    lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
    this.group.add(lampMesh);
  }

  /** Parked cars along kerbs (decorative, but solid). */
  private buildParkedCars() {
    if (this.opts.quality === 'low') return;
    const rand = rng(4242);
    const keep = this.opts.keepClear ?? [];
    const junctions = this.junctions();
    const colors = ['#e9e8e4', '#c9ccd0', '#e9e8e4', '#24262a', '#8d9196', '#e9e8e4', '#2d3b4f', '#5b1f22', '#d8d4c8'];
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    for (const { road, points } of this.graph.polylines) {
      if (road.kind === 'arterial') continue;
      const segs = this.segs(points);
      const total = segs.reduce((s, x) => s + x.len, 0);
      for (const side of [1, -1]) {
        let s = 14;
        while (s < total - 14) {
          const { p, t } = this.pointAt(segs, s);
          s += 6.2 + (rand() < 0.35 ? 8 + rand() * 20 : 0);
          if (this.zoneAt(p) === 'industrial' && rand() < 0.6) continue;
          if (junctions.some((j) => Math.hypot(j.x - p.x, j.y - p.y) < 30)) continue;
          const nx = -t.y * side;
          const ny = t.x * side;
          const at = { x: p.x + nx * (road.width / 2 - 1.15), y: p.y + ny * (road.width / 2 - 1.15) };
          if (keep.some((k) => Math.hypot(k.x - at.x, k.y - at.y) < 16)) continue;
          if (this.opts.reserved.some((r) => boxesOverlap(r, { cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw: 2.1, hd: 0.9 }, 3))) continue;
          // drive on the right: cars face the direction of travel on their side
          const heading = Math.atan2(t.x * -side, t.y * -side);
          const m = new THREE.Matrix4().compose(v3(at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - heading), new THREE.Vector3(1, 1, 1));
          const box: Box = { cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw: 2.05, hd: 0.9, id: `p${mats.length}` };
          this.parked.push(box);
          this.grid.add(box);
          mats.push(m);
          cols.push(new THREE.Color(colors[Math.floor(rand() * colors.length)]!));
        }
      }
    }
    if (!mats.length) return;
    const [bodyGeo, darkGeo] = parkedCarGeometries();
    const body = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.4, roughness: 0.35 }), mats.length);
    const dark = new THREE.InstancedMesh(darkGeo, new THREE.MeshStandardMaterial({ color: '#1c1e21', metalness: 0.5, roughness: 0.4 }), mats.length);
    mats.forEach((m, i) => {
      body.setMatrixAt(i, m);
      body.setColorAt(i, cols[i]!);
      dark.setMatrixAt(i, m);
    });
    body.castShadow = dark.castShadow = this.opts.quality === 'high';
    this.parkedMeshes = [body, dark];
    this.parkedMatrices = mats;
    this.group.add(body, dark);
  }
}
