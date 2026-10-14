// Moving traffic: cars that drive on the right in their lanes, follow the car in front, turn at
// junctions and stop at traffic lights. Every junction of two or more roads gets signals on each
// approach, cycling green / yellow / red per road. Cars live around the player: those that drift too far
// away are respawned on another street nearby. They are drawn with the parked-car models (one instanced
// mesh per car type) and give the player's vehicle something to bump into.

import * as THREE from 'three';
import type { RoadGraph } from '../../../shared/roads';
import type { DistrictData } from '../../../shared/types';
import type { Box } from './collision';
import { cloneNode, hasModel, parkedMaterial } from './assets';
import { PARKED_KINDS, PARKED_LEN, pickKind, type ParkedKind, type Quality } from './world';

export const TRAFFIC_SIZE: Record<Quality, number> = { low: 14, medium: 30, high: 46 };

const SPEED: Record<string, number> = { arterial: 15, primary: 12.5, secondary: 10, local: 8 };
const GREEN = 11;
const YELLOW = 3;
const ALL_RED = 1.5;
const PHASE = GREEN + YELLOW + ALL_RED;
const LIVE_RADIUS = 280;
const SPAWN_MIN = 70;
const SPAWN_MAX = 240;
/** lane centres, metres right of the road centre line, matching the lane paint in textures.ts; the kerb
 * lane is left free for parked cars */
const LANES: Record<string, number[]> = { arterial: [3.9, 8.0], primary: [2.6, 6.0], secondary: [3.0], local: [2.4] };
const COLORS = ['#ecebe7', '#c3c7cc', '#ecebe7', '#1f2124', '#8a8f95', '#ecebe7', '#28364d', '#6a1d22', '#d6cfbf', '#ecebe7', '#2f4a3a'];

type Light = 'green' | 'yellow' | 'red';

interface Junction {
  id: number;
  x: number;
  y: number;
  /** clear radius: the asphalt disc drawn over the junction */
  r: number;
  roads: string[];
  offset: number;
}

interface Lane {
  from: number;
  to: number;
  ax: number;
  ay: number;
  /** road height at the start and end */
  az: number;
  bz: number;
  dx: number;
  dy: number;
  len: number;
  road: string;
  kind: string;
  lanes: number;
  /** lane centres, right of the road centre line */
  offsets: number[];
  /** junction at the end of this edge, if it has signals */
  signal: Junction | null;
  /** distance before the end where cars wait at a red light */
  stopBack: number;
  /** distance kept straight at each end before turning onto the next edge */
  exitR: number;
  entryR: number;
}

interface Turn {
  p0: THREE.Vector2;
  p1: THREE.Vector2;
  p2: THREE.Vector2;
  length: number;
  t: number;
  next: Lane;
  nextLane: number;
  p0z?: number;
  p2z?: number;
}

interface Car {
  e: Lane;
  lane: number;
  s: number;
  v: number;
  vmax: number;
  kind: ParkedKind;
  idx: number;
  turn: Turn | null;
  x: number;
  y: number;
  z: number;
  h: number;
  /** after a bump: stand still until this time */
  holdUntil: number;
  box: Box;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function bezier(t: Turn, u: number, out: THREE.Vector2) {
  const a = (1 - u) * (1 - u);
  const b = 2 * (1 - u) * u;
  const c = u * u;
  return out.set(a * t.p0.x + b * t.p1.x + c * t.p2.x, a * t.p0.y + b * t.p1.y + c * t.p2.y);
}

export class Traffic {
  readonly group = new THREE.Group();
  private lanes: Lane[] = [];
  private out = new Map<number, Lane[]>();
  private junctions: Junction[] = [];
  private cars: Car[] = [];
  private meshes = new Map<ParkedKind, THREE.InstancedMesh>();
  private lamps: THREE.InstancedMesh | null = null;
  /** per lamp: junction, road, and which colour it shows */
  private lampInfo: { j: Junction; road: string; colour: Light }[] = [];
  private lampState: Light[] = [];
  private rand = rng(4242);
  private time = 0;
  private tmp = new THREE.Vector2();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);

  constructor(
    private graph: RoadGraph,
    private district: DistrictData,
    private quality: Quality,
  ) {
    this.group.name = 'traffic';
    this.buildLanes();
    this.buildSignals();
    this.buildCars();
  }

  private roadById = new Map<string, DistrictData['roads'][number]>();

