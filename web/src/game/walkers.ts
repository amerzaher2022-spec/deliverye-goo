// People walking the pavements around the player. They follow the streets, turn back at walls and
// dead ends, wait at signalled junctions and cross while the cars on that street have a red light,
// jump out of the way of a rider coming at them, and stop and look round when someone sounds a horn.
// Only a handful are alive at once; they are moved to new pavements as the player rides on.

import * as THREE from 'three';
import type { LocalPoint } from '../../../shared/geo';
import { distanceToRoadEdge, type RoadGraph } from '../../../shared/roads';
import { hasModel, type PersonId } from './assets';
import { circleVsBox, type BoxGrid } from './collision';
import { Figure, canRig, type Gesture } from './rig';
import type { Traffic } from './traffic';
import type { Quality } from './world';
import { ROAD_TOP } from './world';

export const WALKERS: Record<Quality, number> = { low: 0, medium: 9, high: 18 };

const KINDS: PersonId[] = ['young_man', 'woman_coat', 'kurdish_man', 'worker'];
const PAVEMENT_Y = 0.055;
const ALIVE = 130;

interface Path {
  pts: LocalPoint[];
  cum: number[];
  len: number;
  width: number;
  road: string;
}

type State = 'walk' | 'pause' | 'wait' | 'cross' | 'look' | 'dodge';

interface Walker {
  fig: Figure;
  active: boolean;
  path: Path;
  s: number;
  dir: 1 | -1;
  side: 1 | -1;
  off: number;
  speed: number;
  phase: number;
  state: State;
  timer: number;
  /** sideways shove away from the lane (dodging), eased back to zero */
  ox: number;
  oy: number;
  /** crossing: from / to and progress */
  cross?: { ax: number; ay: number; bx: number; by: number; u: number; len: number; jx: number; jy: number };
  /** seconds before this person will think about crossing again */
  cooldown: number;
  look: number;
  lookTarget: number;
  gesture: Gesture;
  amount: number;
  x: number;
  y: number;
  h: number;
  /** last time this person was bumped (ms), to report a bump once */
  hitAt: number;
}

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  return (x >>> 0) / 4294967296;
}

export class Walkers {
  readonly group = new THREE.Group();
  private paths: Path[] = [];
  /** points every 15 m along the pavements, by 50 m square, for picking spots near the player */
  private spots = new Map<string, { p: Path; s: number }[]>();
  private list: Walker[] = [];
  private seed = 1;
  private time = 0;
  private frame = 0;

  constructor(
    private graph: RoadGraph,
    private grid: BoxGrid,
    private trafficOf: () => Traffic | null,
    quality: Quality,
  ) {
    this.group.name = 'walkers';
    const count = WALKERS[quality];
    if (!count || !hasModel('people')) return;
    const kinds = KINDS.filter((k) => canRig(k));
    if (!kinds.length) return;
    for (const { road, points } of graph.polylines) {
      if (points.length < 2 || points.some((p) => p.z)) continue;
      const cum = [0];
      for (let i = 1; i < points.length; i++) cum.push(cum[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y));
      const len = cum[cum.length - 1]!;
      if (len < 25) continue;
      const path = { pts: points, cum, len, width: road.width, road: road.id };
      this.paths.push(path);
      for (let d = 4; d < len - 4; d += 15) {
        const q = this.at(path, d, this.pt);
        const k = `${Math.floor(q.x / 50)},${Math.floor(q.y / 50)}`;
        const cell = this.spots.get(k);
        if (cell) cell.push({ p: path, s: d });
        else this.spots.set(k, [{ p: path, s: d }]);
      }
    }
    if (!this.paths.length) return;
    for (let i = 0; i < count; i++) {
      const fig = new Figure(kinds[i % kinds.length]!);
      fig.root.visible = false;
      this.group.add(fig.root);
      this.list.push({
        fig,
        active: false,
        path: this.paths[0]!,
        s: 0,
        dir: 1,
        side: 1,
        off: 2,
        speed: 1.3,
        phase: hash(i * 7) * 6.28,
        state: 'walk',
        timer: 0,
        ox: 0,
        oy: 0,
        look: 0,
        lookTarget: 0,
        gesture: 'none',
        amount: 0,
        x: 0,
        y: 0,
        h: 0,
        hitAt: 0,
        cooldown: 0,
      });
    }
  }

