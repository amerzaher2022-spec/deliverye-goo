// Building facades drawn by a shader, in metres, so windows line up storey by storey on every wall of
// every footprint with no stretched or tiled pictures. Each wall vertex carries its building's style,
// a random seed, the storey height and whether the ground floor is a shop front. The wall surface is a
// photographed material (stone, plaster) tinted per building; windows have frames, reflective glass and,
// at night, some rooms lit.
//
// Styles (aStyle.x):
//   0 stone apartment block: limestone cladding, tall windows, recessed balconies with railings
//   1 commercial block: cladding panels, continuous window bands, sign band over the shops
//   2 house: painted plaster, small windows with steel grilles
//   3 tower: glass curtain wall with mullions and floor slabs
//   4 old town: brick and yellow stone, narrow arched windows, wooden doors
//   5 concrete public building: exposed concrete, regular windows
//   6 deep concrete grid: square openings in a structural frame (Empire World's curved towers)

import * as THREE from 'three';
import { photoTexture } from './pbr';

export const FACADE_STYLES = { stone: 0, commercial: 1, house: 2, tower: 3, old: 4, concrete: 5, grid: 6 } as const;
export type FacadeStyle = keyof typeof FACADE_STYLES;

/** Uniforms shared by every facade material: how dark it is (0 day .. 1 night) and how wet. */
export const facadeUniforms = {
  uNight: { value: 0 },
  uWet: { value: 0 },
};

const GLSL_HEAD = /* glsl */ `
  attribute vec4 aStyle;
  attribute vec3 aTint;
  attribute float aRoof;
  varying vec4 vStyle;
  varying vec3 vTint;
  varying vec2 vWall;
  varying float vRoof;
  #ifdef FACADE_DEPTH
  // view direction in the wall's frame: x along the wall, y up, z into the wall
  varying vec3 vViewT;
  #endif
`;