  private width(road: string) {
    return this.roadById.get(road)?.width ?? 12;
  }

  /** OpenStreetMap splits one street into many ways: signals group approaches by street name. */
  private streetOf(road: string) {
    const r = this.roadById.get(road);
    return r?.name_en || r?.name_ar || road;
  }

  private buildLanes() {
    const g = this.graph;
    for (const r of this.district.roads) this.roadById.set(r.id, r);
    const isJunction = (id: number) => {
      const n = g.nodes[id]!;
      return n.edges.length >= 3 && !n.z && new Set(n.edges.map((e) => e.road)).size >= 2;
    };
    const major = (id: string) => ['arterial', 'primary', 'secondary'].includes(this.roadById.get(id)?.kind ?? 'local');
    for (const n of g.nodes) {
      if (!isJunction(n.id)) continue;
      // signals where two named main streets cross
      const streets = [...new Set(n.edges.filter((e) => major(e.road)).map((e) => this.streetOf(e.road)))];
      if (streets.length < 2) continue;
      const r = Math.max(...n.edges.map((e) => this.width(e.road))) / 2 + 1;
      this.junctions.push({ id: n.id, x: n.x, y: n.y, r, roads: streets, offset: this.rand() * PHASE * streets.length });
    }
    const jAt = new Map(this.junctions.map((j) => [j.id, j]));
    for (const s of g.segments) {
      const road = this.roadById.get(s.roadId);
      const dirs: [number, number][] = road?.oneway ? [[s.fromNode, s.toNode]] : [[s.fromNode, s.toNode], [s.toNode, s.fromNode]];
      // scale the standard lane positions to this road's width
      const offsets = road?.oneway
        ? // one-way carriageway: lanes spread across the whole width
          Array.from({ length: Math.max(1, Math.round(s.width / 3.6)) }, (_, k) => -s.width / 2 + ((k + 0.5) * s.width) / Math.max(1, Math.round(s.width / 3.6)))
        : (LANES[s.kind] ?? [2.4]).map((o) => o * (s.width / ({ arterial: 30, primary: 20, secondary: 14, local: 12 }[s.kind] ?? s.width)));
      const lanes = offsets.length;
      for (const [from, to] of dirs) {
        const A = g.nodes[from]!;
        const B = g.nodes[to]!;
        const len = Math.hypot(B.x - A.x, B.y - A.y);
        if (len < 0.5) continue;
        const sig = jAt.get(to) ?? null;
        const jEnd = isJunction(to) ? Math.max(...[...new Set(B.edges.map((e) => e.road))].map((id) => this.width(id))) / 2 + 1 : 2.5;
        const jStart = isJunction(from) ? Math.max(...[...new Set(A.edges.map((e) => e.road))].map((id) => this.width(id))) / 2 + 1 : 2.5;
        const lane: Lane = {
          from,
          to,
          ax: A.x,
          ay: A.y,
          az: A.z ?? 0,
          bz: B.z ?? 0,
          dx: (B.x - A.x) / len,
          dy: (B.y - A.y) / len,
          len,
          road: s.roadId,
          kind: s.kind,
          lanes,
          offsets,
          signal: sig,
          stopBack: sig ? sig.r + 4.6 : 0,
          exitR: Math.min(jEnd, len * 0.45),
          entryR: Math.min(jStart, len * 0.45),
        };
        this.lanes.push(lane);
        const list = this.out.get(from) ?? [];
        list.push(lane);
        this.out.set(from, list);
      }
    }
  }

  /** Point on a lane, `s` metres from its start, in lane `k` (0 = next to the centre line). */
  private lanePoint(e: Lane, k: number, s: number, out: THREE.Vector2) {
    const off = e.offsets[Math.min(k, e.lanes - 1)]!;
    // right of the direction of travel: (dy, -dx)
    return out.set(e.ax + e.dx * s + e.dy * off, e.ay + e.dy * s - e.dx * off);
  }

  lightFor(j: Junction, road: string): Light {
    const i = j.roads.indexOf(this.streetOf(road));
    if (i < 0) return 'green';
    const cycle = PHASE * j.roads.length;
    const t = (((this.time + j.offset) % cycle) + cycle) % cycle;
    const start = i * PHASE;
    if (t < start || t >= start + PHASE) return 'red';
    const u = t - start;
    return u < GREEN ? 'green' : u < GREEN + YELLOW ? 'yellow' : 'red';
  }

