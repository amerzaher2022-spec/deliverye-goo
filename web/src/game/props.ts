// Loose things on the street that a rider can knock over: wheelie bins along the pavements, cones
// round roadworks on the side streets, plastic café tables and chairs outside restaurants, and
// cardboard boxes outside shops. Hit one and it is shoved along, pops up, tips over and slides to a
// stop; ride on and it is back in its place before you return. Only the ones near the player are
// simulated; all of them are drawn from a few instanced meshes split into map squares.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { distanceToRoadEdge, type RoadGraph } from '../../../shared/roads';
import type { Merchant } from '../../../shared/types';
import { ChunkedInstances } from './chunked';
import type { BoxGrid } from './collision';
import { BUILDING_SIZE, type MerchantFrame } from './merchants';
import type { Quality } from './world';
import { ROAD_TOP } from './world';

type Kind = 'bin' | 'cone' | 'chair' | 'table' | 'box';

/** collision radius, how much it slows the vehicle (0..1), how hard it is to shove */
const SPEC: Record<Kind, { r: number; drag: number; mass: number; half: number }> = {
  bin: { r: 0.36, drag: 0.16, mass: 3, half: 0.3 },
  cone: { r: 0.18, drag: 0.02, mass: 0.6, half: 0.16 },
  chair: { r: 0.3, drag: 0.04, mass: 0.8, half: 0.25 },
  table: { r: 0.42, drag: 0.07, mass: 1.4, half: 0.4 },
  box: { r: 0.3, drag: 0.03, mass: 0.7, half: 0.2 },
};

interface Prop {
  kind: Kind;
  i: number;
  hx: number;
  hy: number;
  hh: number;
  ground: number;
  x: number;
  y: number;
  z: number;
  h: number;
  vx: number;
  vy: number;
  vz: number;
  spin: number;
  /** tipping over: angle (0 upright .. π/2 on its side), rate, and the direction it falls */
  tilt: number;
  tiltRate: number;
  fall: number;
  moving: boolean;
  moved: boolean;
}

function colored(g: THREE.BufferGeometry, color: string) {
  const n = g.index ? g.toNonIndexed() : g;
  n.deleteAttribute('uv');
  const c = new THREE.Color(color);
  const a = new Float32Array(n.attributes.position!.count * 3);
  for (let i = 0; i < a.length; i += 3) a.set([c.r, c.g, c.b], i);
  n.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return n;
}

function part(g: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, rx = 0) {
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return colored(g, color);
}