const GLSL_FRAG_HEAD = /* glsl */ `
  uniform float uNight;
  uniform float uWet;
  varying vec4 vStyle;
  varying vec3 vTint;
  varying vec2 vWall;
  varying float vRoof;
  // the per-building seed arrives interpolated, with tiny per-pixel rounding errors that the hash below
  // would blow up into noise: snap it back to its exact value
  float fSeed() { return floor(vStyle.y * 997.0 + 0.5) / 997.0; }
  float fHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  // filled box with edges softened over one pixel (gFw: wall metres per pixel), so window grids do not
  // shimmer into noise in the distance; fine detail (bars, rails) fades out once it is under a pixel
  vec2 gFw = vec2(0.01);
  float box2(vec2 p, vec2 lo, vec2 hi) {
    vec2 a = clamp((p - lo) / gFw + 0.5, 0.0, 1.0) * clamp((hi - p) / gFw + 0.5, 0.0, 1.0);
    return a.x * a.y;
  }
  #ifdef FACADE_DEPTH
  varying vec3 vViewT;
  #endif

// the facade pattern at wall point W (metres): fac.x glass, fac.y frame, fac.z relief shade, fac.w lit
void facadeAt(vec2 W, float fDetail, out vec4 fac, out float fGround, out float fSign, out float fDoor) {
  fac = vec4(0.0);
  fGround = 0.0;
  fSign = 0.0;
  fDoor = 0.0;
  {
    float style = vStyle.x;
    float seed = fSeed();
    float floorH = vStyle.z;
    float shop = vStyle.w;
    float u = W.x;
    float v = W.y;
    float groundH = shop > 0.5 ? 4.4 : floorH;
    if (style > 5.5) {
      // deep concrete grid (Empire World's curved towers): square openings in a structural frame
      // nearly square cells, about a storey wide, with slender piers and deeper floor slabs
      float cw = floorH * 0.92;
      vec2 q = vec2(fract(u / cw) * cw, v - floor(v / floorH) * floorH);
      fac.x = v > vRoof - 0.4 ? 0.0 : box2(q, vec2(0.28, 0.42), vec2(cw - 0.28, floorH - 0.12));
      fac.z = box2(q, vec2(0.0, floorH - 0.16), vec2(cw, floorH)) * 0.12;
    } else if (v > vRoof - 0.05) {
      // parapet: plain wall with a coping line
      fac.z = box2(vec2(0.0, v), vec2(-1.0, vRoof - 0.05), vec2(1.0, vRoof + 0.08)) * 0.3;
    } else if (v < groundH) {
      if (shop > 0.5) {
        // shop units 5 m wide: sign band, glass with aluminium frames, piers between units
        float unit = floor(u / 5.0);
        vec2 q = vec2(fract(u / 5.0) * 5.0, v);
        fGround = 1.0;
        fSign = box2(q, vec2(0.3, 3.35), vec2(4.7, 4.25));
        float glass = box2(q, vec2(0.45, 0.25), vec2(4.55, 3.1));
        float mull = box2(q, vec2(2.45, 0.25), vec2(2.55, 3.1)) + box2(q, vec2(0.45, 2.55), vec2(4.55, 2.62));
        fac.x = glass * (1.0 - min(mull, 1.0));
        fac.y = glass * min(mull, 1.0) + box2(q, vec2(0.38, 0.2), vec2(4.62, 0.25)) + box2(q, vec2(0.38, 3.1), vec2(4.62, 3.17));
        // some shops have their shutter half down
        if (fHash(vec2(unit, seed)) > 0.72) { float sh = step(1.6 + fHash(vec2(unit + 3.0, seed)) * 1.4, v) * glass; fac.x *= 1.0 - sh; fac.y = max(fac.y, sh * 0.6); }
        fac.w = glass * step(0.35, fHash(vec2(unit, seed + 7.0)));
      } else {
        // entrance door every 14 m, small windows elsewhere
        float bay = 3.5;
        vec2 q = vec2(fract(u / bay) * bay, v);
        float door = step(0.82, fHash(vec2(floor(u / bay), seed + 1.0)));
        fDoor = door * box2(q, vec2(0.9, 0.0), vec2(2.4, 2.4));
        fac.x = (1.0 - door) * box2(q, vec2(1.0, 1.0), vec2(2.5, 2.4));
        fac.y = (1.0 - door) * (box2(q, vec2(0.9, 0.9), vec2(2.6, 1.0)) + box2(q, vec2(0.9, 2.4), vec2(2.6, 2.5)));
        fac.w = fac.x * step(0.6, fHash(vec2(floor(u / bay), seed + 9.0)));
      }
    } else {
      float vv = v - groundH;
      float fl = floor(vv / floorH);
      float fv = vv - fl * floorH;
      if (style < 0.5) {
        // stone apartments: 3.6 m bays, window 1.5 x 1.7, every other bay a recessed balcony with railing
        float bay = 3.6;
        float b = floor(u / bay);
        vec2 q = vec2(u - b * bay, fv);
        float balcony = step(0.5, fHash(vec2(b, seed + 2.0))) * step(0.5, mod(b + floor(seed * 7.0), 2.0));
        if (balcony > 0.5) {
          float rec = box2(q, vec2(0.25, 0.05), vec2(3.35, floorH - 0.35));
          fac.z = rec * 0.55;
          fac.x = box2(q, vec2(0.6, 0.15), vec2(3.0, floorH - 0.6));
          float rail = box2(q, vec2(0.25, 0.95), vec2(3.35, 1.05)) + step(0.85, fract(q.x / 0.12)) * box2(q, vec2(0.25, 0.05), vec2(3.35, 1.0)) * fDetail;
          fac.y = min(rail, 1.0);
          fac.x *= 1.0 - fac.y;
        } else {
          fac.x = box2(q, vec2(1.05, 0.85), vec2(2.55, 2.55));
          fac.y = box2(q, vec2(0.95, 0.75), vec2(2.65, 2.65)) * (1.0 - fac.x) + box2(q, vec2(1.77, 0.85), vec2(1.83, 2.55));
          fac.z = box2(q, vec2(0.85, 0.6), vec2(2.75, 0.75)) * -0.4; // stone sill (lighter)
        }
        fac.w = fac.x * step(0.55, fHash(vec2(b, fl + seed * 13.0)));
      } else if (style < 1.5) {
        // commercial: continuous window band, solid spandrel panels with joints
        float panel = 1.6;
        vec2 q = vec2(fract(u / panel) * panel, fv);
        float band = box2(q, vec2(0.0, 0.9), vec2(panel, floorH - 0.5));
        fac.x = band * (1.0 - box2(q, vec2(0.0, 0.9), vec2(0.06, floorH - 0.5)));
        fac.y = band - fac.x;
        fac.z = box2(q, vec2(0.0, floorH - 0.52), vec2(panel, floorH - 0.48)) * 0.4;
        fac.w = fac.x * step(0.5, fHash(vec2(floor(u / 6.0), fl + seed * 17.0)));
      } else if (style < 2.5) {
        // house: small windows with steel grilles
        float bay = 4.2;
        float b = floor(u / bay);
        vec2 q = vec2(u - b * bay, fv);
        float has = step(0.25, fHash(vec2(b, seed + fl)));
        fac.x = has * box2(q, vec2(1.4, 1.0), vec2(2.8, 2.3));
        float grille = (step(0.82, fract(q.x / 0.18)) + step(0.85, fract(q.y / 0.3))) * fDetail;
        fac.y = fac.x * min(grille, 1.0);
        fac.x *= 1.0 - fac.y;
        fac.y += has * (box2(q, vec2(1.3, 0.9), vec2(2.9, 1.0)) + box2(q, vec2(1.3, 2.3), vec2(2.9, 2.42)));
        fac.w = fac.x * step(0.5, fHash(vec2(b, fl + seed * 5.0)));
      } else if (style < 3.5) {
        // glass tower: curtain wall
        float panel = 1.5;
        vec2 q = vec2(fract(u / panel) * panel, fv);
        float mull = box2(q, vec2(0.0, 0.0), vec2(0.07, floorH)) + box2(q, vec2(0.0, floorH - 0.75), vec2(panel, floorH));
        fac.x = 1.0 - min(mull, 1.0);
        fac.y = min(mull, 1.0);
        fac.w = fac.x * step(0.62, fHash(vec2(floor(u / 4.5), fl + seed * 11.0)));
      } else if (style < 4.5) {
        // old town: narrow arched windows in thick walls
        float bay = 3.0;
        float b = floor(u / bay);
        vec2 q = vec2(u - b * bay, fv);
        float has = step(0.35, fHash(vec2(b, seed)));
        vec2 c = vec2(1.5, 2.0);
        float arch = step(length((q - c) * vec2(1.0, 1.2)), 0.42) * step(c.y, q.y);
        fac.x = has * min(box2(q, vec2(1.08, 0.9), vec2(1.92, 2.0)) + arch, 1.0);
        fac.z = has * box2(q, vec2(0.98, 0.8), vec2(2.02, 2.55)) * 0.35 * (1.0 - fac.x);
        fac.w = fac.x * step(0.6, fHash(vec2(b, fl + seed)));
      } else {
        // concrete public building: regular punched windows
        float bay = 3.0;
        vec2 q = vec2(fract(u / bay) * bay, fv);
        fac.x = box2(q, vec2(0.6, 0.9), vec2(2.4, 2.5));
        fac.y = box2(q, vec2(0.5, 0.8), vec2(2.5, 2.6)) * (1.0 - fac.x);
        fac.w = fac.x * step(0.6, fHash(vec2(floor(u / bay), fl + seed)));
      }
      // floor slab line on every storey
      fac.z += box2(vec2(0.0, fv), vec2(-1.0, 0.0), vec2(1.0, 0.12)) * 0.25 * step(style, 2.5);
    }
  }
}
`;

