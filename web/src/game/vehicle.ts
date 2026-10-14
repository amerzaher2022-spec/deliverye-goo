// Player vehicles: detailed scooter and bicycle models with a seated rider
// (GLB files from tools/models), procedural fallbacks, and a driving model with
// grip-limited braking and cornering, lean, suspension, engine state and crashes.

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

/** Handling numbers that are not part of the shared rules (those are checked by the server too). */
const DYN: Record<VehicleId, { wheelbase: number; maxSteer: number; steerFade: number; pitchK: number; idleRpm: number; bike: boolean; shapes: [number, number][] }> = {
  // shapes: collision circles along the vehicle's length (offset forward, radius)
  bicycle: { wheelbase: 1.08, maxSteer: 0.62, steerFade: 7, pitchK: 0.006, idleRpm: 0, bike: true, shapes: [[0.45, 0.42], [-0.45, 0.42]] },
  motorcycle: { wheelbase: 1.32, maxSteer: 0.58, steerFade: 9, pitchK: 0.0065, idleRpm: 0.12, bike: true, shapes: [[0.55, 0.45], [-0.5, 0.45]] },
  car: { wheelbase: 2.5, maxSteer: 0.6, steerFade: 13, pitchK: 0.0035, idleRpm: 0.13, bike: false, shapes: [[1.3, 0.92], [0, 0.92], [-1.3, 0.92]] },
};

const G = 9.81;

