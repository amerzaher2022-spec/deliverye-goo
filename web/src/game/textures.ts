// Canvas-painted textures: road surfaces, building facades and storefront signs.
// Signs are painted with the page's Arabic web font, so business names render
// with correct Arabic shaping in the 3D world.

import * as THREE from 'three';
import { fitText, paintSign, roundRect, type SignOptions } from '../signPainter';
import { photo, photoTexture } from './pbr';

const loader = new Map<string, Promise<HTMLImageElement | null>>();

/** Loads an image (same-origin) once; resolves null on failure so a broken logo never breaks the world. */
export function loadImage(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  let p = loader.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
    loader.set(url, p);
  }
  return p;
}

export async function fontsReady() {
  try {
    await Promise.all([document.fonts.load('700 64px "IBM Plex Sans Arabic"'), document.fonts.load('600 32px "IBM Plex Sans Arabic"')]);
  } catch {
    /* fall back to system fonts */
  }
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function toTexture(c: HTMLCanvasElement, opts: { repeat?: boolean; anisotropy?: number } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = opts.anisotropy ?? 4;
  if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number, count: number, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(r() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha * r()})`;
    ctx.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
  }
}

/** Seeded random generator for repeatable textures. */
function rng(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Wandering crack line. */
function crack(ctx: CanvasRenderingContext2D, r: () => number, x: number, y: number, len: number, width: number, color: string) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = r() * Math.PI * 2;
  for (let i = 0; i < len; i += 6) {
    a += (r() - 0.5) * 0.9;
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
}

/**
 * Worn asphalt with lane markings; v runs along the road. One tile = road width × 1.2 width.
 * Layers: mottled base, aggregate grain, polished wheel tracks, tar-sealed cracks, patches, oil stains,
 * and paint that is chipped and faded where tyres run.
 */
export function roadTexture(kind: 'arterial' | 'primary' | 'secondary' | 'local', markings = true) {
  const W = 1024;
  const [c, ctx] = canvas(W, W);
  const r = rng(kind.length * 977 + 13);
  ctx.fillStyle = kind === 'local' ? '#5a5b5d' : '#535457';
  ctx.fillRect(0, 0, W, W);
  // a photographed asphalt surface (3 x 3 tiles) when available, else painted grain
  const base = photo(kind === 'local' ? 'asphalt_worn' : 'asphalt');
  if (base) for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) ctx.drawImage(base, (x * W) / 3, (y * W) / 3, W / 3 + 1, W / 3 + 1);
  // large soft mottling (wraps vertically so the tile repeats cleanly)
  for (let i = 0; i < (base ? 25 : 70); i++) {
    const x = r() * W;
    const y = r() * W;
    const rad = 40 + r() * 160;
    const light = r() < 0.5;
    for (const yy of [y - W, y, y + W]) {
      const g = ctx.createRadialGradient(x, yy, 0, x, yy, rad);
      g.addColorStop(0, light ? 'rgba(150,150,148,0.10)' : 'rgba(20,20,22,0.12)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, yy - rad, rad * 2, rad * 2);
    }
  }
  // aggregate grain
  if (!base) noise(ctx, W, W, 0.22, 60000, kind.length);
  for (let i = 0; i < (base ? 0 : 9000); i++) {
    ctx.fillStyle = `rgba(${r() < 0.5 ? '200,198,192' : '15,15,16'},${0.08 + r() * 0.12})`;
    ctx.fillRect(r() * W, r() * W, 1, 1);
  }
  const lanes = kind === 'arterial' ? 6 : kind === 'primary' ? 4 : 2;
  const laneW = W / lanes;
  // polished, darker wheel tracks
  for (let i = 0; i < lanes; i++) {
    for (const off of [0.28, 0.72]) {
      const x = laneW * (i + off);
      const g = ctx.createLinearGradient(x - 26, 0, x + 26, 0);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, 'rgba(25,25,28,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 26, 0, 52, W);
    }
    // oil stains in the middle of the lane
    for (let k = 0; k < 3; k++) {
      const x = laneW * (i + 0.5) + (r() - 0.5) * 20;
      const y = r() * W;
      const g = ctx.createRadialGradient(x, y, 0, x, y, 18 + r() * 22);
      g.addColorStop(0, 'rgba(10,10,12,0.22)');
      g.addColorStop(1, 'rgba(10,10,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 40, y - 40, 80, 80);
    }
  }
  // repair patches
  for (let i = 0; i < 4; i++) {
    const w = 60 + r() * 140;
    const h = 50 + r() * 180;
    const x = r() * (W - w);
    const y = r() * (W - h);
    ctx.fillStyle = r() < 0.5 ? 'rgba(40,40,43,0.35)' : 'rgba(120,120,118,0.18)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(18,18,20,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
  }
  // cracks and tar seal
  for (let i = 0; i < (base ? 5 : 14); i++) crack(ctx, r, r() * W, r() * W, 80 + r() * 260, 1 + r() * 1.5, 'rgba(15,15,17,0.55)');
  for (let i = 0; i < 6; i++) crack(ctx, r, r() * W, r() * W, 120 + r() * 300, 5 + r() * 4, 'rgba(22,22,24,0.45)');
  // longitudinal seam where two paving passes meet
  ctx.fillStyle = 'rgba(20,20,22,0.35)';
  ctx.fillRect(W / 2 - 2 + (kind === 'arterial' ? 0 : laneW * 0.02), 0, 3, W);

  // paint: chipped where wheels run over it
  const paint = (x: number, w: number, color: string, dash?: [number, number]) => {
    const seg = (y0: number, len: number) => {
      ctx.fillStyle = color;
      ctx.fillRect(x - w / 2, y0, w, len);
      for (let k = 0; k < len * w * 0.06; k++) {
        ctx.fillStyle = `rgba(80,80,82,${0.3 + r() * 0.5})`;
        ctx.fillRect(x - w / 2 + r() * w, y0 + r() * len, 1 + r() * 3, 1 + r() * 3);
      }
    };
    if (!dash) seg(0, W);
    else for (let y = 0; y < W; y += dash[0] + dash[1]) seg(y, dash[0]);
  };
  const white = 'rgba(236,234,226,0.9)';
  const yellow = 'rgba(222,178,52,0.9)';
  if (!markings) return toTexture(c, { repeat: true, anisotropy: 8 });
  paint(26, 10, white);
  paint(W - 26, 10, white);
  if (kind === 'arterial') {
    // centre is covered by the raised median; three lanes each way
    for (const x of [W * 0.155, W * 0.31, W * 0.69, W * 0.845]) paint(x, 9, white, [190, 320]);
    paint(W * 0.43, 9, yellow);
    paint(W * 0.57, 9, yellow);
  } else if (kind === 'primary') {
    paint(W / 2 - 11, 7, yellow);
    paint(W / 2 + 11, 7, yellow);
    for (const x of [W * 0.26, W * 0.74]) paint(x, 9, white, [190, 320]);
  } else {
    paint(W / 2, 9, white, [160, 350]);
  }
  // gutter darkening along both edges
  for (const x0 of [0, W - 22]) {
    const g = ctx.createLinearGradient(x0, 0, x0 + 22, 0);
    g.addColorStop(x0 === 0 ? 0 : 1, 'rgba(10,10,12,0.4)');
    g.addColorStop(x0 === 0 ? 1 : 0, 'rgba(10,10,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0, 0, 22, W);
  }
  return toTexture(c, { repeat: true, anisotropy: 8 });
}

/** Concrete jersey barrier: grey concrete with a yellow-and-black band near the top. u across the profile, v along. */
export function barrierTexture() {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#a9a6a0';
  ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, 0.18, 9000, 31);
  const r = rng(77);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(60,58,54,${0.05 + r() * 0.08})`;
    ctx.fillRect(r() * 256, r() * 256, 2 + r() * 20, 2 + r() * 6);
  }
  // band covers u 0.62..0.86 on both faces (profile is symmetric: 0..0.5 one side, 0.5..1 the other)
  for (const [u0, u1] of [[0.3, 0.42], [0.58, 0.7]] as const) {
    for (let v = -256; v < 512; v += 64) {
      ctx.fillStyle = '#e2b52a';
      ctx.beginPath();
      ctx.moveTo(u0 * 256, v);
      ctx.lineTo(u1 * 256, v + 40);
      ctx.lineTo(u1 * 256, v + 72);
      ctx.lineTo(u0 * 256, v + 32);
      ctx.fill();
      ctx.fillStyle = '#1d1d1f';
      ctx.beginPath();
      ctx.moveTo(u0 * 256, v + 32);
      ctx.lineTo(u1 * 256, v + 72);
      ctx.lineTo(u1 * 256, v + 104);
      ctx.lineTo(u0 * 256, v + 64);
      ctx.fill();
    }
  }
  // joint between barrier segments
  ctx.fillStyle = 'rgba(30,30,30,0.6)';
  ctx.fillRect(0, 0, 256, 4);
  return toTexture(c, { repeat: true, anisotropy: 4 });
}

