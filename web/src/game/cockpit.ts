// What the player sees from the driver's seat: a digital speedometer on the scooter and bicycle
// handlebars, and the courier car's interior (dashboard, instrument cluster, steering wheel that
// turns with the input, pillars, mirror and door panels). Vehicle frame: x = left, y = up, z = forward.

import * as THREE from 'three';

const AMBER = '#f2a33a';

/** A small display that shows the speed in km/h, redrawn only when the number changes. */
export class Speedo {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D | null;
  private tex: THREE.CanvasTexture;
  private shown = -1;

  constructor(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    this.ctx = canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    this.mesh.name = 'speedo';
    this.draw(0);
  }

  set(kmh: number) {
    const v = Math.min(199, Math.round(Math.abs(kmh)));
    if (v !== this.shown) this.draw(v);
  }

  private draw(v: number) {
    this.shown = v;
    const c = this.ctx;
    if (!c) return;
    c.fillStyle = '#0b0c0e';
    c.fillRect(0, 0, 256, 128);
    // speed bar along the top
    c.fillStyle = '#22262c';
    c.fillRect(16, 14, 224, 8);
    c.fillStyle = AMBER;
    c.fillRect(16, 14, Math.min(224, (224 * v) / 120), 8);
    c.textBaseline = 'alphabetic';
    c.textAlign = 'right';
    c.font = '700 74px "IBM Plex Sans Arabic", system-ui, sans-serif';
    c.fillStyle = '#3a3f46';
    c.fillText('888', 196, 106);
    c.fillStyle = '#f3efe8';
    c.fillText(String(v).padStart(3, '0'), 196, 106);
    c.textAlign = 'left';
    c.font = '600 20px system-ui, sans-serif';
    c.fillStyle = AMBER;
    c.fillText('km', 202, 82);
    c.fillText('/h', 206, 104);
    this.tex.needsUpdate = true;
  }
}

/** Turn `obj` so that its +z axis (the face of a plane) points at `target`; both in the parent's frame. */
function face(obj: THREE.Object3D, target: THREE.Vector3) {
  const m = new THREE.Matrix4().lookAt(target, obj.position, new THREE.Vector3(0, 1, 0));
  obj.quaternion.setFromRotationMatrix(m);
}

export interface Dash {
  group: THREE.Group;
  speedo: Speedo;
  /** turns with the steering input (car only) */
  wheel: THREE.Object3D | null;
}

/** Digital speedometer pod on a two-wheeler's handlebar, angled at the rider's eye. */
export function handlebarDash(kind: 'scooter' | 'bicycle', eye: THREE.Vector3): Dash {
  const group = new THREE.Group();
  group.name = 'dash';
  const scooter = kind === 'scooter';
  const w = scooter ? 0.13 : 0.075;
  const h = scooter ? 0.065 : 0.042;
  const at = scooter ? new THREE.Vector3(0, 1.07, 0.415) : new THREE.Vector3(0, 1.075, 0.325);
  const pod = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.018, h + 0.016, 0.03),
    new THREE.MeshStandardMaterial({ color: '#16181b', roughness: 0.5, metalness: 0.2 }),
  );
  pod.position.copy(at);
  face(pod, eye);
  pod.translateZ(-0.016);
  const speedo = new Speedo(w, h);
  speedo.mesh.position.copy(at);
  face(speedo.mesh, eye);
  group.add(pod, speedo.mesh);
  return { group, speedo, wheel: null };
}

/** Driver's eye in the courier hatchback (left-hand drive). */
export const CAR_EYE = new THREE.Vector3(0.37, 1.19, -0.3);