// Computes, from the wall position in metres, the facade layer at this pixel:
//   fac.x = glass (0..1), fac.y = frame/metal, fac.z = recess shadow, fac.w = lit window at night
//   fGround: 1 on a shop front, fSign: sign band
const GLSL_FACADE = /* glsl */ `
  gFw = max(fwidth(vWall), vec2(0.004));
  float fDetail = 1.0 - smoothstep(0.025, 0.08, max(gFw.x, gFw.y));
  vec4 fac;
  float fGround;
  float fSign;
  float fDoor;
  facadeAt(vWall, fDetail, fac, fGround, fSign, fDoor);
  float fReveal = 0.0;
  float fRevealShade = 0.6;
  #ifdef FACADE_DEPTH
  {
    // windows are set into the wall: follow the line of sight to the glass, a little behind the wall
    // face. Where it lands outside the opening, the eye sees the opening's side wall (the reveal)
    // instead of glass. Deep for the concrete grid towers, shallow for shop fronts.
    float hole = clamp(fac.x, 0.0, 1.0);
    // only near: once a pixel covers more than ~4 cm of wall the depth is not visible, so skip the
    // second evaluation
    if (hole > 0.01 && max(gFw.x, gFw.y) < 0.04) {
      vec3 vt = vViewT;
      float vz = max(vt.z, 0.06 * length(vt));
      float depth = vStyle.x > 5.5 ? 1.2 : fGround > 0.5 ? 0.14 : vStyle.x > 2.5 && vStyle.x < 3.5 ? 0.06 : 0.26;
      vec2 dir = vt.xy / vz;
      vec4 fb;
      float g2;
      float s2;
      float d2;
      facadeAt(vWall + dir * depth, fDetail, fb, g2, s2, d2);
      float seen = clamp(fb.x, 0.0, 1.0);
      fReveal = hole * (1.0 - seen);
      // looking up shows the head of the opening (in shade), looking down the sill (lit), else the jambs
      fRevealShade = abs(dir.y) > abs(dir.x) ? (dir.y > 0.0 ? 0.4 : 0.85) : 0.62;
      fac.x = hole * seen;
      fac.w *= seen;
    }
  }
  #endif
`;

