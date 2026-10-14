// The running game: renderer, scene, player vehicle, camera, collisions,
// mission zones and route guidance. React owns the menus and HUD and talks to
// this class through a small API and a HUD callback.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toLocal, type LocalPoint } from '../../../shared/geo';
import { distanceToRoadEdge, findRoute, nearestOnNetwork, hasGradeSeparation, roadHeightAt, type RoadGraph, type Route } from '../../../shared/roads';
import { DISCOVERY_RADIUS_M, DROPOFF_RADIUS_M, PICKUP_RADIUS_M } from '../../../shared/rules';
import type { DistrictData, Merchant, MissionRun, VehicleId } from '../../../shared/types';
import { disposeOwned } from './assets';
import { circleVsBox } from './collision';
import { Crowd, CROWD_SIZE } from './crowd';
import { MerchantView, merchantFrame, roleFor, targetBeacon } from './merchants';
import { Vehicle, type DriveInput, type ImpactResult } from './vehicle';
import { ribbon, v3, World, type Quality } from './world';
import { Traffic } from './traffic';
import { PostProcess } from './post';
import { Atmosphere } from './atmosphere';
import { GameAudio } from './audio';
import { NightLights } from './nightlights';
import { Mirrors } from './mirrors';
import { cullByDistance } from './chunked';
import { sky } from './pbr';
import { buildLandmarks, buildSigns, landmarkFootprints } from './landmarks';

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
  /** the engine stalled in a crash and needs restarting */
  engineOff: boolean;
  /** the bike is lying on its side */
  fallen: boolean;
  /** time of day, hours */
  hour: number;
}

export interface EngineCallbacks {
  onHud: (s: HudState) => void;
  onDiscover: (merchantId: number) => void;
  onTapMerchant: (merchantId: number) => void;
  onBump: (speed: number) => void;
  /** a collision: how hard, whether the bike went down or the engine stalled */
  onCrash?: (r: ImpactResult) => void;
  /** the player drove through a red light */
  onRedLight?: () => void;
  /** frame rate stayed low: the engine suggests a lower quality level */
  onSlow?: (suggested: Quality) => void;
}

