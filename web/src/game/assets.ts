// Detailed 3D models (scooter, bicycle, cars, riders and people) built offline with
// tools/models and shipped as GLB files in /models. Loading starts as soon as
// this module is imported; the game falls back to the procedural models in
// models.ts when a file is missing or the network is too slow.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type ModelFile = 'scooter' | 'bicycle' | 'people' | 'car' | 'parked';

const scenes: Partial<Record<ModelFile, THREE.Object3D>> = {};
let pending: Promise<void> | null = null;

function prepare(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // clones share geometry and materials with this cached copy: never dispose them per instance
    mesh.userData.shared = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const s = m as THREE.MeshStandardMaterial;
      s.userData.shared = true;
      // alpha-tested hair, brows and lashes: keep them in the opaque pass
      if (s.alphaTest > 0) {
        s.transparent = false;
        s.alphaTest = 0.45;
      }
      if (s.map) s.map.anisotropy = 4;
    }
  });
}

/** Start (or join) loading every model file. Never rejects. */
export function loadModels(timeoutMs = 25000): Promise<void> {
  if (pending) return pending;
  const loader = new GLTFLoader();
  const files: ModelFile[] = ['scooter', 'bicycle', 'people', 'car', 'parked'];
  const all = Promise.all(
    files.map((f) =>
      loader
        .loadAsync(`/models/${f}.glb`)
        .then((gltf) => {
          prepare(gltf.scene);
          gltf.scene.updateMatrixWorld(true);
          scenes[f] = gltf.scene;
        })
        .catch((e: unknown) => console.warn(`model ${f} not loaded`, e)),
    ),
  ).then(() => undefined);
  pending = Promise.race([all, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
  return pending;
}

export function hasModel(f: ModelFile) {
  return Boolean(scenes[f]);
}

/** Clone a named node (and its children) out of a loaded file, or null. */
export function cloneNode(f: ModelFile, name: string): THREE.Object3D | null {
  const node = scenes[f]?.getObjectByName(name);
  if (!node) return null;
  const copy = node.clone(true);
  copy.position.copy(node.position);
  copy.quaternion.copy(node.quaternion);
  return copy;
}

export const PEOPLE = ['staff', 'pizza_carrier', 'kurdish_man', 'young_man', 'woman_coat', 'worker'] as const;
export type PersonId = (typeof PEOPLE)[number];

/** A standing person, origin at their feet, facing +z. */
export function person(id: PersonId): THREE.Object3D | null {
  const p = cloneNode('people', id);
  if (p) p.position.set(0, 0, 0);
  return p;
}

/** Free a tree's own resources, leaving anything shared with the model cache untouched. */
export function disposeOwned(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.userData.shared) return;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (mat.userData.shared) continue;
      (mat as THREE.MeshBasicMaterial).map?.dispose();
      mat.dispose();
    }
  });
}

if (typeof window !== 'undefined') void loadModels();
