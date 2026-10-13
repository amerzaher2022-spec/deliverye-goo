// Original vector logos for the fictional demo businesses. Plain shapes and
// Latin initials only (an SVG drawn as an image cannot use the page's web
// fonts, so Arabic names are rendered by the game's sign painter instead).

const ICONS: Record<string, string> = {
  restaurant:
    '<path d="M-14-22v18a6 6 0 0 0 5 6v22h4V2a6 6 0 0 0 5-6v-18h-3v15h-2v-15h-3v15h-2v-15z M10-22c-5 0-8 8-8 16 0 5 2 8 5 9v21h4v-46z" fill="#fff"/>',
  cafe: '<path d="M-18-6h28v10a14 14 0 0 1-28 0z M10-2h4a6 6 0 0 1 0 12h-5" fill="none" stroke="#fff" stroke-width="4"/><path d="M-10-24c-3 4 3 6 0 10 M-2-24c-3 4 3 6 0 10" stroke="#fff" stroke-width="3" fill="none"/>',
  bakery:
    '<path d="M-22 6c0-16 10-24 22-24s22 8 22 24c0 4-3 6-6 6h-32c-3 0-6-2-6-6z" fill="#fff"/><path d="M-10-10l4 18 M2-14v22 M12-10l-4 18" stroke="currentColor" stroke-width="3"/>',
  pizza: '<path d="M0 24L-22-16a44 44 0 0 1 44 0z" fill="#fff"/><circle cx="-6" cy="-6" r="4" fill="currentColor"/><circle cx="6" cy="-2" r="4" fill="currentColor"/><circle cx="0" cy="10" r="3" fill="currentColor"/>',
  grocery:
    '<path d="M-24-18h8l6 26h26l6-18h-34" fill="none" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><circle cx="-6" cy="16" r="4" fill="#fff"/><circle cx="12" cy="16" r="4" fill="#fff"/>',
  shop: '<path d="M-18-10h36l-3 34h-30z" fill="#fff"/><path d="M-9-10v-6a9 9 0 0 1 18 0v6" fill="none" stroke="#fff" stroke-width="4"/>',
  electronics: '<path d="M4-26L-14 4h12l-4 24 20-32H2z" fill="#fff"/>',
  pharmacy: '<path d="M-7-22h14v15h15v14H7v15H-7V7h-15V-7h15z" fill="#fff"/>',
  books: '<path d="M-22-16c8-4 16-4 21 1v35c-5-5-13-5-21-1z M22-16c-8-4-16-4-21 1v35c5-5 13-5 21-1z" fill="#fff"/>',
  factory:
    '<path d="M-26 24v-30l14 9v-9l14 9v-9l14 9v-26h8v47z" fill="#fff"/>',
  warehouse: '<path d="M-26 24v-28l26-16 26 16v28z" fill="#fff"/><path d="M-14 24v-18h28v18 M-14 0h28 M-14 6h28 M-14 12h28" stroke="currentColor" stroke-width="2.5" fill="none"/>',
  office: '<path d="M-16 26v-50h32v50z" fill="#fff"/><path d="M-9-16h5 M4-16h5 M-9-6h5 M4-6h5 M-9 4h5 M4 4h5 M-3 26v-10h6v10" stroke="currentColor" stroke-width="3"/>',
};

export function logoSvg(opts: { initials: string; color: string; icon: keyof typeof ICONS | string; accent?: string }) {
  const icon = ICONS[opts.icon] ?? ICONS.shop;
  const accent = opts.accent ?? '#ffffff';
  const initials = opts.initials.slice(0, 3).replace(/[^A-Za-z0-9&]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${opts.color}"/><stop offset="1" stop-color="${shade(opts.color, -0.28)}"/></linearGradient></defs>
<rect x="8" y="8" width="240" height="240" rx="56" fill="url(#g)"/>
<rect x="8" y="8" width="240" height="240" rx="56" fill="none" stroke="${accent}" stroke-opacity=".35" stroke-width="6"/>
<g transform="translate(128 98) scale(2.1)" color="${opts.color}">${icon}</g>
<text x="128" y="214" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="44" letter-spacing="4" fill="${accent}">${initials}</text>
</svg>`;
}

export function coverSvg(opts: { color: string; title: string; icon: string }) {
  const icon = ICONS[opts.icon] ?? ICONS.shop;
  const title = opts.title.replace(/[<&>"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="400" viewBox="0 0 960 400">
<defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${opts.color}"/><stop offset="1" stop-color="${shade(opts.color, -0.45)}"/></linearGradient>
<pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M0 40L40 0" stroke="#fff" stroke-opacity=".07" stroke-width="10"/></pattern></defs>
<rect width="960" height="400" fill="url(#c)"/><rect width="960" height="400" fill="url(#p)"/>
<g transform="translate(800 200) scale(4.5)" color="${opts.color}" opacity=".9">${icon}</g>
<text x="56" y="220" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="56" fill="#fff">${title}</text>
<text x="56" y="270" font-family="Arial, Helvetica, sans-serif" font-size="24" fill="#fff" fill-opacity=".75">Fictional demo business · Erbil Delivery World</text>
</svg>`;
}

function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amount < 0 ? v * amount : (255 - v) * amount))));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