const QUALITY = {
  low: { ratio: 1, fog: 300, shadows: false, shadowMap: 0, shadowSpan: 0 },
  medium: { ratio: 1.5, fog: 520, shadows: true, shadowMap: 1024, shadowSpan: 45 },
  high: { ratio: 2, fog: 800, shadows: true, shadowMap: 2048, shadowSpan: 70 },
} as const;

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.5, 2500);
  private world!: World;
  private vehicle!: Vehicle;
  private merchants = new Map<number, MerchantView>();
  private crowd = new Crowd();
  private traffic: Traffic | null = null;
  /** direction towards the sun (from the sky photo) and the horizon colour for the haze */
  private sunDir = new THREE.Vector3(-150, 160, 110).normalize();
  private horizon = '#d8dcdb';
  private post!: PostProcess;
  private graded = false;
  private redAt = 0;
  private lightAt = 0;
  private crowdKey = '';
  private sun = new THREE.DirectionalLight('#ffe8c7', 2.6);
  private hemi = new THREE.HemisphereLight('#d4e3f2', '#9a8662', 0.95);
  /** time of day and weather */
  atmos!: Atmosphere;
  private nightLights: NightLights | null = null;
  private headlight: THREE.SpotLight | null = null;
  readonly audio = new GameAudio();
  private mirrors: Mirrors | null = null;
  /** rear-view mirrors on/off and their angle (settings) */
  mirrorsOn = true;
  trafficDensity = (() => {
    try {
      const d = Number(localStorage.getItem('dg.traffic'));
      return d > 0 ? d : 1;
    } catch {
      return 1;
    }
  })();
  /** distance outside the carriageway at the last frame (kerb strikes) */
  private prevEdge = -1;
  private prevBrake = 0;
  private cullAt = -1;
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
    this.renderer.toneMappingExposure = 0.92;
    this.applyQuality();

    // image-based lighting: the photographed sky lights and reflects in everything (a studio probe
    // when the sky files are missing)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const photoSky = sky();
    if (photoSky) {
      this.scene.environment = pmrem.fromEquirectangular(photoSky.environment).texture;
      this.scene.environmentIntensity = 0.6;
      this.scene.background = photoSky.background;
      this.scene.backgroundRotation.set(0, 0, 0);
      this.sunDir.copy(photoSky.sun);
      this.horizon = photoSky.horizon;
      (this.scene.fog as THREE.Fog | null)?.color.set(this.horizon);
    } else {
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.55;
    }
    pmrem.dispose();

    this.scene.add(this.hemi);
    this.sun.position.copy(this.sunDir).multiplyScalar(260);
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 500;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.applyShadowSize();
    this.scene.add(this.sun, this.sun.target);
    this.post = new PostProcess(this.renderer, this.scene, this.camera, this.quality);
    if (photoSky) photoSky.background.wrapS = THREE.RepeatWrapping;
    const fog = this.scene.fog as THREE.Fog;
    this.atmos = new Atmosphere(this.scene, this.quality, this.sun, this.hemi, photoSky ? { texture: photoSky.background, sun: photoSky.sun } : null, { near: fog.near, far: fog.far });

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

  /** Shadow map resolution and the area it covers around the player (smaller on phones). */
  private applyShadowSize() {
    const q = QUALITY[this.quality];
    if (!q.shadows) return;
    if (this.sun.shadow.mapSize.x !== q.shadowMap) {
      this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    // offset along the surface normal by about one shadow-map texel, or flat walls shadow themselves
    // in speckles ("acne")
    this.sun.shadow.normalBias = ((q.shadowSpan * 2) / q.shadowMap) * 1.1;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -q.shadowSpan;
    sc.right = sc.top = q.shadowSpan;
    sc.updateProjectionMatrix();
  }

  private applyQuality() {
    const q = QUALITY[this.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.ratio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.sun.castShadow = q.shadows;
    // light summer haze, matching the sky at the horizon
    this.scene.fog = new THREE.Fog(this.horizon, q.fog * 0.42, q.fog);
    this.camera.far = q.fog + 50;
    this.camera.updateProjectionMatrix();
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
      reserved: [...active.map((f) => f.box), ...landmarkFootprints(this.district, this.graph)],
      keepClear: active.flatMap((f) => [f.pickup, f.dropoff]),
    });
    this.scene.add(this.world.group);
    // real places: the citadel, the Zanyari towers, Samad restaurant, and shop signs with real names
    const lm = buildLandmarks(this.district, this.graph, this.quality);
    this.world.group.add(lm.group);
    for (const b of lm.boxes) this.world.grid.add(b);
    const signs = buildSigns(this.district, this.world.signFaces, this.quality);
    if (signs) this.world.group.add(signs);
    this.nightLights = new NightLights(this.world.lampLights, this.quality);
    this.world.group.add(this.nightLights.group);
    if (this.traffic) {
      this.scene.remove(this.traffic.group);
      disposeTree(this.traffic.group);
    }
    this.traffic = new Traffic(this.graph, this.district, this.quality, this.trafficDensity);
    this.graded = hasGradeSeparation(this.graph);
    this.scene.add(this.traffic.group);
    this.setMerchants(merchants);
  }

  /** A start point on a ground-level street a couple of hundred metres before the Iskan tunnel, facing it. */
  private startPoint(): { road: RoadGraph['polylines'][number]; i: number } | null {
    const lm = this.district.landmarks.find((l) => l.kind === 'tunnel');
    if (!lm) return null;
    const t = toLocal({ lat: lm.lat, lng: lm.lng }, this.district.origin);
    let best: { road: RoadGraph['polylines'][number]; i: number; score: number } | null = null;
    for (const pl of this.graph.polylines) {
      if (pl.road.kind !== 'arterial' || pl.points.some((p) => p.z)) continue;
      for (let i = 0; i < pl.points.length - 1; i++) {
        const a = pl.points[i]!;
        const b = pl.points[i + 1]!;
        const d = Math.hypot(t.x - a.x, t.y - a.y);
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const towards = ((b.x - a.x) * (t.x - a.x) + (b.y - a.y) * (t.y - a.y)) / (l * (d || 1));
        if (d < 150 || d > 320 || towards < 0.85) continue;
        const score = Math.abs(d - 220);
        if (!best || score < best.score) best = { road: pl, i, score };
      }
    }
    return best;
  }

  private spawn(vehicleId: VehicleId) {
    const start = this.startPoint();
    const road = start?.road ?? this.graph.polylines.find((p) => p.road.id === 'sixty-meter') ?? this.graph.polylines[0]!;
    const pts = road.points;
    const i = start?.i ?? Math.floor(pts.length * 0.42);
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
    this.audio.setVehicle(id === 'car' ? 'car' : id === 'motorcycle' ? 'scooter' : 'bicycle');
    this.mountMirrors();
    // headlamp: one real light that follows the player (none at low quality)
    this.headlight = null;
    if (this.quality !== 'low') {
      const car = id === 'car';
      const hl = new THREE.SpotLight('#fff1dc', 0, car ? 80 : 60, car ? 0.5 : 0.42, 0.6, 1.3);
      hl.position.set(0, car ? 0.75 : 1.05, car ? 2.0 : 0.85);
      hl.target.position.set(0, 0, 32);
      this.vehicle.object.add(hl, hl.target);
      this.headlight = hl;
    }
  }

  private mountMirrors() {
    this.mirrors?.dispose();
    this.mirrors?.group.removeFromParent();
    this.mirrors = null;
    const v = this.vehicle;
    if (v.id === 'bicycle' || !v.eye) return;
    this.mirrors = new Mirrors(v.id === 'car' ? 'car' : 'scooter', this.quality, v.eye);
    try {
      const a = JSON.parse(localStorage.getItem('dg.mirrors') ?? '{}') as { on?: boolean; yaw?: number; pitch?: number };
      if (typeof a.on === 'boolean') this.mirrorsOn = a.on;
      this.mirrors.adjust.yaw = a.yaw ?? 0;
      this.mirrors.adjust.pitch = a.pitch ?? 0;
    } catch {
      /* ignore */
    }
    v.frame.add(this.mirrors.group);
  }

  /** Traffic amount: 0.5 light, 1 normal, 1.5 heavy (rebuilds the traffic). */
  setTrafficDensity(d: number) {
    if (d === this.trafficDensity) return;
    this.trafficDensity = d;
    try {
      localStorage.setItem('dg.traffic', String(d));
    } catch {
      /* ignore */
    }
    if (this.traffic) {
      this.scene.remove(this.traffic.group);
      disposeTree(this.traffic.group);
      this.traffic = new Traffic(this.graph, this.district, this.quality, d);
      this.scene.add(this.traffic.group);
    }
  }

  /** Mirror settings: on/off and an angle offset in degrees. */
  setMirrors(s: { on?: boolean; yaw?: number; pitch?: number }) {
    if (s.on !== undefined) this.mirrorsOn = s.on;
    if (this.mirrors) {
      if (s.yaw !== undefined) this.mirrors.adjust.yaw = (s.yaw * Math.PI) / 180;
      if (s.pitch !== undefined) this.mirrors.adjust.pitch = (s.pitch * Math.PI) / 180;
    }
    const m = this.mirrors?.adjust;
    try {
      localStorage.setItem('dg.mirrors', JSON.stringify({ on: this.mirrorsOn, yaw: m?.yaw ?? 0, pitch: m?.pitch ?? 0 }));
    } catch {
      /* ignore */
    }
  }

  mirrorSettings() {
    const m = this.mirrors?.adjust;
    return { on: this.mirrorsOn, yaw: ((m?.yaw ?? 0) * 180) / Math.PI, pitch: ((m?.pitch ?? 0) * 180) / Math.PI };
  }

  setQuality(q: Quality) {
    if (q === this.quality) return;
    this.quality = q;
    this.applyQuality();
    const fog = this.scene.fog as THREE.Fog;
    this.atmos.setFogBase({ near: fog.near, far: fog.far });
    this.applyShadowSize();
    this.post.setQuality(q);
    this.mountMirrors();
    this.resize();
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
    if (e.type === 'keydown') {
      if (!e.repeat && e.code === 'KeyE') this.restartEngine();
      if (!e.repeat && e.code === 'KeyR') this.resetToRoad();
      if (!e.repeat && e.code === 'KeyH') this.audio.horn(0, this.vehicle.id === 'car' ? 1 : 1.25);
      this.keys.add(e.code);
    } else this.keys.delete(e.code);
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
    this.post?.setSize(w, h);
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
    if (this.mirrors) {
      this.mirrors.group.visible = this.mirrorsOn;
      if (this.mirrorsOn && this.cameraMode !== 'showcase') this.mirrors.render(this.renderer, this.scene, this.vehicle.frame, this.cameraMode === 'rider', this.vehicle.object);
    }
    this.post.render();
  };

  private update(dt: number, t: number) {
    const v = this.vehicle;
    this.input = this.readInput();
    const edge = distanceToRoadEdge(this.graph, { x: v.x, y: v.y });
    if (t - this.gripAt > 0.15) {
      this.gripAt = t;
      this.grip = edge <= 4 ? 1 : 0;
    }
    this.kerb(edge);
    const wetGrip = this.atmos.gripFactor();
    const steps = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < steps; i++) {
      v.step(dt / steps, this.input, this.grip, wetGrip);
      this.collide();
    }
    if (this.input.brake > 0.6 && this.prevBrake <= 0.6 && v.speed > 8) this.audio.brake(this.input.brake);
    this.prevBrake = this.input.brake;
    this.audio.update({ rpm: v.rpm, throttle: this.input.throttle, running: v.engineOn, slip: v.slip, speed: Math.abs(v.speed), rain: this.atmos.rain });
    // tunnels and bridges: follow the height of the road under the vehicle
    if (this.graded) {
      const h = roadHeightAt(this.graph, { x: v.x, y: v.y }, v.z) ?? 0;
      v.z += (h - v.z) * Math.min(1, dt * 14);
    }
    v.sync();
    const now = performance.now();
    this.traffic?.update(dt, { x: v.x, y: v.y, r: v.spec.radius, z: v.z, h: v.heading }, now);
    if (this.traffic?.horns.length) {
      for (const h of this.traffic.horns) this.audio.horn(Math.hypot(h.x - v.x, h.y - v.y), 0.85 + Math.random() * 0.35);
      this.traffic.horns.length = 0;
    }
    if (this.traffic && t - this.lightAt > 0.2) {
      this.lightAt = t;
      const ahead = this.traffic.lightAhead(v.x, v.y, v.heading);
      if (ahead && ahead.light === 'red' && ahead.distance < 0.5 && ahead.distance > -3 && v.speed > 3 && now - this.redAt > 6000) {
        this.redAt = now;
        this.cb.onRedLight?.();
      }
    }
    for (const m of this.merchants.values()) m.update(t);
    if (this.routeTex) this.routeTex.offset.y = -t * 1.2;
    this.animateBeacons(t);
    this.updateCamera(dt);
    this.updateAtmosphere(dt, t);
    // small detail is drawn only near the camera
    if (t - this.cullAt > 0.2 || t < this.cullAt) {
      this.cullAt = t;
      cullByDistance(this.camera.position);
    }

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

  /** Time of day, weather, and everything that follows them (lamps, car lights, headlight, exposure). */
  private updateAtmosphere(dt: number, t: number) {
    const a = this.atmos;
    a.step(dt, this.camera.position);
    this.sunDir.copy(a.lightDir);
    const v = this.vehicle;
    this.nightLights?.update(a.night, new THREE.Vector3(v.x, v.z, -v.y), t);
    const lamps = Math.max(a.night, a.rain * 0.7, a.fog * 0.7);
    this.traffic?.setLights(lamps);
    if (this.headlight) this.headlight.intensity = 450 * lamps;
    // the eye adapts a little to the dark
    this.renderer.toneMappingExposure = 0.92 + 0.3 * a.night;
  }

  /**
   * Solid obstacles: building walls, barriers, poles, parked and moving cars. The vehicle is a row of
   * circles; each overlap pushes it out and bounces its velocity off the surface (Vehicle.hit), so the
   * outcome depends on speed and angle: a scrape along a wall keeps going, a head-on stops dead, a hard
   * hit throws a bike down and stalls the engine.
   */
  private collide() {
    const v = this.vehicle;
    const moving = this.traffic?.boxesNear(v.x, v.y, 8) ?? [];
    const fixed = this.world.grid.near(v.x, v.y, 44);
    for (const c of v.shapes()) {
      for (const b of [...fixed, ...moving]) {
        if (b.enabled === false) continue;
        // walls of a tunnel, bridge parapets: only at their own height
        if (b.z0 !== undefined && (v.z < b.z0 || v.z > b.z1!)) continue;
        const hit = circleVsBox(c.x, c.y, c.r, b);
        if (!hit) continue;
        v.x += hit.nx * hit.depth;
        v.y += hit.ny * hit.depth;
        c.x += hit.nx * hit.depth;
        c.y += hit.ny * hit.depth;
        const isCar = moving.includes(b);
        // a moving car outweighs a scooter about five to one
        const res = v.hit(hit.nx, hit.ny, isCar ? (v.id === 'car' ? 1 : 5) : Infinity);
        if (!res) continue;
        if (isCar) {
          this.traffic?.bumped(b.id, performance.now());
          if (res.speed > 1) this.audio.horn(6, 0.9 + Math.random() * 0.25);
        }
        this.onImpact(res);
      }
    }
    const bnd = this.world.boundsLocal;
    v.x = Math.max(bnd.minX - 150, Math.min(bnd.maxX + 150, v.x));
    v.y = Math.max(bnd.minY - 150, Math.min(bnd.maxY + 150, v.y));
  }

  private onImpact(res: ImpactResult) {
    if (res.speed < 0.8) return;
    this.audio.impact(res.severity);
    const now = performance.now();
    if (res.speed > 3.5 && now - this.lastBump > 1500) {
      this.lastBump = now;
      this.cb.onBump(res.speed);
    }
    if (res.speed > 2.5) this.cb.onCrash?.(res);
  }

  /**
   * Kerbs: riding off the carriageway at a steep angle and speed strikes the kerb like a wall; slowly or
   * at a shallow angle the vehicle rides up it with a jolt.
   */
  private kerb(edge: number) {
    const v = this.vehicle;
    const was = this.prevEdge;
    this.prevEdge = edge;
    if (!(was <= 0 && edge > 0) || Math.abs(v.z) > 0.5 || v.fallen) return;
    const near = nearestOnNetwork(this.graph, { x: v.x, y: v.y });
    if (!near || near.distance < 0.01) return;
    const nx = (v.x - near.point.x) / near.distance;
    const ny = (v.y - near.point.y) / near.distance;
    const out = (Math.sin(v.heading) * nx + Math.cos(v.heading) * ny) * v.speed;
    const limit = v.id === 'car' ? 2.4 : v.id === 'motorcycle' ? 4 : 3;
    if (out > limit) {
      // back onto the road edge, then bounce off the kerb face
      const back = edge + 0.05;
      v.x -= nx * back;
      v.y -= ny * back;
      this.prevEdge = -0.05;
      const res = v.hit(-nx, -ny);
      if (res) this.onImpact({ ...res, severity: res.severity * 0.6 });
    } else if (out > 0.4) {
      v.speed *= 0.94;
      v.shake = Math.max(v.shake, 0.12);
      this.audio.impact(0.06);
    }
  }

  /** Restart a stalled engine (button or E key). */
  restartEngine() {
    if (this.vehicle.restartEngine()) this.audio.starter();
  }

  /** Pick the bike up where it lies. */
  standUp() {
    this.vehicle.standUp();
  }

  /** Put the vehicle back on the nearest road, in the right-hand lane, upright, engine running. */
  resetToRoad() {
    const v = this.vehicle;
    const near = nearestOnNetwork(this.graph, { x: v.x, y: v.y });
    if (!near) return;
    const s = near.segment;
    let tx = (s.b.x - s.a.x) / (s.length || 1);
    let ty = (s.b.y - s.a.y) / (s.length || 1);
    // keep roughly the direction the player was going
    if (tx * Math.sin(v.heading) + ty * Math.cos(v.heading) < 0) {
      tx = -tx;
      ty = -ty;
    }
    const off = s.width / 4;
    v.x = near.point.x + ty * off;
    v.y = near.point.y - tx * off;
    v.heading = Math.atan2(tx, ty);
    v.z = roadHeightAt(this.graph, { x: v.x, y: v.y }, v.z) ?? 0;
    v.standUp();
    v.engineOn = true;
    v.sync();
    this.prevEdge = -1;
    this.snapCamera();
  }

  /** First-person view hides the rider's head (detailed models) or the whole rider (procedural ones). */
  private showRider(firstPerson: boolean) {
    const v = this.vehicle;
    if (v.rider) {
      if (v.riderHead) {
        v.rider.visible = true;
        v.riderHead.visible = !firstPerson;
      } else v.rider.visible = !firstPerson;
    }
    const near = firstPerson && v.eye ? 0.06 : 0.5;
    const fov = this.baseFov + (firstPerson && v.eye ? (v.id === 'car' ? 16 : 24) : 0);
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
    this.camera.up.set(0, 1, 0);
    if (this.cameraMode === 'showcase') {
      // slow three-quarter orbit around the vehicle for the menu
      const a = this.elapsed * 0.08 + 0.75;
      const dist = car ? 7.2 : 3.9;
      const want = new THREE.Vector3(v.x + Math.sin(v.heading + a) * dist, v.z + (car ? 1.9 : 1.55), -(v.y + Math.cos(v.heading + a) * dist));
      const centre = new THREE.Vector3(v.x, v.z + (car ? 0.8 : 0.9), -v.y);
      const dir = centre.clone().sub(want).normalize();
      const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const look = centre.add(right.multiplyScalar(this.showcaseOffset.x * (car ? 1.5 : 1))).add(new THREE.Vector3(0, this.showcaseOffset.y, 0));
      const k = snap ? 1 : 1 - Math.exp(-dt * 3);
      this.camPos.lerp(want, k);
      this.camLook.lerp(look, k);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      this.showRider(false);
      return;
    }
    if (this.cameraMode === 'far') {
      back = 22;
      up = 14;
      ahead = 10;
    }
    // a fallen rider watches from behind the bike
    const rider = this.cameraMode === 'rider' && !v.fallen;
    if (this.cameraMode === 'rider' && v.fallen) {
      back = 5.2;
      up = 2.2;
      ahead = 0;
    } else if (rider) {
      back = car ? -0.35 : -0.05;
      up = car ? 1.25 : 1.78;
      ahead = 20;
      if (v.eye) {
        // from the driver's eyes, looking a little down so the hands and handlebar (or the dashboard and
        // steering wheel) sit at the bottom of the view
        back = car ? -v.eye.z : 0.1 - v.eye.z;
        up = v.eye.y + (car ? 0 : 0.08);
        ahead = car ? 12 : 6;
        drop = car ? 1.0 : 2.25;
      }
    }
    // the car's driver sits on the left: shift the eye sideways (x is the vehicle's left)
    const side = rider && v.eye ? v.eye.x : 0;
    const lx = -fy * side;
    const ly = fx * side;
    const want = new THREE.Vector3(v.x - fx * back + lx, v.z + up, -(v.y - fy * back + ly));
    const look = new THREE.Vector3(v.x + fx * ahead + lx, v.z + (rider ? up - drop : 1.4), -(v.y + fy * ahead + ly));
    // the rider's head goes with the bike's lean, the body's pitch and the bumps of the road
    const rightX = fy;
    const rightZ = fx;
    let roll = 0;
    if (rider) {
      const lean = v.leanAngle;
      const h = up;
      want.x += rightX * h * Math.sin(lean);
      want.z += rightZ * h * Math.sin(lean);
      want.y -= h * (1 - Math.cos(lean)) - v.heave - v.pitch * 0.4;
      look.y -= v.pitch * ahead;
      roll = lean * 0.75;
      // a fine vibration from the engine and the road surface
      const sp = Math.abs(v.speed);
      const buzz = (v.engineOn && v.id !== 'bicycle' ? 0.0012 : 0) + 0.0025 * Math.min(1, sp / 20);
      want.y += Math.sin(this.elapsed * 97) * buzz;
      want.x += Math.sin(this.elapsed * 71) * buzz * 0.5;
    }
    // crash shake
    if (v.shake > 0.01) {
      const a = v.shake * (rider ? 0.12 : 0.25);
      want.x += Math.sin(this.elapsed * 53) * a;
      want.y += Math.sin(this.elapsed * 61 + 1) * a;
      look.x += Math.sin(this.elapsed * 47 + 2) * a * 2;
    }
    const k = snap ? 1 : 1 - Math.exp(-dt * (rider ? 20 : 6));
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    // the driver's eye is fixed to the vehicle: no smoothing, or the camera would trail behind the seat at speed
    if (snap || rider) {
      this.camPos.copy(want);
      this.camLook.copy(look);
    }
    this.camera.position.copy(this.camPos);
    // roll the view with the bike (the eye's "up" tilts towards the lean)
    this.camera.up.set(Math.sin(roll) * rightX, Math.cos(roll), Math.sin(roll) * rightZ);
    this.camera.lookAt(this.camLook);
    this.showRider(rider);
    this.sun.position.set(v.x + this.sunDir.x * 260, this.sunDir.y * 260, -v.y + this.sunDir.z * 260);
    this.sun.target.position.set(v.x, 0, -v.y);
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
      engineOff: v.needsRestart,
      fallen: v.fallen,
      hour: this.atmos.hour,
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
    this.vehicle.z = p.z ?? 0;
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
    this.audio.dispose();
    this.atmos.dispose();
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
