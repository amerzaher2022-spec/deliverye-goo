// Instanced meshes split into map squares. One InstancedMesh for a whole city is drawn (and every
// instance vertex-shaded) even when most of it is behind the camera or beyond the fog; one per square
// lets three.js skip the squares that are off screen. Same calls as InstancedMesh, by global index.

import * as THREE from 'three';

/**
 * Small detail (roof tanks, parked cars, decals...) is only drawn within a set distance of the camera:
 * past it the fog and the size on screen make it invisible anyway, but every vertex would still be
 * processed. Objects register here with their bounding sphere; `cullByDistance` runs a few times a
 * second.
 */
interface Limited {
  o: THREE.Object3D;
  x: number;
  z: number;
  r: number;
  max: number;
  min: number;
}
const limited: Limited[] = [];

/**
 * Draw `o` only while the camera is within `max` metres of its bounding sphere (and, for a distant
 * low-detail stand-in, at least `min` metres from its centre).
 */
export function limitDistance(o: THREE.Object3D, max: number, min = 0) {
  const geo = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
  let sphere: THREE.Sphere | null = null;
  if ((o as THREE.InstancedMesh).isInstancedMesh) {
    const im = o as THREE.InstancedMesh;
    if (!im.boundingSphere) im.computeBoundingSphere();
    sphere = im.boundingSphere;
  } else if (geo) {
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    sphere = geo.boundingSphere;
  }
  if (!sphere) return;
  limited.push({ o, x: sphere.center.x, z: sphere.center.z, r: sphere.radius, max, min });
}

export function cullByDistance(cam: THREE.Vector3) {
  let w = 0;
  for (let i = 0; i < limited.length; i++) {
    const l = limited[i]!;
    // forget objects that left the scene (the world was rebuilt)
    let root: THREE.Object3D = l.o;
    while (root.parent) root = root.parent;
    if (!(root as THREE.Scene).isScene) {
      if (l.o.parent) {
        limited[w++] = l;
        continue;
      }
      continue;
    }
    const d = Math.hypot(l.x - cam.x, l.z - cam.z);
    l.o.visible = d - l.r < l.max && d + (l.min ? l.r : 0) >= l.min;
    limited[w++] = l;
  }
  limited.length = w;
}

export class ChunkedInstances {
  readonly meshes: THREE.InstancedMesh[] = [];
  private where: { mesh: THREE.InstancedMesh; i: number }[] = [];

  /** `positions` are local-plane points (x east, y north), one per instance, in index order. */
  constructor(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    positions: { x: number; y: number }[],
    parent: THREE.Object3D,
    private opts: { cell?: number; castShadow?: boolean; receiveShadow?: boolean; maxDistance?: number } = {},
  ) {
    const cell = opts.cell ?? 220;
    const groups = new Map<string, number[]>();
    positions.forEach((p, i) => {
      const k = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
    });
    for (const list of groups.values()) {
      const mesh = new THREE.InstancedMesh(geo, material, list.length);
      mesh.castShadow = !!opts.castShadow;
      mesh.receiveShadow = opts.receiveShadow ?? true;
      list.forEach((g, i) => (this.where[g] = { mesh, i }));
      this.meshes.push(mesh);
      parent.add(mesh);
    }
  }

  get count() {
    return this.where.length;
  }

  setMatrixAt(index: number, m: THREE.Matrix4) {
    const w = this.where[index];
    if (w) w.mesh.setMatrixAt(w.i, m);
  }

  setColorAt(index: number, c: THREE.Color) {
    const w = this.where[index];
    if (w) w.mesh.setColorAt(w.i, c);
  }

  /** Call once every matrix is set: bounds for culling, and upload. */
  finish() {
    for (const m of this.meshes) {
      m.computeBoundingSphere();
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      if (this.opts.maxDistance) limitDistance(m, this.opts.maxDistance);
    }
  }

  markDirty() {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