/** Models, origin at the base centre, front towards +z. */
function geometry(kind: Kind): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 'cone') {
    parts.push(part(new THREE.BoxGeometry(0.38, 0.035, 0.38), '#1c1d1f', 0, 0.018));
    parts.push(part(new THREE.CylinderGeometry(0.028, 0.15, 0.64, 18, 1, true), '#f2611d', 0, 0.035 + 0.32));
    parts.push(part(new THREE.CylinderGeometry(0.083, 0.104, 0.12, 18, 1, true), '#f1f0ea', 0, 0.36));
    parts.push(part(new THREE.CylinderGeometry(0.052, 0.068, 0.07, 18, 1, true), '#f1f0ea', 0, 0.52));
  } else if (kind === 'bin') {
    // municipal wheelie bin: tapered green body, lid with an overhang, two wheels at the back
    const body = new THREE.CylinderGeometry(0.4, 0.33, 0.92, 4, 1);
    body.rotateY(Math.PI / 4);
    body.scale(1, 1, 1.25);
    parts.push(part(body, '#1f4a2b', 0, 0.06 + 0.46));
    // moulded rim under the lid, a lid with a lip at the front, the hinge bar and the handle at the back
    parts.push(part(new THREE.BoxGeometry(0.6, 0.06, 0.74), '#1a3f25', 0, 0.95));
    parts.push(part(new THREE.BoxGeometry(0.62, 0.045, 0.8), '#173a22', 0, 1.0, 0.02));
    parts.push(part(new THREE.BoxGeometry(0.3, 0.04, 0.05), '#14301c', 0, 0.97, 0.43));
    parts.push(part(new THREE.BoxGeometry(0.5, 0.05, 0.05), '#121a15', 0, 0.98, -0.4));
    // the council's white stencil band on the front
    parts.push(part(new THREE.BoxGeometry(0.42, 0.08, 0.01), '#d9dbd2', 0, 0.72, 0.345));
    for (const sx of [-0.24, 0.24]) parts.push(part(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14).rotateZ(Math.PI / 2), '#141516', sx, 0.1, -0.33));
    parts.push(part(new THREE.CylinderGeometry(0.018, 0.018, 0.5, 6).rotateZ(Math.PI / 2), '#1e2a22', 0, 0.92, -0.44));
  } else if (kind === 'chair') {
    // white monobloc café chair
    parts.push(part(new THREE.BoxGeometry(0.44, 0.04, 0.42), '#ecebe5', 0, 0.44));
    const back = new THREE.BoxGeometry(0.42, 0.42, 0.035);
    back.rotateX(-0.18);
    parts.push(part(back, '#ecebe5', 0, 0.68, -0.21));
    for (const [x, z] of [
      [-0.19, 0.18],
      [0.19, 0.18],
      [-0.19, -0.18],
      [0.19, -0.18],
    ] as const)
      parts.push(part(new THREE.CylinderGeometry(0.018, 0.024, 0.44, 8), '#e2e1db', x, 0.22, z));
  } else if (kind === 'table') {
    parts.push(part(new THREE.CylinderGeometry(0.42, 0.42, 0.035, 24), '#ecebe5', 0, 0.72));
    parts.push(part(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 10), '#d9d8d2', 0, 0.36));
    parts.push(part(new THREE.CylinderGeometry(0.24, 0.27, 0.04, 18), '#d9d8d2', 0, 0.02));
  } else {
    // cardboard box with a tape strip
    parts.push(part(new THREE.BoxGeometry(0.5, 0.38, 0.4), '#b88b56', 0, 0.19));
    parts.push(part(new THREE.BoxGeometry(0.08, 0.005, 0.41), '#9a7a52', 0, 0.383));
  }
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  return (x >>> 0) / 4294967296;
}

const CELL = 30;