  // ------------------------------------------------------------------ traffic lights

  private buildSignals() {
    const poleGeos: THREE.BufferGeometry[] = [];
    const headGeos: THREE.BufferGeometry[] = [];
    const lampAt: { p: THREE.Vector3; face: number; info: { j: Junction; road: string; colour: Light } }[] = [];
    const add = (geo: THREE.BufferGeometry, list: THREE.BufferGeometry[], x: number, y: number, z: number, rotY = 0) => {
      geo.rotateY(rotY);
      geo.translate(x, y, z);
      list.push(geo);
    };
    for (const j of this.junctions) {
      for (const e of this.lanes) {
        if (e.signal !== j || e.len < j.r + 10) continue;
        const half = this.width(e.road) / 2;
        // stop point on the kerb side, just before the zebra crossing
        const sx = j.x - e.dx * (j.r + 5);
        const sy = j.y - e.dy * (j.r + 5);
        const px = sx + e.dy * (half + 0.6);
        const py = sy - e.dx * (half + 0.6);
        const facing = Math.atan2(-e.dx, e.dy); // heads face the traffic coming up to the junction
        const armLen = Math.min(5.5, half - 1.2);
        add(new THREE.CylinderGeometry(0.09, 0.11, 6, 8), poleGeos, px, 3, -py);
        const arm = new THREE.CylinderGeometry(0.06, 0.06, armLen, 6);
        arm.rotateZ(Math.PI / 2);
        arm.translate(armLen / 2, 0, 0);
        // the arm reaches from the kerb out over the road
        add(arm, poleGeos, px, 5.8, -py, Math.atan2(e.dx, -e.dy));
        for (const [hx, hy, hz] of [
          [px - e.dy * (armLen - 0.2), 5.25, py + e.dx * (armLen - 0.2)],
          [px, 2.9, py],
        ] as [number, number, number][]) {
          add(new THREE.BoxGeometry(0.34, 0.95, 0.24), headGeos, hx, hy, -hz, facing);
          // back plate
          add(new THREE.BoxGeometry(0.5, 1.12, 0.03), headGeos, hx + Math.sin(facing) * -0.13, hy, -hz + Math.cos(facing) * -0.13, facing);
          (['red', 'yellow', 'green'] as Light[]).forEach((colour, k) => {
            const p = new THREE.Vector3(hx, hy + 0.3 - k * 0.3, -hz);
            lampAt.push({ p, face: facing, info: { j, road: e.road, colour } });
          });
        }
      }
    }
    if (!poleGeos.length) return;
    const merge = (geos: THREE.BufferGeometry[]) => {
      // merging without the util keeps this module light: these are all non-indexed-compatible boxes and cylinders
      const out = geos.map((g) => g.toNonIndexed());
      const count = out.reduce((n, g) => n + g.attributes.position!.count, 0);
      const pos = new Float32Array(count * 3);
      const nor = new Float32Array(count * 3);
      let o = 0;
      for (const g of out) {
        pos.set(g.attributes.position!.array as Float32Array, o * 3);
        nor.set(g.attributes.normal!.array as Float32Array, o * 3);
        o += g.attributes.position!.count;
        g.dispose();
      }
      for (const g of geos) g.dispose();
      const m = new THREE.BufferGeometry();
      m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      return m;
    };
    const poles = new THREE.Mesh(merge(poleGeos), new THREE.MeshStandardMaterial({ color: '#6b7076', roughness: 0.5, metalness: 0.6 }));
    const heads = new THREE.Mesh(merge(headGeos), new THREE.MeshStandardMaterial({ color: '#17191c', roughness: 0.6 }));
    poles.castShadow = heads.castShadow = this.quality === 'high';
    this.group.add(poles, heads);

    const lampGeo = new THREE.CircleGeometry(0.105, 16);
    const lamps = new THREE.InstancedMesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), lampAt.length);
    lampAt.forEach((l, i) => {
      // on the front face of the head, facing traffic
      const p = l.p.clone().add(new THREE.Vector3(Math.sin(l.face) * 0.125, 0, Math.cos(l.face) * 0.125));
      this.m.compose(p, this.q.setFromAxisAngle(this.up, l.face), new THREE.Vector3(1, 1, 1));
      lamps.setMatrixAt(i, this.m);
      lamps.setColorAt(i, new THREE.Color('#222'));
      this.lampInfo.push(l.info);
      this.lampState.push('red');
    });
    lamps.frustumCulled = false;
    this.lamps = lamps;
    this.group.add(lamps);
    this.updateLamps(true);
  }

  private updateLamps(force = false) {
    const lamps = this.lamps;
    if (!lamps) return;
    const on: Record<Light, THREE.Color> = { red: new THREE.Color('#ff2a1a'), yellow: new THREE.Color('#ffb21a'), green: new THREE.Color('#2bff7a') };
    const off: Record<Light, THREE.Color> = { red: new THREE.Color('#3a1210'), yellow: new THREE.Color('#3a2c10'), green: new THREE.Color('#0f2f1c') };
    let changed = false;
    this.lampInfo.forEach((l, i) => {
      const state = this.lightFor(l.j, l.road);
      if (!force && state === this.lampState[i]) return;
      this.lampState[i] = state;
      lamps.setColorAt(i, state === l.colour ? on[l.colour] : off[l.colour]);
      changed = true;
    });
    if (changed && lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------------ cars

  private buildCars() {
    const n = TRAFFIC_SIZE[this.quality];
    if (!this.lanes.length || !n) return;
    const kinds: ParkedKind[] = [];
    for (let i = 0; i < n; i++) kinds.push(PARKED_KINDS[pickKind(this.rand())]!);
    const counts = new Map<ParkedKind, number>();
    for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
    const mat = parkedMaterial();
    for (const [kind, count] of counts) {
      let geo: THREE.BufferGeometry | null = null;
      const node = hasModel('parked') ? cloneNode('parked', `parked_${kind}`) : null;
      if (node && mat) {
        node.updateMatrixWorld(true);
        node.traverse((o) => {
          const src = o as THREE.Mesh;
          if (src.isMesh && !geo) geo = src.geometry.clone().applyMatrix4(src.matrixWorld);
        });
      }
      const fallback = !geo;
      if (!geo) {
        geo = new THREE.BoxGeometry(1.8, 1.4, PARKED_LEN[kind] * 2);
        (geo as THREE.BufferGeometry).translate(0, 0.75, 0);
      }
      const im = new THREE.InstancedMesh(geo, fallback || !mat ? new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }) : mat, count);
      im.frustumCulled = false;
      im.castShadow = this.quality !== 'low';
      im.receiveShadow = true;
      this.meshes.set(kind, im);
      this.group.add(im);
    }
    const used = new Map<ParkedKind, number>();
    for (const kind of kinds) {
      const idx = used.get(kind) ?? 0;
      used.set(kind, idx + 1);
      const car: Car = {
        e: this.lanes[0]!,
        lane: 0,
        s: 0,
        v: 0,
        vmax: 0,
        kind,
        idx,
        turn: null,
        x: 0,
        y: 0,
        z: 0,
        h: 0,
        holdUntil: 0,
        box: { cx: 0, cy: 0, ux: 0, uy: 1, hw: PARKED_LEN[kind], hd: 0.95, id: `t${this.cars.length}` },
      };
      this.meshes.get(kind)!.setColorAt(idx, new THREE.Color(COLORS[Math.floor(this.rand() * COLORS.length)]!));
      this.cars.push(car);
    }
    for (const im of this.meshes.values()) if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  /** Put a car on a random lane near (px, py), away from the player and from other cars. */
  private spawn(car: Car, px: number, py: number, min: number, max: number) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const e = this.lanes[Math.floor(this.rand() * this.lanes.length)]!;
      if (e.len < e.entryR + e.exitR + 6) continue;
      const s = e.entryR + this.rand() * (e.len - e.entryR - e.exitR - (e.signal ? e.stopBack : 0));
      const lane = Math.floor(this.rand() * e.lanes);
      const p = this.lanePoint(e, lane, s, this.tmp);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < min || d > max) continue;
      if (this.cars.some((c) => c !== car && c.vmax > 0 && Math.hypot(c.x - p.x, c.y - p.y) < 14)) continue;
      car.e = e;
      car.lane = lane;
      car.s = s;
      car.turn = null;
      car.vmax = (SPEED[e.kind] ?? 9) * (0.82 + this.rand() * 0.3);
      car.v = car.vmax * 0.7;
      car.holdUntil = 0;
      this.place(car);
      return true;
    }
    return false;
  }

  private place(car: Car) {
    if (car.turn) {
      const t = car.turn;
      const p = bezier(t, Math.min(1, t.t), this.tmp);
      car.x = p.x;
      car.y = p.y;
      const u = Math.min(1, t.t);
      const tx = 2 * (1 - u) * (t.p1.x - t.p0.x) + 2 * u * (t.p2.x - t.p1.x);
      const ty = 2 * (1 - u) * (t.p1.y - t.p0.y) + 2 * u * (t.p2.y - t.p1.y);
      if (Math.abs(tx) + Math.abs(ty) > 1e-6) car.h = Math.atan2(tx, ty);
      const a = t.p0z ?? 0;
      car.z = a + ((t.p2z ?? 0) - a) * u;
    } else {
      const p = this.lanePoint(car.e, car.lane, car.s, this.tmp);
      car.x = p.x;
      car.y = p.y;
      car.z = car.e.az + (car.e.bz - car.e.az) * Math.max(0, Math.min(1, car.s / car.e.len));
      car.h = Math.atan2(car.e.dx, car.e.dy);
    }
    const b = car.box;
    b.z0 = car.z - 1.5;
    b.z1 = car.z + 2;
    b.cx = car.x;
    b.cy = car.y;
    b.ux = Math.sin(car.h);
    b.uy = Math.cos(car.h);
  }

  private startTurn(car: Car) {
    const e = car.e;
    const options = (this.out.get(e.to) ?? []).filter((n) => n.to !== e.from);
    let next: Lane | undefined;
    if (!options.length) next = (this.out.get(e.to) ?? [])[0];
    else {
      const straight = options.filter((n) => n.road === e.road);
      next = straight.length && this.rand() < 0.65 ? straight[0] : options[Math.floor(this.rand() * options.length)];
    }
    if (!next) {
      car.v = 0;
      return;
    }
    const nextLane = Math.min(car.lane, next.lanes - 1);
    const p0 = this.lanePoint(e, car.lane, e.len - e.exitR, new THREE.Vector2());
    const p2 = this.lanePoint(next, nextLane, next.entryR, new THREE.Vector2());
    // control point: where the two lane lines meet (falls back to the midpoint for near-parallel lanes)
    const den = e.dx * next.dy - e.dy * next.dx;
    let p1: THREE.Vector2;
    if (Math.abs(den) > 0.15) {
      const t = ((p2.x - p0.x) * next.dy - (p2.y - p0.y) * next.dx) / den;
      p1 = new THREE.Vector2(p0.x + e.dx * t, p0.y + e.dy * t);
      if (t < 0 || t > 3 * (e.exitR + next.entryR)) p1 = p0.clone().add(p2).multiplyScalar(0.5);
    } else p1 = p0.clone().add(p2).multiplyScalar(0.5);
    const zAt = (l: Lane, s: number) => l.az + (l.bz - l.az) * Math.max(0, Math.min(1, s / l.len));
    const turn: Turn = { p0, p1, p2, length: 0, t: 0, next, nextLane, p0z: zAt(e, e.len - e.exitR), p2z: zAt(next, next.entryR) };
    let len = 0;
    const a = new THREE.Vector2();
    const b = new THREE.Vector2();
    bezier(turn, 0, a);
    for (let k = 1; k <= 8; k++) {
      bezier(turn, k / 8, b);
      len += a.distanceTo(b);
      a.copy(b);
    }
    turn.length = Math.max(0.5, len);
    car.turn = turn;
  }

  /** Free distance ahead of `car` before it reaches another car or the player. */
  private gapAhead(car: Car, player: { x: number; y: number; r: number; z?: number }) {
    const fx = Math.sin(car.h);
    const fy = Math.cos(car.h);
    let gap = Infinity;
    const test = (x: number, y: number, size: number) => {
      const rx = x - car.x;
      const ry = y - car.y;
      const along = rx * fx + ry * fy;
      if (along <= 0 || along > 40) return;
      const lat = Math.abs(rx * fy - ry * fx);
      if (lat > 1.9) return;
      gap = Math.min(gap, along - car.box.hw - size);
    };
    for (const c of this.cars) {
      if (c === car || c.vmax === 0) continue;
      // ignore oncoming cars, and cars on another level (tunnel under, bridge over)
      if (Math.sin(c.h) * fx + Math.cos(c.h) * fy < 0.2 || Math.abs(c.z - car.z) > 2) continue;
      test(c.x, c.y, c.box.hw);
    }
    if (Math.abs((player.z ?? 0) - car.z) < 2) test(player.x, player.y, player.r);
    return gap;
  }

  update(dt: number, player: { x: number; y: number; r: number; z?: number }, nowMs: number) {
    this.time += dt;
    this.updateLamps();
    if (!this.cars.length) return;
    for (const car of this.cars) {
      if (car.vmax === 0 || Math.hypot(car.x - player.x, car.y - player.y) > LIVE_RADIUS) {
        if (!this.spawn(car, player.x, player.y, car.vmax === 0 ? 25 : SPAWN_MIN, SPAWN_MAX)) car.vmax = 0;
      }
    }
    for (const car of this.cars) {
      if (car.vmax === 0) continue;
      let want = car.vmax;
      if (!car.turn) want = Math.min(want, SPEED[car.e.kind] ?? 9);
      // traffic light at the end of this edge
      const e = car.e;
      if (!car.turn && e.signal) {
        const stopAt = e.len - e.stopBack;
        const dist = stopAt - car.s - car.box.hw;
        const light = this.lightFor(e.signal, e.road);
        if (light !== 'green' && dist > -0.5) {
          const canClear = light === 'yellow' && dist < car.v * 1.1;
          if (!canClear) want = Math.min(want, Math.sqrt(Math.max(0, 2 * 3.5 * Math.max(0, dist - 0.3))));
        }
      }
      const gap = this.gapAhead(car, player);
      if (gap < Infinity) want = Math.min(want, Math.max(0, (gap - 2.2) * 0.9));
      if (nowMs < car.holdUntil) want = 0;
      const dv = want - car.v;
      car.v = Math.max(0, car.v + Math.max(-7 * dt, Math.min(2.6 * dt, dv)));
      const step = car.v * dt;
      if (car.turn) {
        car.turn.t += step / car.turn.length;
        if (car.turn.t >= 1) {
          const over = (car.turn.t - 1) * car.turn.length;
          car.e = car.turn.next;
          car.lane = car.turn.nextLane;
          car.s = car.e.entryR + over;
          car.turn = null;
        }
      } else {
        car.s += step;
        if (car.s >= e.len - e.exitR) this.startTurn(car);
      }
      this.place(car);
    }
    // draw
    for (const car of this.cars) {
      const im = this.meshes.get(car.kind);
      if (!im) continue;
      if (car.vmax === 0) this.m.makeScale(0, 0, 0);
      else this.m.compose(new THREE.Vector3(car.x, car.z + 0.03, -car.y), this.q.setFromAxisAngle(this.up, Math.PI - car.h), new THREE.Vector3(1, 1, 1));
      im.setMatrixAt(car.idx, this.m);
    }
    for (const im of this.meshes.values()) im.instanceMatrix.needsUpdate = true;
  }

  /** Collision boxes of the moving cars near a point. */
  boxesNear(x: number, y: number, r: number): Box[] {
    return this.cars.filter((c) => c.vmax > 0 && Math.abs(c.x - x) < r && Math.abs(c.y - y) < r).map((c) => c.box);
  }

  /** The player hit car `id`: it stops for a moment. */
  bumped(id: string | undefined, nowMs: number) {
    const car = this.cars.find((c) => c.box.id === id);
    if (car) {
      car.holdUntil = nowMs + 2500;
      car.v = 0;
    }
  }

  /** Is the player running a red light? Returns the light state of the approach they are crossing, if any. */
  lightAhead(x: number, y: number, heading: number): { light: Light; distance: number } | null {
    const fx = Math.sin(heading);
    const fy = Math.cos(heading);
    let best: { light: Light; distance: number } | null = null;
    for (const e of this.lanes) {
      if (!e.signal) continue;
      if (e.dx * fx + e.dy * fy < 0.8) continue;
      const stopX = e.signal.x - e.dx * e.stopBack;
      const stopY = e.signal.y - e.dy * e.stopBack;
      const rx = stopX - x;
      const ry = stopY - y;
      const along = rx * e.dx + ry * e.dy;
      const lat = Math.abs(rx * e.dy - ry * e.dx);
      if (along < -2 || along > 60 || lat > this.width(e.road) / 2) continue;
      if (!best || along < best.distance) best = { light: this.lightFor(e.signal, e.road), distance: along };
    }
    return best;
  }

  dispose() {
    for (const im of this.meshes.values()) im.geometry.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.material && !(m.material as THREE.Material).userData.shared) (m.material as THREE.Material).dispose();
    });
  }
}
