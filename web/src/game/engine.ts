// The running game: renderer, scene, player vehicle, camera, collisions,
// mission zones and route guidance. React owns the menus and HUD and talks to
// this class through a small API and a HUD callback.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { distanceToRoadEdge, findRoute, type RoadGraph, type Route } from '../../../shared/roads';
import { DISCOVERY_RADIUS_M, DROPOFF_RADIUS_M, PICKUP_RADIUS_M } from '../../../shared/rules';
import type { DistrictData, Merchant, MissionRun, VehicleId } from '../../../shared/types';
import { disposeOwned } from './assets';
import { circleVsBox } from './collision';
import { Crowd, CROWD_SIZE } from './crowd';
import { MerchantView, merchantFrame, roleFor, targetBeacon } from './merchants';
import { Vehicle, type DriveInput } from './vehicle';
import { ribbon, v3, World, type Quality } from './world';

export type CameraMode = 'chase' | 'far' | 'rider' | 'showcase';

export interface HudState {
  speedKmh: number;
  x: number;
  y: number;
  heading: number;
  nearMerchantId: number | null;
  nearMerchantDistance: number;
  /** player is inside the active mission's pickup or drop-off zone */
  zone: 'pickup' | 'dropoff' | null;
  targetDistance: number | null;
  routeRemaining: number | null;
  route: LocalPoint[] | null;
  target: LocalPoint | null;
}

export interface EngineCallbacks {
  onHud: (s: HudState) => void;
  onDiscover: (merchantId: number) => void;
  onTapMerchant: (merchantId: number) => void;
  onBump: (speed: number) => void;
  /** frame rate stayed low: the engine suggests a lower quality level */
  onSlow?: (suggested: Quality) => void;
}

