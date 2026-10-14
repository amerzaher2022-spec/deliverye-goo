// Time of day and weather.
//
// - The sun follows Erbil's real sun path for today's date (latitude 36.19 N): it rises, crosses the
//   sky and sets; light colour, intensity, shadows, sky, haze and ambient light follow it. After dark a
//   dim moon light takes over, street lamps, shop fronts, windows and car lamps come on.
// - The sky is drawn by one shader: the photographed sky at midday (turned so its sun stands where the
//   real sun is), a computed sky for dawn, dusk and night (sunset glow, stars), and a layer of clouds
//   that drifts with the wind and thickens with the weather.
// - Weather: clear, cloudy, light rain, heavy rain, fog. Changes blend over a few seconds. Rain wets the
//   roads (darker, glossy, with puddles that mirror the sky and lamps), lowers grip and visibility, and
//   is heard; after the rain the roads dry over a couple of game hours.
// - Both run on their own (a game day of 24 minutes, weather changing every few game hours) or are set by
//   hand in the settings. Live weather for Erbil (Open-Meteo, no key) is an option that falls back to
//   the automatic weather when there is no connection; the game never waits for it.

import * as THREE from 'three';
import { facadeUniforms } from './facade';
import type { Quality } from './world';

export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm' | 'fog';
export const WEATHERS: Weather[] = ['clear', 'cloudy', 'rain', 'storm', 'fog'];

/** Uniforms shared by every road and pavement material (see wetSurface). */
export const surfaceUniforms = {
  uWet: { value: 0 },
  uPuddle: { value: 0 },
  uSkyCol: { value: new THREE.Color('#9fb1c4') },
};

interface WeatherLook {
  overcast: number;
  rain: number;
  fog: number;
}
const LOOK: Record<Weather, WeatherLook> = {
  clear: { overcast: 0, rain: 0, fog: 0 },
  cloudy: { overcast: 0.7, rain: 0, fog: 0.1 },
  rain: { overcast: 0.85, rain: 0.45, fog: 0.3 },
  storm: { overcast: 1, rain: 1, fog: 0.5 },
  fog: { overcast: 0.5, rain: 0, fog: 1 },
};

const LAT = (36.19 * Math.PI) / 180;

/** Direction to the sun in scene space (x east, y up, -z north) for a local solar hour and day of year. */
export function sunDirection(hour: number, dayOfYear: number, out = new THREE.Vector3()) {
  const decl = ((-23.44 * Math.PI) / 180) * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  const ha = ((hour - 12) * 15 * Math.PI) / 180;
  const sinEl = Math.sin(LAT) * Math.sin(decl) + Math.cos(LAT) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(sinEl);
  // azimuth from north, clockwise (east positive)
  const az = Math.atan2(-Math.sin(ha) * Math.cos(decl), Math.cos(LAT) * Math.sin(decl) - Math.sin(LAT) * Math.cos(decl) * Math.cos(ha));
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function dayOfYear(d = new Date()) {
  return Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ------------------------------------------------------------------ wet surfaces

const WET_HEAD = /* glsl */ `
  uniform float uWet;
  uniform float uPuddle;
  uniform vec3 uSkyCol;
  varying vec2 vWetPos;
  float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float wNoise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(wHash(i), wHash(i + vec2(1, 0)), f.x), mix(wHash(i + vec2(0, 1)), wHash(i + vec2(1, 1)), f.x), f.y);
  }
  float puddleMask() {
    float n = wNoise(vWetPos * 0.11) * 0.65 + wNoise(vWetPos * 0.43) * 0.35;
    return smoothstep(0.69, 0.74, n) * uPuddle;
  }`;

/**
 * Make a road or pavement material react to rain: darker, glossier (true reflections at high quality,
 * a sky-coloured sheen at medium), with puddles in the dips.
 */
export function wetSurface<T extends THREE.Material>(mat: T, quality: Quality): T {
  if (quality === 'low') {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = surfaceUniforms.uWet;
      shader.fragmentShader = shader.fragmentShader
        .replace('void main() {', 'uniform float uWet;\nvoid main() {')
        .replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb *= 1.0 - 0.35 * uWet;');
    };
    mat.customProgramCacheKey = () => 'wet-low';
    return mat;
  }
  const standard = (mat as unknown as THREE.MeshStandardMaterial).isMeshStandardMaterial === true;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uWet = surfaceUniforms.uWet;
    shader.uniforms.uPuddle = surfaceUniforms.uPuddle;
    shader.uniforms.uSkyCol = surfaceUniforms.uSkyCol;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vWetPos;\nvoid main() {')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vWetPos = (modelMatrix * vec4(transformed, 1.0)).xz;');
    let frag = shader.fragmentShader.replace('void main() {', WET_HEAD + '\nvoid main() {');
    frag = frag.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
       float wPud = puddleMask();
       diffuseColor.rgb *= 1.0 - (0.45 * uWet + 0.35 * wPud);`,
    );
    if (standard) {
      frag = frag.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = mix(roughnessFactor, 0.32, uWet);
         roughnessFactor = mix(roughnessFactor, 0.04, wPud);`,
      );
      // puddles are flat water: drop the asphalt relief there
      frag = frag.replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize(mix(normal, nonPerturbedNormal, wPud));');
    } else {
      // no reflections in Lambert shading: add the sky's colour at grazing angles
      frag = frag.replace(
        '#include <opaque_fragment>',
        `float wFres = pow(1.0 - clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0), 5.0);
         outgoingLight = mix(outgoingLight, uSkyCol, clamp((uWet * 0.25 + wPud * 0.55) * wFres, 0.0, 0.6));
         #include <opaque_fragment>`,
      );
    }
    shader.fragmentShader = frag;
  };
  mat.customProgramCacheKey = () => `wet-${standard ? 's' : 'l'}`;
  return mat;
}

