// Real rear-view mirrors: each mirror renders the scene into a small texture from where the glass is,
// looking along the driver's line of sight reflected off the glass, so what you see moves with the
// vehicle, the lean and the mirror angle like a real one. The scooter has two round mirrors on stalks;
// the car has two door mirrors and the interior mirror. Resolution and update rate drop on weaker
// settings; at low quality they update every third frame.

import * as THREE from 'three';
import type { Quality } from './world';

interface MirrorDef {
  /** centre of the glass in the vehicle's frame (x left, y up, z forward) */
  pos: THREE.Vector3;
  w: number;
  h: number;
  round: boolean;
  /** vertical field of view, degrees */
  fov: number;
  /** which way the glass shows by default: + looks out to the vehicle's left */
  out: number;
  /** stalk from the handlebar (scooter) */
  stalk?: THREE.Vector3;
}

const DEFS: Record<'scooter' | 'car', MirrorDef[]> = {
  scooter: [
    { pos: new THREE.Vector3(0.31, 1.29, 0.43), w: 0.12, h: 0.1, round: true, fov: 30, out: 0.2, stalk: new THREE.Vector3(0.24, 1.08, 0.4) },
    { pos: new THREE.Vector3(-0.31, 1.29, 0.43), w: 0.12, h: 0.1, round: true, fov: 30, out: -0.2, stalk: new THREE.Vector3(-0.24, 1.08, 0.4) },
  ],
  car: [
    { pos: new THREE.Vector3(1.0, 1.0, 0.8), w: 0.2, h: 0.13, round: false, fov: 26, out: 0.12 },
    { pos: new THREE.Vector3(-1.0, 1.0, 0.8), w: 0.2, h: 0.13, round: false, fov: 26, out: -0.12 },
    // interior mirror (cockpit.ts draws its housing)
    { pos: new THREE.Vector3(0, 1.33, 0.33), w: 0.23, h: 0.055, round: false, fov: 12, out: 0 },
  ],
};

const SETTINGS = { low: { px: 96, every: 3, far: 90 }, medium: { px: 160, every: 2, far: 140 }, high: { px: 256, every: 1, far: 220 } };

interface Mirror {
  def: MirrorDef;
  rt: THREE.WebGLRenderTarget;
  cam: THREE.PerspectiveCamera;
  glass: THREE.Mesh;
}

export class Mirrors {
  readonly group = new THREE.Group();
  private list: Mirror[] = [];
  private frame = 0;
  /** extra yaw / pitch of every mirror, radians (the settings slider) */
  adjust = { yaw: 0, pitch: 0 };
  private every: number;
  private tmp = { a: new THREE.Vector3(), b: new THREE.Vector3(), n: new THREE.Vector3(), q: new THREE.Quaternion() };

  constructor(
    kind: 'scooter' | 'car',
    quality: Quality,
    /** the driver's eye in the vehicle frame */
    private eye: THREE.Vector3,
  ) {
    this.group.name = 'mirrors';
    const set = SETTINGS[quality];
    this.every = set.every;
    const housingMat = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.55, metalness: 0.2 });
    for (const def of DEFS[kind]) {
      const aspect = def.w / def.h;
      const rt = new THREE.WebGLRenderTarget(set.px, Math.max(16, Math.round(set.px / aspect)), { samples: 0 });
      rt.texture.generateMipmaps = false;
      const cam = new THREE.PerspectiveCamera(def.fov, aspect, 0.3, set.far);
      const geo = def.round ? new THREE.CircleGeometry(def.w / 2, 24) : new THREE.PlaneGeometry(def.w, def.h);
      if (def.round) geo.scale(1, def.h / def.w, 1);
      // a mirror shows the scene the other way round
      const uv = geo.attributes.uv!;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
      const glass = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: rt.texture, color: '#e8eef2', fog: false }));
      glass.name = 'mirror-glass';
      glass.position.copy(def.pos);
      // face the eye
      glass.lookAt(this.eye);
      this.group.add(glass);
      if (def.out !== 0) {
        // housing behind the glass
        const backGeo = def.round ? new THREE.CircleGeometry(def.w / 2 + 0.012, 24) : new THREE.BoxGeometry(def.w + 0.03, def.h + 0.03, 0.06);
        if (def.round) backGeo.scale(1, (def.h + 0.024) / (def.w + 0.024), 1);
        const back = new THREE.Mesh(backGeo, housingMat);
        back.position.copy(def.pos);
        back.quaternion.copy(glass.quaternion);
        back.translateZ(def.round ? -0.004 : -0.032);
        if (def.round) (back.material as THREE.Material).side = THREE.DoubleSide;
        this.group.add(back);
        if (def.stalk) {
          const len = def.stalk.distanceTo(def.pos);
          const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.009, len, 6), housingMat);
          stalk.position.copy(def.stalk).add(def.pos).multiplyScalar(0.5);
          stalk.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), def.pos.clone().sub(def.stalk).normalize());
          this.group.add(stalk);
        } else {
          // door mirror arm
          const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.06), housingMat);
          arm.position.set(def.pos.x - Math.sign(def.pos.x) * 0.1, def.pos.y - 0.04, def.pos.z);
          this.group.add(arm);
        }
      }
      this.list.push({ def, rt, cam, glass });
    }
  }

  /**
   * Render the mirrors that are due this frame. `owner` is the object the mirrors are mounted on
   * (the vehicle's lean group) so they follow its lean and pitch.
   */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, owner: THREE.Object3D, active: boolean, body?: THREE.Object3D) {
    this.frame++;
    if (!this.list.length) return;
    const every = active ? this.every : Math.max(6, this.every * 3);
    const { a, b, n, q } = this.tmp;
    owner.updateWorldMatrix(true, false);
    owner.getWorldQuaternion(q);
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    // the shadow map from the main view is reused
    renderer.shadowMap.autoUpdate = false;
    for (const m of this.list) m.glass.visible = false;
    this.list.forEach((m, i) => {
      if ((this.frame + i) % every !== 0) return;
      // the reflected line of sight: from the eye to the glass, bounced off the glass's normal
      a.copy(m.def.pos);
      owner.localToWorld(a);
      b.copy(this.eye);
      owner.localToWorld(b);
      const view = a.clone().sub(b).normalize();
      // the glass is set so the eye sees straight back along the road, a little outward for the door
      // mirrors and slightly down; the settings turn it further
      const yaw = m.def.out + this.adjust.yaw * Math.sign(m.def.out || 1);
      const want = new THREE.Vector3(Math.sin(yaw), -0.05 + this.adjust.pitch, -Math.cos(yaw)).normalize().applyQuaternion(q);
      n.copy(view).sub(want).normalize();
      const dir = view.sub(n.clone().multiplyScalar(2 * view.dot(n)));
      m.cam.position.copy(a);
      m.cam.up.set(0, 1, 0).applyQuaternion(q);
      m.cam.lookAt(a.clone().add(dir));
      m.cam.updateMatrixWorld();
      // the interior mirror looks out through the rear window: leave the car's own (opaque) body and cabin out
      const inside = m.def.out === 0 && body;
      if (inside) body.visible = false;
      renderer.setRenderTarget(m.rt);
      renderer.render(scene, m.cam);
      if (inside) body.visible = true;
    });
    for (const m of this.list) m.glass.visible = true;
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
  }

  dispose() {
    for (const m of this.list) {
      m.rt.dispose();
      m.glass.geometry.dispose();
      (m.glass.material as THREE.Material).dispose();
    }
    this.list = [];
  }
}
