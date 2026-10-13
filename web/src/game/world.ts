// Static environment generated from the district data: ground, zones, roads,
// junctions, procedural buildings, palms and street lamps. Merchant buildings
// are added separately (merchants.ts) because they change at runtime.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { distanceToRoadEdge, type RoadGraph } from '../../../shared/roads';
import type { DistrictData } from '../../../shared/types';
import { BoxGrid, boxesOverlap, pointInPolygon, type Box } from './collision';
import { facadeTexture, groundTexture, roadTexture, sidewalkTexture } from './textures';

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

/** Lambert material whose facade texture tiles by the instance's real size (no stretched windows). */
function facadeMaterial(style: 'glass' | 'stone' | 'industrial', bay: number, floor: number) {
  const mat = new THREE.MeshLambertMaterial({ map: facadeTexture(style) });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 instScale = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        float horiz = abs(normal.x) > 0.5 ? instScale.z : instScale.x;
        if (abs(normal.y) > 0.5) { vMapUv = vec2(0.02, 0.02); }
        else { vMapUv = vMapUv * vec2(max(1.0, floor(horiz / ${bay.toFixed(1)})), max(1.0, floor(instScale.y / ${floor.toFixed(1)}))); }
      #endif`,
    );
  };
  return mat;
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
  const color = new THREE.Color(params.color ?? '#ffffff').multiplyScalar(0.8);
  return new THREE.MeshBasicMaterial({ ...map, color, ...po });
}

export interface GenericBuilding {
  box: Box;
  height: number;
  kind: 0 | 1 | 2;
  index: number;
}

export interface WorldOptions {
  quality: Quality;
  /** areas kept free for merchant buildings */
  reserved: Box[];
}