export class Props {
  readonly group = new THREE.Group();
  private props: Prop[] = [];
  private inst = new Map<Kind, ChunkedInstances>();
  private cells = new Map<string, Prop[]>();
  private active: Prop[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private axis = new THREE.Vector3();
  private pos = new THREE.Vector3();
  private one = new THREE.Vector3(1, 1, 1);
  private seed = 1;

  constructor(graph: RoadGraph, grid: BoxGrid, views: { merchant: Merchant; frame: MerchantFrame }[], quality: Quality) {
    this.group.name = 'props';
    if (quality === 'low') return;
    const add = (kind: Kind, x: number, y: number, h: number) => {
      const r = SPEC[kind].r;
      if (grid.anyOverlap({ cx: x, cy: y, ux: 1, uy: 0, hw: r, hd: r }, 0.15)) return false;
      if (this.props.some((p) => Math.abs(p.hx - x) < r + 0.3 && Math.abs(p.hy - y) < r + 0.3 && Math.hypot(p.hx - x, p.hy - y) < r + SPEC[p.kind].r)) return false;
      const edge = distanceToRoadEdge(graph, { x, y });
      const ground = edge < 0 ? ROAD_TOP : 0.055;
      this.props.push({ kind, i: 0, hx: x, hy: y, hh: h, ground, x, y, z: 0, h, vx: 0, vy: 0, vz: 0, spin: 0, tilt: 0, tiltRate: 0, fall: 0, moving: false, moved: false });
      return true;
    };
    // bins at the kerb every 60-90 m along ground-level streets; cones round a work patch now and then
    let k = 0;
    for (const { road, points } of graph.polylines) {
      if (points.some((p) => p.z)) continue;
      let acc = 0;
      let nextBin = 20 + hash(k++) * 40;
      let nextWork = road.kind === 'local' || road.kind === 'secondary' ? 120 + hash(k++) * 500 : Infinity;
      for (let i = 0; i < points.length - 1; i++) {
        const a = points[i]!;
        const b = points[i + 1]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 0.5) continue;
        const tx = (b.x - a.x) / len;
        const ty = (b.y - a.y) / len;
        while (nextBin < acc + len) {
          const d = nextBin - acc;
          const side = hash(k++) < 0.5 ? 1 : -1;
          const off = road.width / 2 + 0.9;
          const x = a.x + tx * d + ty * off * side;
          const y = a.y + ty * d - tx * off * side;
          if (distanceToRoadEdge(graph, { x, y }) > 0.4) add('bin', x, y, Math.atan2(-ty * side, tx * side) + Math.PI / 2);
          nextBin += 60 + hash(k++) * 30;
        }
        while (nextWork < acc + len) {
          // a short taper of cones along the edge of the carriageway
          const d = nextWork - acc;
          const side = hash(k++) < 0.5 ? 1 : -1;
          const off = road.width / 2 - 1.1;
          for (let c = 0; c < 5; c++) {
            const dd = Math.min(len, d + c * 2.2);
            const o = off - (c === 0 || c === 4 ? 0.5 : 0) - (hash(k++) - 0.5) * 0.15;
            add('cone', a.x + tx * dd + ty * o * side, a.y + ty * dd - tx * o * side, hash(k++) * 6);
          }
          nextWork += 400 + hash(k++) * 600;
        }
        acc += len;
      }
    }
    // outside businesses: café tables and chairs by restaurants, boxes by shops and warehouses
    for (const { merchant: m, frame: f } of views) {
      const fx = f.front.x;
      const fy = f.front.y;
      const sx = fy;
      const sy = -fx;
      const at = (along: number, out: number) => ({ x: f.entrance.x + fx * out + sx * along, y: f.entrance.y + fy * out + sy * along });
      const faceOut = Math.atan2(fx, fy);
      if (m.building_type === 'restaurant') {
        // the terrace under the awning: three tables, a chair either side of each (building frame:
        // x along the front, z out from the centre)
        const local = (x: number, z: number) => ({ x: f.centre.x + sx * x + fx * z, y: f.centre.y + sy * x + fy * z });
        const z0 = BUILDING_SIZE.restaurant.d / 2 + 3.6;
        for (const x of [-4.5, -1.5, 1.5]) {
          const c = local(x, z0);
          if (!add('table', c.x, c.y, faceOut)) continue;
          for (const cz of [-0.68, 0.68]) {
            const ch = local(x + (hash(k++) - 0.5) * 0.15, z0 + cz);
            // chairs face the table
            add('chair', ch.x, ch.y, faceOut + (cz > 0 ? Math.PI : 0) + (hash(k++) - 0.5) * 0.35);
          }
        }
      } else if (m.building_type === 'shop' || m.building_type === 'warehouse') {
        const c = at(2.6 * (hash(m.id) < 0.5 ? 1 : -1), 1.4);
        if (distanceToRoadEdge(graph, c) > 1) {
          add('box', c.x, c.y, faceOut + 0.2);
          add('box', c.x + sx * 0.55, c.y + sy * 0.55, faceOut - 0.15);
          add('box', c.x + fx * 0.5, c.y + fy * 0.5, faceOut + 0.6);
        }
      }
    }
    // draw
    const kinds: Kind[] = ['bin', 'cone', 'chair', 'table', 'box'];
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    for (const kind of kinds) {
      const list = this.props.filter((p) => p.kind === kind);
      if (!list.length) continue;
      list.forEach((p, i) => (p.i = i));
      const ci = new ChunkedInstances(geometry(kind), mat, list.map((p) => ({ x: p.hx, y: p.hy })), this.group, {
        cell: 160,
        castShadow: quality === 'high',
        maxDistance: kind === 'cone' || kind === 'bin' ? 200 : 140,
      });
      for (const p of list) this.draw(p, ci);
      ci.finish();
      this.inst.set(kind, ci);
    }
    for (const p of this.props) {
      const key = `${Math.floor(p.hx / CELL)},${Math.floor(p.hy / CELL)}`;
      const c = this.cells.get(key);
      if (c) c.push(p);
      else this.cells.set(key, [p]);
    }
  }

  get count() {
    return this.props.length;
  }

  private draw(p: Prop, ci = this.inst.get(p.kind)) {
    if (!ci) return;
    const s = SPEC[p.kind];
    this.q.setFromAxisAngle(this.up, Math.PI - p.h);
    if (p.tilt > 0) {
      // tip about the horizontal axis across the direction it is falling
      this.axis.set(Math.cos(p.fall), 0, Math.sin(p.fall));
      this.q2.setFromAxisAngle(this.axis, p.tilt);
      this.q.premultiply(this.q2);
    }
    this.pos.set(p.x, p.ground + p.z + Math.sin(p.tilt) * s.half * 0.9, -p.y);
    this.m.compose(this.pos, this.q, this.one);
    ci.setMatrixAt(p.i, this.m);
    ci.dirty(p.i);
  }

