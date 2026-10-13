// Renders the app icon (an original design) to the PNG sizes the PWA manifest and iOS need.
import { mkdirSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = (pad = 0) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1b3a63"/><stop offset="1" stop-color="#0f1b2d"/></linearGradient>
<linearGradient id="box" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffcf4a"/><stop offset="1" stop-color="#f5a623"/></linearGradient></defs>
<rect width="512" height="512" rx="${pad ? 0 : 112}" fill="url(#bg)"/>
<g transform="translate(256 262) scale(${pad ? 0.78 : 1})">
<path d="M-190 120 Q0 40 190 120" stroke="#1eaaff" stroke-width="26" fill="none" stroke-linecap="round" stroke-dasharray="1 52"/>
<rect x="-110" y="-150" width="220" height="190" rx="26" fill="url(#box)"/>
<path d="M-110 -95 H110" stroke="#c77700" stroke-width="16"/>
<path d="M-28 -150 V-60 L0 -78 L28 -60 V-150" fill="#fff4cf"/>
<circle cx="0" cy="40" r="0" fill="none"/>
<path d="M-62 92 a34 34 0 1 0 0.1 0 M62 92 a34 34 0 1 0 0.1 0" fill="none" stroke="#fff" stroke-width="18"/>
</g></svg>`;

mkdirSync('web/public/icons', { recursive: true });
writeFileSync('web/public/icons/icon.svg', svg());
for (const [name, size, pad] of [
  ['icon-180.png', 180, 0],
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['maskable-512.png', 512, 1],
]) {
  const png = new Resvg(svg(pad), { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(`web/public/icons/${name}`, png);
}
console.log('icons written');
