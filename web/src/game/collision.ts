// 2D collision in the local plane (x east, y north). Buildings are oriented
// boxes; vehicles are circles. A uniform grid keeps lookups local.

export interface Box {
  cx: number;
  cy: number;
  /** unit vector along the box width */
  ux: number;
  uy: number;
  /** half width (along u) and half depth (along v = perpendicular) */
  hw: number;
  hd: number;
  id?: string;
  enabled?: boolean;
}

export function boxCorners(b: Box): [number, number][] {
  const vx = -b.uy;
  const vy = b.ux;
  const out: [number, number][] = [];
  for (const [su, sv] of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    out.push([b.cx + b.ux * b.hw * su + vx * b.hd * sv, b.cy + b.uy * b.hw * su + vy * b.hd * sv]);
  }
  return out;
}

/** Separating-axis overlap test for two oriented boxes, with optional margin. */
export function boxesOverlap(a: Box, b: Box, margin = 0): boolean {
  const axes: [number, number][] = [
    [a.ux, a.uy],
    [-a.uy, a.ux],
    [b.ux, b.uy],
    [-b.uy, b.ux],
  ];
  const ca = boxCorners(a);
  const cb = boxCorners(b);
  for (const [ax, ay] of axes) {
    let minA = Infinity;
    let maxA = -Infinity;
    let minB = Infinity;
    let maxB = -Infinity;
    for (const [x, y] of ca) {
      const p = x * ax + y * ay;
      minA = Math.min(minA, p);
      maxA = Math.max(maxA, p);
    }
    for (const [x, y] of cb) {
      const p = x * ax + y * ay;
      minB = Math.min(minB, p);
      maxB = Math.max(maxB, p);
    }
    if (maxA + margin < minB || maxB + margin < minA) return false;
  }
  return true;
}

/** Push a circle out of a box. Returns the push vector or null if not touching. */
export function circleVsBox(px: number, py: number, r: number, b: Box): { nx: number; ny: number; depth: number } | null {
  const dx = px - b.cx;
  const dy = py - b.cy;
  const vx = -b.uy;
  const vy = b.ux;
  const lu = dx * b.ux + dy * b.uy;
  const lv = dx * vx + dy * vy;
  const cu = Math.max(-b.hw, Math.min(b.hw, lu));
  const cv = Math.max(-b.hd, Math.min(b.hd, lv));
  const closestX = b.cx + b.ux * cu + vx * cv;
  const closestY = b.cy + b.uy * cu + vy * cv;
  let nx = px - closestX;
  let ny = py - closestY;
  const d = Math.hypot(nx, ny);
  if (d >= r) return null;
  if (d > 1e-6) return { nx: nx / d, ny: ny / d, depth: r - d };
  // centre inside the box: push out along the shallowest axis
  const pu = b.hw - Math.abs(lu);
  const pv = b.hd - Math.abs(lv);
  if (pu < pv) {
    const s = Math.sign(lu) || 1;
    nx = b.ux * s;
    ny = b.uy * s;
    return { nx, ny, depth: pu + r };
  }
  const s = Math.sign(lv) || 1;
  return { nx: vx * s, ny: vy * s, depth: pv + r };
}

export class BoxGrid {
  private cells = new Map<string, Box[]>();
  constructor(private size = 40) {}

  private keys(b: Box): string[] {
    const r = Math.hypot(b.hw, b.hd);
    const out: string[] = [];
    for (let x = Math.floor((b.cx - r) / this.size); x <= Math.floor((b.cx + r) / this.size); x++)
      for (let y = Math.floor((b.cy - r) / this.size); y <= Math.floor((b.cy + r) / this.size); y++) out.push(`${x},${y}`);
    return out;
  }

  add(b: Box) {
    for (const k of this.keys(b)) {
      let list = this.cells.get(k);
      if (!list) this.cells.set(k, (list = []));
      list.push(b);
    }
  }

  remove(b: Box) {
    for (const k of this.keys(b)) {
      const list = this.cells.get(k);
      if (!list) continue;
      const i = list.indexOf(b);
      if (i >= 0) list.splice(i, 1);
    }
  }

  near(x: number, y: number, r: number): Box[] {
    const seen = new Set<Box>();
    for (let gx = Math.floor((x - r) / this.size); gx <= Math.floor((x + r) / this.size); gx++)
      for (let gy = Math.floor((y - r) / this.size); gy <= Math.floor((y + r) / this.size); gy++)
        for (const b of this.cells.get(`${gx},${gy}`) ?? []) seen.add(b);
    return [...seen];
  }

  anyOverlap(b: Box, margin = 0): boolean {
    const r = Math.hypot(b.hw, b.hd) + margin;
    return this.near(b.cx, b.cy, r).some((o) => o.enabled !== false && boxesOverlap(o, b, margin));
  }
}

export function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