  /**
   * Knock things about. `shapes` are the vehicle's collision circles, (vx, vy) its velocity.
   * Returns how much the vehicle should slow (fraction of speed lost) and the hardest hit (m/s).
   */
  update(dt: number, shapes: { x: number; y: number; r: number }[], vx: number, vy: number, px: number, py: number): { drag: number; hit: number } {
    let drag = 0;
    let hit = 0;
    if (!this.props.length) return { drag, hit };
    const speed = Math.hypot(vx, vy);
    // what is near the vehicle
    const cx = Math.floor(px / CELL);
    const cy = Math.floor(py / CELL);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const p of this.cells.get(`${cx + i},${cy + j}`) ?? []) {
          for (const c of shapes) {
            const dx = p.x - c.x;
            const dy = p.y - c.y;
            const d = Math.hypot(dx, dy);
            const s = SPEC[p.kind];
            if (d > c.r + s.r || p.z > 0.6) continue;
            // relative speed into the prop
            const nx = d > 1e-4 ? dx / d : 1;
            const ny = d > 1e-4 ? dy / d : 0;
            const into = vx * nx + vy * ny - (p.vx * nx + p.vy * ny);
            // push it clear either way
            p.x += nx * (c.r + s.r - d);
            p.y += ny * (c.r + s.r - d);
            if (into < 0.6) {
              if (!p.moving) this.wake(p);
              continue;
            }
            const k = 1 / Math.sqrt(s.mass);
            p.vx = vx * 0.85 * k + nx * into * 0.5 * k;
            p.vy = vy * 0.85 * k + ny * into * 0.5 * k;
            p.vz = Math.min(4, 0.6 + into * 0.18 * k);
            p.spin = (this.rnd() - 0.5) * into * 1.2;
            p.fall = Math.atan2(p.vx, p.vy) + Math.PI / 2;
            p.tiltRate = p.kind === 'table' || p.kind === 'bin' ? 2.2 + into * 0.15 : 3.5 + into * 0.3;
            if (p.kind === 'box' || p.kind === 'chair') p.tiltRate *= this.rnd() < 0.5 ? 1 : -1;
            this.wake(p);
            drag = Math.max(drag, s.drag * Math.min(1, into / Math.max(1, speed)));
            hit = Math.max(hit, into);
          }
        }
    // move what is moving
    let w = 0;
    for (const p of this.active) {
      p.vz -= 9.8 * dt;
      p.z += p.vz * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.h += p.spin * dt;
      if (p.tiltRate) {
        p.tilt += p.tiltRate * dt;
        if (Math.abs(p.tilt) >= Math.PI / 2) {
          p.tilt = (Math.sign(p.tilt) * Math.PI) / 2;
          p.tiltRate = 0;
        }
      }
      if (p.z <= 0) {
        p.z = 0;
        p.vz = p.vz < -1.2 ? -p.vz * 0.3 : 0;
        // sliding on the ground
        const f = Math.exp(-(p.tilt ? 5 : 3) * dt);
        p.vx *= f;
        p.vy *= f;
        p.spin *= f;
      }
      this.draw(p);
      if (Math.hypot(p.vx, p.vy) < 0.05 && p.z === 0 && p.vz === 0 && !p.tiltRate) {
        p.moving = false;
        continue;
      }
      this.active[w++] = p;
    }
    this.active.length = w;
    // knocked-over things far behind the player go back to their places
    if (this.rnd() < 0.05) {
      for (const p of this.props) {
        if (!p.moved || p.moving || Math.hypot(p.hx - px, p.hy - py) < 110) continue;
        p.x = p.hx;
        p.y = p.hy;
        p.h = p.hh;
        p.z = p.vx = p.vy = p.vz = p.spin = p.tilt = p.tiltRate = 0;
        p.moved = false;
        this.draw(p);
      }
    }
    return { drag, hit };
  }

  private wake(p: Prop) {
    p.moved = true;
    if (!p.moving) {
      p.moving = true;
      this.active.push(p);
    }
  }

  private rnd() {
    return hash(this.seed++ * 7 + 3);
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.group.clear();
  }
}
