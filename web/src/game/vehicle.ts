// Player vehicles: low-poly models built from primitives, and an arcade
// driving model with per-vehicle acceleration, braking, steering and top speed.

import * as THREE from 'three';
import { VEHICLE_SPECS, type VehicleSpec } from '../../../shared/rules';
import type { VehicleId } from '../../../shared/types';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverse)
  steer: number; // -1 (left) .. 1 (right)
}

const mat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
};

function wheel(radius: number, width: number) {
  const g = new THREE.CylinderGeometry(radius, radius, width, 14);
  g.rotateZ(Math.PI / 2);
  const w = new THREE.Group();
  w.add(mesh(g, mat('#1f1f22')));
  const hub = new THREE.CylinderGeometry(radius * 0.45, radius * 0.45, width + 0.02, 8);
  hub.rotateZ(Math.PI / 2);
  w.add(mesh(hub, mat('#b8bec4')));
  return w;
}

function rider(shirt = '#f39c12') {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(0.5, 0.65, 0.32), mat(shirt), 0, 1.35, -0.05));
  g.add(mesh(new THREE.BoxGeometry(0.42, 0.25, 0.6), mat('#2d3e50'), 0, 0.98, 0.1));
  const helmet = mesh(new THREE.SphereGeometry(0.2, 12, 10), mat('#e74c3c'), 0, 1.86, 0.02);
  g.add(helmet, mesh(new THREE.SphereGeometry(0.15, 10, 8), mat('#c99a74'), 0, 1.78, 0.06));
  // arms reaching for the handlebar
  const arm = new THREE.BoxGeometry(0.12, 0.12, 0.55);
  g.add(mesh(arm, mat(shirt), -0.28, 1.45, 0.3), mesh(arm, mat(shirt), 0.28, 1.45, 0.3));
  return g;
}

function deliveryBox(size = 0.6) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(size, size, size), mat('#f39c12')));
  g.add(mesh(new THREE.BoxGeometry(size + 0.02, 0.08, size + 0.02), mat('#d35400'), 0, size * 0.2, 0));
  return g;
}

export class Vehicle {
  readonly spec: VehicleSpec;
  readonly object = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private frontWheels: THREE.Object3D[] = [];
  private lean = new THREE.Group();
  /** local plane position (x east, y north) */
  x = 0;
  y = 0;
  /** bearing in radians, clockwise from north */
  heading = 0;
  /** m/s along the heading (negative = reversing) */
  speed = 0;
  yawRate = 0;
  private wheelAngle = 0;

  constructor(readonly id: VehicleId) {
    this.spec = VEHICLE_SPECS[id];
    this.object.add(this.lean);
    if (id === 'car') this.buildCar();
    else if (id === 'motorcycle') this.buildMotorcycle();
    else this.buildBicycle();
  }

