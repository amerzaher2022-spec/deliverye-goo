// Photographic materials and the sky, from Poly Haven (CC0, https://polyhaven.com): converted to WebP
// by tools/assets/convert_polyhaven.py into /textures. Loaded with the models before the world is
// built; every user falls back to the procedural textures when a file is missing.

import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export type PhotoSet = 'asphalt' | 'asphalt_worn' | 'pavers' | 'paving' | 'plaster' | 'plaster_smooth' | 'sand' | 'shutter';
const SETS: PhotoSet[] = ['asphalt', 'asphalt_worn', 'pavers', 'paving', 'plaster', 'plaster_smooth', 'sand', 'shutter'];

const images = new Map<string, HTMLImageElement>();
let skyPano: THREE.Texture | null = null;
let skyEnv: THREE.DataTexture | null = null;
let skyInfo: { sun: [number, number, number]; horizon: string } | null = null;

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      images.set(url, img);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** Load every material and the sky. Never rejects. */
export async function loadPhotos(): Promise<void> {
  const jobs: Promise<unknown>[] = [];
  for (const s of SETS) for (const m of ['col', 'nrm', 'rgh']) jobs.push(loadImage(`/textures/${s}_${m}.webp`));
  jobs.push(
    new THREE.TextureLoader()
      .loadAsync('/textures/sky.webp')
      .then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        skyPano = t;
      })
      .catch(() => undefined),
  );
  jobs.push(
    new HDRLoader()
      .loadAsync('/textures/sky_env.hdr')
      .then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        skyEnv = t;
      })
      .catch(() => undefined),
  );
  jobs.push(
    fetch('/textures/sky.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (skyInfo = j))
      .catch(() => undefined),
  );
  await Promise.all(jobs);
}

/** The colour photo of a set, for compositing into canvas textures (lane paint, windows...). */
export function photo(set: PhotoSet): HTMLImageElement | null {
  return images.get(`/textures/${set}_col.webp`) ?? null;
}

const cache = new Map<string, THREE.Texture>();

/** A repeating texture made from one map of a set (normal and roughness maps are linear data). */
export function photoTexture(set: PhotoSet, map: 'col' | 'nrm' | 'rgh'): THREE.Texture | null {
  const key = `${set}_${map}`;
  const hit = cache.get(key);
  if (hit) {
    const c = hit.clone();
    c.needsUpdate = true;
    return c;
  }
  const img = images.get(`/textures/${key}.webp`);
  if (!img) return null;
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = map === 'col' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  cache.set(key, t);
  // clones share the image (uploaded once) but keep their own repeat
  const c = t.clone();
  c.needsUpdate = true;
  return c;
}

/** The sky photo for the background and the matching light probe for reflections and ambient light. */
export function sky(): { background: THREE.Texture; environment: THREE.DataTexture; sun: THREE.Vector3; horizon: string } | null {
  if (!skyPano || !skyEnv || !skyInfo) return null;
  return { background: skyPano, environment: skyEnv, sun: new THREE.Vector3(...skyInfo.sun).normalize(), horizon: skyInfo.horizon };
}
