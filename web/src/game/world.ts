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
import { cloneNode, hasModel, parkedMaterial } from './assets';
import { ChunkedInstances, limitDistance } from './chunked';
import { photoTexture, type PhotoSet } from './pbr';
import { parkedCarGeometries } from './models';
import { barrierTexture, facadeTexture, groundTexture, roadTexture, sidewalkTexture, type FacadeStyle } from './textures';
import { wetSurface } from './atmosphere';
import { buildRoadDetails } from './roaddetails';
import { buildCity, buildingData } from './buildings';
import { boxFaces, type SignFace } from './landmarks';

export type Quality = 'low' | 'medium' | 'high';

/** local (x east, y north) -> three.js (x, y up, z south) */
export const v3 = (p: LocalPoint, h = 0) => new THREE.Vector3(p.x, h, -p.y);

/** height of the asphalt surface above the ground plane: wheels stand on it */
export const ROAD_TOP = 0.11;

/** distance within which parked cars are drawn with the detailed model */
const PARKED_NEAR = 150;
const farCarGeos = new Map<string, THREE.BufferGeometry>();
/** A low block (body plus a darker cabin) the size of a parked car, for far away. */
function farCarGeometry(kind: ParkedKind) {
  let g = farCarGeos.get(kind);
  if (g) return g;
  const len = PARKED_LEN[kind] * 2;
  const body = new THREE.BoxGeometry(1.78, 0.75, len);
  body.translate(0, 0.62, 0);
  const cabin = new THREE.BoxGeometry(1.6, 0.6, len * 0.5);
  cabin.translate(0, 1.27, -len * 0.06);
  const shade = (geo: THREE.BufferGeometry, v: number) => {
    const c: number[] = [];
    for (let i = 0; i < geo.attributes.position!.count; i++) c.push(v, v, v);
    geo.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    return geo;
  };
  g = mergeGeometries([shade(body, 1), shade(cabin, 0.35)]);
  farCarGeos.set(kind, g);
  return g;
}
let farCarMat: THREE.Material | null = null;
function farCarMaterial() {
  return (farCarMat ??= new THREE.MeshLambertMaterial({ vertexColors: true }));
}