/** Interior of the courier hatchback, sized to its body (tools/models/cars.py, 'hatch'). */
export function carDash(): Dash {
  const group = new THREE.Group();
  group.name = 'cockpit';
  const plastic = new THREE.MeshStandardMaterial({ color: '#1d1f22', roughness: 0.85 });
  const soft = new THREE.MeshStandardMaterial({ color: '#2a2d31', roughness: 0.9 });
  const liner = new THREE.MeshStandardMaterial({ color: '#5d5b57', roughness: 0.95, side: THREE.DoubleSide });
  const trim = new THREE.MeshStandardMaterial({ color: '#3b3f45', roughness: 0.4, metalness: 0.6 });

  // dashboard: a profile in (z, y) extruded across the car
  const prof = new THREE.Shape();
  prof.moveTo(0.3, 0.62);
  prof.lineTo(0.3, 0.9);
  prof.quadraticCurveTo(0.31, 0.985, 0.4, 0.995);
  prof.lineTo(0.7, 0.975);
  prof.quadraticCurveTo(0.95, 0.955, 1.0, 0.925);
  prof.lineTo(1.0, 0.62);
  const dashGeo = new THREE.ExtrudeGeometry(prof, { depth: 1.62, bevelEnabled: false, curveSegments: 6 });
  // shape x→z, shape y→y, extrusion z→x
  dashGeo.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -0.81, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  const dash = new THREE.Mesh(dashGeo, soft);
  group.add(dash);

  // instrument cluster: a binnacle with a visor over the speedometer, behind the wheel
  const binnacle = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.1, 0.14), plastic);
  binnacle.position.set(CAR_EYE.x, 1.0, 0.45);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.13), plastic);
  visor.position.set(CAR_EYE.x, 1.07, 0.39);
  visor.rotation.x = 0.12;
  group.add(binnacle, visor);
  const speedo = new Speedo(0.17, 0.085);
  speedo.mesh.position.set(CAR_EYE.x, 1.0, 0.375);
  face(speedo.mesh, CAR_EYE);
  group.add(speedo.mesh);

  // centre screen and air vents
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.13), new THREE.MeshStandardMaterial({ color: '#0d0f12', roughness: 0.55, metalness: 0.1 }));
  screen.position.set(0, 1.07, 0.47);
  face(screen, new THREE.Vector3(0, 1.25, -0.3));
  group.add(screen);
  for (const x of [-0.62, -0.12, 0.12, 0.62]) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.02), trim);
    vent.position.set(x, 0.92, 0.31);
    group.add(vent);
  }

  // steering column and wheel; the wheel group turns about its own axis
  const tilt = new THREE.Group();
  tilt.position.set(CAR_EYE.x, 0.95, 0.2);
  tilt.rotation.x = 0.42;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.32, 12), plastic);
  column.rotation.x = Math.PI / 2;
  column.position.z = 0.17;
  tilt.add(column);
  const wheel = new THREE.Group();
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.019, 10, 40), plastic);
  wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.04, 20), soft);
  hub.rotation.x = Math.PI / 2;
  wheel.add(hub);
  const badge = new THREE.Mesh(new THREE.CircleGeometry(0.022, 20), new THREE.MeshStandardMaterial({ color: '#e38b1d', roughness: 0.3, metalness: 0.4 }));
  badge.position.z = -0.021;
  badge.rotation.y = Math.PI;
  wheel.add(badge);
  // spokes to the left, right and bottom of the hub
  for (const a of [0, Math.PI, -Math.PI / 2]) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.032, 0.016), plastic);
    spoke.position.set(Math.cos(a) * 0.105, Math.sin(a) * 0.105 - (a === 0 || a === Math.PI ? 0.02 : 0), 0);
    spoke.rotation.z = a;
    wheel.add(spoke);
  }
  tilt.add(wheel);
  group.add(tilt);

  // A-pillars from the windshield base up to the roof
  for (const s of [1, -1]) {
    const a = new THREE.Vector3(s * 0.8, 0.93, 0.98);
    const b = new THREE.Vector3(s * 0.66, 1.43, 0.3);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.05, a.distanceTo(b)), plastic);
    pillar.position.copy(a).add(b).multiplyScalar(0.5);
    pillar.lookAt(b);
    group.add(pillar);
    // door panel and window sill
    const door = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.42), soft);
    door.position.set(s * 0.83, 0.74, -0.05);
    door.rotation.y = (-s * Math.PI) / 2;
    group.add(door);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 1.9), plastic);
    sill.position.set(s * 0.81, 0.95, -0.05);
    group.add(sill);
  }
  // headliner and its front edge
  const roof = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 1.5), liner);
  roof.rotation.x = Math.PI / 2;
  roof.position.set(0, 1.45, -0.45);
  group.add(roof);
  const header = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.03, 0.06), liner);
  header.position.set(0, 1.44, 0.28);
  group.add(header);
  // rear-view mirror
  const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.07, 0.025), plastic);
  mirror.position.set(0, 1.33, 0.36);
  mirror.rotation.x = 0.15;
  // its glass is a live view (mirrors.ts)
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08), plastic);
  stem.position.set(0, 1.39, 0.34);
  group.add(mirror, stem);

  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) m.receiveShadow = true;
  });
  return { group, speedo, wheel };
}
