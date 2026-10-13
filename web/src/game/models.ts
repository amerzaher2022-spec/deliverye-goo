// Low-poly but properly proportioned models: delivery hatchback, 125cc scooter,
// city bicycle, riders and pedestrians. Built from extruded profiles and
// capsules with physically based materials so they read as vehicles and
// people rather than toys. All dimensions are in metres; +Z is forward.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MAT = {
  paint: (color: string) => new THREE.MeshStandardMaterial({ color, metalness: 0.45, roughness: 0.32 }),
  glass: () => new THREE.MeshStandardMaterial({ color: '#141a1f', metalness: 0.85, roughness: 0.1 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: '#151516', metalness: 0, roughness: 0.92 }),
  rim: () => new THREE.MeshStandardMaterial({ color: '#b9bec3', metalness: 1, roughness: 0.28 }),
  plastic: (color = '#26282b') => new THREE.MeshStandardMaterial({ color, metalness: 0.05, roughness: 0.65 }),
  fabric: (color: string) => new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.85 }),
  skin: () => new THREE.MeshStandardMaterial({ color: '#b98a66', metalness: 0, roughness: 0.7 }),
  light: (color: string, emissive: string) => new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 0.9, roughness: 0.3 }),
};

/** Merge geometries of mixed kinds (indexed or not, extra attributes) safely. */
export function mergeSafe(list: THREE.BufferGeometry[]) {
  return mergeGeometries(
    list.map((g) => {
      const out = g.index ? g.toNonIndexed() : g.clone();
      for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(k)) out.deleteAttribute(k);
      if (!out.attributes.uv) out.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((out.attributes.position!.count) * 2), 2));
      return out;
    }),
  );
}

function profile(points: [number, number][]) {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  s.closePath();
  return s;
}

/** Extrude a side profile (x = length, y = height) across `width`, then orient it to +Z forward. */
function extrudeSide(points: [number, number][], width: number, bevel = 0.05) {
  const g = new THREE.ExtrudeGeometry(profile(points), {
    depth: width,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.translate(0, 0, -width / 2);
  g.rotateY(-Math.PI / 2); // profile x -> object +Z
  return g;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function wheelGeo(radius: number, width: number) {
  const tire = new THREE.CylinderGeometry(radius, radius, width, 20);
  tire.rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.01, 16);
  rim.rotateZ(Math.PI / 2);
  return { tire, rim };
}

export interface CarParts {
  body: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  wheelTire: THREE.BufferGeometry;
  wheelRim: THREE.BufferGeometry;
  wheelPositions: [number, number, number][];
  lights: { front: [number, number, number][]; rear: [number, number, number][] };
}

/** Five-door hatchback, 4.1 m long, 1.78 m wide. */
export function hatchbackParts(): CarParts {
  const W = 1.66;
  const body = extrudeSide(
    [
      [-2.02, 0.3],
      [-2.06, 0.78],
      [-1.94, 1.06],
      [-1.68, 1.42],
      [0.2, 1.47],
      [0.95, 1.02],
      [1.86, 0.88],
      [2.04, 0.62],
      [2.0, 0.3],
    ],
    W,
    0.06,
  );
  const pillar = boxAt(1.8, 0.4, 0.1, 0, 1.24, -0.52);
  const glass = extrudeSide(
    [
      [-1.86, 1.04],
      [-1.64, 1.38],
      [0.16, 1.42],
      [0.9, 1.02],
    ],
    W + 0.14,
    0,
  );
  const dark = mergeSafe([
    boxAt(1.8, 0.24, 0.22, 0, 0.36, 2.0), // front bumper
    boxAt(1.8, 0.26, 0.22, 0, 0.38, -1.98), // rear bumper
    boxAt(1.78, 0.08, 3.1, 0, 0.27, 0), // sill
    boxAt(0.62, 0.16, 0.04, 0, 0.62, 2.06), // grille
    boxAt(0.1, 0.1, 0.18, 0.92, 1.0, 0.82), // mirrors
    boxAt(0.1, 0.1, 0.18, -0.92, 1.0, 0.82),
  ]);
  const { tire, rim } = wheelGeo(0.31, 0.22);
  return {
    body: mergeSafe([body, pillar]),
    dark,
    glass,
    wheelTire: tire,
    wheelRim: rim,
    wheelPositions: [
      [-0.8, 0.31, 1.3],
      [0.8, 0.31, 1.3],
      [-0.8, 0.31, -1.28],
      [0.8, 0.31, -1.28],
    ],
    lights: {
      front: [
        [-0.62, 0.78, 2.0],
        [0.62, 0.78, 2.0],
      ],
      rear: [
        [-0.66, 0.9, -2.0],
        [0.66, 0.9, -2.0],
      ],
    },
  };
}

/** Merged geometry of a parked car for instancing: [painted body, everything dark]. */
export function parkedCarGeometries(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  const p = hatchbackParts();
  const tires = p.wheelPositions.map(([x, y, z]) => p.wheelTire.clone().translate(x, y, z));
  const rims = p.wheelPositions.map(([x, y, z]) => p.wheelRim.clone().translate(x, y, z));
  return [p.body, mergeSafe([p.dark, p.glass, ...tires, ...rims])];
}

/** A capsule limb between two points. */
export function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 2 + 0.02), 4, 8), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export interface RiderPose {
  hip: THREE.Vector3;
  shoulder: THREE.Vector3;
  hands: THREE.Vector3;
  feet: THREE.Vector3;
}