const GLSL_APPLY_COLOR = /* glsl */ `
  {
    float style = vStyle.x;
    vec3 wall = diffuseColor.rgb * vTint;
    // bare concrete: keep the photo's grain but not its warm colour
    if (style > 5.5) wall = vec3(dot(wall, vec3(0.3, 0.55, 0.15))) * vec3(1.0, 0.99, 0.96) * 1.08;
    vec3 glassCol = style > 5.5 ? wall * 0.16 : style > 2.5 && style < 3.5 ? vec3(0.16, 0.24, 0.3) : vec3(0.07, 0.085, 0.1);
    vec3 frameCol = style < 0.5 ? vec3(0.78, 0.78, 0.76) : style < 1.5 ? vec3(0.55, 0.57, 0.6) : style < 2.5 ? vec3(0.16, 0.17, 0.18) : vec3(0.32, 0.34, 0.36);
    vec3 c = wall * (1.0 - clamp(fac.z, -0.4, 0.8));
    c = mix(c, frameCol, clamp(fac.y, 0.0, 1.0));
    c = mix(c, glassCol, fac.x);
    c = mix(c, wall * fRevealShade, fReveal);
    if (fGround > 0.5) {
      // shop sign bands in strong colours, a different one per unit
      float unit = floor(vWall.x / 5.0);
      float h = fHash(vec2(unit, fSeed() + 21.0));
      vec3 signCol = h < 0.25 ? vec3(0.62, 0.08, 0.06) : h < 0.45 ? vec3(0.05, 0.25, 0.45) : h < 0.6 ? vec3(0.9, 0.86, 0.78) : h < 0.75 ? vec3(0.08, 0.32, 0.16) : h < 0.88 ? vec3(0.85, 0.5, 0.08) : vec3(0.08, 0.08, 0.09);
      c = mix(c, signCol, fSign);
    }
    c = mix(c, vec3(0.32, 0.22, 0.14), fDoor);
    // contact shade where the wall meets the pavement, and grime splashed at its foot
    c *= mix(0.62, 1.0, smoothstep(-0.2, 1.4, vWall.y));
    diffuseColor.rgb = c;
  }
`;