/** What a collision did, for sounds, camera shake and the UI. */
export interface ImpactResult {
  /** speed into the obstacle, m/s */
  speed: number;
  /** 0..1 */
  severity: number;
  fell: boolean;
  stalled: boolean;
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
  /** height above the ground: in a tunnel or on a bridge */
  z = 0;
  /** bearing in radians, clockwise from north */
  heading = 0;
  /** m/s along the heading (negative = reversing) */
  speed = 0;
  yawRate = 0;
  /** bike lean (rad, + to the right), body pitch (rad, + nose down), vertical bounce (m) */
  leanAngle = 0;
  pitch = 0;
  heave = 0;
  private pitchVel = 0;
  private heaveVel = 0;
  /** engine state: off after a hard crash until restarted */
  engineOn = true;
  private starting = 0;
  /** 0..1 engine speed, for the sound */
  rpm = 0;
  /** tyre slide 0..1, for the sound */
  slip = 0;
  /** lying on its side after a crash (bikes) */
  fallen = false;
  private fallSide = 1;
  /** camera shake 0..1, decays */
  shake = 0;
  /** smoothed controls: throttle and brakes build up, the bars turn at a human rate */
  private thr = 0;
  private brk = 0;
  private str = 0;
  private slideTime = 0;
  private lastAccel = 0;
  private bumpPhase = Math.random() * 100;
  readonly dyn: (typeof DYN)[VehicleId];
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
    this.dyn = DYN[id];
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
    if (this.dyn.idleRpm === 0) this.engineOn = true;
  }

  /** The leaning, pitching body frame: things mounted on the vehicle (mirrors) go here. */
  get frame(): THREE.Object3D {
    return this.lean;
  }

  /** Collision circles in the plane: centre and radius. */
  shapes(): { x: number; y: number; r: number }[] {
    const fx = Math.sin(this.heading);
    const fy = Math.cos(this.heading);
    return this.dyn.shapes.map(([o, r]) => ({ x: this.x + fx * o, y: this.y + fy * o, r }));
  }

  /**
   * Advance the physics.
   * `surfaceGrip` 1 on the road, 0 off it (sand, dirt); `weatherGrip` 1 dry .. ~0.7 in a downpour.
   *
   * Longitudinal: engine force that fades towards top speed, rolling and air drag, brakes limited by
   * tyre grip (the car has ABS; a bike's wheels lock and slide). Lateral: the turn the front wheel asks
   * for (narrower at speed), limited by grip; a bike leans into the turn by the angle its speed needs.
   * Suspension: the body dips under braking, squats under power and bounces on bumps.
   */
  step(dt: number, input: DriveInput, surfaceGrip: number, weatherGrip = 1) {
    const s = this.spec;
    const d = this.dyn;
    const mu = (0.55 + 0.45 * surfaceGrip) * weatherGrip * (d.bike ? 0.95 : 1);
    if (this.fallen) {
      // sliding on its side
      this.thr = this.brk = 0;
      const fr = 0.55 * G * dt;
      this.speed = Math.abs(this.speed) <= fr ? 0 : this.speed - Math.sign(this.speed) * fr;
      this.yawRate *= Math.exp(-dt * 2);
      this.heading += this.yawRate * dt;
      this.x += Math.sin(this.heading) * this.speed * dt;
      this.y += Math.cos(this.heading) * this.speed * dt;
      this.leanAngle += (this.fallSide * 1.42 - this.leanAngle) * Math.min(1, dt * 7);
      this.slip = Math.min(1, Math.abs(this.speed) / 6);
      this.rpm += (0 - this.rpm) * Math.min(1, dt * 3);
      this.applyVisuals(dt, input);
      return;
    }
    if (this.starting > 0) {
      this.starting -= dt;
      if (this.starting <= 0) this.engineOn = true;
    }
    const powered = this.engineOn || d.idleRpm === 0;
    // controls build up instead of switching on and off
    this.thr += ((powered ? input.throttle : 0) - this.thr) * Math.min(1, dt * (input.throttle > this.thr ? 3.5 : 6));
    this.brk += (input.brake - this.brk) * Math.min(1, dt * (input.brake > this.brk ? 7 : 9));
    const sp0 = Math.abs(this.speed);
    const steerRate = 3.2 / (1 + sp0 / 12);
    this.str += Math.max(-steerRate * dt, Math.min(steerRate * dt, input.steer - this.str));

    // ---- longitudinal
    const max = s.maxSpeed * (0.55 + 0.45 * surfaceGrip);
    let a = 0;
    if (this.thr > 0.01 && this.speed >= -0.1) {
      const fade = Math.max(0, 1 - (this.speed / max) ** 2);
      a += s.acceleration * this.thr * (0.35 + 0.65 * fade) * (this.speed > max ? 0 : 1);
    }
    // rolling resistance, air drag, engine braking
    const drag = 0.25 + 0.0016 * this.speed * this.speed * (d.bike ? 1.4 : 1) + (powered && d.idleRpm ? 0.35 * (1 - this.thr) : 0) + (1 - surfaceGrip) * 1.6;
    let slide = 0;
    if (this.brk > 0.01) {
      if (this.speed > 0.4) {
        const want = s.braking * this.brk;
        const limit = mu * G;
        if (want > limit) {
          // over the grip limit: the car's ABS holds the limit; a bike's wheels lock and slide (longer stop)
          slide = Math.min(1, (want - limit) / limit + 0.3);
          a -= d.bike ? limit * 0.78 : limit * 0.97;
        } else a -= want;
      } else if (this.speed > -s.maxSpeed * 0.2) {
        // stopped: holding the brake backs up slowly
        a -= s.acceleration * 0.4 * this.brk;
      }
    }
    if (this.speed > 0) a -= drag;
    else if (this.speed < 0) a += drag;
    const before = this.speed;
    this.speed += a * dt;
    if (before > 0 && this.speed < 0 && this.brk > 0.01 && before > 0.5) this.speed = 0;
    if (Math.abs(this.speed) < 0.05 && this.thr < 0.02 && this.brk < 0.02) this.speed = 0;
    if (this.speed > max + 0.5) this.speed -= 2 * dt;
    this.lastAccel = (this.speed - before) / dt;

    // ---- lateral: the curvature the front wheel asks for, limited by grip
    const sp = Math.abs(this.speed);
    const steerAngle = this.str * d.maxSteer / (1 + (sp / d.steerFade) ** 2);
    let curv = Math.tan(steerAngle) / d.wheelbase;
    const latWant = sp * sp * Math.abs(curv);
    // grip left over after braking (friction circle)
    const longUse = Math.min(0.95, Math.abs(Math.min(0, this.lastAccel)) / (mu * G));
    const latLimit = mu * G * Math.sqrt(1 - longUse * longUse) * 0.92;
    if (latWant > latLimit && sp > 0.5) {
      slide = Math.max(slide, Math.min(1, (latWant - latLimit) / latLimit));
      curv *= latLimit / latWant;
    }
    const yaw = this.speed * curv;
    this.yawRate += (yaw - this.yawRate) * Math.min(1, dt * 10);
    this.heading += this.yawRate * dt;
    this.x += Math.sin(this.heading) * this.speed * dt;
    this.y += Math.cos(this.heading) * this.speed * dt;

    // a bike pushed past grip for long enough (a locked front wheel in a bend, standing water) goes down
    this.slip += (slide - this.slip) * Math.min(1, dt * 8);
    this.slideTime = slide > 0.45 && d.bike && sp > 4 ? this.slideTime + dt : Math.max(0, this.slideTime - dt * 2);
    if (this.slideTime > 0.45) this.fall(Math.sign(this.leanAngle || this.str || 1));

    // ---- lean: the angle that balances the turn
    if (d.bike) {
      const target = Math.atan2(sp * this.yawRate * Math.sign(this.speed || 1), G);
      const lim = Math.atan(mu) * 0.95;
      this.leanAngle += (Math.max(-lim, Math.min(lim, target)) - this.leanAngle) * Math.min(1, dt * 5);
    }

    // ---- engine speed (CVT scooter / automatic car)
    if (d.idleRpm) {
      let r: number;
      if (d.bike) r = Math.max(d.idleRpm + 0.3 * this.thr, Math.min(1, sp / s.maxSpeed) * 0.85 + 0.12 * this.thr);
      else {
        const bands = [0, 6, 11, 16, 21, 99];
        let g = 0;
        while (sp > bands[g + 1]! && g < 4) g++;
        const within = (sp - bands[g]!) / (Math.min(bands[g + 1]!, 28) - bands[g]!);
        r = Math.max(d.idleRpm + 0.25 * this.thr, 0.25 + 0.6 * Math.min(1, within) + 0.1 * this.thr);
      }
      if (!this.engineOn) r = 0;
      this.rpm += (r - this.rpm) * Math.min(1, dt * 6);
    }
    this.applyVisuals(dt, input);
  }

  private applyVisuals(dt: number, input: DriveInput) {
    const d = this.dyn;
    const sp = Math.abs(this.speed);
    // suspension: a spring that follows braking and acceleration, plus road bumps at speed
    const pitchTarget = this.fallen ? 0 : -this.lastAccel * d.pitchK;
    this.pitchVel += ((pitchTarget - this.pitch) * 90 - this.pitchVel * 11) * dt;
    this.pitch += this.pitchVel * dt;
    this.bumpPhase += sp * dt;
    const rough = Math.sin(this.bumpPhase * 1.7) * Math.sin(this.bumpPhase * 0.37 + 1.3);
    const bumpTarget = this.fallen ? 0 : rough * Math.min(1, sp / 8) * (d.bike ? 0.012 : 0.008);
    this.heaveVel += ((bumpTarget - this.heave) * 160 - this.heaveVel * 14) * dt;
    this.heave += this.heaveVel * dt;
    this.shake *= Math.exp(-dt * 3.5);

    const radius = this.id === 'car' ? 0.31 : this.id === 'motorcycle' ? 0.24 : 0.34;
    if (!this.fallen) this.wheelAngle += (this.speed * dt) / radius;
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    // the front wheel turns as the rider steers (more at walking pace than at speed)
    const vis = this.fallen ? 0 : -this.str * 0.42 * this.steerScale * (1 / (1 + sp / 10) * 0.7 + 0.3);
    this.steerVisual += (vis - this.steerVisual) * Math.min(1, dt * 10);
    for (const w of this.frontWheels) w.rotation.y = this.steerVisual;
    if (this.dash) {
      this.dash.speedo.set(sp * 3.6);
      // a car's steering wheel turns about 2.5 times as far as its road wheels' visual angle
      if (this.dash.wheel) this.dash.wheel.rotation.z = (-this.steerVisual / (0.42 * this.steerScale)) * 1.6;
    }
    this.lean.rotation.order = 'YXZ';
    this.lean.rotation.z = d.bike ? this.leanAngle : 0;
    this.lean.rotation.x = this.pitch;
    this.lean.position.y = this.heave;
    // a fallen bike lies on the ground: lower the pivot so it does not float
    if (d.bike) this.lean.position.y += -Math.abs(Math.sin(this.leanAngle)) * (this.fallen ? 0.25 : 0);
    void input;
  }

  /**
   * A collision with a solid obstacle. `nx, ny` points from the obstacle towards the vehicle, `mass` of
   * the other body relative to ours (Infinity for walls). The velocity bounces off the surface; what
   * goes along it is kept (a glancing blow scrapes along, a head-on stops dead). Returns what happened.
   */
  hit(nx: number, ny: number, other = Infinity): ImpactResult | null {
    const fx = Math.sin(this.heading);
    const fy = Math.cos(this.heading);
    const vx = fx * this.speed;
    const vy = fy * this.speed;
    const vn = vx * nx + vy * ny;
    if (vn >= -0.05) return null;
    const share = other === Infinity ? 1 : other / (other + 1);
    const e = 0.18;
    const nvx = vx - (1 + e) * vn * nx * share;
    const nvy = vy - (1 + e) * vn * ny * share;
    // scraping along loses speed too
    const tx = nvx - (nvx * nx + nvy * ny) * nx;
    const ty = nvy - (nvx * nx + nvy * ny) * ny;
    const scrape = Math.max(0, 1 - 0.35 * Math.abs(vn) / (Math.hypot(tx, ty) + 1));
    const ovx = (nvx - tx) + tx * scrape;
    const ovy = (nvy - ty) + ty * scrape;
    const mag = Math.hypot(ovx, ovy);
    const along = ovx * fx + ovy * fy;
    // a glancing blow turns the vehicle along the wall
    const cross = fx * ny - fy * nx;
    const impact = -vn * share;
    this.yawRate += cross * Math.min(2.5, impact * 0.25) * Math.sign(this.speed || 1);
    if (mag > 0.2 && along > 0) {
      const ang = Math.atan2(ovx, ovy);
      let dh = ang - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * 0.5;
    }
    this.speed = Math.sign(along || -1) * Math.min(mag, Math.abs(this.speed));
    const severity = Math.min(1, impact / 12);
    this.shake = Math.max(this.shake, 0.15 + severity);
    let fell = false;
    let stalled = false;
    if (this.dyn.bike && (impact > 6.5 || (impact > 4 && Math.abs(this.leanAngle) > 0.35))) {
      this.fall(cross >= 0 ? 1 : -1);
      fell = true;
    }
    if (this.dyn.idleRpm && (fell || impact > (this.dyn.bike ? 6.5 : 9))) {
      stalled = this.engineOn;
      this.engineOn = false;
    }
    return { speed: impact, severity, fell, stalled };
  }

  /** The bike goes down on one side. */
  fall(side: number) {
    if (this.fallen || !this.dyn.bike) return;
    this.fallen = true;
    this.fallSide = side >= 0 ? 1 : -1;
    this.shake = 1;
    if (this.dyn.idleRpm) this.engineOn = false;
  }

  /** Pick the bike up (or straighten the car) where it is. */
  standUp() {
    this.fallen = false;
    this.leanAngle = 0;
    this.speed = 0;
    this.yawRate = 0;
    this.slideTime = 0;
    this.slip = 0;
  }

  /** Turn the key: the engine catches after a short crank. Returns false when it is already running. */
  restartEngine() {
    if (this.engineOn || this.fallen || this.dyn.idleRpm === 0) return false;
    this.starting = 0.9;
    return true;
  }

  get needsRestart() {
    return this.dyn.idleRpm > 0 && !this.engineOn && this.starting <= 0;
  }

  sync() {
    this.object.position.set(this.x, this.z, -this.y);
    this.object.rotation.y = Math.PI - this.heading;
  }
}
