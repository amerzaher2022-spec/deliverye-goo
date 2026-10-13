// Renders the Erbil Delivery World livery decals (uniform badge, backpack print,
// car door livery) with real Arabic typography, using headless Chromium.
// Output: tools/models/decals/*.png (inputs for build_models.py).
//
//   node tools/models/render-decals.mjs

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..', '..');
const out = join(import.meta.dirname, 'decals');
const fontDir = join(root, 'node_modules', '@fontsource', 'ibm-plex-sans-arabic', 'files');
mkdirSync(out, { recursive: true });

const AMBER = '#e38b1d';
const CHAR = '#1d1f23';
const CREAM = '#f3efe8';
const box = (stroke, w = 3.4) =>
  `<svg viewBox="0 0 48 48" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"><path d="M8 16 24 8l16 8v16l-16 8-16-8z"/><path d="M8 16l16 8 16-8M24 24v16"/></svg>`;

const font = (w) => `@font-face{font-family:Plex;src:url(file://${fontDir}/ibm-plex-sans-arabic-arabic-${w}-normal.woff2) format('woff2');font-weight:${w}}`;
const page = (w, h, body) => `<!doctype html><html><head><style>${font(600)}${font(700)}
html,body{margin:0;background:transparent;width:${w}px;height:${h}px;overflow:hidden;font-family:Plex,sans-serif}
.c{width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center}</style></head><body>${body}</body></html>`;

const DECALS = {
  // round chest badge
  badge: [256, 256, `<div class="c"><div style="width:236px;height:236px;border-radius:50%;background:${AMBER};display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 10px ${CHAR}">
    <div style="width:132px;height:132px">${box(CHAR, 3.6)}</div></div></div>`],
  // backpack back panel
  back: [512, 512, `<div class="c" style="background:${CHAR};flex-direction:column;gap:14px">
    <div style="width:210px;height:210px;border-radius:50%;background:${AMBER};display:flex;align-items:center;justify-content:center"><div style="width:128px;height:128px">${box(CHAR, 3.6)}</div></div>
    <div dir="rtl" style="color:${CREAM};font-weight:700;font-size:64px;line-height:1">توصيل أربيل</div>
    <div style="color:${AMBER};font-weight:600;font-size:30px;letter-spacing:6px">ERBIL DELIVERY</div></div>`],
  // car door livery (transparent background)
  door: [1024, 256, `<div class="c" style="gap:28px">
    <div style="width:180px;height:180px;border-radius:50%;background:${AMBER};display:flex;align-items:center;justify-content:center"><div style="width:112px;height:112px">${box(CHAR, 3.6)}</div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><div dir="rtl" style="color:${CREAM};font-weight:700;font-size:86px;line-height:1">عالم توصيل أربيل</div>
    <div style="color:${AMBER};font-weight:600;font-size:40px;letter-spacing:9px">ERBIL DELIVERY WORLD</div></div></div>`],
  // car door livery on a light body (charcoal text)
  door_light: [1024, 256, `<div class="c" style="gap:28px">
    <div style="width:180px;height:180px;border-radius:50%;background:${AMBER};display:flex;align-items:center;justify-content:center"><div style="width:112px;height:112px">${box(CHAR, 3.6)}</div></div>
    <div style="display:flex;flex-direction:column;gap:6px"><div dir="rtl" style="color:${CHAR};font-weight:700;font-size:86px;line-height:1">عالم توصيل أربيل</div>
    <div style="color:#b8650c;font-weight:600;font-size:40px;letter-spacing:9px">ERBIL DELIVERY WORLD</div></div></div>`],
  // pizza box lid print
  pizza: [256, 256, `<div class="c" style="background:#b8875a"><div style="width:200px;height:200px;border-radius:50%;border:12px solid #a3261f;display:flex;align-items:center;justify-content:center;flex-direction:column">
    <div style="color:#a3261f;font-weight:700;font-size:44px;line-height:1">PIZZA</div><div dir="rtl" style="color:#a3261f;font-weight:700;font-size:40px;line-height:1.2">بيتزا</div></div></div>`],
  // helmet side stripe badge
  helmet: [256, 256, `<div class="c"><div style="width:220px;height:220px;border-radius:50%;background:${CHAR};display:flex;align-items:center;justify-content:center"><div style="width:130px;height:130px">${box(AMBER, 3.6)}</div></div></div>`],
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [name, [w, h, body]] of Object.entries(DECALS)) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(page(w, h, body), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: join(out, `${name}.png`), omitBackground: true });
  await p.close();
  console.log('decal', name);
}
await browser.close();
