// Paints a shop's lightbox sign onto a 2D canvas: logo tile, Arabic name,
// English name in spaced capitals, flat brand colour. Used for the in-game
// sign texture and for the live preview in the dashboard editor, so what the
// admin sees is what the game shows.

export interface SignOptions {
  nameAr: string;
  nameEn: string;
  color: string;
  logo: CanvasImageSource & { width: number; height: number } | null;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight: number, family: string) {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 12);
  return size;
}

const FONT = '"IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, sans-serif';

export function paintSign(ctx: CanvasRenderingContext2D, W: number, H: number, opts: SignOptions) {
  const k = H / 256;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = opts.color;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 3 * k;
  ctx.strokeRect(12 * k, 12 * k, W - 24 * k, H - 24 * k);

  const pad = 32 * k;
  const logoSize = H - 64 * k;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, pad, pad, logoSize, logoSize, 18 * k);
  ctx.fill();
  if (opts.logo) {
    ctx.save();
    roundRect(ctx, pad, pad, logoSize, logoSize, 18 * k);
    ctx.clip();
    const s = Math.min(logoSize / opts.logo.width, logoSize / opts.logo.height);
    const lw = opts.logo.width * s;
    const lh = opts.logo.height * s;
    ctx.drawImage(opts.logo, pad + (logoSize - lw) / 2, pad + (logoSize - lh) / 2, lw, lh);
    ctx.restore();
  }

  const textX = pad + logoSize + 36 * k;
  const textW = W - textX - 40 * k;
  ctx.fillStyle = '#ffffff';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  fitText(ctx, opts.nameAr || ' ', textW, 100 * k, 700, FONT);
  ctx.fillText(opts.nameAr, W - 40 * k, 100 * k);
  ctx.direction = 'ltr';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  const spaced = 'letterSpacing' in ctx;
  if (spaced) (ctx as unknown as { letterSpacing: string }).letterSpacing = `${4 * k}px`;
  fitText(ctx, opts.nameEn.toUpperCase() || ' ', textW, 42 * k, 600, FONT);
  ctx.fillText(opts.nameEn.toUpperCase(), textX, 192 * k);
  if (spaced) (ctx as unknown as { letterSpacing: string }).letterSpacing = '0px';
}
