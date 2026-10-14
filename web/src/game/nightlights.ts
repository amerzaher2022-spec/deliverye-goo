// Street lighting after dark. Every lamp gets a glowing lens and a pool of warm light on the road under
// it (drawn, not computed: thousands of real lights would be far too slow); the few lamps closest to
// the player are also real lights, so cars, kerbs and the rider are lit by them and wet asphalt
// shows their reflections.

import * as THREE from 'three';
import { ChunkedInstances } from './chunked';
import type { Quality } from './world';

function poolTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const LAMP = new THREE.Color('#ffc884');

export class NightLights {
  readonly group = new THREE.Group();
  private poolMat: THREE.MeshBasicMaterial;
  private lensMat: THREE.MeshBasicMaterial;
  private lights: THREE.PointLight[] = [];
  private at = -Infinity;

  constructor(
    /** lamp lens positions in scene space and the point on the road the light falls on */
    private lamps: { head: THREE.Vector3; ground: THREE.Vector3 }[],
    quality: Quality,
  ) {
    this.group.name = 'night-lights';
    const plane = (p: THREE.Vector3) => ({ x: p.x, y: -p.z });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: poolTexture(),
      color: LAMP,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      fog: true,
    });
    const poolGeo = new THREE.PlaneGeometry(1, 1);
    poolGeo.rotateX(-Math.PI / 2);
    const pools = new ChunkedInstances(poolGeo, this.poolMat, lamps.map((l) => plane(l.ground)), this.group, { castShadow: false, receiveShadow: false });
    const m = new THREE.Matrix4();
    lamps.forEach((l, i) => {
      m.compose(new THREE.Vector3(l.ground.x, l.ground.y + 0.06, l.ground.z), new THREE.Quaternion(), new THREE.Vector3(17, 1, 17));
      pools.setMatrixAt(i, m);
    });
    pools.finish();

    this.lensMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#3a3a36'), toneMapped: false });
    const lensGeo = new THREE.PlaneGeometry(0.6, 0.24);
    lensGeo.rotateX(Math.PI / 2);
    const lenses = new ChunkedInstances(lensGeo, this.lensMat, lamps.map((l) => plane(l.head)), this.group, { castShadow: false, receiveShadow: false });
    lamps.forEach((l, i) => {
      m.makeTranslation(l.head.x, l.head.y - 0.08, l.head.z);
      lenses.setMatrixAt(i, m);
    });
    lenses.finish();

    const n = quality === 'high' ? 6 : quality === 'medium' ? 3 : 0;
    for (let i = 0; i < n; i++) {
      const pl = new THREE.PointLight(LAMP, 0, 26, 1.6);
      pl.castShadow = false;
      this.lights.push(pl);
      this.group.add(pl);
    }
  }

  /** `night` 0..1 from the atmosphere; `player` in scene space. */
  update(night: number, player: THREE.Vector3, t: number) {
    const on = Math.max(0, Math.min(1, (night - 0.15) / 0.5));
    this.poolMat.opacity = 0.42 * on;
    this.poolMat.visible = on > 0.01;
    this.lensMat.color.set('#3a3a36').lerp(new THREE.Color(LAMP).multiplyScalar(2.2), on);
    if (!this.lights.length) return;
    if (t - this.at > 0.4) {
      this.at = t;
      // the nearest lamps become real lights
      const near = this.lamps
        .map((l) => ({ l, d: (l.head.x - player.x) ** 2 + (l.head.z - player.z) ** 2 }))
        .filter((e) => e.d < 70 * 70)
        .sort((a, b) => a.d - b.d)
        .slice(0, this.lights.length);
      this.lights.forEach((pl, i) => {
        const e = near[i];
        if (e) pl.position.copy(e.l.head).y -= 0.4;
        pl.userData.active = !!e;
      });
    }
    for (const pl of this.lights) pl.intensity = pl.userData.active ? 140 * on : 0;
  }
}