export function groundTexture(color: string, seed: number) {
  // the open ground: photographed sandy soil when available
  const sand = color === '#c9b893' ? photoTexture('sand', 'col') : null;
  if (sand) return sand;
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 0.1, 1500, seed);
  return toTexture(c, { repeat: true, anisotropy: 1 });
}

export function sidewalkTexture() {
  const pavers = photoTexture('pavers', 'col');
  if (pavers) return pavers;
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = '#c9c3b6';
  ctx.fillRect(0, 0, 256, 256);
  const r = rng(5);
  // 30 × 30 cm pavers, each a slightly different tone, in a running bond
  for (let y = 0; y < 256; y += 32) {
    const off = (y / 32) % 2 ? 16 : 0;
    for (let x = -32; x < 256; x += 32) {
      const t = 188 + Math.floor(r() * 26);
      ctx.fillStyle = `rgb(${t},${t - 5},${t - 15})`;
      ctx.fillRect(x + off + 1, y + 1, 30, 30);
    }
  }
  noise(ctx, 256, 256, 0.12, 6000, 7);
  for (let i = 0; i < 18; i++) {
    const g = ctx.createRadialGradient(r() * 256, r() * 256, 0, r() * 256, r() * 256, 30);
    g.addColorStop(0, 'rgba(90,80,66,0.12)');
    g.addColorStop(1, 'rgba(90,80,66,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return toTexture(c, { repeat: true });
}

export type FacadeStyle = 'plaster' | 'glass' | 'industrial' | 'shopfront';

/**
 * Facade tiles. Each tile is one storey high; plaster = two window bays,
 * glass = one curtain-wall panel, shopfront = one ground-floor unit.
 * Painted near-white so per-building colour tints come through.
 */
export function facadeTexture(style: FacadeStyle) {
  if (style === 'glass') {
    const [c, ctx] = canvas(128, 128);
    const g = ctx.createLinearGradient(0, 0, 128, 128);
    g.addColorStop(0, '#34495a');
    g.addColorStop(0.55, '#6d8597');
    g.addColorStop(1, '#3c5163');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2a3036';
    ctx.fillRect(0, 100, 128, 28); // spandrel
    ctx.fillStyle = '#a7aeb3';
    ctx.fillRect(0, 0, 4, 128);
    ctx.fillRect(124, 0, 4, 128);
    ctx.fillRect(0, 98, 128, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(10, 6, 30, 90);
    return toTexture(c, { repeat: true });
  }
  if (style === 'industrial') {
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = '#e9e8e4';
    ctx.fillRect(0, 0, 128, 128);
    for (let x = 0; x < 128; x += 8) {
      ctx.fillStyle = 'rgba(0,0,0,0.07)';
      ctx.fillRect(x, 0, 3, 128);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x + 4, 0, 1, 128);
    }
    ctx.fillStyle = '#4b5966';
    ctx.fillRect(0, 14, 128, 16);
    ctx.fillStyle = '#9aa1a6';
    for (let x = 0; x < 128; x += 32) ctx.fillRect(x, 14, 2, 16);
    return toTexture(c, { repeat: true });
  }
  if (style === 'shopfront') {
    // one shop unit: sign band, rolled-up shutter box, aluminium-framed glass with a lit interior
    const [c, ctx] = canvas(256, 256);
    ctx.fillStyle = '#d9d3c7';
    ctx.fillRect(0, 0, 256, 256);
    noise(ctx, 256, 256, 0.05, 800, 9);
    ctx.fillStyle = '#26282b';
    ctx.fillRect(6, 14, 244, 52); // sign band
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(6, 14, 244, 8);
    ctx.fillStyle = '#9a9c9d';
    ctx.fillRect(12, 70, 232, 14); // shutter box
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 72; y < 84; y += 3) ctx.fillRect(12, y, 232, 1);
    const g = ctx.createLinearGradient(0, 86, 0, 256);
    g.addColorStop(0, '#6d6152');
    g.addColorStop(0.5, '#4a4239');
    g.addColorStop(1, '#2e2a26');
    ctx.fillStyle = g;
    ctx.fillRect(14, 86, 228, 170);
    // shelves and warm light inside
    ctx.fillStyle = 'rgba(255,214,150,0.22)';
    ctx.fillRect(20, 92, 100, 150);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (let y = 120; y < 240; y += 34) ctx.fillRect(130, y, 104, 4);
    // reflection streak
    const r = ctx.createLinearGradient(14, 86, 140, 256);
    r.addColorStop(0, 'rgba(200,220,235,0.25)');
    r.addColorStop(0.4, 'rgba(200,220,235,0)');
    ctx.fillStyle = r;
    ctx.fillRect(14, 86, 228, 170);
    ctx.fillStyle = '#c3c6c8';
    ctx.fillRect(14, 86, 228, 4);
    ctx.fillRect(124, 86, 6, 170);
    ctx.fillRect(14, 86, 5, 170);
    ctx.fillRect(237, 86, 5, 170);
    return toTexture(c, { repeat: true, anisotropy: 4 });
  }
  // stone-clad residential bays (as on Erbil's newer blocks): two windows per tile with aluminium
  // frames and sky reflections, a floor band, one bay with a balcony railing and an AC unit
  const [c, ctx] = canvas(512, 256);
  const rnd = rng(911);
  ctx.fillStyle = '#efe8da';
  ctx.fillRect(0, 0, 512, 256);
  const wall = photo('plaster');
  // limestone blocks, each a little different
  for (let y = 0; y < 236; y += 30) {
    const off = (y / 30) % 2 ? 0 : 40;
    for (let x = -off; x < 512; x += 80) {
      const l = 228 + Math.floor(rnd() * 16);
      ctx.fillStyle = `rgb(${l},${l - 7},${l - 20})`;
      ctx.fillRect(x + 1, y + 1, 78, 28);
    }
  }
  noise(ctx, 512, 256, 0.05, 2600, 5);
  if (wall) {
    // real stone grain over the block pattern
    ctx.globalAlpha = 0.55;
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(wall, 0, 0, 256, 256);
    ctx.drawImage(wall, 256, 0, 256, 256);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  ctx.fillStyle = 'rgba(120,105,85,0.35)';
  for (let y = 0; y < 236; y += 30) ctx.fillRect(0, y, 512, 1);
  // floor band
  ctx.fillStyle = '#d8ccb6';
  ctx.fillRect(0, 236, 512, 20);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillRect(0, 254, 512, 2);
  for (const [i, x] of [56, 296].entries()) {
    const w = 160;
    // reveal shadow, frame, glass with a sky reflection
    ctx.fillStyle = '#8e8676';
    ctx.fillRect(x - 6, 40, w + 12, 160);
    ctx.fillStyle = '#c9cbcc';
    ctx.fillRect(x - 3, 43, w + 6, 154);
    const g = ctx.createLinearGradient(x, 46, x + 40, 196);
    g.addColorStop(0, '#9fb7cc');
    g.addColorStop(0.35, '#5f7b92');
    g.addColorStop(0.36, '#3c4f5e');
    g.addColorStop(1, '#2c3843');
    ctx.fillStyle = g;
    ctx.fillRect(x + 3, 49, w - 6, 142);
    ctx.fillStyle = '#c9cbcc';
    ctx.fillRect(x + w / 2 - 3, 49, 6, 142);
    ctx.fillRect(x + 3, 118, w - 6, 5);
    // curtains in some panes
    if (rnd() < 0.7) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(236,226,206,0.55)' : 'rgba(190,170,140,0.5)';
      ctx.fillRect(x + 6, 52, 30 + rnd() * 30, 64);
    }
    // stone sill
    ctx.fillStyle = '#f6f1e6';
    ctx.fillRect(x - 10, 200, w + 20, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x - 10, 208, w + 20, 3);
    if (i === 1) {
      // balcony: slab shadow and a dark steel railing across the lower part of the window
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x - 18, 196, w + 36, 6);
      ctx.fillStyle = '#2d2f31';
      ctx.fillRect(x - 18, 140, w + 36, 5);
      for (let k = 0; k <= 18; k++) ctx.fillRect(x - 16 + k * ((w + 32) / 18), 140, 3, 58);
    } else {
      // AC condenser on a bracket under the sill
      ctx.fillStyle = '#dcdddb';
      ctx.fillRect(x + 30, 214, 70, 20);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let k = 0; k < 9; k++) ctx.fillRect(x + 34 + k * 7, 218, 3, 12);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x + 30, 234, 70, 2);
    }
  }
  return toTexture(c, { repeat: true, anisotropy: 4 });
}

