// Player vehicles: low-poly models built from primitives, and an arcade
// driving model with per-vehicle acceleration, braking, steering and top speed.

import * as THREE from 'three';
import { VEHICLE_SPECS, type VehicleSpec } from '../../../shared/rules';
import type { VehicleId } from '../../../shared/types';
import { buildBicycle, buildCar, buildScooter, type VehicleModel } from './models';

export interface DriveInput {
  throttle: number; // 0..1
  brake: number; // 0..1 (also reverse)
  steer: number; // -1 (left) .. 1 (right)
}

export class Vehicle {
  readonly spec: VehicleSpec;
  readonly object = new THREE.Group();
  private wheels: THREE.Object3D[] = [];
  private frontWheels: THREE.Object3D[] = [];
  private lean: THREE.Group;
  /** local plane position (x east, y north) */
  x = 0;
  y = 0;
  /** bearing in radians, clockwise from north */
  heading = 0;
  /** m/s along the heading (negative = reversing) */
  speed = 0;
  yawRate = 0;
  private wheelAngle = 0;
  private steerVisual = 0;
  readonly rider: THREE.Object3D | null;

  constructor(readonly id: VehicleId) {
    this.spec = VEHICLE_SPECS[id];
    const model: VehicleModel = id === 'car' ? buildCar() : id === 'motorcycle' ? buildScooter() : buildBicycle();
    this.object.add(model.root);
    this.lean = model.lean;
    this.wheels = model.wheels;
    this.frontWheels = model.steer;
    this.rider = model.rider;
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

    const radius = this.id === 'car' ? 0.31 : this.id === 'motorcycle' ? 0.24 : 0.34;
    this.wheelAngle += (this.speed * dt) / radius;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    // smooth steering animation instead of snapping the wheels
    this.steerVisual += (-input.steer * 0.42 - this.steerVisual) * Math.min(1, dt * 10);
    for (const w of this.frontWheels) w.rotation.y = this.steerVisual;
    if (this.id !== 'car') this.lean.rotation.z += (this.yawRate * sp * 0.05 - this.lean.rotation.z) * Math.min(1, dt * 6);
  }

  sync() {
    this.object.position.set(this.x, 0, -this.y);
    this.object.rotation.y = Math.PI - this.heading;
  }
}