const ROAD_Y: Record<string, number> = { arterial: 0.1, primary: 0.09, secondary: 0.08, local: 0.07 };

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function ribbon(points: LocalPoint[], width: number, y: number, tile: number, uTile = 0) {
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
    const py = y + (p.z ?? 0);
    pos.push(p.x + nx * h, py, -(p.y + ny * h), p.x - nx * h, py, -(p.y - ny * h));
    const u1 = uTile ? width / uTile : 1;
    uv.push(0, along / tile, u1, along / tile);
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

/** Extrude a cross-section (x across, y up) along a polyline; u runs around the profile, v along (metres / tile). */
export function extrude(points: LocalPoint[], profile: [number, number][], offset: number, tile: number) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const lens = profile.map((p, i) => (i ? Math.hypot(p[0] - profile[i - 1]![0], p[1] - profile[i - 1]![1]) : 0));
  const total = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  const us = lens.map((l) => (acc += l) / total);
  let along = 0;
  const m = profile.length;
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
    for (let k = 0; k < m; k++) {
      const [px, py] = profile[k]!;
      const o = offset + px;
      pos.push(p.x + nx * o, py, -(p.y + ny * o));
      uv.push(us[k]!, along / tile);
    }
    if (i > 0) {
      const a = (i - 1) * m;
      const b = i * m;
      for (let k = 0; k < m - 1; k++) idx.push(a + k, b + k, a + k + 1, a + k + 1, b + k, b + k + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Does this road leave ground level anywhere (tunnel, bridge, or their ramps)? */
export function isGraded(points: LocalPoint[]) {
  return points.some((p) => Math.abs(p.z ?? 0) > 0.3);
}

/** Local-plane position of an instance matrix (x east, y north). */
const planeOf = (m: THREE.Matrix4) => ({ x: m.elements[12]!, y: -m.elements[14]! });

export type ParkedKind = 'hatch' | 'sedan' | 'suv' | 'pickup';
export const PARKED_KINDS: ParkedKind[] = ['hatch', 'sedan', 'suv', 'pickup'];
/** half lengths for the collision boxes */
export const PARKED_LEN: Record<ParkedKind, number> = { hatch: 2.08, sedan: 2.45, suv: 2.5, pickup: 2.68 };
export function pickKind(r: number) {
  return r < 0.28 ? 0 : r < 0.62 ? 1 : r < 0.84 ? 2 : 3;
}

const JERSEY: [number, number][] = [
  [-0.3, 0], [-0.3, 0.08], [-0.13, 0.25], [-0.08, 0.81], [0.08, 0.81], [0.13, 0.25], [0.3, 0.08], [0.3, 0],
];

/**
 * Material for flat, horizontal surfaces. Their lighting is uniform anyway, so
 * below "high" quality an unlit material with the lit colour baked in looks the
 * same and costs far less per pixel on phones. "high" keeps Lambert for shadows.
 */
/**
 * Ground surfaces: unlit at low quality; lit and shadowed at medium (with the photographed normal map
 * when there is one); physically based at high (normal and roughness maps). `relief` names the photo
 * set whose normal/roughness maps match `map`, and how many photo tiles one tile of `map` holds.
 */
export function surfaceMaterial(
  quality: Quality,
  params: { map?: THREE.Texture; color?: string; polygonOffsetFactor?: number; relief?: { set: PhotoSet; tiles: number; strength?: number }; dry?: boolean },
) {
  const m = surfaceMaterialBase(quality, params);
  // paved surfaces get wet in the rain (atmosphere.ts)
  return params.dry ? m : wetSurface(m, quality);
}

function surfaceMaterialBase(
  quality: Quality,
  params: { map?: THREE.Texture; color?: string; polygonOffsetFactor?: number; relief?: { set: PhotoSet; tiles: number; strength?: number } },
) {
  const po = params.polygonOffsetFactor ? { polygonOffset: true, polygonOffsetFactor: params.polygonOffsetFactor } : {};
  const map = params.map ? { map: params.map } : {};
  if (quality === 'low') {
    const color = new THREE.Color(params.color ?? '#ffffff').multiplyScalar(0.84);
    return new THREE.MeshBasicMaterial({ ...map, color, ...po });
  }
  // relief maps follow the colour map's tiling (same repeat object, scaled for photo tiles per map tile)
  const relief = (kind: 'nrm' | 'rgh') => {
    if (!params.relief || !params.map) return null;
    const t = photoTexture(params.relief.set, kind);
    if (!t) return null;
    const base = params.map.repeat;
    const k = params.relief.tiles;
    Object.defineProperty(t, 'repeat', { get: () => new THREE.Vector2(base.x * k, base.y * k), configurable: true });
    t.matrixAutoUpdate = true;
    return t;
  };
  const normalMap = relief('nrm');
  const strength = params.relief?.strength ?? 1;
  if (quality === 'medium') {
    return new THREE.MeshLambertMaterial({ ...map, color: params.color ?? '#ffffff', ...po, ...(normalMap ? { normalMap, normalScale: new THREE.Vector2(strength, strength) } : {}) });
  }
  const roughnessMap = relief('rgh');
  return new THREE.MeshStandardMaterial({
    ...map,
    color: params.color ?? '#ffffff',
    ...po,
    roughness: 1,
    metalness: 0,
    ...(normalMap ? { normalMap, normalScale: new THREE.Vector2(strength, strength) } : {}),
    ...(roughnessMap ? { roughnessMap } : {}),
  });
}

/** Unit box (base at y=0) whose vertex colours darken towards the ground: cheap contact shading. */
export function shadedBox() {
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
export function facadeMaterial(style: FacadeStyle, bay: number, floor: number) {
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
  /** street lamps: the lens and the spot on the road below it, scene space */
  readonly lampLights: { head: THREE.Vector3; ground: THREE.Vector3 }[] = [];
  /** street-facing walls for shop signs */
  readonly signFaces: SignFace[];
  readonly parked: Box[] = [];
  readonly zonesLocal: { kind: string; poly: LocalPoint[] }[];
  readonly boundsLocal: { minX: number; maxX: number; minY: number; maxY: number };
  private instanced: ChunkedInstances[] = [];
  private podiumMesh: ChunkedInstances | null = null;
  private capMesh: ChunkedInstances | null = null;
  private propMeshes: ChunkedInstances[] = [];
  private propOwners: PropOwner[] = [];
  private parkedMeshes: THREE.InstancedMesh[] = [];
  /** where each parked slot is drawn: the meshes holding it and its instance index in them */
  private parkedSlots: { meshes: THREE.InstancedMesh[]; i: number }[] = [];
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
    this.buildGradeSeparation();
    // real footprints when the building file loaded, generated blocks along the streets otherwise
    const city = buildingData() ? buildCity(opts.quality, opts.reserved) : null;
    if (city && city.walls.length) {
      // buildings hide most of what is behind them: draw them first
      city.group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) o.renderOrder = -2;
      });
      this.group.add(city.group);
      for (const w of city.walls) this.grid.add(w);
      this.signFaces = city.shopWalls.map((s) => ({ x: s.x, y: s.y, nx: s.nx, ny: s.ny, w: s.len, z: 3.35, hMax: 0.9 }));
    } else {
      this.buildBuildings();
      this.signFaces = boxFaces(graph, this.buildings);
    }
    this.buildStreetFurniture();
    this.buildParkedCars();
  }

  zoneAt(p: LocalPoint): string {
    for (const z of this.zonesLocal) if (pointInPolygon(p.x, p.y, z.poly)) return z.kind;
    return 'residential';
  }

  /** Ground-level nodes where three or more road ends meet from at least two roads. */
  private junctions() {
    return this.graph.nodes.filter((n) => n.edges.length >= 3 && !n.z && new Set(n.edges.map((e) => e.road)).size >= 2);
  }

  private buildGround() {
    const { minX, maxX, minY, maxY } = this.boundsLocal;
    const margin = 600;
    const w = maxX - minX + margin * 2;
    const h = maxY - minY + margin * 2;
    const tex = groundTexture('#c9b893', 3);
    // open tunnel ramps are cut out of the ground
    const holes = this.trenchOutlines();
    let ground: THREE.Mesh;
    if (holes.length) {
      tex.repeat.set(1 / 12, 1 / 12);
      const x0 = minX - margin;
      const y0 = minY - margin;
      const shape = new THREE.Shape([new THREE.Vector2(x0, y0), new THREE.Vector2(x0 + w, y0), new THREE.Vector2(x0 + w, y0 + h), new THREE.Vector2(x0, y0 + h)]);
      for (const hole of holes) shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
      ground = new THREE.Mesh(new THREE.ShapeGeometry(shape), surfaceMaterial(this.opts.quality, { map: tex, relief: { set: 'sand', tiles: 1 } }));
      ground.rotation.x = -Math.PI / 2;
    } else {
      tex.repeat.set(w / 12, h / 12);
      ground = new THREE.Mesh(new THREE.PlaneGeometry(w, h), surfaceMaterial(this.opts.quality, { map: tex, relief: { set: 'sand', tiles: 1 } }));
      ground.rotation.x = -Math.PI / 2;
      ground.position.set((minX + maxX) / 2, 0, -(minY + maxY) / 2);
    }
    ground.receiveShadow = true;
    // the ground is mostly hidden under roads, pavements and buildings: draw it after them so the depth
    // test skips the hidden pixels
    ground.renderOrder = 6;
    this.group.add(ground);

    // zone tints would cover the tunnel cuttings, so they are left out where there are any
    if (this.opts.quality !== 'low' && !holes.length) {
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

  /** Ground outlines of the open (uncovered) parts of roads below ground level. */
  private trenchOutlines(): LocalPoint[][] {
    const out: LocalPoint[][] = [];
    for (const { road, points } of this.graph.polylines) {
      if (road.tunnel || !points.some((p) => (p.z ?? 0) < -0.3)) continue;
      const h = road.width / 2 + 0.3;
      const left: LocalPoint[] = [];
      const right: LocalPoint[] = [];
      points.forEach((p, i) => {
        const a = points[Math.max(0, i - 1)]!;
        const b = points[Math.min(points.length - 1, i + 1)]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = -(b.y - a.y) / l;
        const ny = (b.x - a.x) / l;
        left.push({ x: p.x + nx * h, y: p.y + ny * h });
        right.push({ x: p.x - nx * h, y: p.y - ny * h });
      });
      out.push([...left, ...right.reverse()]);
    }
    return out;
  }

  /**
   * Tunnels, their open ramps and bridges: retaining walls and a roof for roads below ground level (with
   * lights inside), deck, parapets and piers for roads above it. Their collision walls only block
   * vehicles at the matching height.
   */
  private buildGradeSeparation() {
    const wallGeos: THREE.BufferGeometry[] = [];
    const roofGeos: THREE.BufferGeometry[] = [];
    const lightGeos: THREE.BufferGeometry[] = [];
    const pierGeos: THREE.BufferGeometry[] = [];
    // vertical strip along a polyline offset sideways, between two heights given per point
    const strip = (pts: LocalPoint[], off: number, bottom: (p: LocalPoint) => number, top: (p: LocalPoint) => number) => {
      const pos: number[] = [];
      const idx: number[] = [];
      pts.forEach((p, i) => {
        const a = pts[Math.max(0, i - 1)]!;
        const b = pts[Math.min(pts.length - 1, i + 1)]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const x = p.x - ((b.y - a.y) / l) * off;
        const y = p.y + ((b.x - a.x) / l) * off;
        pos.push(x, bottom(p), -y, x, top(p), -y);
        if (i > 0) idx.push((i - 1) * 2, i * 2, (i - 1) * 2 + 1, (i - 1) * 2 + 1, i * 2, i * 2 + 1);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const walls = (pts: LocalPoint[], off: number, z0: (a: number, b: number) => number, z1: (a: number, b: number) => number) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]!;
        const b = pts[i + 1]!;
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l < 0.2) continue;
        const ux = (b.x - a.x) / l;
        const uy = (b.y - a.y) / l;
        for (const sd of [1, -1]) {
          this.grid.add({
            cx: (a.x + b.x) / 2 - uy * off * sd,
            cy: (a.y + b.y) / 2 + ux * off * sd,
            ux,
            uy,
            hw: l / 2,
            hd: 0.25,
            z0: z0(a.z ?? 0, b.z ?? 0),
            z1: z1(a.z ?? 0, b.z ?? 0),
          });
        }
      }
    };
    for (const { road, points } of this.graph.polylines) {
      if (!isGraded(points)) continue;
      const off = road.width / 2 + 0.3;
      const below = points.some((p) => (p.z ?? 0) < -0.3);
      if (below) {
        const top = (p: LocalPoint) => (road.tunnel ? -0.4 : Math.max(0.9, (p.z ?? 0) + 0.9));
        for (const sd of [1, -1]) wallGeos.push(strip(points, off * sd, (p) => (p.z ?? 0) - 0.2, top));
        walls(points, off, (a, b) => Math.min(a, b) - 1, () => (road.tunnel ? -1.2 : 1.0));
        // concrete floor under the carriageway, so the joins between road pieces never show through
        roofGeos.push(ribbon(points.map((p) => ({ x: p.x, y: p.y, z: (p.z ?? 0) - 0.06 })), road.width + 0.7, 0, 6));
        if (road.tunnel) {
          roofGeos.push(ribbon(points.map((p) => ({ x: p.x, y: p.y, z: -0.4 })), road.width + 0.7, 0, 6));
          lightGeos.push(ribbon(points.map((p) => ({ x: p.x, y: p.y, z: -0.46 })), 0.35, 0, 4));
          // portal beams over each opening
          for (const end of [points[0]!, points[points.length - 1]!]) {
            const g = new THREE.BoxGeometry(road.width + 1.4, 1.3, 0.6);
            const k = end === points[0] ? 1 : points.length - 2;
            const nb = points[k]!;
            g.rotateY(Math.atan2(nb.x - end.x, -(nb.y - end.y)));
            g.translate(end.x, 0.25, -end.y);
            wallGeos.push(g);
          }
        }
      } else {
        const bridge = !!road.bridge;
        // deck fascia (or the retaining wall of an embankment ramp), parapets on the deck
        for (const sd of [1, -1]) {
          wallGeos.push(strip(points, off * sd, (p) => (bridge ? (p.z ?? 0) - 0.9 : 0), (p) => (p.z ?? 0) + 0.05));
          wallGeos.push(strip(points, (off - 0.15) * sd, (p) => (p.z ?? 0), (p) => (p.z ?? 0) + 0.95));
        }
        walls(points, off - 0.15, (a, b) => Math.min(a, b) - 0.5, (a, b) => Math.max(a, b) + 2);
        walls(points, off, () => -1, (a, b) => Math.max(0, Math.min(a, b) - 0.4));
        if (bridge) {
          roofGeos.push(ribbon(points.map((p) => ({ x: p.x, y: p.y, z: (p.z ?? 0) - 0.9 })), road.width + 0.6, 0, 6));
          const segs = this.segs(points);
          const total = segs.reduce((acc, x) => acc + x.len, 0);
          for (let d = 10; d < total - 5; d += 22) {
            const { p, t } = this.pointAt(segs, d);
            const z = (() => {
              // height at this distance: interpolate between the polyline points
              let acc = 0;
              for (const sg of segs) {
                if (acc + sg.len >= d) return (sg.a.z ?? 0) + ((sg.b.z ?? 0) - (sg.a.z ?? 0)) * ((d - acc) / (sg.len || 1));
                acc += sg.len;
              }
              return 0;
            })();
            if (z < 2.5) continue;
            const g = new THREE.BoxGeometry(1.3, z - 0.9, 1.6);
            g.rotateY(Math.atan2(t.x, -t.y));
            g.translate(p.x, (z - 0.9) / 2, -p.y);
            pierGeos.push(g);
            this.grid.add({ cx: p.x, cy: p.y, ux: t.x, uy: t.y, hw: 0.8, hd: 0.65, z0: -1, z1: z - 1.2 });
          }
        }
      }
    }
    const concrete = new THREE.MeshLambertMaterial({ color: '#b7b1a6', side: THREE.DoubleSide });
    // boxes and strips together: same attributes (no uv), non-indexed
    const plain = (g: THREE.BufferGeometry) => {
      const n = g.index ? g.toNonIndexed() : g;
      n.deleteAttribute('uv');
      return n;
    };
    this.addMerged(wallGeos.map(plain), concrete);
    this.addMerged(roofGeos, new THREE.MeshLambertMaterial({ color: '#6d6a65', side: THREE.DoubleSide }));
    this.addMerged(pierGeos.map(plain), concrete);
    if (lightGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(lightGeos), new THREE.MeshBasicMaterial({ color: '#ffe2a8', side: THREE.DoubleSide }));
      this.group.add(m);
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
    const walkMat = q === 'low' ? surfaceMaterial(q, { color: '#c2bcb0' }) : surfaceMaterial(q, { map: sidewalkTexture(), color: '#cfc9be', relief: { set: 'pavers', tiles: 1 } });
    const barrierGeos: THREE.BufferGeometry[] = [];
    const planterAt: { x: number; y: number; a: number }[] = [];
    const junc = this.junctions();
    const mats = new Map<string, THREE.Material>();
    const sideGeos: THREE.BufferGeometry[] = [];
    const curbGeos: THREE.BufferGeometry[] = [];
    const medianGeos: THREE.BufferGeometry[] = [];
    const medianTop: THREE.BufferGeometry[] = [];
    for (const { road, points } of this.graph.polylines) {
      const graded = isGraded(points);
      if (!graded) {
        sideGeos.push(ribbon(points, road.width + 9, 0.05, 2.4, 2.4));
        curbGeos.push(ribbon(points, road.width + 0.7, 0.06, 4));
      }
      // one-way carriageways (each half of a dual carriageway) are painted as two lanes with a dashed line
      const style = road.oneway ? 'secondary' : road.kind;
      let mat = mats.get(style);
      if (!mat) {
        // the photographed asphalt is pale: darken it to sun-baked Erbil asphalt
        mat = surfaceMaterial(q, { map: roadTexture(style), color: '#77787c', polygonOffsetFactor: -1, relief: { set: style === 'local' ? 'asphalt_worn' : 'asphalt', tiles: 3, strength: 0.8 } });
        mats.set(style, mat);
      }
      const mesh = new THREE.Mesh(ribbon(points, road.width, ROAD_Y[road.kind] ?? 0.08, road.width * 1.2), mat);
      mesh.receiveShadow = true;
      this.group.add(mesh);
      if (road.kind === 'arterial' && !road.oneway) {
        medianGeos.push(ribbon(points, 3.4, 0.24, 4));
        medianTop.push(ribbon(points, 2.6, 0.26, 4));
        if (q !== 'low' && !graded) {
          // concrete jersey barriers on both edges of the median, planters with shrubs between them
          for (const side of [1.25, -1.25]) barrierGeos.push(extrude(points, JERSEY.map(([x, y]) => [x * 0.8, y + 0.24]), side, 2.0));
          const segs = this.segs(points);
          const total = segs.reduce((acc, x) => acc + x.len, 0);
          for (let d = 12; d < total - 12; d += 26) {
            const { p, t } = this.pointAt(segs, d);
            if (junc.some((j) => Math.hypot(j.x - p.x, j.y - p.y) < 28)) continue;
            planterAt.push({ x: p.x, y: p.y, a: Math.atan2(t.x, t.y) });
          }
        }
      }
    }
    this.addMerged(sideGeos, walkMat);
    this.addMerged(curbGeos, surfaceMaterial(q, { color: '#b8b3aa' }));
    this.addMerged(medianGeos, surfaceMaterial(q, { color: '#cfcac0' }));
    this.addMerged(medianTop, surfaceMaterial(q, { color: '#76805a', dry: true }));
    if (barrierGeos.length) {
      const m = new THREE.Mesh(mergeGeometries(barrierGeos), new THREE.MeshLambertMaterial({ map: barrierTexture() }));
      m.castShadow = q === 'high';
      m.receiveShadow = true;
      this.group.add(m);
    }
    if (planterAt.length) {
      const box = new THREE.BoxGeometry(1.1, 0.55, 2.2);
      box.translate(0, 0.24 + 0.275, 0);
      const bush = new THREE.IcosahedronGeometry(0.75, 1);
      const bp = bush.attributes.position!;
      for (let i = 0; i < bp.count; i++) {
        const k = 0.8 + 0.35 * Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1);
        bp.setXYZ(i, bp.getX(i) * k * 0.8, bp.getY(i) * k * 0.6, bp.getZ(i) * k * 1.6);
      }
      bush.computeVertexNormals();
      bush.translate(0, 0.24 + 0.55 + 0.32, 0);
      const shadow = { castShadow: q === 'high' };
      const pm = new ChunkedInstances(box, new THREE.MeshLambertMaterial({ color: '#b9b4aa' }), planterAt, this.group, shadow);
      const bm = new ChunkedInstances(bush, new THREE.MeshLambertMaterial({ color: '#4f6b32', flatShading: true }), planterAt, this.group, shadow);
      planterAt.forEach((p, i) => {
        const mtx = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, -p.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.a), new THREE.Vector3(1, 1, 1));
        pm.setMatrixAt(i, mtx);
        bm.setMatrixAt(i, mtx);
      });
      pm.finish();
      bm.finish();
    }

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
        // stop line across the lanes that approach the junction (they drive on the right)
        if (n.edges.length >= 3) {
          const half = roadW / 2 - 1.2;
          const line = new THREE.PlaneGeometry(half, 0.45);
          line.rotateX(-Math.PI / 2);
          line.rotateY(Math.atan2(ux, -uy) + Math.PI / 2);
          const mid = (roadW > 16 ? 1.7 : 0.2) / 2 + half / 2;
          const sx = n.x + ux * (r + 4.7) - uy * mid;
          const sy = n.y + uy * (r + 4.7) + ux * mid;
          line.translate(sx, 0.13, -sy);
          zebras.push(line);
        }
        for (let k = -roadW / 2 + 1; k <= roadW / 2 - 1; k += 1.2) {
          const s = new THREE.PlaneGeometry(0.6, 3.2);
          s.rotateX(-Math.PI / 2);
          s.rotateY(Math.atan2(ux, -uy));
          s.translate(c.x - uy * k, 0.13, -(c.y + ux * k));
          zebras.push(s);
        }
      }
    }
    // junction asphalt: the same worn surface as the roads, without lane paint
    const junctionTex = roadTexture('secondary', false);
    junctionTex.repeat.set(2, 2);
    this.addMerged(discs, surfaceMaterial(q, { map: junctionTex, color: '#77787c', polygonOffsetFactor: -2, relief: { set: 'asphalt', tiles: 3, strength: 0.8 } }));
    this.addMerged(zebras, surfaceMaterial(q, { color: '#e6e3da', polygonOffsetFactor: -3 }));
    // arrows, drains, manholes, patches and cracks
    const widthOf = (id: string) => this.district.roads.find((x) => x.id === id)?.width ?? 12;
    this.group.add(buildRoadDetails(this.graph, q, this.junctions(), widthOf, isGraded));
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

    for (const { road, points } of this.graph.polylines.filter((pl) => !isGraded(pl.points))) {
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
    const at = (b: GenericBuilding) => ({ x: b.box.cx, y: b.box.cy });
    for (let k = 0 as 0 | 1 | 2; k <= 2; k = (k + 1) as 0 | 1 | 2) {
      const list = placed.filter((b) => b.kind === k);
      // list is in index order (indices were handed out per kind as buildings were placed)
      const mesh = new ChunkedInstances(geo, materials[k]!, list.map(at), this.group, { castShadow: this.opts.quality !== 'low' });
      for (const b of list) {
        mesh.setMatrixAt(b.index, this.matrixFor(b, m));
        const pal = PALETTE[k]!;
        color.set(pal[Math.floor(rand() * pal.length)]!);
        mesh.setColorAt(b.index, color);
      }
      mesh.finish();
      this.instanced[k] = mesh;
    }

    const withPodium = placed.filter((b) => b.podium >= 0);
    const pod = new ChunkedInstances(geo, facadeMaterial('shopfront', 4.5, 4.2), withPodium.map(at), this.group);
    for (const b of withPodium) pod.setMatrixAt(b.podium, this.podiumMatrix(b, m));
    pod.finish();
    this.podiumMesh = pod;

    const caps = new ChunkedInstances(geo, new THREE.MeshLambertMaterial({ color: 0xb3ab9e, vertexColors: true }), placed.map(at), this.group, { receiveShadow: false });
    placed.forEach((b, i) => caps.setMatrixAt(i, this.capMatrix(b, m)));
    caps.finish();
    this.capMesh = caps;

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
    const t = new ChunkedInstances(tankGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), tanks.map(planeOf), this.group);
    tanks.forEach((m, i) => {
      t.setMatrixAt(i, m);
      t.setColorAt(i, tankColors[i]!);
    });
    t.finish();
    const a = new ChunkedInstances(acGeo, new THREE.MeshLambertMaterial({ color: '#cfd0cc' }), acs.map(planeOf), this.group);
    acs.forEach((m, i) => a.setMatrixAt(i, m));
    a.finish();
    this.propMeshes = [t, a];
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
      const slot = this.parkedSlots[idx]!;
      for (const pm of slot.meshes) pm.setMatrixAt(slot.i, blocked ? zero : this.parkedMatrices[idx]!);
    });
    if (changed) {
      for (const mesh of this.parkedMeshes) mesh.instanceMatrix.needsUpdate = true;
      for (const c of [...this.instanced, ...this.propMeshes, this.capMesh, this.podiumMesh]) c?.markDirty();
    }
  }

  private buildStreetFurniture() {
    const rand = rng(77);
    const step = this.opts.quality === 'low' ? 70 : this.opts.quality === 'medium' ? 45 : 34;
    const palms: THREE.Matrix4[] = [];
    const lamps: THREE.Matrix4[] = [];
    const junctions = this.junctions();
    const nearJunction = (p: LocalPoint) => junctions.some((j) => Math.hypot(j.x - p.x, j.y - p.y) < 28);
    for (const { road, points } of this.graph.polylines.filter((pl) => !isGraded(pl.points))) {
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
          // not inside (or against) a building wall
          if (this.grid.anyOverlap({ cx: at.x, cy: at.y, ux: 1, uy: 0, hw: 0.3, hd: 0.3 }, 0.4)) continue;
          // the lamp arm (+X in the model) reaches over the carriageway, towards -n
          const m = new THREE.Matrix4().compose(v3(at), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-ny, -nx)), new THREE.Vector3(1, 1, 1));
          lamps.push(m);
          const head = new THREE.Vector3(2.25, 8.82, 0).applyMatrix4(m);
          this.lampLights.push({ head, ground: new THREE.Vector3(head.x, 0, head.z) });
        }
        // palms only on a real median (two-way main roads), never in a carriageway
        if (road.kind === 'arterial' && !road.oneway) {
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
    const palmShadow = { castShadow: this.opts.quality !== 'low' };
    const trunks = new ChunkedInstances(trunk, new THREE.MeshLambertMaterial({ color: 0x7b6650 }), palms.map(planeOf), this.group, palmShadow);
    const crowns = new ChunkedInstances(crown, new THREE.MeshLambertMaterial({ color: 0x4f6b3a, side: THREE.DoubleSide }), palms.map(planeOf), this.group, palmShadow);
    palms.forEach((m, i) => {
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
    });
    trunks.finish();
    crowns.finish();

    const pole = new THREE.CylinderGeometry(0.08, 0.12, 9, 6);
    pole.translate(0, 4.5, 0);
    const arm = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 5);
    arm.rotateZ(Math.PI / 2);
    arm.translate(1.15, 8.9, 0);
    const head = new THREE.BoxGeometry(0.75, 0.14, 0.32);
    head.translate(2.25, 8.82, 0);
    const lampMesh = new ChunkedInstances(mergeGeometries([pole, arm, head]), new THREE.MeshLambertMaterial({ color: 0x5d6268 }), lamps.map(planeOf), this.group);
    lamps.forEach((m, i) => lampMesh.setMatrixAt(i, m));
    lampMesh.finish();
    this.buildPowerLines(rand);
    this.buildBillboards(rand);
  }

  /**
   * Residential streets: concrete electricity poles on one side, with sagging cables between them and a
   * transformer on some, as along most of Erbil's neighbourhood streets.
   */
  private buildPowerLines(rand: () => number) {
    if (this.opts.quality === 'low') return;
    const poles: THREE.Matrix4[] = [];
    const cable: number[] = [];
    const boxes: THREE.Matrix4[] = [];
    for (const { road, points } of this.graph.polylines.filter((pl) => !isGraded(pl.points))) {
      if (road.kind !== 'local' && road.kind !== 'secondary') continue;
      const segs = this.segs(points);
      const total = segs.reduce((a, x) => a + x.len, 0);
      if (total < 60) continue;
      const side = rand() < 0.5 ? 1 : -1;
      let prev: THREE.Vector3[] | null = null;
      for (let s = 12; s < total - 8; s += 34 + rand() * 6) {
        const { p, t } = this.pointAt(segs, s);
        const nx = -t.y * side;
        const ny = t.x * side;
        const at = { x: p.x + nx * (road.width / 2 + 0.9), y: p.y + ny * (road.width / 2 + 0.9) };
        if (this.grid.anyOverlap({ cx: at.x, cy: at.y, ux: 1, uy: 0, hw: 0.25, hd: 0.25 }, 0.3)) {
          prev = null;
          continue;
        }
        // the cross-arm (local x) spans across the street
        const yaw = Math.atan2(ny, nx);
        poles.push(new THREE.Matrix4().compose(new THREE.Vector3(at.x, 0, -at.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
        this.grid.add({ cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw: 0.2, hd: 0.2 });
        // three cables at the cross-arm
        const tips = [-0.75, 0, 0.75].map((o) => new THREE.Vector3(at.x + nx * o, 8.6, -(at.y + ny * o)));
        if (prev) {
          for (let k = 0; k < 3; k++) {
            const a = prev[k]!;
            const b = tips[k]!;
            const n = 8;
            for (let i = 0; i < n; i++) {
              const u0 = i / n;
              const u1 = (i + 1) / n;
              const sag = (u: number) => -1.1 * 4 * u * (1 - u);
              cable.push(a.x + (b.x - a.x) * u0, a.y + (b.y - a.y) * u0 + sag(u0), a.z + (b.z - a.z) * u0);
              cable.push(a.x + (b.x - a.x) * u1, a.y + (b.y - a.y) * u1 + sag(u1), a.z + (b.z - a.z) * u1);
            }
          }
        }
        prev = tips;
        if (rand() < 0.12) boxes.push(new THREE.Matrix4().compose(new THREE.Vector3(at.x, 6.2, -at.y), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1)));
      }
    }
    if (!poles.length) return;
    const pole = new THREE.CylinderGeometry(0.11, 0.17, 9.2, 6);
    pole.translate(0, 4.6, 0);
    const arm = new THREE.BoxGeometry(1.8, 0.1, 0.1);
    arm.translate(0, 8.6, 0);
    const pm = new ChunkedInstances(mergeGeometries([pole, arm]), new THREE.MeshLambertMaterial({ color: '#a29d93' }), poles.map(planeOf), this.group, { castShadow: this.opts.quality === 'high', maxDistance: 320 });
    poles.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.finish();
    if (boxes.length) {
      const tx = new THREE.BoxGeometry(0.7, 0.9, 0.55);
      tx.translate(0, 0, 0.35);
      const bm = new ChunkedInstances(tx, new THREE.MeshLambertMaterial({ color: '#7d8279' }), boxes.map(planeOf), this.group, { maxDistance: 220 });
      boxes.forEach((m, i) => bm.setMatrixAt(i, m));
      bm.finish();
    }
    // cables in 200 m squares, each drawn only near the camera
    const cableMat = new THREE.LineBasicMaterial({ color: '#1d1f22' });
    const squares = new Map<string, number[]>();
    for (let i = 0; i < cable.length; i += 6) {
      const k = `${Math.floor(cable[i]! / 200)},${Math.floor(cable[i + 2]! / 200)}`;
      const list = squares.get(k) ?? squares.set(k, []).get(k)!;
      for (let j = 0; j < 6; j++) list.push(cable[i + j]!);
    }
    for (const list of squares.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
      g.computeBoundingSphere();
      const lines = new THREE.LineSegments(g, cableMat);
      this.group.add(lines);
      limitDistance(lines, 260);
    }
  }

  /** Roadside billboards on the main roads (invented advertisers, no real brands). */
  private buildBillboards(rand: () => number) {
    const ads = [
      ['هاتف أربيل', 'Erbil Phone · 4G+', '#0e5aa7', '#ffffff'],
      ['عسل جبلي كردستاني', 'Mountain Honey', '#e0a020', '#2b1a05'],
      ['شقق للبيع — مشروع النخيل', 'Apartments for sale', '#2f6b3a', '#ffffff'],
      ['أسرع توصيل في المدينة', 'Fastest delivery in town', '#d0461b', '#ffffff'],
      ['معرض السيارات الحديث', 'New car showroom', '#1b1d22', '#f2c14e'],
      ['مستشفى الشفاء الخاص', 'Al-Shifa private hospital', '#ffffff', '#0d6b6b'],
    ];
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 768;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ads.forEach(([ar, en, bg, fg], i) => {
      const x = (i % 2) * 512;
      const y = Math.floor(i / 2) * 256;
      ctx.fillStyle = bg!;
      ctx.fillRect(x, y, 512, 256);
      ctx.fillStyle = fg!;
      ctx.textAlign = 'center';
      ctx.font = '700 58px "IBM Plex Sans Arabic", system-ui, sans-serif';
      ctx.fillText(ar!, x + 256, y + 120, 480);
      ctx.font = '600 34px system-ui, sans-serif';
      ctx.fillText(en!, x + 256, y + 190, 480);
    });
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const pos: number[] = [];
    const uv: number[] = [];
    const posts: THREE.Matrix4[] = [];
    let n = 0;
    for (const { road, points } of this.graph.polylines.filter((pl) => !isGraded(pl.points))) {
      if (road.kind !== 'arterial' && road.kind !== 'primary') continue;
      const segs = this.segs(points);
      const total = segs.reduce((a, x) => a + x.len, 0);
      for (let s = 150 + rand() * 200; s < total - 60; s += 380 + rand() * 300) {
        const { p, t } = this.pointAt(segs, s);
        const side = rand() < 0.5 ? 1 : -1;
        const nx = -t.y * side;
        const ny = t.x * side;
        const at = { x: p.x + nx * (road.width / 2 + 5), y: p.y + ny * (road.width / 2 + 5) };
        if (this.grid.anyOverlap({ cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw: 4.5, hd: 1 }, 0.5)) continue;
        if (this.opts.reserved.some((r) => boxesOverlap(r, { cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw: 4.5, hd: 1 }, 2))) continue;
        this.grid.add({ cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw: 0.4, hd: 0.4 });
        posts.push(new THREE.Matrix4().makeTranslation(at.x, 0, -at.y));
        const ad = n++ % ads.length;
        const u0 = (ad % 2) * 0.5;
        const v1 = 1 - Math.floor(ad / 2) / 3;
        // two faces, one towards each direction of traffic
        for (const f of [1, -1]) {
          const fx = t.x * f;
          const fy = t.y * f;
          const rx = fy;
          const ry = -fx;
          const cx = at.x - fx * 0.25;
          const cy = at.y - fy * 0.25;
          const w = 8;
          const h = 4;
          const y0 = 6;
          const c = [
            [cx - rx * w / 2, y0, cy - ry * w / 2, u0, v1 - 1 / 3],
            [cx + rx * w / 2, y0, cy + ry * w / 2, u0 + 0.5, v1 - 1 / 3],
            [cx + rx * w / 2, y0 + h, cy + ry * w / 2, u0 + 0.5, v1],
            [cx - rx * w / 2, y0 + h, cy - ry * w / 2, u0, v1],
          ];
          // facing the traffic coming towards it: the face's normal is -t*f
          const order = f > 0 ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
          for (const k of order) {
            const q = c[k]!;
            pos.push(q[0]!, q[1]!, -q[2]!);
            uv.push(q[3]!, q[4]!);
          }
        }
      }
    }
    if (!posts.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    const boards = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12, side: THREE.DoubleSide }));
    boards.receiveShadow = true;
    this.group.add(boards);
    const post = new THREE.CylinderGeometry(0.35, 0.45, 6.2, 10);
    post.translate(0, 3.1, 0);
    const pm = new ChunkedInstances(post, new THREE.MeshLambertMaterial({ color: '#5f646b' }), posts.map(planeOf), this.group, { castShadow: this.opts.quality !== 'low' });
    posts.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.finish();
  }

  /** Parked cars along kerbs (decorative, but solid). */
  private buildParkedCars() {
    if (this.opts.quality === 'low') return;
    const rand = rng(4242);
    const keep = this.opts.keepClear ?? [];
    const junctions = this.junctions();
    const colors = ['#ecebe7', '#c3c7cc', '#ecebe7', '#1f2124', '#8a8f95', '#ecebe7', '#28364d', '#6a1d22', '#d6cfbf', '#ecebe7'];
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const kinds: ParkedKind[] = [];
    for (const { road, points } of this.graph.polylines.filter((pl) => !isGraded(pl.points))) {
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
          // the real city has kilometres of kerb: thin the parked cars out (most at medium quality, for phones)
          if (rand() < (this.opts.quality === 'medium' ? 0.72 : 0.45)) continue;
          const kind = PARKED_KINDS[pickKind(rand())]!;
          const hw = PARKED_LEN[kind];
          if (this.opts.reserved.some((r) => boxesOverlap(r, { cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw: hw + 0.05, hd: 0.9 }, 3))) continue;
          // drive on the right: cars face the direction of travel on their side
          const heading = Math.atan2(t.x * -side, t.y * -side);
          const m = new THREE.Matrix4().compose(v3(at, ROAD_TOP), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI - heading), new THREE.Vector3(1, 1, 1));
          const box: Box = { cx: at.x, cy: at.y, ux: t.x, uy: t.y, hw, hd: 0.95, id: `p${mats.length}` };
          this.parked.push(box);
          this.grid.add(box);
          mats.push(m);
          kinds.push(kind);
          s += hw * 2 - 4.1;
          cols.push(new THREE.Color(colors[Math.floor(rand() * colors.length)]!));
        }
      }
    }
    if (!mats.length) return;
    this.parkedMatrices = mats;
    if (hasModel('parked') && this.buildParkedModels(mats, cols, kinds)) return;
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
    this.parkedSlots = mats.map((_, i) => ({ meshes: this.parkedMeshes, i }));
    this.group.add(body, dark);
  }

  /**
   * Detailed parked cars (hatchback, saloon, SUV, pickup) as instanced meshes, one per car type, material
   * and map cell. Splitting by cell lets the camera skip whole streets of cars that are off screen. All
   * cars share one baked texture atlas; the instance colour tints only the body paint (see parkedMaterial).
   */
  private buildParkedModels(mats: THREE.Matrix4[], cols: THREE.Color[], kinds: ParkedKind[]) {
    const sources = new Map<ParkedKind, { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; paint: boolean }[]>();
    for (const kind of PARKED_KINDS) {
      const node = cloneNode('parked', `parked_${kind}`);
      if (!node) return false;
      node.updateMatrixWorld(true);
      const list: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial; paint: boolean }[] = [];
      node.traverse((o) => {
        const src = o as THREE.Mesh;
        if (!src.isMesh) return;
        const mat = parkedMaterial();
        if (!mat) return;
        list.push({ geo: src.geometry.clone().applyMatrix4(src.matrixWorld), mat, paint: true });
      });
      if (!list.length) return false;
      sources.set(kind, list);
    }
    const CELL = 160;
    const cells = new Map<string, number[]>();
    const at = new THREE.Vector3();
    mats.forEach((m, i) => {
      at.setFromMatrixPosition(m);
      const key = `${kinds[i]}:${Math.floor(at.x / CELL)}:${Math.floor(at.z / CELL)}`;
      const list = cells.get(key) ?? [];
      list.push(i);
      cells.set(key, list);
    });
    const meshes: THREE.InstancedMesh[] = [];
    const slots: { meshes: THREE.InstancedMesh[]; i: number }[] = [];
    for (const [key, idx] of cells) {
      const kind = key.split(':')[0] as ParkedKind;
      const cellMeshes: THREE.InstancedMesh[] = [];
      for (const { geo, mat, paint } of sources.get(kind)!) {
        const im = new THREE.InstancedMesh(geo, mat, idx.length);
        idx.forEach((slot, k) => {
          im.setMatrixAt(k, mats[slot]!);
          if (paint) im.setColorAt(k, cols[slot]!);
        });
        im.computeBoundingSphere();
        im.castShadow = this.opts.quality === 'high';
        im.receiveShadow = true;
        cellMeshes.push(im);
        this.group.add(im);
        // the detailed model only near the camera
        limitDistance(im, PARKED_NEAR);
      }
      // far away: a plain painted block of the same size stands in
      const far = new THREE.InstancedMesh(farCarGeometry(kind), farCarMaterial(), idx.length);
      idx.forEach((slot, k) => {
        far.setMatrixAt(k, mats[slot]!);
        far.setColorAt(k, cols[slot]!);
      });
      far.computeBoundingSphere();
      this.group.add(far);
      limitDistance(far, 420, PARKED_NEAR);
      cellMeshes.push(far);
      idx.forEach((slot, k) => (slots[slot] = { meshes: cellMeshes, i: k }));
      meshes.push(...cellMeshes);
    }
    this.parkedMeshes = meshes;
    this.parkedSlots = slots;
    this.parkedMatrices = mats;
    return true;
  }
}
