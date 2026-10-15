// People standing on the pavement outside businesses. When the figures can be rigged (rig.ts) each one
// is a moving person who turns to watch a rider go past, and now and then waves when the rider stops
// close by; otherwise the crowd is merged into one still mesh per material. Each person also gets a
// small collision box, so riders have to go around them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Merchant } from '../../../shared/types';
import type { Box } from './collision';
import { hasModel, person, type PersonId } from './assets';
import { Figure, canRig } from './rig';
import type { MerchantFrame } from './merchants';

export const CROWD_SIZE = { low: 0, medium: 7, high: 14 } as const;

const PASSERS: PersonId[] = ['young_man', 'woman_coat', 'kurdish_man'];

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  return x / 4294967296;
}

/** Who stands outside a business. */
export function crowdRole(m: Merchant, k: number): PersonId {
  if (m.building_type === 'factory' || m.building_type === 'warehouse') return k % 2 ? 'worker' : PASSERS[(m.id + k) % PASSERS.length]!;
  return PASSERS[(m.id * 3 + k) % PASSERS.length]!;
}

export class Crowd {
  readonly group = new THREE.Group();
  boxes: Box[] = [];
  private figures: { fig: Figure; x: number; y: number; h: number; look: number; wave: number; friendly: boolean }[] = [];

  constructor() {
    this.group.name = 'crowd';
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    this.boxes = [];
    for (const f of this.figures) f.fig.dispose();
    this.figures = [];
  }

  /** Heads turn to follow a rider passing within ~18 m; friendly ones wave when the rider stops close. */
  update(t: number, px: number, py: number, speed: number) {
    for (const [i, p] of this.figures.entries()) {
      const dx = px - p.x;
      const dy = py - p.y;
      const d = Math.hypot(dx, dy);
      if (d > 60) continue;
      const fx = Math.sin(p.h);
      const fy = Math.cos(p.h);
      const want = d < 18 ? Math.max(-1, Math.min(1, Math.atan2(fx * dy - fy * dx, fx * dx + fy * dy) / 1.4)) : Math.sin(t * 0.3 + i * 1.7) * 0.4;
      p.look += (want - p.look) * 0.06;
      const wave = p.friendly && d < 9 && Math.abs(speed) < 1.2;
      p.wave = Math.max(0, Math.min(1, p.wave + (wave ? 0.04 : -0.04)));
      p.fig.pose({ speed: 0, phase: 0, look: p.look, gesture: p.wave > 0 ? 'wave' : 'none', amount: p.wave, t: t + i });
    }
  }

  /** Place up to `count` people outside the given businesses (deterministic for a given list). */
  build(views: { merchant: Merchant; frame: MerchantFrame }[], count: number) {
    this.clear();
    if (!count || !hasModel('people')) return;
    const sorted = [...views].sort((a, b) => a.merchant.id - b.merchant.id);
    const tmp = new THREE.Group();
    let placed = 0;
    for (let round = 0; round < 2 && placed < count; round++) {
      for (const { merchant: m, frame: f } of sorted) {
        if (placed >= count) break;
        const r = hash(m.id * 31 + round * 7);
        if (round === 1 && r < 0.5) continue;
        const role = crowdRole(m, round);
        const fig = canRig(role) ? new Figure(role) : null;
        const p = fig ? fig.root : person(role);
        if (!p) continue;
        // on the pavement between the shopfront and the kerb, off to one side of the entrance
        const side = (round === 0 ? 1 : -1) * (r < 0.5 ? 1 : -1);
        const along = side * Math.min(Math.max(f.box.hw * 0.55, 3.2), 7);
        const towardKerb = 0.35 + 0.25 * hash(m.id + round);
        const x = f.entrance.x + (f.pickup.x - f.entrance.x) * towardKerb + f.box.ux * along;
        const y = f.entrance.y + (f.pickup.y - f.entrance.y) * towardKerb + f.box.uy * along;
        // mostly facing the street, turned a little left or right
        const turn = (hash(m.id * 13 + round) - 0.5) * 1.6;
        const dx = f.front.x * Math.cos(turn) - f.front.y * Math.sin(turn);
        const dy = f.front.x * Math.sin(turn) + f.front.y * Math.cos(turn);
        p.position.set(x, 0, -y);
        p.rotation.y = Math.atan2(dx, -dy);
        if (fig) {
          this.group.add(p);
          this.figures.push({ fig, x, y, h: Math.atan2(dx, dy), look: 0, wave: 0, friendly: hash(m.id * 5 + round) < 0.6 });
        } else tmp.add(p);
        this.boxes.push({ cx: x, cy: y, ux: 1, uy: 0, hw: 0.35, hd: 0.35, id: `p${m.id}-${round}` });
        placed++;
      }
    }
    tmp.updateMatrixWorld(true);
    const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
    tmp.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || Array.isArray(mesh.material)) return;
      const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
      const list = buckets.get(mesh.material) ?? [];
      list.push(g);
      buckets.set(mesh.material, list);
    });
    for (const [mat, geos] of buckets) {
      const merged = mergeGeometries(geos);
      for (const g of geos) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }
}
