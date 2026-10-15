// Spray thrown up by the tyres on a wet road: a small pool of droplets launched up and back from
// the contact patches, falling under gravity and fading out. Scaled by how wet the road is and how
// fast the vehicle goes; nothing is drawn on a dry road.

import * as THREE from 'three';

const MAX = 260;

export class Spray {
  readonly points: THREE.Points;
  private pos = new Float32Array(MAX * 3);
  private vel = new Float32Array(MAX * 3);
  private life = new Float32Array(MAX);
  private alpha = new Float32Array(MAX);
  private next = 0;
  private carry = 0;

  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const m = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: new THREE.Color('#c9d0d4') }, uSize: { value: 70 } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vA;
        uniform float uSize;
        void main() {
          vA = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = uSize / max(1.0, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        uniform vec3 uColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          gl_FragColor = vec4(uColor, vA * (1.0 - r * 4.0));
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.name = 'spray';
    this.points.renderOrder = 5;
  }

  /**
   * `wheels`: contact points in scene space; `back` the direction behind the vehicle (scene x, z);
   * `speed` m/s; `wet` 0..1; `light` 0..1 scales the colour for night.
   */
  update(dt: number, wheels: THREE.Vector3[], back: { x: number; z: number }, speed: number, wet: number, light: number) {
    const rate = wet > 0.15 && speed > 3 ? Math.min(1, (wet - 0.15) * 1.6) * Math.min(1, speed / 14) * 320 : 0;
    this.carry += rate * dt;
    while (this.carry >= 1 && wheels.length) {
      this.carry -= 1;
      const w = wheels[this.next % wheels.length]!;
      const i = this.next++ % MAX;
      const j = i * 3;
      const side = (Math.random() - 0.5) * 3.2;
      this.pos[j] = w.x + (Math.random() - 0.5) * 0.1;
      this.pos[j + 1] = w.y + 0.05;
      this.pos[j + 2] = w.z + (Math.random() - 0.5) * 0.1;
      const k = speed * (0.12 + Math.random() * 0.12);
      this.vel[j] = back.x * k - back.z * side;
      this.vel[j + 1] = 1.2 + Math.random() * 1.8 + speed * 0.06;
      this.vel[j + 2] = back.z * k + back.x * side;
      this.life[i] = 0.35 + Math.random() * 0.35;
    }
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      any = true;
      const j = i * 3;
      this.life[i]! -= dt;
      this.vel[j + 1]! -= 9.8 * dt;
      this.pos[j]! += this.vel[j]! * dt;
      this.pos[j + 1]! += this.vel[j + 1]! * dt;
      this.pos[j + 2]! += this.vel[j + 2]! * dt;
      this.alpha[i] = Math.max(0, Math.min(0.28, this.life[i]! * 0.7));
    }
    this.points.visible = any;
    if (any) {
      this.points.geometry.attributes.position!.needsUpdate = true;
      this.points.geometry.attributes.alpha!.needsUpdate = true;
      ((this.points.material as THREE.ShaderMaterial).uniforms.uColor!.value as THREE.Color).setRGB(0.8, 0.84, 0.86).multiplyScalar(0.35 + 0.65 * light);
    }
  }
}
