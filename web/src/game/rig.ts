// Moving people. The townspeople in people.glb are baked as still meshes; here they get a skeleton
// at load time so they can walk, step out of the way, look round and wave.
//
// The bones come from the same skeletons the figures were sculpted around (tools/models/rig.py writes
// them to people.rig.json), so every joint sits exactly where the mesh bends. Skin weights are worked
// out from how close each vertex is to each bone, with the trunk treated as wider than it is deep so
// that hips and ribs follow the body rather than a hanging arm.

import * as THREE from 'three';
import { cloneNode, peopleRig, type PersonId } from './assets';

interface RigBone {
  name: string;
  parent: string | null;
  head: [number, number, number];
  tail: [number, number, number];
}

/** thickness of each body part around its bone (m) */
const RADIUS: Record<string, number> = {
  pelvis: 0.12,
  spine: 0.11,
  chest: 0.12,
  neck: 0.05,
  head: 0.09,
  clav: 0.03,
  uarm: 0.045,
  farm: 0.038,
  hand: 0.03,
  thigh: 0.075,
  shin: 0.05,
  foot: 0.04,
};
const TRUNK = new Set(['pelvis', 'spine', 'chest']);

interface Skinned {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  bones: RigBone[];
}
const cache = new Map<PersonId, Skinned | null>();

function segmentDistance(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, sx: number) {
  // distance from p to segment ab, with x scaled by 1/sx (sx > 1 makes the part wider than deep)
  const ax = a.x / sx, bx = b.x / sx, px = p.x / sx;
  const dx = bx - ax, dy = b.y - a.y, dz = b.z - a.z;
  const len2 = dx * dx + dy * dy + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (p.y - a.y) * dy + (p.z - a.z) * dz) / len2));
  const qx = ax + dx * t - px, qy = a.y + dy * t - p.y, qz = a.z + dz * t - p.z;
  return Math.sqrt(qx * qx + qy * qy + qz * qz);
}

function build(id: PersonId): Skinned | null {
  const bones = (peopleRig() as Record<string, RigBone[]> | null)?.[id];
  const node = cloneNode('people', id);
  const src = node?.getObjectByName(`${id}_body`) as THREE.Mesh | undefined;
  if (!bones || !src?.isMesh) return null;
  src.updateWorldMatrix(true, false);
  const geometry = src.geometry.clone();
  geometry.applyMatrix4(new THREE.Matrix4().copy(node!.matrixWorld).invert().multiply(src.matrixWorld));
  const pos = geometry.attributes.position!;
  const n = pos.count;
  const index = new Uint16Array(n * 4);
  const weight = new Float32Array(n * 4);
  const heads = bones.map((b) => new THREE.Vector3(...b.head));
  // the hand bone ends at the knuckles: reach on over the fingers
  const tails = bones.map((b, k) => {
    const t = new THREE.Vector3(...b.tail);
    return b.name.startsWith('hand') ? t.sub(heads[k]!).multiplyScalar(2.3).add(heads[k]!) : t;
  });
  const pelvisY = heads[0]!.y;
  const neckY = heads[bones.findIndex((b) => b.name === 'neck')]!.y;
  const p = new THREE.Vector3();
  const w = new Float32Array(bones.length);
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i);
    for (let k = 0; k < bones.length; k++) {
      const name = bones[k]!.name;
      const part = name.split('.')[0]!;
      const side = name.endsWith('.L') ? 1 : name.endsWith('.R') ? -1 : 0;
      let ok = true;
      // arms only claim the outside of the body; legs only below the hips; head and neck only above the chest
      if (part === 'clav') ok = p.x * side > 0.02;
      else if (part === 'uarm') ok = p.x * side > 0.14;
      else if (part === 'farm' || part === 'hand') ok = p.x * side > 0.05;
      else if (part === 'thigh' || part === 'shin' || part === 'foot') ok = p.y < pelvisY + 0.06 && p.x * side > -0.04;
      else if (part === 'head' || part === 'neck') ok = p.y > neckY - 0.08;
      if (!ok) {
        w[k] = 0;
        continue;
      }
      const d = Math.max(0, segmentDistance(p, heads[k]!, tails[k]!, TRUNK.has(part) ? 1.5 : 1) - RADIUS[part]!);
      w[k] = 1 / Math.pow(d + 0.012, 5);
    }
    // keep the four strongest
    const order = Array.from(w.keys()).sort((a, b) => w[b]! - w[a]!).slice(0, 4);
    let sum = 0;
    for (const k of order) sum += w[k]!;
    order.forEach((k, j) => {
      index[i * 4 + j] = k;
      weight[i * 4 + j] = sum > 0 ? w[k]! / sum : j === 0 ? 1 : 0;
    });
  }
  // where a hanging hand was baked touching the hip, the surface joins them: drop those few joining
  // triangles so the hand comes away cleanly instead of pulling a strip of cloth with it
  const chain = (v: number) => {
    const name = bones[index[v * 4]!]!.name;
    if (name.startsWith('farm') || name.startsWith('hand')) return 'arm';
    if (name === 'pelvis' || name === 'spine' || name.startsWith('thigh')) return 'hip';
    return 'other';
  };
  if (geometry.index) {
    const src = geometry.index.array;
    const kept: number[] = [];
    for (let t = 0; t < src.length; t += 3) {
      const c = [chain(src[t]!), chain(src[t + 1]!), chain(src[t + 2]!)];
      if (c.includes('arm') && c.includes('hip')) continue;
      kept.push(src[t]!, src[t + 1]!, src[t + 2]!);
    }
    geometry.setIndex(kept);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
  return { geometry, material: src.material, bones };
}

