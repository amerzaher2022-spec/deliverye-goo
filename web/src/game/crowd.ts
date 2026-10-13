// People standing on the pavement outside businesses. They are static scenery:
// every person is a clone of a generated model, and the whole crowd is merged
// into one mesh per material so it costs a handful of draw calls. Each person
// also gets a small collision box, so riders have to go around them.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Merchant } from '../../../shared/types';
import type { Box } from './collision';
import { hasModel, person, type PersonId } from './assets';
import type { MerchantFrame } from './merchants';

export const CROWD_SIZE = { low: 0, medium: 7, high: 14 } as const;

const PASSERS: PersonId[] = ['jacket_man', 'woman_casual', 'cap_man'];

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

  constructor() {
    this.group.name = 'crowd';
  }

  clear() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      (c as THREE.Mesh).geometry?.dispose();
    }
    this.boxes = [];
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
        const p = person(crowdRole(m, round));
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
        tmp.add(p);
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
