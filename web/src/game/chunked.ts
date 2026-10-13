// Instanced meshes split into map squares. One InstancedMesh for a whole city is drawn (and every
// instance vertex-shaded) even when most of it is behind the camera or beyond the fog; one per square
// lets three.js skip the squares that are off screen. Same calls as InstancedMesh, by global index.

import * as THREE from 'three';

export class ChunkedInstances {
  readonly meshes: THREE.InstancedMesh[] = [];
  private where: { mesh: THREE.InstancedMesh; i: number }[] = [];

  /** `positions` are local-plane points (x east, y north), one per instance, in index order. */
  constructor(
    geo: THREE.BufferGeometry,
    material: THREE.Material,
    positions: { x: number; y: number }[],
    parent: THREE.Object3D,
    opts: { cell?: number; castShadow?: boolean; receiveShadow?: boolean } = {},
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
    }
  }

  markDirty() {
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
