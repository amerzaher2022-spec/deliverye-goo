// Image post-processing, the way console games finish a frame:
// - medium: multisampled render, filmic tone mapping, then a colour grade (contrast, saturation, warm
//   shadows / cool highlights) and a soft vignette
// - high: also ground-truth ambient occlusion (contact shadows in corners and under cars) and a gentle
//   bloom on bright highlights (sun glints, lamps, signs)
// Low quality renders straight to the screen.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Quality } from './world';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    contrast: { value: 1.07 },
    saturation: { value: 1.12 },
    vignette: { value: 0.28 },
    aspect: { value: 1.0 },
    speed: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float contrast;
    uniform float saturation;
    uniform float vignette;
    uniform float aspect;
    uniform float speed;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // at speed, a radial blur that grows towards the edges (the centre stays sharp)
      if (speed > 0.01) {
        vec2 d = (vUv - 0.5);
        float k = speed * 0.035 * smoothstep(0.12, 0.6, length(d * vec2(aspect, 1.0)));
        vec4 acc = c;
        for (int i = 1; i <= 5; i++) acc += texture2D(tDiffuse, vUv - d * k * float(i) / 5.0);
        c = acc / 6.0;
      }
      vec3 col = c.rgb;
      // contrast around mid grey, then saturation
      col = (col - 0.5) * contrast + 0.5;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, saturation);
      // split toning: a touch of warmth in the shadows and mid tones, cooler highlights
      col += vec3(0.018, 0.008, -0.012) * (1.0 - l) - vec3(0.006, 0.0, -0.008) * l;
      // vignette
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      col *= 1.0 - vignette * smoothstep(0.35, 1.05, length(d));
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class PostProcess {
  private composer: EffectComposer | null = null;
  private grade: ShaderPass | null = null;
  private gtao: GTAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    quality: Quality,
  ) {
    this.setQuality(quality);
  }

  setQuality(q: Quality) {
    this.dispose();
    if (q === 'low') return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (q === 'high') {
      this.gtao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.gtao.blendIntensity = 0.85;
      this.gtao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.4, thickness: 1.5, scale: 1.0, samples: 12 });
      composer.addPass(this.gtao);
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.14, 0.5, 0.96);
      composer.addPass(this.bloom);
    }
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
    this.composer = composer;
  }

  setSize(w: number, h: number) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    if (this.grade) this.grade.uniforms.aspect!.value = w / Math.max(1, h);
  }

  /** 0..1: how much speed blur to add */
  setSpeed(s: number) {
    if (this.grade) this.grade.uniforms.speed!.value = s;
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.composer?.renderTarget1.dispose();
    this.composer?.renderTarget2.dispose();
    this.gtao?.dispose();
    this.bloom?.dispose();
    this.composer = null;
    this.grade = null;
    this.gtao = null;
    this.bloom = null;
  }
}