/** Courier in a charcoal jacket with a reflective band and a full-face helmet. */
export function rider(pose: RiderPose, jacket = '#3b3f45') {
  const g = new THREE.Group();
  const cloth = MAT.fabric(jacket);
  const trousers = MAT.fabric('#25262a');
  const skin = MAT.skin();
  const helmetMat = new THREE.MeshStandardMaterial({ color: '#d9d6cf', metalness: 0.25, roughness: 0.3 });
  const visor = new THREE.MeshStandardMaterial({ color: '#0b0d10', metalness: 0.9, roughness: 0.08 });
  const reflective = new THREE.MeshStandardMaterial({ color: '#d9a13a', emissive: '#4d3205', roughness: 0.5 });

  for (const side of [-1, 1]) {
    const hip = pose.hip.clone().add(V(0.11 * side, 0, 0));
    const knee = V(0.15 * side, pose.hip.y + 0.02, pose.hip.z + 0.38);
    const foot = pose.feet.clone().add(V(0.17 * side, 0, 0));
    g.add(limb(hip, knee, 0.075, trousers), limb(knee, foot, 0.06, trousers));
    const sh = pose.shoulder.clone().add(V(0.2 * side, -0.02, 0));
    const hand = pose.hands.clone().add(V(0.26 * side, 0, 0));
    const elbow = sh.clone().lerp(hand, 0.5).add(V(0.05 * side, -0.08, -0.02));
    g.add(limb(sh, elbow, 0.055, cloth), limb(elbow, hand, 0.045, cloth));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), MAT.plastic('#1a1b1d'));
    glove.position.copy(hand);
    g.add(glove);
  }
  const torso = limb(pose.hip, pose.shoulder, 0.17, cloth);
  g.add(torso);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.05, 16, 1, true), reflective);
  band.position.copy(pose.hip.clone().lerp(pose.shoulder, 0.55));
  band.quaternion.copy(torso.quaternion);
  g.add(band);
  const neck = pose.shoulder.clone().add(V(0, 0.1, 0.02));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 14, 10), skin);
  head.position.copy(neck).add(V(0, 0.1, 0.02));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 18, 12), helmetMat);
  helmet.scale.set(1, 1.02, 1.12);
  helmet.position.copy(head.position).add(V(0, 0.03, -0.01));
  const vis = new THREE.Mesh(new THREE.SphereGeometry(0.147, 16, 8, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.36, Math.PI * 0.26), visor);
  vis.scale.copy(helmet.scale);
  vis.position.copy(helmet.position);
  g.add(head, helmet, vis);
  g.traverse((o) => (o.castShadow = true));
  return bakeStatic(g);
}