  private buildCar() {
    const body = mat('#f39c12');
    const g = this.lean;
    g.add(mesh(new THREE.BoxGeometry(1.9, 0.75, 4.3), body, 0, 0.75, 0));
    g.add(mesh(new THREE.BoxGeometry(1.75, 0.65, 2.1), mat('#2c3e50'), 0, 1.45, -0.3));
    g.add(mesh(new THREE.BoxGeometry(1.8, 0.08, 2.2), body, 0, 1.8, -0.3));
    // roof sign
    g.add(mesh(new THREE.BoxGeometry(1.0, 0.35, 0.25), mat('#ffffff', { emissive: '#ffcc66', emissiveIntensity: 0.5 }), 0, 2.0, -0.3));
    // lights
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), mat('#fff8e1', { emissive: '#fff3c0' }), -0.6, 0.85, 2.16));
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), mat('#fff8e1', { emissive: '#fff3c0' }), 0.6, 0.85, 2.16));
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), mat('#c0392b', { emissive: '#7a1010' }), -0.6, 0.85, -2.16));
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.15, 0.05), mat('#c0392b', { emissive: '#7a1010' }), 0.6, 0.85, -2.16));
    for (const [x, z, front] of [
      [-0.95, 1.35, true],
      [0.95, 1.35, true],
      [-0.95, -1.35, false],
      [0.95, -1.35, false],
    ] as const) {
      const w = wheel(0.38, 0.28);
      w.position.set(x, 0.38, z);
      this.wheels.push(w);
      if (front) this.frontWheels.push(w);
      g.add(w);
    }
  }

  private buildMotorcycle() {
    const g = this.lean;
    g.add(mesh(new THREE.BoxGeometry(0.35, 0.45, 1.4), mat('#f1c40f'), 0, 0.75, 0));
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.15, 0.7), mat('#222'), 0, 1.02, -0.25));
    g.add(mesh(new THREE.BoxGeometry(0.8, 0.06, 0.06), mat('#aaa'), 0, 1.25, 0.62));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), mat('#aaa'), 0, 0.95, 0.62));
    const front = wheel(0.33, 0.14);
    front.position.set(0, 0.33, 0.75);
    const back = wheel(0.33, 0.16);
    back.position.set(0, 0.33, -0.65);
    this.wheels.push(front, back);
    this.frontWheels.push(front);
    g.add(front, back);
    const r = rider();
    r.position.z = -0.25;
    g.add(r);
    const b = deliveryBox(0.62);
    b.position.set(0, 1.45, -0.85);
    g.add(b);
  }

  private buildBicycle() {
    const g = this.lean;
    const frame = mat('#16a085');
    const tube = (len: number, x: number, y: number, z: number, rx: number) => {
      const m = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), frame, x, y, z);
      m.rotation.x = rx;
      return m;
    };
    g.add(tube(1.0, 0, 0.62, 0.05, Math.PI / 2.3), tube(0.75, 0, 0.55, -0.35, -0.5), tube(0.6, 0, 0.85, 0.45, -0.25));
    g.add(mesh(new THREE.BoxGeometry(0.62, 0.04, 0.04), mat('#888'), 0, 1.15, 0.55));
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.06, 0.28), mat('#222'), 0, 0.98, -0.3));
    const front = wheel(0.34, 0.05);
    front.position.set(0, 0.34, 0.6);
    const back = wheel(0.34, 0.05);
    back.position.set(0, 0.34, -0.55);
    this.wheels.push(front, back);
    this.frontWheels.push(front);
    g.add(front, back);
    const r = rider('#27ae60');
    r.position.set(0, -0.12, -0.2);
    g.add(r);
    const basket = deliveryBox(0.45);
    basket.position.set(0, 1.0, 0.75);
    g.add(basket);
  }

  /** Advance the physics. `surfaceGrip` < 1 when off the road. */
  step(dt: number, input: DriveInput, surfaceGrip: number) {
    const s = this.spec;
    const max = s.maxSpeed * (0.55 + 0.45 * surfaceGrip);
    if (input.throttle > 0.01) {
      if (this.speed < 0) this.speed = Math.min(0, this.speed + s.braking * dt);
      else this.speed += s.acceleration * input.throttle * dt * Math.max(0, 1 - this.speed / max);
    }
    if (input.brake > 0.01) {
      if (this.speed > 0.3) this.speed = Math.max(0, this.speed - s.braking * input.brake * dt);
      else this.speed = Math.max(-s.maxSpeed * 0.25, this.speed - s.acceleration * 0.6 * input.brake * dt);
    }
    if (input.throttle <= 0.01 && input.brake <= 0.01) {
      const roll = (0.9 + Math.abs(this.speed) * 0.05) * dt;
      this.speed = Math.abs(this.speed) <= roll ? 0 : this.speed - Math.sign(this.speed) * roll;
    }
    if (this.speed > max) this.speed = Math.max(max, this.speed - s.braking * 0.5 * dt);

    const sp = Math.abs(this.speed);
    const authority = Math.min(1, sp / 3) * (1 - 0.45 * Math.min(1, sp / s.maxSpeed));
    const targetYaw = input.steer * s.steering * authority * Math.sign(this.speed || 1);
    this.yawRate += (targetYaw - this.yawRate) * Math.min(1, dt * 8);
    this.heading += this.yawRate * dt;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.y += Math.cos(this.heading) * this.speed * dt;

    this.wheelAngle += (this.speed * dt) / 0.35;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    for (const w of this.frontWheels) w.rotation.y = -input.steer * 0.45;
    if (this.id !== 'car') this.lean.rotation.z += (this.yawRate * sp * 0.05 - this.lean.rotation.z) * Math.min(1, dt * 6);
  }

  sync() {
    this.object.position.set(this.x, 0, -this.y);
    this.object.rotation.y = Math.PI - this.heading;
  }
}