  get count() {
    return this.list.filter((w) => w.active).length;
  }

  /** where everybody is (for drivers to stop for them) */
  positions(): { x: number; y: number }[] {
    return this.list.filter((w) => w.active).map((w) => ({ x: w.x, y: w.y }));
  }

  private traffic() {
    return this.trafficOf();
  }

  private rand() {
    return hash(this.seed++ * 13 + 5);
  }

  private at(p: Path, s: number, out: { x: number; y: number; tx: number; ty: number }) {
    s = Math.max(0, Math.min(p.len, s));
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i]! < s) i++;
    const a = p.pts[i - 1]!;
    const b = p.pts[i]!;
    const seg = p.cum[i]! - p.cum[i - 1]! || 1;
    const u = (s - p.cum[i - 1]!) / seg;
    out.tx = (b.x - a.x) / seg;
    out.ty = (b.y - a.y) / seg;
    out.x = a.x + (b.x - a.x) * u;
    out.y = a.y + (b.y - a.y) * u;
    return out;
  }

  private pt = { x: 0, y: 0, tx: 0, ty: 0 };

  /** the pavement spot of a walker on its path */
  private lanePos(w: Walker, s: number) {
    const q = this.at(w.path, s, this.pt);
    // right-hand normal of the path direction is (ty, -tx)
    return { x: q.x + q.ty * w.side * w.off, y: q.y - q.tx * w.side * w.off, tx: q.tx * w.dir, ty: q.ty * w.dir };
  }

  /** is a pavement spot clear of buildings and off the asphalt of any other road? */
  private clear(x: number, y: number) {
    if (distanceToRoadEdge(this.graph, { x, y }) < 0.7) return false;
    for (const b of this.grid.near(x, y, 4)) {
      if (b.enabled === false || (b.z1 !== undefined && b.z1 < 0)) continue;
      if (circleVsBox(x, y, 0.35, b)) return false;
    }
    return true;
  }

  private place(w: Walker, px: number, py: number, near: boolean) {
    const spots: { p: Path; s: number }[] = [];
    const r = Math.ceil(ALIVE / 50);
    const cx = Math.floor(px / 50);
    const cy = Math.floor(py / 50);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) spots.push(...(this.spots.get(`${cx + i},${cy + j}`) ?? []));
    if (!spots.length) return false;
    for (let attempt = 0; attempt < 14; attempt++) {
      const pick = spots[Math.floor(this.rand() * spots.length)]!;
      const p = pick.p;
      const s = Math.max(2, Math.min(p.len - 2, pick.s + (this.rand() - 0.5) * 14));
      const q = this.at(p, s, this.pt);
      const d = Math.hypot(q.x - px, q.y - py);
      if (d > ALIVE - 15 || (!near && d < 55)) continue;
      w.path = p;
      w.s = s;
      w.side = this.rand() < 0.5 ? 1 : -1;
      w.dir = this.rand() < 0.5 ? 1 : -1;
      // pavements run 4.5 m out from the kerb
      w.off = p.width / 2 + 1.3 + this.rand() * 2.2;
      const l = this.lanePos(w, s);
      if (!this.clear(l.x, l.y)) continue;
      w.speed = 1.05 + this.rand() * 0.45;
      w.state = 'walk';
      w.ox = w.oy = 0;
      w.cross = undefined;
      w.gesture = 'none';
      w.amount = 0;
      w.active = true;
      w.x = l.x;
      w.y = l.y;
      w.h = Math.atan2(l.tx, l.ty);
      return true;
    }
    return false;
  }

  /** A horn at (x, y): people nearby stop and look; close ones throw up their hands. */
  horn(x: number, y: number) {
    for (const w of this.list) {
      if (!w.active || w.state === 'cross') continue;
      const d = Math.hypot(w.x - x, w.y - y);
      if (d > 24) continue;
      w.state = 'look';
      w.timer = 1.4 + this.rand() * 0.8;
      w.lookTarget = this.lookAt(w, x, y);
      if (d < 9) {
        w.gesture = 'shrug';
        w.amount = 0;
      }
    }
  }

  private lookAt(w: Walker, x: number, y: number) {
    // angle from facing to the target, -1..1 (left positive): facing (sin h, cos h), left = (-cos h, sin h)? in this frame
    const fx = Math.sin(w.h);
    const fy = Math.cos(w.h);
    const dx = x - w.x;
    const dy = y - w.y;
    const cross = fx * dy - fy * dx;
    const dot = fx * dx + fy * dy;
    return Math.max(-1, Math.min(1, Math.atan2(cross, dot) / 1.4));
  }

  /**
   * Move everybody. Returns how many people the player ran into this frame (each is reported once).
   * `player`: position, velocity (m/s along heading) and collision radius.
   */
  update(dt: number, player: { x: number; y: number; h: number; v: number; r: number }, nowMs: number, cam: THREE.Camera): number {
    if (!this.list.length) return 0;
    this.time += dt;
    this.frame++;
    let hits = 0;
    const pfx = Math.sin(player.h);
    const pfy = Math.cos(player.h);
    for (const [i, w] of this.list.entries()) {
      if (!w.active || Math.hypot(w.x - player.x, w.y - player.y) > ALIVE) {
        w.active = false;
        w.fig.root.visible = false;
        // stagger the respawns so they do not all appear in one frame
        if ((this.frame + i) % 15 === 0) this.place(w, player.x, player.y, this.time < 1);
        if (!w.active) continue;
      }
      // a rider coming straight at them: jump to the side
      const rx = w.x - player.x;
      const ry = w.y - player.y;
      const ahead = rx * pfx + ry * pfy;
      const lat = rx * pfy - ry * pfx;
      if (w.state !== 'dodge' && player.v > 2.5 && ahead > 0 && ahead < 3 + player.v * 0.9 && Math.abs(lat) < 1.6) {
        w.state = 'dodge';
        w.timer = 1.1;
        w.gesture = 'startle';
        w.amount = 0;
        const away = lat >= 0 ? 1 : -1;
        // shove perpendicular to the rider's path
        w.ox += pfy * away * 1.7;
        w.oy += -pfx * away * 1.7;
        w.lookTarget = this.lookAt(w, player.x, player.y);
      }
      this.step(w, dt);
      // ran into: report once a second at most
      if (Math.hypot(w.x - player.x, w.y - player.y) < player.r + 0.3 && nowMs - w.hitAt > 1500) {
        w.hitAt = nowMs;
        hits++;
        w.state = 'look';
        w.timer = 2.5;
        w.gesture = 'shrug';
        w.amount = 0;
        w.lookTarget = this.lookAt(w, player.x, player.y);
        const d = Math.hypot(rx, ry) || 1;
        w.ox += (rx / d) * 0.8;
        w.oy += (ry / d) * 0.8;
      }
      // draw
      const root = w.fig.root;
      root.visible = true;
      const onRoad = w.state === 'cross';
      root.position.set(w.x, onRoad ? ROAD_TOP : PAVEMENT_Y, -w.y);
      root.rotation.y = Math.PI - w.h;
      const dist = Math.hypot(rx, ry);
      // far people are posed every other frame
      if (dist < 45 || (this.frame + i) % 2 === 0) {
        w.look += (w.lookTarget - w.look) * Math.min(1, dt * 5);
        const g = w.gesture !== 'none';
        w.amount = g ? Math.min(1, w.amount + dt * 4) : Math.max(0, w.amount - dt * 3);
        const moving = w.state === 'walk' || w.state === 'cross' ? w.speed : w.state === 'dodge' ? 0.6 : 0;
        w.fig.pose({ speed: moving, phase: w.phase, look: w.look, gesture: w.gesture, amount: w.amount, t: this.time + i });
      }
      w.fig.mesh.castShadow = dist < 40;
    }
    void cam;
    return hits;
  }

  private step(w: Walker, dt: number) {
    // ease any dodge shove back to the lane
    const back = Math.min(1, dt * 0.8);
    w.ox -= w.ox * back;
    w.oy -= w.oy * back;
    if (w.timer > 0) w.timer -= dt;
    if (w.cooldown > 0) w.cooldown -= dt;
    switch (w.state) {
      case 'dodge':
      case 'look':
      case 'pause':
        if (w.timer <= 0) {
          w.state = 'walk';
          w.gesture = 'none';
          w.lookTarget = 0;
        }
        break;
      case 'wait': {
        // waiting at the kerb for the cars on this street to get a red light
        const c = w.cross!;
        const red = this.traffic()?.redFor(c.jx, c.jy, w.path.road) ?? -1;
        w.lookTarget = Math.sin(this.time * 0.7 + w.off) * 0.7;
        if (red > c.len / (w.speed * 1.25) + 1.5) {
          w.state = 'cross';
          w.lookTarget = 0;
        } else if (w.timer <= 0) {
          // waited long enough: walk back the way they came
          w.state = 'walk';
          w.cross = undefined;
          w.dir = (-w.dir) as 1 | -1;
          w.lookTarget = 0;
          w.cooldown = 20;
        }
        break;
      }
      case 'cross': {
        const c = w.cross!;
        const v = w.speed * 1.25;
        c.u += (v * dt) / c.len;
        w.phase += ((v * dt) / 1.45) * Math.PI;
        if (c.u >= 1) {
          // on the far pavement: carry on along it, away from the junction
          w.side = (-w.side) as 1 | -1;
          w.dir = (-w.dir) as 1 | -1;
          w.state = 'walk';
          w.cross = undefined;
          w.cooldown = 20;
          break;
        }
        w.x = c.ax + (c.bx - c.ax) * c.u + w.ox;
        w.y = c.ay + (c.by - c.ay) * c.u + w.oy;
        w.h = Math.atan2(c.bx - c.ax, c.by - c.ay);
        return;
      }
      case 'walk': {
        const ns = w.s + w.dir * w.speed * dt;
        w.phase += ((w.speed * dt) / 1.45) * Math.PI;
        const end = ns < 1.5 || ns > w.path.len - 1.5;
        const l = this.lanePos(w, ns);
        // nearing a signalled junction: wait at the kerb to cross this street while its cars are held
        if (w.cooldown <= 0 && w.path.width < 22) {
          const q = this.at(w.path, ns, { x: 0, y: 0, tx: 0, ty: 0 });
          const j = this.traffic()?.signalNear(q.x, q.y, 40);
          if (j && (j.x - q.x) * q.tx * w.dir + (j.y - q.y) * q.ty * w.dir > 0 && Math.hypot(j.x - q.x, j.y - q.y) < j.r + 2.6) {
            w.cooldown = 20;
            if ((this.traffic()?.redFor(j.x, j.y, w.path.road) ?? -1) >= 0 && this.rand() < 0.8) {
              const n = { x: q.ty * w.side, y: -q.tx * w.side };
              const half = w.path.width / 2 + 0.6;
              const ax = q.x + n.x * half;
              const ay = q.y + n.y * half;
              const bx = q.x - n.x * half;
              const by = q.y - n.y * half;
              w.s = ns;
              w.cross = { ax, ay, bx, by, u: 0, len: Math.hypot(bx - ax, by - ay), jx: j.x, jy: j.y };
              w.state = 'wait';
              w.timer = 40;
              w.x = ax;
              w.y = ay;
              w.h = Math.atan2(bx - ax, by - ay);
              return;
            }
          }
        }
        if (end || !this.clear(l.x, l.y)) {
          w.dir = (-w.dir) as 1 | -1;
          w.state = 'pause';
          w.timer = 0.6 + this.rand() * 2.5;
          break;
        }
        w.s = ns;
        w.x = l.x + w.ox;
        w.y = l.y + w.oy;
        // turn smoothly towards the walking direction
        const want = Math.atan2(l.tx, l.ty);
        let dh = want - w.h;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        w.h += dh * Math.min(1, dt * 6);
        return;
      }
    }
    if (w.state !== 'wait' && w.state !== 'cross') {
      const l = this.lanePos(w, w.s);
      w.x = l.x + w.ox;
      w.y = l.y + w.oy;
    }
  }

  dispose() {
    for (const w of this.list) w.fig.dispose();
    this.group.clear();
  }
}
