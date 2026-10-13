// Canvas-painted textures: road surfaces, building facades and storefront signs.
// Signs are painted with the page's Arabic web font, so business names render
// with correct Arabic shaping in the 3D world.

import * as THREE from 'three';

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
    await Promise.all([document.fonts.load('700 64px Cairo'), document.fonts.load('400 32px Cairo')]);
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

/** Asphalt with edge lines and lane dashes; v runs along the road (1 unit = `metresPerTile`). */
export function roadTexture(kind: 'arterial' | 'primary' | 'secondary' | 'local') {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = kind === 'local' ? '#4a4d52' : '#3d4045';
  ctx.fillRect(0, 0, 256, 256);
  noise(ctx, 256, 256, 0.25, 3500, kind.length);
  ctx.fillStyle = '#e8e6df';
  // edge lines
  ctx.fillRect(10, 0, 4, 256);
  ctx.fillRect(242, 0, 4, 256);
  const dash = (x: number, color = '#f1efe8', wdt = 4) => {
    ctx.fillStyle = color;
    ctx.fillRect(x - wdt / 2, 20, wdt, 110);
  };
  if (kind === 'arterial') {
    // median strip
    ctx.fillStyle = '#c9b98f';
    ctx.fillRect(118, 0, 20, 256);
    ctx.fillStyle = '#d9c400';
    ctx.fillRect(114, 0, 3, 256);
    ctx.fillRect(139, 0, 3, 256);
    for (const x of [46, 82, 174, 210]) dash(x);
  } else if (kind === 'primary') {
    ctx.fillStyle = '#d9c400';
    ctx.fillRect(124, 0, 3, 256);
    ctx.fillRect(130, 0, 3, 256);
    for (const x of [66, 190]) dash(x);
  } else {
    dash(128, '#f1efe8', 4);
  }
  return toTexture(c, { repeat: true, anisotropy: 4 });
}

export function groundTexture(color: string, seed: number) {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 128, 128);
  noise(ctx, 128, 128, 0.12, 1500, seed);
  return toTexture(c, { repeat: true, anisotropy: 1 });
}

export function sidewalkTexture() {
  const [c, ctx] = canvas(128, 128);
  ctx.fillStyle = '#b9b3a7';
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = 'rgba(80,70,60,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, 128);
    ctx.moveTo(0, i);
    ctx.lineTo(128, i);
    ctx.stroke();
  }
  noise(ctx, 128, 128, 0.15, 1200, 7);
  return toTexture(c, { repeat: true });
}

/** Facade with a window grid; repeat it per floor/bay on the material. */
export function facadeTexture(style: 'glass' | 'stone' | 'industrial') {
  const [c, ctx] = canvas(128, 128);
  if (style === 'industrial') {
    ctx.fillStyle = '#d7d2c8';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < 128; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 128);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,60,80,0.6)';
    ctx.fillRect(16, 20, 96, 14);
  } else {
    ctx.fillStyle = style === 'glass' ? '#e9edf0' : '#efe6d6';
    ctx.fillRect(0, 0, 128, 128);
    noise(ctx, 128, 128, 0.08, 500, style.length);
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const x = 14 + col * 64;
        const y = 16 + row * 64;
        const g = ctx.createLinearGradient(x, y, x + 36, y + 36);
        g.addColorStop(0, style === 'glass' ? '#3c6e93' : '#5b7590');
        g.addColorStop(1, style === 'glass' ? '#9cc3df' : '#a9bccc');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, 36, style === 'glass' ? 44 : 34);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x, y + (style === 'glass' ? 44 : 34), 36, 3);
      }
    }
  }
  return toTexture(c, { repeat: true });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight: number, family: string) {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 12);
  return size;
}

/**
 * Storefront sign: logo on the left, Arabic name large, English name below.
 * Returns the texture and its aspect ratio (width / height).
 */
export function signTexture(opts: {
  nameAr: string;
  nameEn: string;
  color: string;
  logo: HTMLImageElement | null;
  sponsored?: boolean;
}) {
  const W = 1024;
  const H = 256;
  const [c, ctx] = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, opts.color);
  g.addColorStop(1, shade(opts.color, -0.35));
  roundRect(ctx, 4, 4, W - 8, H - 8, 28);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = opts.sponsored ? '#ffd23f' : 'rgba(255,255,255,0.65)';
  ctx.stroke();

  const logoSize = H - 56;
  roundRect(ctx, 28, 28, logoSize, logoSize, 26);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  if (opts.logo) {
    ctx.save();
    roundRect(ctx, 34, 34, logoSize - 12, logoSize - 12, 22);
    ctx.clip();
    const s = Math.min((logoSize - 12) / opts.logo.width, (logoSize - 12) / opts.logo.height);
    const lw = opts.logo.width * s;
    const lh = opts.logo.height * s;
    ctx.drawImage(opts.logo, 34 + (logoSize - 12 - lw) / 2, 34 + (logoSize - 12 - lh) / 2, lw, lh);
    ctx.restore();
  }

  const textX = 28 + logoSize + 30;
  const textW = W - textX - 34;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 6;
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  fitText(ctx, opts.nameAr, textW, 104, 700, 'Cairo, "Noto Kufi Arabic", Tahoma, sans-serif');
  ctx.fillText(opts.nameAr, W - 34, 96);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  fitText(ctx, opts.nameEn.toUpperCase(), textW, 52, 700, 'Cairo, Arial, sans-serif');
  ctx.fillText(opts.nameEn.toUpperCase(), textX, 192);
  return { texture: toTexture(c, { anisotropy: 8 }), aspect: W / H };
}

/** Floating label sprite (merchant name / "!" markers). */
export function labelTexture(text: string, bg: string, fg = '#ffffff') {
  const [c, ctx] = canvas(512, 128);
  ctx.font = '700 60px Cairo, Tahoma, sans-serif';
  roundRect(ctx, 4, 14, 504, 100, 50);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, text, 460, 60, 700, 'Cairo, Tahoma, sans-serif');
  ctx.fillText(text, 256, 66);
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
