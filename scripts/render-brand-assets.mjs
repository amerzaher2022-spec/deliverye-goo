// Renders the fictional demo brands (logo 512×512 and cover 1200×500 PNG) with
// real Arabic typography, using headless Chromium. Output: db/seed-assets/.
//
//   node scripts/render-brand-assets.mjs
//
// Needs @playwright/test and a Chromium (set CHROMIUM_PATH if it is not the
// Playwright default). The PNGs are committed, so the app never needs this at runtime.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'db', 'seed-assets');
const fontDir = join(root, 'node_modules', '@fontsource', 'ibm-plex-sans-arabic', 'files');
mkdirSync(out, { recursive: true });

// glyphs on a 48-unit grid, drawn with strokes in the accent colour
const G = {
  flame: '<path d="M24 6c2 7 10 10 10 20a10 10 0 0 1-20 0c0-5 3-8 5-10 0 4 2 6 4 6-1-6 1-12 1-16z"/><path d="M12 42h24"/>',
  citadel: '<path d="M6 40V22h6v-6h6v6h4v-8h4v8h4v-6h6v6h6v18z"/><path d="M20 40v-7a4 4 0 0 1 8 0v7"/>',
  skewer: '<path d="M8 40 40 8"/><rect x="15" y="20" width="9" height="9" rx="2" transform="rotate(-45 19.5 24.5)"/><rect x="23" y="12" width="9" height="9" rx="2" transform="rotate(-45 27.5 16.5)"/><path d="M8 40l-2 2"/>',
  wheat: '<path d="M24 42V12"/><path d="M24 18c-5-1-7-5-7-8 4 0 7 3 7 8zM24 18c5-1 7-5 7-8-4 0-7 3-7 8zM24 27c-5-1-7-5-7-8 4 0 7 3 7 8zM24 27c5-1 7-5 7-8-4 0-7 3-7 8zM24 36c-5-1-7-5-7-8 4 0 7 3 7 8zM24 36c5-1 7-5 7-8-4 0-7 3-7 8z"/>',
  leaf: '<path d="M10 38C10 20 22 10 40 10c0 18-10 28-28 28z"/><path d="M10 38 30 18"/>',
  peaks: '<path d="M4 38 17 16l7 11 6-8 14 19z"/><path d="M26 22l3 4 3-4"/>',
  house: '<path d="M8 22 24 9l16 13"/><path d="M12 19v20h24V19"/><path d="M21 39V28h6v11"/>',
  book: '<path d="M24 14c-5-4-12-4-17-2v26c5-2 12-2 17 2 5-4 12-4 17-2V12c-5-2-12-2-17 2z"/><path d="M24 14v26"/>',
  cross: '<path d="M19 8h10v11h11v10H29v11H19V29H8V19h11z"/>',
  sheets: '<path d="M12 8h18l8 8v24H12z"/><path d="M30 8v8h8M17 24h14M17 30h14"/>',
  box: '<path d="M8 16 24 8l16 8v16l-16 8-16-8z"/><path d="M8 16l16 8 16-8M24 24v16"/>',
  waves: '<path d="M6 20c4-4 8-4 12 0s8 4 12 0 8-4 12 0"/><path d="M6 30c4-4 8-4 12 0s8 4 12 0 8-4 12 0"/>',
  snow: '<path d="M24 6v36M8.4 15l31.2 18M8.4 33l31.2-18"/><path d="M20 9l4 4 4-4M20 39l4-4 4 4"/>',
  sun: '<circle cx="24" cy="24" r="7"/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/>',
  slice: '<path d="M24 42 8 12a32 32 0 0 1 32 0z"/><circle cx="20" cy="20" r="2.5"/><circle cx="28" cy="24" r="2.5"/><circle cx="23" cy="31" r="2"/>',
};