export class World {
  readonly group = new THREE.Group();
  readonly grid = new BoxGrid(40);
  readonly buildings: GenericBuilding[] = [];
  private instanced: THREE.InstancedMesh[] = [];
  private hidden = new Set<GenericBuilding>();
  readonly zonesLocal: { kind: string; poly: LocalPoint[] }[];
  readonly boundsLocal: { minX: number; maxX: number; minY: number; maxY: number };

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
  }

  zoneAt(p: LocalPoint): string {
    for (const z of this.zonesLocal) if (pointInPolygon(p.x, p.y, z.poly)) return z.kind;
    return 'residential';
  }

  private buildGround() {
    const { minX, maxX, minY, maxY } = this.boundsLocal;
    const margin = 600;
    const w = maxX - minX + margin * 2;
    const h = maxY - minY + margin * 2;
    const tex = groundTexture('#cdbb94', 3);
    tex.repeat.set(w / 40, h / 40);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), surfaceMaterial(this.opts.quality, { map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set((minX + maxX) / 2, 0, -(minY + maxY) / 2);
    ground.receiveShadow = true;
    this.group.add(ground);

    // zone tints: flat colour (no texture) keeps the ground cheap to draw on phones
    if (this.opts.quality !== 'low') {
      const colors: Record<string, string> = { commercial: '#d8cfbb', industrial: '#c9b690', residential: '#cfc29f' };
      for (const z of this.zonesLocal) {
        const shape = new THREE.Shape(z.poly.map((p) => new THREE.Vector2(p.x, p.y)));
        const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), surfaceMaterial(this.opts.quality, { color: colors[z.kind] ?? '#cfc29f' }));
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.y = 0.02;
        mesh.receiveShadow = true;
        this.group.add(mesh);
      }
    }
  }

  private buildRoads() {
    const walkMat =
      this.opts.quality === 'high' ? surfaceMaterial('high', { map: sidewalkTexture() }) : surfaceMaterial(this.opts.quality, { color: '#bdb6a9' });
    const mats = new Map<string, THREE.Material>();
    const sideGeos: THREE.BufferGeometry[] = [];
    for (const { road, points } of this.graph.polylines) {
      sideGeos.push(ribbon(points, road.width + 8, 0.05, 4));
      let mat = mats.get(road.kind);
      if (!mat) {
        mat = surfaceMaterial(this.opts.quality, { map: roadTexture(road.kind), polygonOffsetFactor: -1 });
        mats.set(road.kind, mat);
      }
      const mesh = new THREE.Mesh(ribbon(points, road.width, ROAD_Y[road.kind] ?? 0.08, road.width * 1.2), mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    const sidewalks = new THREE.Mesh(mergeGeometries(sideGeos), walkMat);
    sidewalks.receiveShadow = true;
    this.group.add(sidewalks);

    // plain asphalt over junctions hides crossing lane markings
    const junctionMat = surfaceMaterial(this.opts.quality, { color: '#3f4247', polygonOffsetFactor: -2 });
    const discs: THREE.BufferGeometry[] = [];
    for (const n of this.graph.nodes) {
      const roads = new Set(n.edges.map((e) => e.road));
      if (roads.size < 2) continue;
      const widths = [...roads].map((id) => this.district.roads.find((r) => r.id === id)?.width ?? 12);
      const r = Math.max(...widths) / 2 + 1;
      const g = new THREE.CircleGeometry(r, 24);
      g.rotateX(-Math.PI / 2);
      g.translate(n.x, 0.12, -n.y);
      discs.push(g);
    }
    if (discs.length) {
      const m = new THREE.Mesh(mergeGeometries(discs), junctionMat);
      m.receiveShadow = true;
      this.group.add(m);
    }
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

  private buildBuildings() {
    const rand = rng(20261013);
    const density = this.opts.quality === 'low' ? 0.55 : this.opts.quality === 'medium' ? 0.8 : 1;
    const placed: GenericBuilding[] = [];
    const counts: [number, number, number] = [0, 0, 0];

    for (const { road, points } of this.graph.polylines) {
      for (const side of [1, -1] as const) {
        // walk along the polyline
        const segs = points.slice(1).map((p, i) => ({ a: points[i]!, b: p, len: Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y) }));
        const total = segs.reduce((s, x) => s + x.len, 0);
        let s = 16 + rand() * 10;
        while (s < total - 16) {
          const zoneProbe = this.pointAt(segs, s);
          const zone = this.zoneAt(zoneProbe.p);
          const industrial = zone === 'industrial';
          const w = industrial ? 26 + rand() * 30 : 10 + rand() * 16;
          const d = industrial ? 22 + rand() * 24 : 12 + rand() * 14;
          const setback = industrial ? 8 + rand() * 8 : 3 + rand() * 4;
          const mid = this.pointAt(segs, s + w / 2);
          const nx = -mid.t.y * side;
          const ny = mid.t.x * side;
          const off = road.width / 2 + 4 + setback + d / 2;
          const box: Box = { cx: mid.p.x + nx * off, cy: mid.p.y + ny * off, ux: mid.t.x, uy: mid.t.y, hw: w / 2, hd: d / 2 };
          s += w + 3 + rand() * 6;
          if (rand() > density) continue;
          if (this.opts.reserved.some((r) => boxesOverlap(r, box, 6))) continue;
          if (this.grid.anyOverlap(box, 2)) continue;
          if (!this.clearOfRoads(box, 2.5)) continue;
          let height: number;
          let kind: 0 | 1 | 2;
          if (industrial) {
            height = 7 + rand() * 6;
            kind = 2;
          } else if (zone === 'commercial' && road.kind === 'arterial' && rand() < 0.22) {
            height = 32 + rand() * 40;
            kind = 0;
          } else {
            height = 7 + rand() * (zone === 'commercial' ? 18 : 9);
            kind = rand() < 0.25 ? 0 : 1;
          }
          const gb: GenericBuilding = { box, height, kind, index: counts[kind]++ } as GenericBuilding;
          placed.push(gb);
          this.grid.add(box);
        }
      }
    }
    this.buildings.push(...placed);

    const styles: [THREE.Material, number, number][] = [
      [facadeMaterial('glass', 6, 7), 0, 0],
      [facadeMaterial('stone', 6, 7), 0, 0],
      [facadeMaterial('industrial', 12, 12), 0, 0],
    ];
    const palette: string[][] = [
      ['#e8eef3', '#dfe7ee', '#f1f1ec', '#d9e3ea'],
      ['#f1e4cc', '#ead8b8', '#f4ecdc', '#e2cfae', '#efe0c4', '#e9d2b5'],
      ['#e3ddd0', '#d6d0c2', '#e8e1d2', '#cfc7b7'],
    ];
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const color = new THREE.Color();
    for (let k = 0 as 0 | 1 | 2; k <= 2; k = (k + 1) as 0 | 1 | 2) {
      const list = placed.filter((b) => b.kind === k);
      const mesh = new THREE.InstancedMesh(geo, styles[k]![0], Math.max(1, list.length));
      mesh.count = list.length;
      for (const b of list) {
        const angle = Math.atan2(b.box.uy, b.box.ux);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        m.compose(new THREE.Vector3(b.box.cx, 0, -b.box.cy), q, new THREE.Vector3(b.box.hw * 2, b.height, b.box.hd * 2));
        mesh.setMatrixAt(b.index, m);
        const pal = palette[k]!;
        color.set(pal[Math.floor(rand() * pal.length)]!);
        mesh.setColorAt(b.index, color);
      }
      mesh.castShadow = this.opts.quality === 'high';
      mesh.receiveShadow = true;
      this.instanced[k] = mesh;
      this.group.add(mesh);
    }
    // roof parapets: a darker cap on top of each building
    const capGeo = new THREE.BoxGeometry(1, 1, 1);
    capGeo.translate(0, 0.5, 0);
    const caps = new THREE.InstancedMesh(capGeo, new THREE.MeshLambertMaterial({ color: 0x9a9184 }), Math.max(1, placed.length));
    caps.count = placed.length;
    placed.forEach((b, i) => {
      const angle = Math.atan2(b.box.uy, b.box.ux);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      m.compose(new THREE.Vector3(b.box.cx, b.height, -b.box.cy), q, new THREE.Vector3(b.box.hw * 2 - 0.6, 0.6, b.box.hd * 2 - 0.6));
      caps.setMatrixAt(i, m);
    });
    this.capMesh = caps;
    this.group.add(caps);
  }

  private capMesh: THREE.InstancedMesh | null = null;

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

  /**
   * Hide generic buildings that a (moved or new) merchant now occupies, and
   * bring back ones that are free again. Collision follows visibility.
   */
  updateReserved(reserved: Box[]) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    let changed = false;
    this.buildings.forEach((b, i) => {
      const blocked = reserved.some((r) => boxesOverlap(r, b.box, 4));
      const isHidden = this.hidden.has(b);
      if (blocked === isHidden) return;
      changed = true;
      const mesh = this.instanced[b.kind]!;
      if (blocked) {
        this.hidden.add(b);
        b.box.enabled = false;
        mesh.setMatrixAt(b.index, zero);
        this.capMesh?.setMatrixAt(i, zero);
      } else {
        this.hidden.delete(b);
        b.box.enabled = true;
        const angle = Math.atan2(b.box.uy, b.box.ux);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
        m.compose(new THREE.Vector3(b.box.cx, 0, -b.box.cy), q, new THREE.Vector3(b.box.hw * 2, b.height, b.box.hd * 2));
        mesh.setMatrixAt(b.index, m);
        m.compose(new THREE.Vector3(b.box.cx, b.height, -b.box.cy), q, new THREE.Vector3(b.box.hw * 2 - 0.6, 0.6, b.box.hd * 2 - 0.6));
        this.capMesh?.setMatrixAt(i, m);
      }
    });
    if (changed) {
      for (const mesh of this.instanced) mesh.instanceMatrix.needsUpdate = true;
      if (this.capMesh) this.capMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private buildStreetFurniture() {
    const rand = rng(77);
    const step = this.opts.quality === 'low' ? 70 : this.opts.quality === 'medium' ? 45 : 32;
    const palms: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    const junctions = this.graph.nodes.filter((n) => new Set(n.edges.map((e) => e.road)).size >= 2);
    const nearJunction = (p: LocalPoint) => junctions.some((j) => Math.hypot(j.x - p.x, j.y - p.y) < 26);
    for (const { road, points } of this.graph.polylines) {
      if (road.kind === 'local') continue;
      const segs = points.slice(1).map((p, i) => ({ a: points[i]!, b: p, len: Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y) }));
      const total = segs.reduce((s, x) => s + x.len, 0);
      for (let s = 10; s < total - 10; s += step) {
        const { p, t } = this.pointAt(segs, s);
        if (nearJunction(p)) continue;
        for (const side of [1, -1]) {
          const nx = -t.y * side;
          const ny = t.x * side;
          const off = road.width / 2 + 2.2;
          const at = { x: p.x + nx * off, y: p.y + ny * off };
          if (this.opts.reserved.some((r) => Math.hypot(r.cx - at.x, r.cy - at.y) < Math.hypot(r.hw, r.hd) + 8)) continue;
          const m = new THREE.Matrix4();
          const sc = 0.85 + rand() * 0.4;
          m.compose(v3(at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2), new THREE.Vector3(sc, sc, sc));
          (side === 1 ? palms : lamps).push(m);
        }
        if (road.kind === 'arterial' && rand() < 0.7) {
          // palms on the median
          const m = new THREE.Matrix4();
          const sc = 0.9 + rand() * 0.3;
          m.compose(v3(p), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6), new THREE.Vector3(sc, sc, sc));
          palms.push(m);
        }
      }
    }

    // palm: trunk + fronds
    const trunk = new THREE.CylinderGeometry(0.22, 0.35, 7, 6);
    trunk.translate(0, 3.5, 0);
    const fronds: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 7; i++) {
      const f = new THREE.ConeGeometry(0.5, 4.2, 4);
      f.rotateZ(Math.PI / 2 + 0.35);
      f.translate(1.9, 6.8, 0);
      f.rotateY((i / 7) * Math.PI * 2);
      fronds.push(f);
    }
    const crown = mergeGeometries(fronds);
    const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshLambertMaterial({ color: 0x8b6b4a }), Math.max(1, palms.length));
    const crowns = new THREE.InstancedMesh(crown, new THREE.MeshLambertMaterial({ color: 0x3f8f3a }), Math.max(1, palms.length));
    trunks.count = crowns.count = palms.length;
    palms.forEach((m, i) => {
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    });
    trunks.castShadow = crowns.castShadow = this.opts.quality === 'high';
    this.group.add(trunks, crowns);

    const pole = new THREE.CylinderGeometry(0.1, 0.14, 8, 5);
    pole.translate(0, 4, 0);
    const arm = new THREE.BoxGeometry(2.2, 0.15, 0.3);
    arm.translate(1, 7.9, 0);
    const lampHead = new THREE.BoxGeometry(0.7, 0.2, 0.4);
    lampHead.translate(2, 7.75, 0);
    const lampGeo = mergeGeometries([pole, arm, lampHead]);
    const lampMesh = new THREE.InstancedMesh(lampGeo, new THREE.MeshLambertMaterial({ color: 0x6f7780 }), Math.max(1, lamps.length));
    lampMesh.count = lamps.length;
    lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
    this.group.add(lampMesh);
  }
}