/** Can this person be animated (model and rig loaded)? */
export function canRig(id: PersonId) {
  if (!cache.has(id)) cache.set(id, build(id));
  return !!cache.get(id);
}

export type Gesture = 'none' | 'wave' | 'startle' | 'shrug';

export interface PoseInput {
  /** walking speed (m/s); 0 = standing */
  speed: number;
  /** walk cycle phase (radians), advanced by the caller */
  phase: number;
  /** -1..1: turn the head to look left (+) or right (-) */
  look: number;
  gesture: Gesture;
  /** 0..1 how far into the gesture */
  amount: number;
  /** seconds, for idle breathing and waving */
  t: number;
}

const d2r = Math.PI / 180;

/** One animated person: `root` goes in the scene, origin at the feet, facing +z. */
export class Figure {
  readonly root = new THREE.Group();
  readonly mesh: THREE.SkinnedMesh;
  private b: Record<string, THREE.Bone> = {};
  private rest: Record<string, THREE.Vector3> = {};
  private e = new THREE.Euler();
  private legLength: number;

  constructor(readonly id: PersonId) {
    const s = cache.get(id) ?? build(id);
    if (!s) throw new Error(`no rig for ${id}`);
    cache.set(id, s);
    const bones: THREE.Bone[] = [];
    const byName = new Map<string, RigBone>();
    for (const rb of s.bones) byName.set(rb.name, rb);
    for (const rb of s.bones) {
      const bone = new THREE.Bone();
      bone.name = rb.name;
      const parent = rb.parent ? byName.get(rb.parent) : null;
      bone.position.set(rb.head[0] - (parent?.head[0] ?? 0), rb.head[1] - (parent?.head[1] ?? 0), rb.head[2] - (parent?.head[2] ?? 0));
      this.b[rb.name] = bone;
      this.rest[rb.name] = bone.position.clone();
      bones.push(bone);
    }
    for (const rb of s.bones) if (rb.parent) this.b[rb.parent]!.add(this.b[rb.name]!);
    this.mesh = new THREE.SkinnedMesh(s.geometry, s.material);
    this.mesh.add(this.b.pelvis!);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(bones));
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.userData.shared = true;
    this.root.add(this.mesh);
    const th = byName.get('thigh.L')!;
    const sh = byName.get('shin.L')!;
    this.legLength = th.head[1] - sh.tail[1];
  }

  private rot(name: string, x: number, y = 0, z = 0) {
    const bone = this.b[name];
    if (bone) bone.quaternion.setFromEuler(this.e.set(x * d2r, y * d2r, z * d2r, 'YXZ'));
  }

  /** Set the whole body for this frame. */
  pose(i: PoseInput) {
    const walk = Math.min(1, i.speed / 1.3);
    const s = Math.sin(i.phase);
    const c = Math.cos(i.phase);
    const g = i.gesture === 'none' ? 0 : i.amount;
    // legs: hips swing (forward = negative about x), knees fold in the swing, feet stay level
    const hipA = 24 * walk;
    const legs: [string, number][] = [
      ['L', s],
      ['R', -s],
    ];
    let drop = 0;
    for (const [side, k] of legs) {
      const hip = -hipA * k;
      const swing = side === 'L' ? c : -c;
      const knee = walk * (6 + 48 * Math.pow(Math.max(0, swing), 2)) + (i.gesture === 'startle' ? 18 * g : 0);
      this.rot(`thigh.${side}`, hip - (i.gesture === 'startle' ? 10 * g : 0));
      this.rot(`shin.${side}`, knee);
      this.rot(`foot.${side}`, -(hip + knee) * 0.85 + walk * 8 * Math.max(0, -swing));
      drop = Math.max(drop, this.legLength * (1 - Math.cos(hip * d2r)));
    }
    // pelvis: a little bob and sway, the chest turns against it
    const breathe = Math.sin(i.t * 1.7) * 0.6;
    this.b.pelvis!.position.set(
      this.rest.pelvis!.x + Math.sin(i.phase) * 0.012 * walk,
      this.rest.pelvis!.y - drop * 0.9 - 0.012 * walk * Math.abs(c) - (i.gesture === 'startle' ? 0.06 * g : 0),
      this.rest.pelvis!.z,
    );
    this.rot('pelvis', i.gesture === 'startle' ? -8 * g : 2 * walk, 6 * s * walk, 2.5 * c * walk);
    this.rot('spine', 3 * walk + (i.gesture === 'startle' ? 12 * g : 0), -3 * s * walk, 0);
    this.rot('chest', breathe, -4 * s * walk, -2 * c * walk);
    // head stays steady and can look round
    this.rot('neck', 0, 25 * i.look, 0);
    this.rot('head', -2 * walk, 30 * i.look - 6 * s * walk * 0.3, 0);
    // arms swing against the legs
    const armA = 16 * walk;
    for (const [side, k, sx] of [
      ['L', -s, 1],
      ['R', s, -1],
    ] as [string, number, number][]) {
      let ux = armA * k;
      let uz = 0;
      let fx = -8 - 10 * walk - 6 * Math.max(0, -k) * walk;
      let fz = 0;
      // gestures move the arms forward rather than out to the side: the sleeves are part of the coat
      if (i.gesture === 'startle') {
        // hands come up in front of the chest
        ux = ux * (1 - g) - 38 * g;
        fx = fx * (1 - g) - 100 * g;
      } else if (i.gesture === 'shrug') {
        ux = ux * (1 - g) - 12 * g;
        fx = fx * (1 - g) - 80 * g;
        fz = -sx * 35 * g;
      } else if (i.gesture === 'wave' && side === 'R') {
        // right hand up at shoulder height, waving from the elbow
        ux = ux * (1 - g) - 42 * g;
        uz = -12 * g;
        fx = fx * (1 - g) - 115 * g;
        fz = (-10 + 24 * Math.sin(i.t * 8)) * g;
      }
      this.rot(`clav.${side}`, 0, 0, i.gesture === 'shrug' ? sx * 8 * g : 0);
      this.rot(`uarm.${side}`, ux, 0, uz);
      this.rot(`farm.${side}`, fx, 0, fz);
      this.rot(`hand.${side}`, 0, 0, 0);
    }
  }

  dispose() {
    this.mesh.skeleton.dispose();
  }
}
