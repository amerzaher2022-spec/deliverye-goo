// The game's name and mark: سوا اربيل · Sawa Erbil ("together, Erbil"). The mark is a map pin whose
// head holds a delivery box, over a road swoosh. The same drawing is used for the app icon
// (web/public/icons/icon.svg), the menu and the box on the scooter.

export const BRAND = {
  ar: 'سوا اربيل',
  en: 'Sawa Erbil',
  teal: '#0b7a75',
  tealDark: '#06423f',
  amber: '#f6a821',
  cream: '#fff6e2',
};

/** The mark as SVG markup (viewBox 0 0 512 512), for the app icon and the menu. */
export function logoSvg(withBackground = true) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
<defs><linearGradient id="sb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${BRAND.teal}"/><stop offset="1" stop-color="${BRAND.tealDark}"/></linearGradient></defs>
${withBackground ? '<rect width="512" height="512" rx="116" fill="url(#sb)"/>' : ''}
<path d="M96 392 C 180 330, 332 330, 416 392" fill="none" stroke="${BRAND.amber}" stroke-width="30" stroke-linecap="round"/>
<path d="M256 380 C 196 300, 132 238, 132 176 a124 124 0 0 1 248 0 C 380 238, 316 300, 256 380 Z" fill="${BRAND.cream}"/>
<rect x="196" y="122" width="120" height="104" rx="16" fill="${BRAND.amber}"/>
<path d="M196 158 H316" stroke="#c77a06" stroke-width="12"/>
<path d="M242 122 V176 L256 166 L270 176 V122" fill="${BRAND.cream}"/>
</svg>`;
}

/** Draw the mark into a 2D canvas at (x, y) with the given size (square). */
export function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, withBackground = true) {
  const s = size / 512;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  if (withBackground) {
    const g = ctx.createLinearGradient(0, 0, 512, 512);
    g.addColorStop(0, BRAND.teal);
    g.addColorStop(1, BRAND.tealDark);
    ctx.fillStyle = g;
    roundRect(ctx, 0, 0, 512, 512, 116);
    ctx.fill();
  }
  ctx.strokeStyle = BRAND.amber;
  ctx.lineWidth = 30;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(96, 392);
  ctx.bezierCurveTo(180, 330, 332, 330, 416, 392);
  ctx.stroke();
  ctx.fillStyle = BRAND.cream;
  ctx.beginPath();
  ctx.moveTo(256, 380);
  ctx.bezierCurveTo(196, 300, 132, 238, 132, 176);
  ctx.arc(256, 176, 124, Math.PI, 0);
  ctx.bezierCurveTo(380, 238, 316, 300, 256, 380);
  ctx.fill();
  ctx.fillStyle = BRAND.amber;
  roundRect(ctx, 196, 122, 120, 104, 16);
  ctx.fill();
  ctx.strokeStyle = '#c77a06';
  ctx.lineWidth = 12;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(196, 158);
  ctx.lineTo(316, 158);
  ctx.stroke();
  ctx.fillStyle = BRAND.cream;
  ctx.beginPath();
  ctx.moveTo(242, 122);
  ctx.lineTo(242, 176);
  ctx.lineTo(256, 166);
  ctx.lineTo(270, 176);
  ctx.lineTo(270, 122);
  ctx.fill();
  ctx.restore();
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