const QUALITY = {
  low: { ratio: 1, fog: 300, shadows: false },
  medium: { ratio: 1.5, fog: 520, shadows: false },
  high: { ratio: 2, fog: 800, shadows: true },
} as const;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2500);
  private world!: World;
  private vehicle!: Vehicle;
  private merchants = new Map<number, MerchantView>();
  private crowd = new Crowd();
  private crowdKey = '';
  private sun = new THREE.DirectionalLight('#ffe8c7', 2.6);
  private sky!: THREE.Mesh;
  private lastFrame = performance.now();
  private elapsed = 0;
  private raf = 0;
  private paused = false;
  private input: DriveInput = { throttle: 0, brake: 0, steer: 0 };
  private keys = new Set<string>();
  /** touch controls write here */
  readonly touch: DriveInput = { throttle: 0, brake: 0, steer: 0 };
  private cameraMode: CameraMode = 'chase';
  private baseFov = 55;
  private camPos = new THREE.Vector3();
  private camLook = new THREE.Vector3();
  private run: MissionRun | null = null;
  private target: LocalPoint | null = null;
  private targetKind: 'pickup' | 'dropoff' | null = null;
  private customerBeacon: THREE.Object3D | null = null;
  private routeMesh: THREE.Mesh | null = null;
  private routeTex: THREE.Texture;
  private route: Route | null = null;
  private routeAt = { x: Infinity, y: Infinity, t: 0 };
  private hudAt = 0;
  private gripAt = 0;
  private grip = 1;
  private discovered = new Set<number>();
  private lastBump = 0;
  private quality: Quality;
  private pointerDown: { x: number; y: number; t: number } | null = null;
  private resizeObserver: ResizeObserver;

  constructor(
    private canvas: HTMLCanvasElement,
    private district: DistrictData,
    private graph: RoadGraph,
    merchants: Merchant[],
    opts: { quality: Quality; vehicle: VehicleId; discovered: number[] },
    private cb: EngineCallbacks,
  ) {
    this.quality = opts.quality;
    this.discovered = new Set(opts.discovered);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: opts.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.applyQuality();

    // image-based lighting gives the vehicles believable reflections
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pmrem.dispose();

    this.scene.add(new THREE.HemisphereLight('#dfe8f0', '#8f7d60', 1.05));
    this.sun.position.set(-150, 160, 110);
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -70;
    sc.right = sc.top = 70;
    sc.near = 10;
    sc.far = 500;
    this.scene.add(this.sun, this.sun.target);
    this.buildSky();

    this.routeTex = chevronTexture();
    this.buildWorld(merchants);
    this.spawn(opts.vehicle);

    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.loop();
  }

  // ---- setup ---------------------------------------------------------------

  private applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = q.shadows;
    this.scene.fog = new THREE.Fog('#d9d6cc', q.fog * 0.3, q.fog);
    this.camera.far = q.fog + 50;
    this.camera.updateProjectionMatrix();
  }

  private buildSky() {
    const geo = new THREE.SphereGeometry(1, 24, 12);
    const top = new THREE.Color('#7fa3c4');
    const bottom = new THREE.Color('#dedbd1');
    const colors: number[] = [];
    const pos = geo.attributes.position!;
    for (let i = 0; i < pos.count; i++) {
      const t = Math.max(0, pos.getY(i));
      const c = bottom.clone().lerp(top, Math.pow(t, 0.45));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    this.sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }



  private buildWorld(merchants: Merchant[]) {
    if (this.world) {
      this.scene.remove(this.world.group);
      disposeTree(this.world.group);
    }
    for (const v of this.merchants.values()) {
      this.scene.remove(v.group);
      v.dispose();
    }
    this.merchants.clear();
    this.crowdKey = '';
    const active = merchants.filter((m) => m.status === 'active').map((m) => merchantFrame(m, this.district, this.graph));
    this.world = new World(this.district, this.graph, {
      quality: this.quality,
      reserved: active.map((f) => f.box),
      keepClear: active.flatMap((f) => [f.pickup, f.dropoff]),
    });
    this.scene.add(this.world.group);
    this.setMerchants(merchants);
  }

  private spawn(vehicleId: VehicleId) {
    const road = this.graph.polylines.find((p) => p.road.id === 'sixty-meter') ?? this.graph.polylines[0]!;
    const pts = road.points;
    const i = Math.floor(pts.length * 0.42);
    const a = pts[i]!;
    const b = pts[i + 1] ?? a;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    // drive on the right: offset to the right-hand carriageway
    const off = road.road.width / 4;
    this.setVehicle(vehicleId);
    this.vehicle.x = a.x + ty * off;
    this.vehicle.y = a.y - tx * off;
    this.vehicle.heading = Math.atan2(tx, ty);
    this.vehicle.sync();
    this.snapCamera();
  }

  setVehicle(id: VehicleId) {
    const prev = this.vehicle;
    if (prev?.id === id) return;
    this.vehicle = new Vehicle(id);
    if (prev) {
      this.vehicle.x = prev.x;
      this.vehicle.y = prev.y;
      this.vehicle.heading = prev.heading;
      this.scene.remove(prev.object);
      disposeTree(prev.object);
    }
    this.vehicle.sync();
    this.scene.add(this.vehicle.object);
    this.vehicle.object.traverse((o) => (o.castShadow = true));
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    const list = [...this.merchants.values()].map((v) => v.merchant);
    this.buildWorld(list);
    this.applyRunMarkers();
  }

  setCameraMode(m: CameraMode) {
    if (m !== this.cameraMode) this.snapNext = true;
    this.cameraMode = m;
  }

  private snapNext = true;
  private showcaseOffset = { x: 0, y: 0 };
  /** Where the vehicle should sit on screen in the menu (metres of look-target offset, camera right/up). */
  setShowcaseOffset(x: number, y: number) {
    this.showcaseOffset = { x, y };
    this.snapNext = true;
  }

  getCameraMode() {
    return this.cameraMode;
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) this.lastFrame = performance.now();
  }

  // ---- merchants -------------------------------------------------------------

  /** Add, rebuild or remove merchant buildings so the world matches `list`. */
  setMerchants(list: Merchant[]) {
    const next = new Map(list.filter((m) => m.status === 'active').map((m) => [m.id, m]));
    for (const [id, view] of this.merchants) {
      const m = next.get(id);
      if (!m || m.updated_at !== view.merchant.updated_at || JSON.stringify(m.sponsorship) !== JSON.stringify(view.merchant.sponsorship)) {
        this.scene.remove(view.group);
        this.world.grid.remove(view.frame.box);
        view.dispose();
        this.merchants.delete(id);
      }
    }
    for (const [id, m] of next) {
      if (this.merchants.has(id)) continue;
      const view = new MerchantView(m, this.district, this.graph, this.quality);
      this.merchants.set(id, view);
      this.scene.add(view.group);
      this.world.grid.add(view.frame.box);
    }
    this.world.updateReserved([...this.merchants.values()].map((v) => v.frame.box));
    this.rebuildCrowd();
    this.applyRunMarkers();
  }

  /** People on the pavements; rebuilt only when the businesses or the quality level change. */
  private rebuildCrowd() {
    const views = [...this.merchants.values()];
    const key = `${this.quality}:${views.map((v) => `${v.merchant.id}@${v.merchant.updated_at}`).sort().join(',')}`;
    if (key === this.crowdKey && this.crowd.group.parent) return;
    for (const b of this.crowd.boxes) this.world.grid.remove(b);
    this.crowd.build(views.map((v) => ({ merchant: v.merchant, frame: v.frame })), CROWD_SIZE[this.quality]);
    for (const b of this.crowd.boxes) this.world.grid.add(b);
    if (!this.crowd.group.parent) this.scene.add(this.crowd.group);
    this.crowdKey = key;
  }

  merchantFrame(id: number) {
    return this.merchants.get(id)?.frame ?? null;
  }

  // ---- missions ----------------------------------------------------------------

  setRun(run: MissionRun | null) {
    this.run = run;
    this.route = null;
    this.routeAt = { x: Infinity, y: Infinity, t: 0 };
    this.applyRunMarkers();
  }

  private applyRunMarkers() {
    for (const v of this.merchants.values()) v.setTarget(null);
    if (this.customerBeacon) {
      this.scene.remove(this.customerBeacon);
      disposeTree(this.customerBeacon);
      this.customerBeacon = null;
    }
    const run = this.run;
    const mission = run?.mission;
    if (!run || !mission || run.status === 'delivered' || run.status === 'cancelled') {
      this.target = null;
      this.targetKind = null;
      this.setRouteMesh(null);
      return;
    }
    const toPickup = run.status === 'accepted' || run.status === 'going_to_pickup';
    this.targetKind = toPickup ? 'pickup' : 'dropoff';
    this.target = toLocal(toPickup ? mission.pickup : mission.destination, this.district.origin);
    if (toPickup) {
      this.merchants.get(mission.origin_merchant_id)?.setTarget('pickup');
    } else if (mission.destination_merchant_id && this.merchants.has(mission.destination_merchant_id)) {
      this.merchants.get(mission.destination_merchant_id)!.setTarget('dropoff');
    } else {
      this.customerBeacon = targetBeacon('dropoff', this.target, undefined, roleFor(null, 'dropoff', [...String(run.id)].reduce((a, c) => a + c.charCodeAt(0), 0)));
      this.scene.add(this.customerBeacon);
    }
  }

  private setRouteMesh(route: Route | null) {
    if (this.routeMesh) {
      this.scene.remove(this.routeMesh);
      this.routeMesh.geometry.dispose();
      (this.routeMesh.material as THREE.Material).dispose();
      this.routeMesh = null;
    }
    if (!route || route.points.length < 2) return;
    // thin out near-duplicate points so the ribbon stays clean
    const pts: LocalPoint[] = [];
    for (const p of route.points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 0.8) pts.push(p);
    }
    if (pts.length < 2) return;
    const mat = new THREE.MeshBasicMaterial({ map: this.routeTex, transparent: true, depthWrite: false, color: '#ffffff' });
    this.routeMesh = new THREE.Mesh(ribbon(pts, 1.6, 0.3, 2.4), mat);
    this.routeMesh.renderOrder = 2;
    this.scene.add(this.routeMesh);
  }

  // ---- input -------------------------------------------------------------------

  private onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.type === 'keydown') this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  };

  private onPointerDown = (e: PointerEvent) => {
    this.pointerDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.pointerDown;
    this.pointerDown = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8 || performance.now() - d.t > 400) return;
    const id = this.pick(e.clientX, e.clientY);
    if (id !== null) this.cb.onTapMerchant(id);
  };

  pick(clientX: number, clientY: number): number | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    ray.far = 400;
    const hits = ray.intersectObjects([...this.merchants.values()].map((v) => v.group), true);
    for (const h of hits) if (typeof h.object.userData.merchantId === 'number') return h.object.userData.merchantId;
    return null;
  }

  private readInput(): DriveInput {
    const k = this.keys;
    const kbThrottle = k.has('KeyW') || k.has('ArrowUp') ? 1 : 0;
    const kbBrake = k.has('KeyS') || k.has('ArrowDown') || k.has('Space') ? 1 : 0;
    const kbSteer = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    return {
      throttle: Math.max(kbThrottle, this.touch.throttle),
      brake: Math.max(kbBrake, this.touch.brake),
      steer: Math.max(-1, Math.min(1, kbSteer + this.touch.steer)),
    };
  }

  // ---- loop --------------------------------------------------------------------

  private resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // wider view in portrait so the road ahead stays visible
    this.baseFov = w < h ? 70 : 55;
    this.camera.fov = this.baseFov;
    this.camera.updateProjectionMatrix();
  }

  // adaptive quality: sample the frame rate in 4-second windows after a warm-up
  private perf = { start: performance.now() + 3000, frames: 0 };
  adaptive = true;

  private watchPerformance(nowMs: number) {
    if (!this.adaptive || this.quality === 'low' || this.paused || document.hidden) {
      this.perf = { start: nowMs + 1000, frames: 0 };
      return;
    }
    if (nowMs < this.perf.start) return;
    this.perf.frames++;
    const span = nowMs - this.perf.start;
    if (span < 4000) return;
    const fps = (this.perf.frames * 1000) / span;
    this.perf = { start: nowMs + 2000, frames: 0 };
    if (fps < 24) this.cb.onSlow?.(this.quality === 'high' ? 'medium' : 'low');
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const nowMs = performance.now();
    this.watchPerformance(nowMs);
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;
    this.elapsed += dt;
    const t = this.elapsed;
    if (!this.paused) this.update(dt, t);
    this.renderer.render(this.scene, this.camera);
  };

  private update(dt: number, t: number) {
    const v = this.vehicle;
    this.input = this.readInput();
    if (t - this.gripAt > 0.15) {
      this.gripAt = t;
      this.grip = distanceToRoadEdge(this.graph, { x: v.x, y: v.y }) <= 4 ? 1 : 0;
    }
    const steps = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < steps; i++) {
      v.step(dt / steps, this.input, this.grip);
      this.collide();
    }
    v.sync();
    for (const m of this.merchants.values()) m.update(t);
    if (this.routeTex) this.routeTex.offset.y = -t * 1.2;
    this.animateBeacons(t);
    this.updateCamera(dt);

    if (this.target && t - this.routeAt.t > 0.4) {
      const moved = Math.hypot(v.x - this.routeAt.x, v.y - this.routeAt.y);
      if (!this.route || moved > 18 || t - this.routeAt.t > 3) {
        this.route = findRoute(this.graph, { x: v.x, y: v.y }, this.target);
        this.routeAt = { x: v.x, y: v.y, t };
        this.setRouteMesh(this.route);
      }
    }

    if (t - this.hudAt > 0.1) {
      this.hudAt = t;
      this.emitHud();
    }
  }

  private collide() {
    const v = this.vehicle;
    const r = v.spec.radius;
    for (const b of this.world.grid.near(v.x, v.y, r + 40)) {
      if (b.enabled === false) continue;
      const hit = circleVsBox(v.x, v.y, r, b);
      if (!hit) continue;
      v.x += hit.nx * hit.depth;
      v.y += hit.ny * hit.depth;
      // lose the velocity component going into the wall
      const fx = Math.sin(v.heading);
      const fy = Math.cos(v.heading);
      const into = (fx * hit.nx + fy * hit.ny) * Math.sign(v.speed);
      if (into < -0.2) {
        const impact = Math.abs(v.speed);
        v.speed *= 0.25;
        const now = performance.now();
        if (impact > 6 && now - this.lastBump > 1500) {
          this.lastBump = now;
          this.cb.onBump(impact);
        }
      }
    }
    const bnd = this.world.boundsLocal;
    v.x = Math.max(bnd.minX - 150, Math.min(bnd.maxX + 150, v.x));
    v.y = Math.max(bnd.minY - 150, Math.min(bnd.maxY + 150, v.y));
  }

  /** First-person view hides the rider's head (detailed models) or the whole rider (procedural ones). */
  private showRider(firstPerson: boolean) {
    const v = this.vehicle;
    if (!v.rider) return;
    if (v.riderHead) {
      v.rider.visible = true;
      v.riderHead.visible = !firstPerson;
    } else v.rider.visible = !firstPerson;
    const near = firstPerson && v.eye ? 0.06 : 0.5;
    const fov = this.baseFov + (firstPerson && v.eye ? 24 : 0);
    if (this.camera.near !== near || this.camera.fov !== fov) {
      this.camera.near = near;
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private animateBeacons(t: number) {
    const s = 1 + Math.sin(t * 4) * 0.12;
    this.scene.traverse((o) => {
      if (o.name === 'pulse') o.scale.set(s, s, s);
      else if (o.name === 'bob') o.position.y = 3.3 + Math.sin(t * 3) * 0.25;
      else if (o.name === 'bang') {
        o.position.y = 2.2 + Math.sin(t * 3) * 0.07;
        o.rotation.y = t * 1.6;
      }
    });
  }

  private snapCamera() {
    this.updateCamera(1, true);
  }

  private updateCamera(dt: number, snap = false) {
    const v = this.vehicle;
    const fx = Math.sin(v.heading);
    const fy = Math.cos(v.heading);
    const car = v.id === 'car';
    let back = car ? 7.6 : 5.2;
    let up = car ? 3.0 : 2.5;
    let ahead = 8;
    let drop = 0.5;
    if (this.snapNext) {
      snap = true;
      this.snapNext = false;
    }
    if (this.cameraMode === 'showcase') {
      // slow three-quarter orbit around the vehicle for the menu
      const a = this.elapsed * 0.08 + 0.75;
      const dist = car ? 7.2 : 3.9;
      const want = new THREE.Vector3(v.x + Math.sin(v.heading + a) * dist, car ? 1.9 : 1.55, -(v.y + Math.cos(v.heading + a) * dist));
      const centre = new THREE.Vector3(v.x, car ? 0.8 : 0.9, -v.y);
      const dir = centre.clone().sub(want).normalize();
      const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const look = centre.add(right.multiplyScalar(this.showcaseOffset.x * (car ? 1.5 : 1))).add(new THREE.Vector3(0, this.showcaseOffset.y, 0));
      const k = snap ? 1 : 1 - Math.exp(-dt * 3);
      this.camPos.lerp(want, k);
      this.camLook.lerp(look, k);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.showRider(false);
      this.sky.position.copy(this.camera.position);
      this.sky.scale.setScalar(this.camera.far * 0.9);
      return;
    }
    if (this.cameraMode === 'far') {
      back = 22;
      up = 14;
      ahead = 10;
    } else if (this.cameraMode === 'rider') {
      back = car ? -0.35 : -0.05;
      up = car ? 1.25 : 1.78;
      ahead = 20;
      if (v.eye) {
        // from the rider's eyes, looking a little down so the hands and handlebar sit at the bottom of the view
        back = 0.1 - v.eye.z;
        up = v.eye.y + 0.08;
        ahead = 6;
        drop = 2.25;
      }
    }
    const want = new THREE.Vector3(v.x - fx * back, up, -(v.y - fy * back));
    const look = new THREE.Vector3(v.x + fx * ahead, this.cameraMode === 'rider' ? up - drop : 1.4, -(v.y + fy * ahead));
    const k = snap ? 1 : 1 - Math.exp(-dt * (this.cameraMode === 'rider' ? 20 : 6));
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    if (snap) {
      this.camPos.copy(want);
      this.camLook.copy(look);
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.showRider(this.cameraMode === 'rider');
    this.sky.position.copy(this.camera.position);
    this.sky.scale.setScalar(this.camera.far * 0.9);
    if (this.sun.castShadow) {
      this.sun.position.set(v.x - 120, 220, -v.y + 80);
      this.sun.target.position.set(v.x, 0, -v.y);
    }
  }

  private emitHud() {
    const v = this.vehicle;
    const p = { x: v.x, y: v.y };
    let near: { id: number; d: number } | null = null;
    for (const [id, view] of this.merchants) {
      const f = view.frame;
      const d = Math.min(
        Math.hypot(f.entrance.x - p.x, f.entrance.y - p.y),
        Math.hypot(f.pickup.x - p.x, f.pickup.y - p.y),
      );
      if (d < DISCOVERY_RADIUS_M && !this.discovered.has(id)) {
        this.discovered.add(id);
        this.cb.onDiscover(id);
      }
      if (d < 30 && (!near || d < near.d)) near = { id, d };
    }
    let zone: HudState['zone'] = null;
    let targetDistance: number | null = null;
    if (this.target) {
      targetDistance = Math.hypot(this.target.x - p.x, this.target.y - p.y);
      const radius = this.targetKind === 'pickup' ? PICKUP_RADIUS_M : DROPOFF_RADIUS_M;
      // stay a little inside the server's radius so the request is not refused
      if (targetDistance <= radius - 1.5) zone = this.targetKind;
    }
    this.cb.onHud({
      speedKmh: Math.abs(v.speed) * 3.6,
      x: v.x,
      y: v.y,
      heading: v.heading,
      nearMerchantId: near?.id ?? null,
      nearMerchantDistance: near?.d ?? Infinity,
      zone,
      targetDistance,
      routeRemaining: this.route ? this.route.length : null,
      route: this.route?.points ?? null,
      target: this.target,
    });
  }

  position(): LocalPoint {
    return { x: this.vehicle.x, y: this.vehicle.y };
  }

  /** Move the player (used by the e2e tests and the "return to hub" option). */
  teleport(p: LocalPoint, heading?: number) {
    this.vehicle.x = p.x;
    this.vehicle.y = p.y;
    this.vehicle.speed = 0;
    if (heading !== undefined) this.vehicle.heading = heading;
    this.vehicle.sync();
    this.snapCamera();
    this.emitHud();
  }

  /** Put the player on a merchant's kerb, facing the storefront, `back` metres away. */
  focusMerchant(id: number, back = 22): boolean {
    const f = this.merchantFrame(id);
    if (!f) return false;
    const h = Math.atan2(f.entrance.x - f.pickup.x, f.entrance.y - f.pickup.y);
    this.teleport({ x: f.pickup.x - Math.sin(h) * back, y: f.pickup.y - Math.cos(h) * back }, h);
    return true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.resizeObserver.disconnect();
    for (const v of this.merchants.values()) v.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
  }
}

function disposeTree(root: THREE.Object3D) {
  disposeOwned(root);
}

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(227,139,29,0.5)';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(255,244,226,0.95)';
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(12, 42);
  ctx.lineTo(32, 22);
  ctx.lineTo(52, 42);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export { v3 };