const BRANDS = [
  { key: 'abu-ali', ar: 'أبو علي', en: 'ABU ALI', sub: 'GRILL HOUSE · EST. 1998', bg: '#7a1f1c', fg: '#f4ead9', accent: '#e9b46a', glyph: 'flame', cat: 'مشويات عراقية وكردية' },
  { key: 'citadel-cafe', ar: 'إطلالة القلعة', en: 'CITADEL VIEW', sub: 'SPECIALTY COFFEE', bg: '#3a2a20', fg: '#efe2c9', accent: '#c8995c', glyph: 'citadel', cat: 'قهوة مختصة وحلويات' },
  { key: 'pizza-sixty', ar: 'بيتزا الستين', en: 'PIZZA 60', sub: 'WOOD-FIRED', bg: '#1f1f20', fg: '#f3ece0', accent: '#d9482b', glyph: 'slice', cat: 'بيتزا على الحطب' },
  { key: 'nishtiman', ar: 'نشتمان', en: 'NISHTIMAN', sub: 'SHAWARMA', bg: '#2e3a28', fg: '#f1e8d6', accent: '#dea43c', glyph: 'skewer', cat: 'شاورما وصمون' },
  { key: 'hawler-bakery', ar: 'مخبز هولير', en: 'HAWLER', sub: 'BAKERY & SWEETS', bg: '#efe3cc', fg: '#5a3418', accent: '#a8692e', glyph: 'wheat', cat: 'خبز تنور وحلويات' },
  { key: 'fresh-market', ar: 'السوق الطازج', en: 'ERBIL FRESH', sub: 'MARKET', bg: '#1e5f36', fg: '#f2f5ee', accent: '#9fd17a', glyph: 'leaf', cat: 'خضار وفواكه يومية' },
  { key: 'zagros-electronics', ar: 'زاغروس', en: 'ZAGROS', sub: 'ELECTRONICS', bg: '#0f2744', fg: '#eef3f9', accent: '#4a96e6', glyph: 'peaks', cat: 'هواتف وأجهزة منزلية' },
  { key: 'sirwan-home', ar: 'سيروان', en: 'SIRWAN', sub: 'HOME GOODS', bg: '#23464a', fg: '#f1ece2', accent: '#d8b980', glyph: 'house', cat: 'أدوات منزلية ومفروشات' },
  { key: 'shaqlawa-books', ar: 'مكتبة شقلاوة', en: 'SHAQLAWA', sub: 'BOOKS & STATIONERY', bg: '#174a46', fg: '#f3eee3', accent: '#e2c27a', glyph: 'book', cat: 'كتب وقرطاسية' },
  { key: 'hayat-pharmacy', ar: 'صيدلية الحياة', en: 'HAYAT', sub: 'PHARMACY · SIMULATED', bg: '#f4f6f5', fg: '#0b6f69', accent: '#13a399', glyph: 'cross', cat: 'صيدلية افتراضية داخل اللعبة' },
  { key: 'kurdistan-paper', ar: 'صناعات كردستان الورقية', en: 'KPI', sub: 'KURDISTAN PAPER INDUSTRIES', bg: '#262626', fg: '#f0e6d6', accent: '#c79a63', glyph: 'sheets', cat: 'ورق تغليف وكرتون' },
  { key: 'hawler-packaging', ar: 'هولير للتعبئة', en: 'HAWLER PACK', sub: 'FOOD PACKAGING', bg: '#4f5a28', fg: '#f3f0e3', accent: '#d7d08a', glyph: 'box', cat: 'تعبئة وتغليف الأغذية' },
  { key: 'tigris-logistics', ar: 'دجلة', en: 'TIGRIS', sub: 'LOGISTICS', bg: '#12233a', fg: '#eef2f6', accent: '#2fb5a8', glyph: 'waves', cat: 'تخزين وتوزيع' },
  { key: 'cold-storage', ar: 'مخازن الستين', en: 'SIXTY COLD', sub: 'STORAGE', bg: '#1d4b6e', fg: '#f0f6fb', accent: '#9fd3f5', glyph: 'snow', cat: 'تخزين مبرّد' },
  { key: 'nawroz-holding', ar: 'نوروز', en: 'NAWROZ', sub: 'HOLDING', bg: '#121212', fg: '#f2ede2', accent: '#c9a24a', glyph: 'sun', cat: 'شركة استثمار' },
];