/** Lightbox sign texture; the painting itself lives in signPainter.ts (shared with the dashboard preview). */
export function signTexture(opts: SignOptions) {
  const [c, ctx] = canvas(1024, 256);
  paintSign(ctx, 1024, 256, opts);
  return { texture: toTexture(c, { anisotropy: 8 }), aspect: 4 };
}

/** A round "map pin" badge with the merchant's logo, for sponsored highlight markers. */
export function pinTexture(logo: HTMLImageElement | null, color: string) {
  const [c, ctx] = canvas(256, 256);
  ctx.beginPath();
  ctx.arc(128, 128, 120, 0, Math.PI * 2);
  ctx.fillStyle = '#16181b';
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(128, 128, 92, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.clip();
  if (logo) ctx.drawImage(logo, 36, 36, 184, 184);
  ctx.restore();
  return toTexture(c);
}

export function stripeTexture(a: string, b: string) {
  const [c, ctx] = canvas(64, 64);
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = i % 2 ? b : a;
    ctx.fillRect(i * 16, 0, 16, 64);
  }
  return toTexture(c, { repeat: true });
}

export function hazardTexture() {
  const [c, ctx] = canvas(64, 64);
  ctx.fillStyle = '#f2c230';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#222';
  for (let i = -64; i < 64; i += 24) {
    ctx.beginPath();
    ctx.moveTo(i, 64);
    ctx.lineTo(i + 12, 64);
    ctx.lineTo(i + 76, 0);
    ctx.lineTo(i + 64, 0);
    ctx.fill();
  }
  return toTexture(c, { repeat: true });
}

export function shade(hex: string, amount: number) {
  const n = parseInt(hex.replace('#', ''), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount < 0 ? v * amount : (255 - v) * amount))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
