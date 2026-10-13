// Canvas-painted textures: road surfaces, building facades and storefront signs.
// Signs are painted with the page's Arabic web font, so business names render
// with correct Arabic shaping in the 3D world.

import * as THREE from 'three';
import { fitText, paintSign, roundRect, type SignOptions } from '../signPainter';

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

/** Asphalt with lane markings; v runs along the road. One tile = road width × 1.2 width. */
export function roadTexture(kind: 'arterial' | 'primary' | 'secondary' | 'local') {
  const W = 512;
  const [c, ctx] = canvas(W, W);
  ctx.fillStyle = kind === 'local' ? '#46474a' : '#3b3c3f';
  ctx.fillRect(0, 0, W, W);
  noise(ctx, W, W, 0.18, 9000, kind.length);
  // faint tyre tracks
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  const lanes = kind === 'arterial' ? 6 : kind === 'primary' ? 4 : 2;
  for (let i = 0; i < lanes; i++) {
    const x = (W / lanes) * (i + 0.3);
    ctx.fillRect(x, 0, W / lanes / 8, W);
    ctx.fillRect(x + W / lanes / 2.6, 0, W / lanes / 8, W);
  }
  const paint = 'rgba(238,236,228,0.88)';
  const line = (x: number, w: number, color = paint, dash?: [number, number]) => {
    ctx.fillStyle = color;
    if (!dash) ctx.fillRect(x - w / 2, 0, w, W);
    else for (let y = 0; y < W; y += dash[0] + dash[1]) ctx.fillRect(x - w / 2, y, w, dash[0]);
  };
  line(14, 6);
  line(W - 14, 6);
  if (kind === 'arterial') {
    // centre is covered by the raised median; three lanes each way
    for (const x of [W * 0.155, W * 0.31, W * 0.69, W * 0.845]) line(x, 5, paint, [96, 160]);
    line(W * 0.43, 5);
    line(W * 0.57, 5);
  } else if (kind === 'primary') {
    line(W / 2 - 6, 4, 'rgba(226,182,60,0.9)');
    line(W / 2 + 6, 4, 'rgba(226,182,60,0.9)');
    for (const x of [W * 0.26, W * 0.74]) line(x, 5, paint, [96, 160]);
  } else {
    line(W / 2, 5, paint, [80, 176]);
  }
  return toTexture(c, { repeat: true, anisotropy: 4 });
}

export function groundTexture(color: string, seed: number) {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 0.1, 1500, seed);
  return toTexture(c, { repeat: true, anisotropy: 1 });
}

export function sidewalkTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#c4beb2';
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 0.1, 1500, 7);
  ctx.strokeStyle = 'rgba(70,62,52,0.28)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
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
    const [c, ctx] = canvas(128, 128);
    ctx.fillStyle = '#d8d4cc';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#2d2f31';
    ctx.fillRect(4, 8, 120, 26); // sign band
    const g = ctx.createLinearGradient(0, 40, 0, 128);
    g.addColorStop(0, '#3b4650');
    g.addColorStop(1, '#5e5246');
    ctx.fillStyle = g;
    ctx.fillRect(8, 40, 112, 88);
    ctx.fillStyle = '#b8bcbf';
    ctx.fillRect(8, 40, 112, 3);
    ctx.fillRect(62, 40, 4, 88);
    ctx.fillRect(8, 40, 3, 88);
    ctx.fillRect(117, 40, 3, 88);
    ctx.fillStyle = 'rgba(255,214,150,0.18)';
    ctx.fillRect(12, 46, 46, 78);
    return toTexture(c, { repeat: true });
  }
  // plaster: two windows per tile, slab band, occasional AC unit
  const [c, ctx] = canvas(256, 128);
  ctx.fillStyle = '#f3efe7';
  ctx.fillRect(0, 0, 256, 128);
  noise(ctx, 256, 128, 0.05, 900, 3);
  ctx.fillStyle = '#ddd5c6';
  ctx.fillRect(0, 118, 256, 10);
  for (const [i, x] of [34, 152].entries()) {
    ctx.fillStyle = '#3a3936';
    ctx.fillRect(x - 3, 24, 76, 74);
    const g = ctx.createLinearGradient(x, 26, x + 70, 96);
    g.addColorStop(0, '#2b3740');
    g.addColorStop(0.6, '#5a6a75');
    g.addColorStop(1, '#33404a');
    ctx.fillStyle = g;
    ctx.fillRect(x, 27, 70, 68);
    ctx.fillStyle = '#3a3936';
    ctx.fillRect(x + 33, 27, 4, 68);
    ctx.fillStyle = '#e7e1d5';
    ctx.fillRect(x - 6, 98, 82, 5); // sill
    if (i === 1) {
      ctx.fillStyle = '#d9dad7';
      ctx.fillRect(x + 10, 104, 34, 13); // AC unit
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      for (let k = 0; k < 6; k++) ctx.fillRect(x + 13 + k * 5, 107, 2, 7);
    }
  }
  return toTexture(c, { repeat: true });
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