// ------------------------------------------------------------------ sky

const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww;
  }`;

const SKY_FRAG = /* glsl */ `
  uniform sampler2D tPano;
  uniform float uHasPano;
  uniform float uPanoRot;
  uniform vec3 uSunDir;
  uniform float uDay;
  uniform float uDusk;
  uniform float uOvercast;
  uniform float uFog;
  uniform vec3 uFogCol;
  uniform float uTime;
  varying vec3 vDir;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
  float n2(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
    return s;
  }
  void main() {
    vec3 dir = normalize(vDir);
    float up = max(dir.y, 0.0);
    float sunUp = uSunDir.y;
    // computed sky: day blue, sunset glow towards the sun, deep blue night
    vec3 zen = mix(vec3(0.004, 0.008, 0.022), vec3(0.09, 0.26, 0.6), uDay);
    vec3 hor = mix(vec3(0.02, 0.03, 0.06), vec3(0.62, 0.72, 0.82), uDay);
    vec2 sh = normalize(uSunDir.xz + 1e-4);
    float toward = dot(normalize(dir.xz + 1e-4), sh) * 0.5 + 0.5;
    vec3 glow = mix(vec3(0.75, 0.32, 0.12), vec3(1.0, 0.6, 0.3), toward);
    hor = mix(hor, glow, uDusk * pow(toward, 2.0) * 0.9);
    zen = mix(zen, vec3(0.16, 0.14, 0.3), uDusk * 0.35);
    vec3 col = mix(hor, zen, pow(up, 0.45));
    // the photographed sky around midday, turned so its sun matches the real one
    if (uHasPano > 0.5) {
      float u = atan(dir.z, dir.x) * 0.15915494 + 0.5 + uPanoRot;
      float v = asin(clamp(dir.y, -1.0, 1.0)) * 0.31830989 + 0.5;
      vec3 pano = texture2D(tPano, vec2(u, max(v, 0.502))).rgb;
      col = mix(col, pano, smoothstep(0.25, 0.6, sunUp) * (1.0 - uOvercast * 0.85));
    }
    // sun disc and glow (behind clouds when overcast)
    float sd = dot(dir, uSunDir);
    float sunVis = smoothstep(-0.04, 0.02, sunUp) * (1.0 - uOvercast * 0.9);
    vec3 sunCol = mix(vec3(1.0, 0.45, 0.15), vec3(1.0, 0.93, 0.82), smoothstep(0.0, 0.35, sunUp));
    col += sunCol * (smoothstep(0.99955, 0.9998, sd) * 12.0 + pow(max(sd, 0.0), 220.0) * 1.2 + pow(max(sd, 0.0), 12.0) * 0.18) * sunVis;
    // stars
    vec2 sp = vec2(atan(dir.z, dir.x) * 180.0, dir.y * 260.0);
    float star = step(0.9965, h21(floor(sp))) * smoothstep(0.05, 0.3, up) * (0.5 + 0.5 * sin(uTime * 2.0 + h21(floor(sp) + 3.0) * 30.0));
    col += vec3(0.8, 0.85, 1.0) * star * (1.0 - uDay) * (1.0 - uOvercast) * 0.9;
    // drifting clouds on a plane above the city
    if (dir.y > 0.0) {
      vec2 cp = dir.xz / (dir.y + 0.12) * 1.6 + vec2(uTime * 0.012, uTime * 0.004);
      float cover = mix(0.62, 0.3, uOvercast);
      float d = fbm(cp);
      float c = smoothstep(cover, cover + 0.28, d) * smoothstep(0.0, 0.12, dir.y);
      float lit = clamp(dot(dir, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
      vec3 cloudDay = mix(vec3(0.78, 0.8, 0.84), vec3(1.0, 0.98, 0.95), lit) * mix(1.0, 0.55, uOvercast);
      vec3 cloudDusk = mix(vec3(0.35, 0.25, 0.3), vec3(1.0, 0.55, 0.3), lit);
      vec3 cloudNight = vec3(0.025, 0.03, 0.045);
      vec3 cc = mix(cloudNight, mix(cloudDay, cloudDusk, uDusk * 0.8), uDay);
      col = mix(col, cc, c * mix(0.75, 0.95, uOvercast));
    }
    // grey overcast and haze at the horizon
    vec3 grey = mix(vec3(0.03, 0.035, 0.045), mix(vec3(0.6, 0.63, 0.67), vec3(0.42, 0.45, 0.5), uOvercast * uOvercast), uDay);
    col = mix(col, grey, uOvercast * 0.55);
    col = mix(col, uFogCol, clamp(uFog * (1.0 - up * 1.2) + (1.0 - smoothstep(0.0, 0.18, up)) * 0.55, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// ------------------------------------------------------------------ rain

const RAIN_VERT = /* glsl */ `
  attribute vec4 aSeed;
  uniform vec3 uCam;
  uniform float uTime;
  uniform vec3 uBox;
  uniform vec2 uWind;
  uniform float uLen;
  varying float vA;
  void main() {
    float fall = 8.5 + aSeed.w * 3.0;
    vec3 base = aSeed.xyz * uBox;
    vec3 lo = uCam - uBox * 0.5;
    vec3 p;
    p.x = lo.x + mod(base.x + uWind.x * uTime - lo.x, uBox.x);
    p.z = lo.z + mod(base.z + uWind.y * uTime - lo.z, uBox.z);
    p.y = lo.y + mod(base.y - fall * uTime - lo.y, uBox.y);
    // the tail of the streak, along the fall direction
    float tail = float(gl_VertexID % 2);
    p -= vec3(uWind.x, -fall, uWind.y) * (uLen / fall) * tail;
    vA = 1.0 - tail * 0.7;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const RAIN_FRAG = /* glsl */ `
  uniform float uAlpha;
  uniform vec3 uColor;
  varying float vA;
  void main() { gl_FragColor = vec4(uColor, uAlpha * vA); }`;

// ------------------------------------------------------------------ the controller

export interface AtmosphereState {
  hour: number;
  autoTime: boolean;
  weather: Weather;
  autoWeather: boolean;
  live: boolean;
}

export class Atmosphere {
  readonly group = new THREE.Group();
  /** direction towards the sun (or the moon at night): the engine aims the shadow light along it */
  readonly lightDir = new THREE.Vector3(0, 1, 0);
  hour = 15.5;
  autoTime = true;
  /** game hours per real second: a day lasts 24 minutes */
  timeSpeed = 1 / 60;
  weather: Weather = 'clear';
  autoWeather = true;
  /** current blended weather look, wetness of the roads, and puddles */
  overcast = 0;
  rain = 0;
  fog = 0;
  wet = 0;
  puddle = 0;
  /** 1 by day, 0 at night */
  day = 1;
  /** 0 by day, 1 at night: lamps, windows, car lights */
  night = 0;
  liveStatus: 'off' | 'ok' | 'offline' = 'off';
  private live = false;
  private liveAt = -Infinity;
  private nextChange = 3;
  private time = 0;
  private doy = dayOfYear();
  private sunDir = new THREE.Vector3();
  private sky: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private rainMesh: THREE.LineSegments<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private rainMax: number;
  private panoSunAz = 0;
  private fogBase: { near: number; far: number };
  private onChange: (() => void) | null = null;

  constructor(
    private scene: THREE.Scene,
    private quality: Quality,
    private sun: THREE.DirectionalLight,
    private hemi: THREE.HemisphereLight,
    pano: { texture: THREE.Texture; sun: THREE.Vector3 } | null,
    fog: { near: number; far: number },
  ) {
    this.group.name = 'atmosphere';
    this.fogBase = fog;
    const uniforms = {
      tPano: { value: pano?.texture ?? null },
      uHasPano: { value: pano ? 1 : 0 },
      uPanoRot: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uDay: { value: 1 },
      uDusk: { value: 0 },
      uOvercast: { value: 0 },
      uFog: { value: 0 },
      uFogCol: { value: new THREE.Color() },
      uTime: { value: 0 },
    };
    if (pano) this.panoSunAz = Math.atan2(pano.sun.z, pano.sun.x);
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false }),
    );
    // drawn after every other opaque object, at the far plane: only the pixels nothing else covered are
    // shaded (the clouds are the most expensive shader per pixel)
    this.sky.renderOrder = 1000;
    this.sky.frustumCulled = false;
    this.sky.name = 'sky';
    this.group.add(this.sky);
    scene.background = null;

    // rain streaks: positions are computed on the GPU around the camera
    this.rainMax = quality === 'low' ? 2500 : quality === 'medium' ? 5000 : 9000;
    const seeds = new Float32Array(this.rainMax * 2 * 4);
    for (let i = 0; i < this.rainMax; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      seeds.set(s, i * 8);
      seeds.set(s, i * 8 + 4);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.rainMax * 2 * 3), 3));
    this.rainMesh = new THREE.LineSegments(
      rg,
      new THREE.ShaderMaterial({
        uniforms: {
          uCam: { value: new THREE.Vector3() },
          uTime: { value: 0 },
          uBox: { value: new THREE.Vector3(36, 18, 36) },
          uWind: { value: new THREE.Vector2(1.2, 0.6) },
          uLen: { value: 0.55 },
          uAlpha: { value: 0.3 },
          uColor: { value: new THREE.Color('#c8d2dc') },
        },
        vertexShader: RAIN_VERT,
        fragmentShader: RAIN_FRAG,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    this.group.add(this.rainMesh);
    scene.add(this.group);
    this.load();
    this.step(0, new THREE.Vector3());
  }

  /** The clear-weather haze distances for the current quality. */
  setFogBase(fog: { near: number; far: number }) {
    this.fogBase = fog;
  }

  /** Called whenever the time or weather settings change (to refresh the settings panel). */
  setListener(fn: (() => void) | null) {
    this.onChange = fn;
  }

  state(): AtmosphereState {
    return { hour: this.hour, autoTime: this.autoTime, weather: this.weather, autoWeather: this.autoWeather, live: this.live };
  }

  set(s: Partial<AtmosphereState>) {
    if (s.hour !== undefined) this.hour = ((s.hour % 24) + 24) % 24;
    if (s.autoTime !== undefined) this.autoTime = s.autoTime;
    if (s.weather !== undefined) this.weather = s.weather;
    if (s.autoWeather !== undefined) this.autoWeather = s.autoWeather;
    if (s.live !== undefined) {
      this.live = s.live;
      this.liveStatus = s.live ? this.liveStatus : 'off';
      this.liveAt = -Infinity;
    }
    this.save();
    this.onChange?.();
  }

  /** Jump the blended look straight to the chosen weather (no fade), e.g. for tests and screenshots. */
  settle() {
    const l = LOOK[this.weather];
    this.overcast = l.overcast;
    this.rain = l.rain;
    this.fog = l.fog;
    this.wet = l.rain > 0 ? 1 : 0;
    this.puddle = l.rain > 0 ? Math.min(1, l.rain * 1.4) : 0;
  }

  private save() {
    try {
      localStorage.setItem('dg.atmos', JSON.stringify({ autoTime: this.autoTime, hour: this.hour, weather: this.weather, autoWeather: this.autoWeather, live: this.live }));
    } catch {
      /* private mode */
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem('dg.atmos');
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<AtmosphereState>;
      if (typeof s.autoTime === 'boolean') this.autoTime = s.autoTime;
      if (typeof s.hour === 'number' && !this.autoTime) this.hour = s.hour;
      if (s.weather && WEATHERS.includes(s.weather)) this.weather = s.weather;
      if (typeof s.autoWeather === 'boolean') this.autoWeather = s.autoWeather;
      if (typeof s.live === 'boolean') this.live = s.live;
    } catch {
      /* ignore */
    }
  }

  private pickWeather() {
    // Erbil: mostly clear; rain and fog mostly in the cool season and fog mostly early in the morning
    const r = Math.random();
    const morning = this.hour > 4 && this.hour < 9;
    const next: Weather = morning && r < 0.25 ? 'fog' : r < 0.45 ? 'clear' : r < 0.7 ? 'cloudy' : r < 0.86 ? 'rain' : r < 0.94 ? 'storm' : 'clear';
    this.weather = next;
    this.nextChange = 2 + Math.random() * 4;
    this.onChange?.();
  }

  private async fetchLive() {
    this.liveAt = this.time;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=36.19&longitude=44.01&current=weather_code,cloud_cover,precipitation&timezone=auto', {
        signal: ctl.signal,
      });
      clearTimeout(timer);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as { current?: { weather_code?: number; cloud_cover?: number; precipitation?: number } };
      const code = j.current?.weather_code ?? 0;
      const cloud = j.current?.cloud_cover ?? 0;
      // WMO weather codes
      this.weather = code >= 95 || code === 65 || code === 82 ? 'storm' : code >= 51 ? 'rain' : code === 45 || code === 48 ? 'fog' : cloud > 60 || code >= 2 ? 'cloudy' : 'clear';
      this.liveStatus = 'ok';
    } catch {
      this.liveStatus = 'offline';
    }
    this.onChange?.();
  }

  /** Advance time and weather and update the scene. `cam` is the camera position. */
  step(dt: number, cam: THREE.Vector3) {
    this.time += dt;
    if (this.autoTime) this.hour = (this.hour + dt * this.timeSpeed) % 24;
    if (this.live) {
      if (this.time - this.liveAt > 600) void this.fetchLive();
      // without a connection the automatic weather keeps going
      if (this.liveStatus === 'offline' && this.autoWeather) this.autoStep(dt);
    } else if (this.autoWeather) this.autoStep(dt);

    // blend towards the chosen weather over ~10 s
    const look = LOOK[this.weather];
    const k = Math.min(1, dt * 0.12);
    this.overcast += (look.overcast - this.overcast) * k;
    this.rain += (look.rain - this.rain) * k;
    this.fog += (look.fog - this.fog) * k;
    // roads get wet in a minute of rain and dry over ~2 game hours (puddles last longer)
    if (this.rain > 0.05) {
      this.wet = Math.min(1, this.wet + dt * this.rain * 0.05);
      this.puddle = Math.min(this.rain * 1.4, Math.min(1, this.puddle + dt * this.rain * 0.02));
    } else {
      const dry = dt * this.timeSpeed * 0.5 + dt * 0.002;
      this.wet = Math.max(0, this.wet - dry);
      this.puddle = Math.max(0, this.puddle - dry * 0.6);
    }
    this.apply(cam);
  }

  private autoStep(dt: number) {
    this.nextChange -= dt * this.timeSpeed;
    if (this.nextChange <= 0) this.pickWeather();
  }

  private apply(cam: THREE.Vector3) {
    const sun = sunDirection(this.hour, this.doy, this.sunDir);
    const el = sun.y;
    this.day = smooth(-0.12, 0.12, el);
    this.night = 1 - smooth(-0.08, 0.06, el);
    const dusk = smooth(-0.15, 0.0, el) * (1 - smooth(0.05, 0.3, el));
    const oc = this.overcast;

    // the shadow-casting light: the sun by day, a pale moon at night
    if (el > -0.03) {
      this.lightDir.copy(sun);
      if (this.lightDir.y < 0.06) this.lightDir.y = 0.06;
      this.lightDir.normalize();
      const warm = smooth(0.0, 0.35, el);
      this.sun.color.setRGB(1.0, 0.62 + 0.3 * warm, 0.38 + 0.42 * warm);
      this.sun.intensity = 2.6 * smooth(-0.03, 0.15, el) * (1 - 0.82 * oc) * (1 - 0.5 * this.fog);
    } else {
      this.lightDir.set(-sun.x, Math.max(0.5, -sun.y), -sun.z).normalize();
      this.sun.color.set('#9fb4d8');
      this.sun.intensity = 0.22 * (1 - 0.8 * oc);
    }
    this.hemi.color.setRGB(0.83 * this.day + 0.1, 0.89 * this.day + 0.12, 0.95 * this.day + 0.2);
    this.hemi.groundColor.setRGB(0.6 * this.day + 0.04, 0.52 * this.day + 0.04, 0.38 * this.day + 0.05);
    this.hemi.intensity = 0.25 + 0.7 * this.day + 0.25 * oc * this.day;
    this.scene.environmentIntensity = 0.04 + 0.56 * this.day * (1 - 0.35 * oc);

    // haze colour: the sky at the horizon, greyer in bad weather
    const fogCol = new THREE.Color().setRGB(0.83, 0.84, 0.87).multiplyScalar(0.06 + 0.94 * this.day);
    fogCol.lerp(new THREE.Color('#e08a52').multiplyScalar(0.7), dusk * 0.35 * (1 - oc));
    fogCol.lerp(new THREE.Color().setRGB(0.5, 0.52, 0.56).multiplyScalar(0.05 + 0.95 * this.day), oc * 0.7);
    const f = this.scene.fog as THREE.Fog | null;
    if (f) {
      f.color.copy(fogCol);
      const thick = Math.max(this.fog, this.rain * 0.6);
      f.far = THREE.MathUtils.lerp(this.fogBase.far, 140, thick);
      f.near = THREE.MathUtils.lerp(this.fogBase.near, 4, thick);
    }

    const u = this.sky.material.uniforms;
    u.uSunDir!.value.copy(sun);
    u.uDay!.value = this.day;
    u.uDusk!.value = dusk;
    u.uOvercast!.value = oc;
    u.uFog!.value = this.fog * 0.85 + this.rain * 0.3;
    (u.uFogCol!.value as THREE.Color).copy(fogCol);
    u.uTime!.value = this.time;
    u.uPanoRot!.value = (this.panoSunAz - Math.atan2(sun.z, sun.x)) / (Math.PI * 2);
    this.sky.position.copy(cam);
    this.sky.scale.setScalar(10);

    // rain streaks
    const r = this.rain;
    this.rainMesh.visible = r > 0.02;
    if (this.rainMesh.visible) {
      const ru = this.rainMesh.material.uniforms;
      (ru.uCam!.value as THREE.Vector3).copy(cam);
      ru.uTime!.value = this.time;
      ru.uAlpha!.value = (0.16 + 0.22 * r) * (0.35 + 0.65 * this.day) + 0.08;
      ru.uLen!.value = 0.4 + 0.5 * r;
      (ru.uColor!.value as THREE.Color).setRGB(0.78, 0.82, 0.86).multiplyScalar(0.3 + 0.7 * this.day);
      this.rainMesh.geometry.setDrawRange(0, Math.floor(this.rainMax * Math.min(1, r * 1.1)) * 2);
    }

    // shared surface and facade uniforms
    surfaceUniforms.uWet.value = this.wet;
    surfaceUniforms.uPuddle.value = this.puddle;
    surfaceUniforms.uSkyCol.value.copy(fogCol).multiplyScalar(0.9);
    facadeUniforms.uNight.value = this.night;
    facadeUniforms.uWet.value = this.wet;
  }

  /** Lower grip on wet roads: 1 when dry, about 0.68 in a downpour with standing water. */
  gripFactor() {
    return 1 - 0.22 * this.wet - 0.1 * this.puddle;
  }

  dispose() {
    this.scene.remove(this.group);
    this.sky.geometry.dispose();
    this.sky.material.dispose();
    this.rainMesh.geometry.dispose();
    this.rainMesh.material.dispose();
  }
}