/** Standing person (shop staff / customer), optionally holding a parcel. */
export function pedestrian(shirt: string, parcel = true) {
  const g = new THREE.Group();
  const cloth = MAT.fabric(shirt);
  const legs = MAT.fabric('#2c2e33');
  const skin = MAT.skin();
  for (const s of [-1, 1]) {
    g.add(limb(V(0.1 * s, 0.92, 0), V(0.1 * s, 0.48, 0.02), 0.075, legs), limb(V(0.1 * s, 0.48, 0.02), V(0.1 * s, 0.07, 0), 0.06, legs));
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.24), MAT.plastic('#1b1b1c'));
    shoe.position.set(0.1 * s, 0.035, 0.05);
    g.add(shoe);
    const sh = V(0.21 * s, 1.42, 0);
    const hand = parcel ? V(0.16 * s, 1.08, 0.3) : V(0.24 * s, 0.86, 0.02);
    g.add(limb(sh, hand, 0.05, cloth));
  }
  g.add(limb(V(0, 0.95, 0), V(0, 1.42, 0), 0.17, cloth));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), skin);
  head.position.set(0, 1.66, 0.01);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), MAT.fabric('#1d1a17'));
  hair.position.copy(head.position).add(V(0, 0.01, -0.01));
  g.add(head, hair);
  if (parcel) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.28, 0.32), new THREE.MeshStandardMaterial({ color: '#b48a5a', roughness: 0.9 }));
    box.position.set(0, 1.12, 0.36);
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.04, 0.33), new THREE.MeshStandardMaterial({ color: '#d8cbb3', roughness: 0.6 }));
    tape.position.copy(box.position).add(V(0, 0.12, 0));
    g.add(box, tape);
  }
  g.traverse((o) => (o.castShadow = true));
  return bakeStatic(g);
}

export interface VehicleModel {
  root: THREE.Group;
  /** rotate about X with distance travelled */
  wheels: THREE.Object3D[];
  /** steer about Y */
  steer: THREE.Object3D[];
  /** roll for two-wheelers */
  lean: THREE.Group;
  rider: THREE.Object3D | null;
  /** the rider's head (hidden in first-person view so the arms and hands stay visible) */
  riderHead?: THREE.Object3D | null;
  /** rider eye position in the vehicle frame, for the first-person camera */
  eye?: THREE.Vector3;
  /** fraction of the steering angle shown on the front wheel */
  steerScale?: number;
}

function wheelObject(radius: number, width: number, spokes = 0) {
  const { tire, rim } = wheelGeo(radius, width);
  const w = new THREE.Group();
  w.add(new THREE.Mesh(tire, MAT.rubber()), new THREE.Mesh(rim, MAT.rim()));
  if (spokes) {
    for (let i = 0; i < spokes; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(width + 0.015, radius * 1.1, 0.03), MAT.plastic('#3a3d41'));
      s.rotation.x = (i / spokes) * Math.PI;
      w.add(s);
    }
  }
  w.traverse((o) => (o.castShadow = true));
  return bakeStatic(w);
}

export function buildCar(paint = '#eceae5'): VehicleModel {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const p = hatchbackParts();
  const body = new THREE.Mesh(p.body, MAT.paint(paint));
  const dark = new THREE.Mesh(p.dark, MAT.plastic('#202225'));
  const glass = new THREE.Mesh(p.glass, MAT.glass());
  // courier livery: graphite band with an amber pinstripe along the doors
  const band = new THREE.Mesh(new THREE.BoxGeometry(1.79, 0.16, 2.3), MAT.paint('#2b2d31'));
  band.position.set(0, 0.62, 0.05);
  const pin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.03, 2.3), MAT.paint('#d98a1e'));
  pin.position.set(0, 0.72, 0.05);
  lean.add(body, dark, glass, band, pin);
  for (const [x, y, z] of p.lights.front) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), MAT.light('#f4f1e8', '#fff6dc'));
    l.position.set(x, y, z);
    lean.add(l);
  }
  for (const [x, y, z] of p.lights.rear) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.12, 0.06), MAT.light('#7e1414', '#5a0606'));
    l.position.set(x, y, z);
    lean.add(l);
  }
  const wheels: THREE.Object3D[] = [];
  const steer: THREE.Object3D[] = [];
  for (const [x, y, z] of p.wheelPositions) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const w = wheelObject(0.31, 0.22, 5);
    pivot.add(w);
    lean.add(pivot);
    wheels.push(w);
    if (z > 0) steer.push(pivot);
  }
  lean.traverse((o) => (o.castShadow = true));
  bakeStatic(lean, [...steer, ...wheels]);
  return { root, wheels, steer, lean, rider: null };
}

