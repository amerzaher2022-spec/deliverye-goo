// Player vehicles: detailed scooter and bicycle models with a seated rider
// (GLB files from tools/models), procedural fallbacks, and an arcade driving
// model with per-vehicle acceleration, braking, steering and top speed.

import * as THREE from 'three';
import { VEHICLE_SPECS, type VehicleSpec } from '../../../shared/rules';
import type { VehicleId } from '../../../shared/types';
import { cloneNode, hasModel } from './assets';
import { buildBicycle, buildCar, buildScooter, type VehicleModel } from './models';
import { CAR_EYE, carDash, handlebarDash, type Dash } from './cockpit';

/** Rider eye positions measured on the generated models (tools/models/build_models.py). */
const EYE = { scooter: new THREE.Vector3(0, 1.579, 0.05), bicycle: new THREE.Vector3(0, 1.783, -0.077) };

/** The courier hatchback: body plus four wheels; front wheels steer. */
function detailedCar(): VehicleModel | null {
  if (!hasModel('car')) return null;
  const body = cloneNode('car', 'car_body');
  if (!body) return null;
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  lean.add(body);
  const wheels: THREE.Object3D[] = [];
  const steer: THREE.Object3D[] = [];
  for (const n of ['hatch_wheel_fl', 'hatch_wheel_fr', 'hatch_wheel_rl', 'hatch_wheel_rr']) {
    const w = cloneNode('car', n);
    if (!w) return null;
    const pivot = new THREE.Group();
    pivot.position.copy(w.position);
    w.position.set(0, 0, 0);
    pivot.add(w);
    lean.add(pivot);
    wheels.push(w);
    if (n.includes('_f')) steer.push(pivot);
  }
  return { root, wheels, steer, lean, rider: null, steerScale: 0.8, eye: CAR_EYE };
}

function detailed(file: 'scooter' | 'bicycle'): VehicleModel | null {
  if (!hasModel(file)) return null;
  const body = cloneNode(file, `${file}_body`);
  const front = cloneNode(file, `${file}_front_wheel`);
  const rear = cloneNode(file, `${file}_rear_wheel`);
  if (!body || !front || !rear) return null;
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  // the front wheel spins inside a pivot that steers
  const pivot = new THREE.Group();
  pivot.position.copy(front.position);
  front.position.set(0, 0, 0);
  pivot.add(front);
  lean.add(body, pivot, rear);
  const rider = cloneNode(file, `rider_${file}`);
  if (rider) lean.add(rider);
  return {
    root,
    wheels: [front, rear],
    steer: [pivot],
    lean,
    rider,
    riderHead: rider?.getObjectByName(`rider_${file}_head`) ?? null,
    eye: EYE[file],
    steerScale: 0.35,
  };
}

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
  readonly riderHead: THREE.Object3D | null;
  readonly eye: THREE.Vector3 | null;
  private steerScale: number;
  /** speedometer (and the car's steering wheel), seen from the driver's seat */
  private dash: Dash | null = null;

  constructor(readonly id: VehicleId) {
    this.spec = VEHICLE_SPECS[id];
    const model: VehicleModel =
      id === 'car' ? (detailedCar() ?? buildCar()) : id === 'motorcycle' ? (detailed('scooter') ?? buildScooter()) : (detailed('bicycle') ?? buildBicycle());
    this.object.add(model.root);
    this.lean = model.lean;
    this.wheels = model.wheels;
    this.frontWheels = model.steer;
    this.rider = model.rider;
    this.riderHead = model.riderHead ?? null;
    this.eye = model.eye ?? null;
    this.steerScale = model.steerScale ?? 1;
    if (this.eye) {
      this.dash = id === 'car' ? carDash() : handlebarDash(id === 'motorcycle' ? 'scooter' : 'bicycle', this.eye);
      this.lean.add(this.dash.group);
    }
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
    this.steerVisual += (-input.steer * 0.42 * this.steerScale - this.steerVisual) * Math.min(1, dt * 10);
    for (const w of this.frontWheels) w.rotation.y = this.steerVisual;
    if (this.dash) {
      this.dash.speedo.set(this.speed * 3.6);
      // a car's steering wheel turns about 2.5 times as far as its road wheels' visual angle
      if (this.dash.wheel) this.dash.wheel.rotation.z = (-this.steerVisual / (0.42 * this.steerScale)) * 1.6;
    }
    if (this.id !== 'car') this.lean.rotation.z += (this.yawRate * sp * 0.05 - this.lean.rotation.z) * Math.min(1, dt * 6);
  }

  sync() {
    this.object.position.set(this.x, 0, -this.y);
    this.object.rotation.y = Math.PI - this.heading;
  }
}
