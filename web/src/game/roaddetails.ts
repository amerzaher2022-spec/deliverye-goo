// The small things on a real street that make it read as one: lane arrows before junctions, drain
// grates along the kerb, manhole covers, patched asphalt and cracks. All are flat decals from one
// texture drawn here, merged per 250 m square so the camera skips squares it cannot see.

import * as THREE from 'three';
import type { LocalPoint } from '../../../shared/geo';
import type { RoadGraph } from '../../../shared/roads';
import { wetSurface } from './atmosphere';
import type { Quality } from './world';

/** atlas cells (128 x 256 px each, eight across) */
const enum Cell {
  Straight = 0,
  StraightRight = 1,
  StraightLeft = 2,
  Grate = 3,
  Manhole = 4,
  Patch = 5,
  Cracks = 6,
}

function atlas() {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  const paint = 'rgba(236,233,224,0.92)';
  // arrows point up (towards the junction); a little worn
  const arrow = (x0: number, kind: 'S' | 'R' | 'L') => {
    g.save();
    g.translate(x0 + 64, 0);
    g.fillStyle = paint;
    g.fillRect(-9, 120, 18, 126);
    g.beginPath();
    g.moveTo(0, 18);
    g.lineTo(-34, 92);
    g.lineTo(34, 92);
    g.closePath();
    g.fill();
    g.fillRect(-9, 88, 18, 40);
    if (kind !== 'S') {
      const s = kind === 'R' ? 1 : -1;
      g.beginPath();
      g.moveTo(0, 170);
      g.quadraticCurveTo(s * 22, 168, s * 30, 140);
      g.lineTo(s * 30, 128);
      g.lineTo(s * 9, 128);
      g.lineTo(s * 9, 150);
      g.lineTo(s * 9, 180);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(s * 52, 120);
      g.lineTo(s * 16, 140);
      g.lineTo(s * 44, 156);
      g.closePath();
      g.fill();
    }
    // wear: knock out specks of paint
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.6})`;
      g.fillRect(-60 + Math.random() * 120, Math.random() * 256, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
    g.restore();
  };
  arrow(0, 'S');
  arrow(128, 'R');
  arrow(256, 'L');
  // drain grate: steel frame with slots
  g.fillStyle = '#2a2b2c';
  g.fillRect(384 + 14, 14, 100, 228);
  g.fillStyle = '#0c0d0e';
  for (let y = 30; y < 230; y += 16) g.fillRect(384 + 26, y, 76, 8);
  // manhole: round cover with a ring and a cast pattern (drawn stretched; the decal is twice as long)
  g.save();
  g.translate(512 + 64, 128);
  g.scale(1, 2);
  g.fillStyle = '#3b3c3d';
  g.beginPath();
  g.arc(0, 0, 58, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#26272a';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 50, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2.5;
  for (let r = 12; r < 46; r += 9) {
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.restore();
  // patched asphalt: darker, soft edges
  const pg = g.createRadialGradient(640 + 64, 128, 20, 640 + 64, 128, 90);
  pg.addColorStop(0, 'rgba(28,29,31,0.55)');
  pg.addColorStop(0.75, 'rgba(28,29,31,0.45)');
  pg.addColorStop(1, 'rgba(28,29,31,0)');
  g.fillStyle = pg;
  g.fillRect(640, 0, 128, 256);
  // cracks: thin branching lines
  g.strokeStyle = 'rgba(18,18,19,0.8)';
  for (let k = 0; k < 5; k++) {
    let x = 768 + 30 + Math.random() * 68;
    let y = 10;
    g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath();
    g.moveTo(x, y);
    while (y < 246) {
      x += (Math.random() - 0.5) * 18;
      x = Math.max(772, Math.min(892, x));
      y += 8 + Math.random() * 16;
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function hash(n: number) {
  let x = (n * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  return (x >>> 0) / 4294967296;
}

export function buildRoadDetails(
  graph: RoadGraph,
  quality: Quality,
  junctions: { x: number; y: number; edges: { to: number; road: string }[] }[],
  widthOf: (road: string) => number,
  graded: (pts: LocalPoint[]) => boolean,
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'road-details';
  const cells = new Map<string, { pos: number[]; uv: number[] }>();
  /** a decal centred at (x, y), `w` across and `l` along direction (dx, dy) */
  const decal = (cell: Cell, x: number, y: number, dx: number, dy: number, w: number, l: number, h = 0.135) => {
    const key = `${Math.floor(x / 250)},${Math.floor(y / 250)}`;
    let b = cells.get(key);
    if (!b) cells.set(key, (b = { pos: [], uv: [] }));
    const rx = dy;
    const ry = -dx;
    const u0 = cell / 8 + 0.002;
    const u1 = (cell + 1) / 8 - 0.002;
    const corners = [
      [-w / 2, -l / 2, u0, 0],
      [w / 2, -l / 2, u1, 0],
      [w / 2, l / 2, u1, 1],
      [-w / 2, l / 2, u0, 1],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const [a, c, u, v] = corners[k]!;
      const px = x + rx * a! + dx * c!;
      const py = y + ry * a! + dy * c!;
      b.pos.push(px, h, -py);
      b.uv.push(u!, v!);
    }
  };

  // lane arrows a little before each junction, in the lanes that approach it (traffic keeps right)
  for (const n of junctions) {
    const roads = [...new Set(n.edges.map((e) => e.road))];
    const r = Math.max(...roads.map(widthOf)) / 2 + 1;
    for (const e of n.edges) {
      const other = graph.nodes[e.to]!;
      const len = Math.hypot(other.x - n.x, other.y - n.y);
      if (len < r + 22) continue;
      const ux = (other.x - n.x) / len;
      const uy = (other.y - n.y) / len;
      const roadW = widthOf(e.road);
      const half = roadW / 2 - (roadW > 16 ? 1.7 : 0.4);
      const lanes = Math.max(1, Math.min(3, Math.floor(half / 3.2)));
      const inner = roadW > 16 ? 0.85 : 0.1;
      for (let k = 0; k < lanes; k++) {
        const off = inner + ((k + 0.5) * half) / lanes;
        // right of the direction of travel (towards the junction, -u): (-uy, ux) negated
        const x = n.x + ux * (r + 13) - uy * off;
        const y = n.y + uy * (r + 13) + ux * off;
        const cell = lanes === 1 ? Cell.Straight : k === lanes - 1 ? Cell.StraightRight : k === 0 ? Cell.StraightLeft : Cell.Straight;
        decal(cell, x, y, -ux, -uy, 1.6, 5.2);
      }
    }
  }

  // along every ground-level street: drains at the kerb, manholes, patches and cracks
  let seed = 1;
  const step = quality === 'low' ? 1.6 : 1;
  for (const { road, points } of graph.polylines) {
    if (graded(points)) continue;
    let acc = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1) continue;
      const dx = (b.x - a.x) / len;
      const dy = (b.y - a.y) / len;
      const nx = -dy;
      const ny = dx;
      for (let s = (acc % 1) * 0; s < len; s += 6 * step) {
        const t = acc + s;
        const h = hash(seed++);
        const x = a.x + dx * s;
        const y = a.y + dy * s;
        // drains every ~32 m on both kerbs
        if (Math.floor(t / 32) !== Math.floor((t - 6 * step) / 32)) {
          for (const side of [1, -1]) {
            const o = road.width / 2 - 0.35;
            decal(Cell.Grate, x + nx * o * side, y + ny * o * side, dx, dy, 0.42, 0.9);
          }
        }
        if (h < 0.035) decal(Cell.Manhole, x + nx * (h * 40 - 0.7) * (road.width / 6), y + ny * (h * 40 - 0.7) * (road.width / 6), dx, dy, 0.75, 1.5);
        else if (h > 0.93 && quality !== 'low') {
          const w = 1.8 + hash(seed++) * 2.4;
          const lat = (hash(seed++) - 0.5) * (road.width - w);
          decal(Cell.Patch, x + nx * lat, y + ny * lat, dx, dy, w, w * 2, 0.132);
        } else if (h > 0.86 && quality !== 'low') {
          const lat = (hash(seed++) - 0.5) * (road.width - 1.5);
          decal(Cell.Cracks, x + nx * lat, y + ny * lat, dx, dy, 1.2, 2.4, 0.133);
        }
      }
      acc += len;
    }
  }

  const tex = atlas();
  const mat = wetSurface(
    quality === 'low'
      ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, color: '#d6d6d6' })
      : quality === 'medium'
        ? new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
        : new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.85 }),
    quality,
  );
  for (const b of cells.values()) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    const nrm = new Float32Array(b.pos.length);
    for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    group.add(m);
  }
  return group;
}