export function buildScooter(): VehicleModel {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const paint = MAT.paint('#2f3236');
  // rear body under the seat
  const rear = new THREE.Mesh(
    extrudeSide(
      [
        [-0.82, 0.42],
        [-0.86, 0.66],
        [-0.6, 0.82],
        [-0.02, 0.8],
        [0.08, 0.5],
        [-0.2, 0.36],
      ],
      0.34,
      0.05,
    ),
    paint,
  );
  const floor = new THREE.Mesh(boxAt(0.36, 0.08, 0.62, 0, 0.36, 0.32), MAT.plastic('#1d1f22'));
  const shield = new THREE.Mesh(
    extrudeSide(
      [
        [0.62, 0.34],
        [0.82, 0.62],
        [0.86, 1.02],
        [0.74, 1.06],
        [0.66, 0.66],
        [0.52, 0.4],
      ],
      0.36,
      0.04,
    ),
    paint,
  );
  const seat = new THREE.Mesh(
    extrudeSide(
      [
        [-0.74, 0.82],
        [-0.66, 0.92],
        [0.0, 0.9],
        [0.04, 0.82],
      ],
      0.3,
      0.04,
    ),
    MAT.plastic('#141516'),
  );
  const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), MAT.rim());
  fork.position.set(0, 0.6, 0.86);
  fork.rotation.x = -0.35;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.66, 8), MAT.plastic('#191a1c'));
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.1, 0.74);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), MAT.light('#f4f1e8', '#fff6dc'));
  head.position.set(0, 0.98, 0.9);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.04), MAT.light('#7e1414', '#5a0606'));
  tail.position.set(0, 0.68, -0.86);
  // delivery top box: graphite with an amber reflective strip
  const box = new THREE.Mesh(boxAt(0.46, 0.4, 0.44, 0, 1.18, -0.72), MAT.plastic('#33363b'));
  const back = new THREE.Mesh(boxAt(0.3, 0.1, 0.01, 0, 1.14, -0.945), new THREE.MeshStandardMaterial({ color: '#e7a640', emissive: '#6b4307', roughness: 0.4 }));
  lean.add(back);
  const strip = new THREE.Mesh(boxAt(0.47, 0.04, 0.45, 0, 1.24, -0.72), new THREE.MeshStandardMaterial({ color: '#d9a13a', emissive: '#4d3205', roughness: 0.5 }));
  const rack = new THREE.Mesh(boxAt(0.3, 0.04, 0.4, 0, 0.96, -0.7), MAT.rim());
  lean.add(rear, floor, shield, seat, fork, bar, head, tail, box, strip, rack);
  const fw = wheelObject(0.24, 0.11, 5);
  const rw = wheelObject(0.24, 0.12, 5);
  const fp = new THREE.Group();
  fp.position.set(0, 0.24, 0.92);
  fp.add(fw);
  rw.position.set(0, 0.24, -0.58);
  lean.add(fp, rw);
  const r = rider({ hip: V(0, 0.98, -0.3), shoulder: V(0, 1.5, -0.12), hands: V(0, 1.1, 0.68), feet: V(0, 0.42, 0.34) });
  lean.add(r);
  lean.traverse((o) => (o.castShadow = true));
  bakeStatic(lean, [fp, rw, r]);
  return { root, wheels: [fw, rw], steer: [fp], lean, rider: r };
}