/**
 * A facade material. `surface` is the photographed wall material; the shader adds windows and the rest.
 * Wall uv must be in metres (u along the footprint, v up from the ground).
 */
export function facadeMaterial(quality: 'low' | 'medium' | 'high', surface: 'plaster' | 'plaster_smooth'): THREE.Material {
  const map = photoTexture(surface, 'col');
  if (map) map.repeat.set(1 / 3, 1 / 3);
  const normalMap = quality === 'high' ? photoTexture(surface, 'nrm') : null;
  if (normalMap) normalMap.repeat.set(1 / 3, 1 / 3);
  const mat =
    quality === 'low'
      ? new THREE.MeshLambertMaterial({ ...(map ? { map } : {}), color: '#ffffff' })
      : new THREE.MeshStandardMaterial({ ...(map ? { map } : {}), ...(normalMap ? { normalMap } : {}), roughness: 0.9, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = facadeUniforms.uNight;
    shader.uniforms.uWet = facadeUniforms.uWet;
    shader.vertexShader = GLSL_HEAD + shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      vStyle = aStyle;
      vTint = aTint;
      vWall = uv;
      vRoof = aRoof;`,
    ).replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef FACADE_DEPTH
      vec3 fV = (modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition;
      vec3 fN = normalize(mat3(modelMatrix) * objectNormal);
      vViewT = vec3(dot(fV, vec3(fN.z, 0.0, -fN.x)), fV.y, -dot(fV, fN));
      #endif`,
    );
    let frag = GLSL_FRAG_HEAD + shader.fragmentShader;
    frag = frag.replace('#include <map_fragment>', '#include <map_fragment>\n' + GLSL_FACADE + GLSL_APPLY_COLOR);
    // glass and frames are smooth and reflective; walls rough
    frag = frag.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
      roughnessFactor = mix(mix(roughnessFactor, 0.45, clamp(fac.y, 0.0, 1.0)), vStyle.x > 5.5 ? 0.95 : 0.2, fac.x);
      roughnessFactor = mix(roughnessFactor, 0.35, uWet * (1.0 - fac.x));`,
    );
    frag = frag.replace(
      '#include <metalnessmap_fragment>',
      `#include <metalnessmap_fragment>
      metalnessFactor = mix(metalnessFactor, 0.7, fac.x * (vStyle.x > 5.5 ? 0.0 : vStyle.x > 2.5 && vStyle.x < 3.5 ? 1.0 : 0.5) * (1.0 - fac.w * uNight));`,
    );
    // lit rooms and shop windows at night
    frag = frag.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      vec3 roomLight = mix(vec3(1.0, 0.78, 0.5), vec3(0.85, 0.92, 1.0), fHash(vec2(floor(vWall.x / 3.0), floor(vWall.y / 3.0) + fSeed())));
      // rooms glow at different strengths (curtains, lamps); shop fronts brighter than flats
      float roomLevel = 0.45 + 0.55 * fHash(vec2(floor(vWall.x / 3.0) + 7.0, floor(vWall.y / 3.0) + fSeed() * 3.0));
      totalEmissiveRadiance += roomLight * fac.w * uNight * roomLevel * (fGround > 0.5 ? 0.75 : 0.32);
      totalEmissiveRadiance += vec3(1.0, 0.95, 0.85) * fSign * uNight * 0.3;`,
    );
    shader.fragmentShader = frag;
  };
  if (quality !== 'low') mat.defines = { ...(mat.defines ?? {}), FACADE_DEPTH: '' };
  mat.customProgramCacheKey = () => `facade-${quality}-${surface}`;
  return mat;
}