const fontCss = [500, 600, 700]
  .flatMap((w) => [
    `@font-face{font-family:Plex;font-weight:${w};src:url("file://${fontDir}/ibm-plex-sans-arabic-arabic-${w}-normal.woff2") format("woff2");unicode-range:U+0600-06FF,U+0750-077F,U+FB50-FDFF,U+FE70-FEFF;}`,
    `@font-face{font-family:Plex;font-weight:${w};src:url("file://${fontDir}/ibm-plex-sans-arabic-latin-${w}-normal.woff2") format("woff2");unicode-range:U+0000-00FF,U+2000-206F;}`,
  ])
  .join('\n');

const glyph = (b, size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 48 48" fill="none" stroke="${b.accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${G[b.glyph]}</svg>`;

const logoHtml = (b) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
html,body{margin:0;width:512px;height:512px;background:${b.bg};font-family:Plex,sans-serif;color:${b.fg}}
.wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
.ring{width:150px;height:150px;border-radius:50%;border:4px solid ${b.accent};display:grid;place-items:center}
.ar{font-weight:700;font-size:${b.ar.length > 12 ? 44 : 68}px;line-height:1.05;direction:rtl;text-align:center;max-width:440px}
.rule{width:56px;height:3px;background:${b.accent};border-radius:2px}
.en{font-weight:600;font-size:22px;letter-spacing:.32em;margin-inline-start:.32em}
.sub{font-weight:500;font-size:13px;letter-spacing:.24em;opacity:.7;margin-top:-6px}
</style></head><body><div class="wrap"><div class="ring">${glyph(b, 92)}</div><div class="ar">${b.ar}</div><div class="rule"></div><div class="en">${b.en}</div><div class="sub">${b.sub}</div></div></body></html>`;

const coverHtml = (b) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}
html,body{margin:0;width:1200px;height:500px;font-family:Plex,sans-serif;color:${b.fg};overflow:hidden}
body{background:linear-gradient(115deg, ${b.bg} 0%, ${b.bg} 55%, color-mix(in srgb, ${b.bg} 78%, #000) 100%)}
.pattern{position:absolute;inset:0;background:repeating-linear-gradient(135deg, transparent 0 46px, color-mix(in srgb, ${b.accent} 10%, transparent) 46px 48px)}
.mark{position:absolute;right:-40px;top:50%;transform:translateY(-50%);opacity:.18}
.text{position:absolute;left:80px;top:50%;transform:translateY(-50%);max-width:760px;text-align:left}
.cat{font-size:22px;font-weight:500;opacity:.75;direction:rtl;text-align:left}
.ar{font-size:84px;font-weight:700;line-height:1.1;direction:rtl;text-align:left}
.en{font-size:26px;font-weight:600;letter-spacing:.3em;margin-top:10px}
.rule{width:80px;height:4px;background:${b.accent};margin:22px 0;border-radius:2px}
.demo{position:absolute;left:80px;bottom:34px;font-size:15px;opacity:.55;letter-spacing:.08em}
</style></head><body><div class="pattern"></div><div class="mark">${glyph(b, 520)}</div>
<div class="text"><div class="ar">${b.ar}</div><div class="rule"></div><div class="en">${b.en} · ${b.sub}</div><div class="cat" style="margin-top:14px">${b.cat}</div></div>
<div class="demo">DEMO BRAND · علامة تجريبية لأغراض العرض</div></body></html>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
const tmp = join(root, '.dev');
mkdirSync(tmp, { recursive: true });
for (const b of BRANDS) {
  for (const [kind, html, w, h] of [
    ['logo', logoHtml(b), 512, 512],
    ['cover', coverHtml(b), 1200, 500],
  ]) {
    const file = join(tmp, `brand-${b.key}-${kind}.html`);
    writeFileSync(file, html);
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`file://${file}`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `${b.key}-${kind}.png`), type: 'png' });
  }
  console.log('rendered', b.key);
}
await browser.close();
writeFileSync(join(out, 'brands.json'), JSON.stringify(Object.fromEntries(BRANDS.map((b) => [b.key, { bg: b.bg, accent: b.accent }])), null, 1) + '\n');