export function buildBicycle(): VehicleModel {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const frame = MAT.paint('#3c4249');
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.022) => limb(a, b, r, frame);
  const rearHub = V(0, 0.34, -0.52);
  const frontHub = V(0, 0.34, 0.56);
  const crank = V(0, 0.3, -0.02);
  const seatTop = V(0, 0.86, -0.2);
  const headTop = V(0, 0.92, 0.42);
  lean.add(
    tube(crank, seatTop),
    tube(crank, headTop.clone().add(V(0, -0.14, 0))),
    tube(seatTop.clone().add(V(0, -0.06, 0)), headTop),
    tube(rearHub, crank, 0.016),
    tube(rearHub, seatTop.clone().add(V(0, -0.06, 0)), 0.016),
    tube(headTop, frontHub, 0.02),
  );
  const saddle = new THREE.Mesh(boxAt(0.14, 0.05, 0.26, 0, 0.9, -0.22), MAT.plastic('#141516'));
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.56, 8), MAT.plastic('#191a1c'));
  bar.rotation.z = Math.PI / 2;
  bar.position.set(0, 1.0, 0.4);
  const rack = new THREE.Mesh(boxAt(0.26, 0.03, 0.34, 0, 0.74, -0.52), MAT.rim());
  const box = new THREE.Mesh(boxAt(0.4, 0.34, 0.36, 0, 0.93, -0.54), MAT.plastic('#232528'));
  const strip = new THREE.Mesh(boxAt(0.41, 0.035, 0.37, 0, 0.98, -0.54), new THREE.MeshStandardMaterial({ color: '#d9a13a', emissive: '#4d3205', roughness: 0.5 }));
  lean.add(saddle, bar, rack, box, strip);
  const ring = (pos: THREE.Vector3) => {
    const w = new THREE.Group();
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.022, 8, 28), MAT.rubber());
    tyre.rotation.y = Math.PI / 2;
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.01, 6, 28), MAT.rim());
    rimRing.rotation.y = Math.PI / 2;
    w.add(tyre, rimRing);
    for (let i = 0; i < 8; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.6, 0.006), MAT.rim());
      sp.rotation.x = (i / 8) * Math.PI;
      w.add(sp);
    }
    w.position.copy(pos);
    return w;
  };
  const rw = ring(rearHub);
  const fp = new THREE.Group();
  fp.position.copy(frontHub);
  const fw = ring(V(0, 0, 0));
  fp.add(fw);
  lean.add(rw, fp);
  const r = rider({ hip: V(0, 0.98, -0.22), shoulder: V(0, 1.46, 0.02), hands: V(0, 1.02, 0.4), feet: V(0, 0.36, 0.02) });
  lean.add(r);
  lean.traverse((o) => (o.castShadow = true));
  bakeStatic(lean, [fp, rw, r]);
  return { root, wheels: [rw, fw], steer: [fp], lean, rider: r };
}

function materialKey(m: THREE.Material): string {
  const a = m as THREE.MeshStandardMaterial;
  return [
    m.type,
    a.color?.getHexString(),
    a.map?.uuid ?? (a.map === null ? '' : 'pending'),
    a.emissive?.getHexString(),
    a.emissiveIntensity,
    a.metalness,
    a.roughness,
    m.side,
    m.transparent,
    m.opacity,
    (a as unknown as { vertexColors?: boolean }).vertexColors,
  ].join('|');
}

/**
 * Merge every static mesh under `root` into one mesh per distinct material,
 * so a detailed storefront or rider costs a handful of draw calls instead of
 * dozens. Subtrees in `skip` (wheels, animated parts) are left alone.
 * Materials whose texture is still loading are kept as they are (same object),
 * so the async sign painter still finds them.
 */
export function bakeStatic(root: THREE.Object3D, skip: THREE.Object3D[] = []) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const skipSet = new Set(skip);
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[]; shadow: boolean }>();
  const remove: THREE.Mesh[] = [];
  const skipped = (o: THREE.Object3D) => {
    for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) if (skipSet.has(p)) return true;
    return false;
  };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || Array.isArray(m.material) || o === root || skipped(o) || m.userData.live) return;
    const mat = m.material as THREE.Material;
    // signs paint their texture later: keep their own material object in its own bucket
    const key = (mat.userData.unique ? mat.uuid : materialKey(mat)) as string;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, geos: [], shadow: false }));
    b.geos.push(m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld)));
    b.shadow ||= m.castShadow;
    remove.push(m);
  });
  for (const m of remove) {
    m.parent?.remove(m);
    m.geometry.dispose();
  }
  for (const { mat, geos, shadow } of buckets.values()) {
    const mesh = new THREE.Mesh(mergeSafe(geos), mat);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return root;
}
