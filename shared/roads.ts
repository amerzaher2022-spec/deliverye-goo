// Road network built from the district's road polylines: intersections become
// graph nodes, so routing follows connected streets. Used by the game (route
// line, minimap) and by the server (estimated mission distance).

import { toLocal, type LatLng, type LocalPoint } from './geo';
import type { DistrictData, DistrictRoad } from './types';

export interface RoadNode {
  id: number;
  x: number;
  y: number;
  z?: number;
  edges: { to: number; length: number; road: string }[];
}

export interface RoadSegment {
  a: LocalPoint;
  b: LocalPoint;
  width: number;
  roadId: string;
  kind: DistrictRoad['kind'];
  fromNode: number;
  toNode: number;
  length: number;
}

export interface RoadGraph {
  nodes: RoadNode[];
  segments: RoadSegment[];
  /** Local-plane polylines, one per road, intersections included. */
  polylines: { road: DistrictRoad; points: LocalPoint[] }[];
}

export interface Route {
  points: LocalPoint[];
  length: number;
}

const MERGE = 0.75; // metres: points closer than this become one node

function lerpZ(a: LocalPoint, b: LocalPoint, t: number) {
  return (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * t;
}

/** Does any road leave ground level? */
export function hasGradeSeparation(graph: RoadGraph) {
  return graph.segments.some((s) => s.a.z || s.b.z);
}

/**
 * Height of the road surface under a point, for a vehicle currently at height `z`: only roads within
 * reach of that height count, so a car in a tunnel stays in it while the street above passes overhead.
 * Returns null off the roads that leave ground level (the vehicle is then on the ground).
 */
export function roadHeightAt(graph: RoadGraph, p: LocalPoint, z: number): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  for (const s of segmentsNear(graph, p, 2)) {
    if (!s.a.z && !s.b.z) continue;
    const pr = projectOnSegment(p, s.a, s.b);
    if (pr.distance > s.width / 2 + 0.6) continue;
    const h = lerpZ(s.a, s.b, pr.t);
    const gap = Math.abs(h - z);
    if (gap < 2.5 && gap < bestGap) {
      best = h;
      bestGap = gap;
    }
  }
  return best;
}

function segmentIntersection(p: LocalPoint, p2: LocalPoint, q: LocalPoint, q2: LocalPoint) {
  const r = { x: p2.x - p.x, y: p2.y - p.y };
  const s = { x: q2.x - q.x, y: q2.y - q.y };
  const denom = r.x * s.y - r.y * s.x;
  if (Math.abs(denom) < 1e-9) return null;
  const qp = { x: q.x - p.x, y: q.y - p.y };
  const t = (qp.x * s.y - qp.y * s.x) / denom;
  const u = (qp.x * r.y - qp.y * r.x) / denom;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, point: { x: p.x + t * r.x, y: p.y + t * r.y } };
}

export function buildRoadGraph(district: DistrictData): RoadGraph {
  const origin = district.origin;
  const lines = district.roads.map((road) => ({
    road,
    pts: road.coords.map(([lat, lng], i): LocalPoint => {
      const p = toLocal({ lat, lng }, origin);
      const z = road.elev?.[i] ?? 0;
      return z ? { ...p, z } : p;
    }),
  }));

  // Extra points to insert, per road, per segment index, with parameter t.
  const inserts: Map<number, { t: number; point: LocalPoint }[]>[] = lines.map(() => new Map());
  const addInsert = (line: number, seg: number, t: number, point: LocalPoint) => {
    const m = inserts[line]!;
    if (!m.has(seg)) m.set(seg, []);
    m.get(seg)!.push({ t, point });
  };

  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const A = lines[i]!.pts;
      const B = lines[j]!.pts;
      for (let a = 0; a < A.length - 1; a++) {
        for (let b = 0; b < B.length - 1; b++) {
          const hit = segmentIntersection(A[a]!, A[a + 1]!, B[b]!, B[b + 1]!);
          if (!hit) continue;
          // roads at different levels (a tunnel under a junction, a bridge over it) do not meet
          const za = lerpZ(A[a]!, A[a + 1]!, hit.t);
          const zb = lerpZ(B[b]!, B[b + 1]!, hit.u);
          if (Math.abs(za - zb) > 1.5) continue;
          addInsert(i, a, hit.t, za ? { ...hit.point, z: za } : hit.point);
          addInsert(j, b, hit.u, zb ? { ...hit.point, z: zb } : hit.point);
        }
      }
    }
  }

  const nodes: RoadNode[] = [];
  // hash grid so merging stays fast with thousands of OpenStreetMap vertices
  const cells = new Map<string, number[]>();
  const nodeAt = (p: LocalPoint): number => {
    const cx = Math.floor(p.x / MERGE);
    const cy = Math.floor(p.y / MERGE);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          const n = nodes[id]!;
          if (Math.abs(n.x - p.x) < MERGE && Math.abs(n.y - p.y) < MERGE && Math.abs((n.z ?? 0) - (p.z ?? 0)) < 1.5) return id;
        }
    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y, ...(p.z ? { z: p.z } : {}), edges: [] });
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)!.push(id);
    return id;
  };

  const segments: RoadSegment[] = [];
  const polylines: RoadGraph['polylines'] = [];

  lines.forEach((line, li) => {
    const full: LocalPoint[] = [];
    line.pts.forEach((p, idx) => {
      full.push(p);
      if (idx === line.pts.length - 1) return;
      const extra = (inserts[li]!.get(idx) ?? []).sort((x, y) => x.t - y.t);
      for (const e of extra) full.push(e.point);
    });
    // drop duplicates produced by intersections at vertices
    const pts = full.filter((p, i) => i === 0 || Math.hypot(p.x - full[i - 1]!.x, p.y - full[i - 1]!.y) > 0.05);
    polylines.push({ road: line.road, points: pts });
    for (let k = 0; k < pts.length - 1; k++) {
      const from = nodeAt(pts[k]!);
      const to = nodeAt(pts[k + 1]!);
      if (from === to) continue;
      const length = Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.y - pts[k]!.y);
      segments.push({
        a: pts[k]!,
        b: pts[k + 1]!,
        width: line.road.width,
        roadId: line.road.id,
        kind: line.road.kind,
        fromNode: from,
        toNode: to,
        length,
      });
      // routes may use a one-way street in either direction (couriers on scooters do); moving traffic
      // keeps to the direction of travel (see web/src/game/traffic.ts)
      nodes[from]!.edges.push({ to, length, road: line.road.id });
      nodes[to]!.edges.push({ to: from, length, road: line.road.id });
    }
  });

  return { nodes, segments, polylines };
}

export interface Projection {
  point: LocalPoint;
  distance: number;
  segment: RoadSegment;
  /** distance along the segment from a */
  along: number;
}

export function projectOnSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1e-9;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

// ------------------------------------------------------------------ spatial index

const CELL = 50;
const grids = new WeakMap<RoadGraph, Map<string, RoadSegment[]>>();

/** Segments whose bounding box comes within `r` metres of `p` (a uniform grid, built on first use). */
export function segmentsNear(graph: RoadGraph, p: LocalPoint, r: number): RoadSegment[] {
  let grid = grids.get(graph);
  if (!grid) {
    grid = new Map();
    for (const s of graph.segments) {
      const pad = s.width / 2;
      for (let cx = Math.floor((Math.min(s.a.x, s.b.x) - pad) / CELL); cx <= Math.floor((Math.max(s.a.x, s.b.x) + pad) / CELL); cx++)
        for (let cy = Math.floor((Math.min(s.a.y, s.b.y) - pad) / CELL); cy <= Math.floor((Math.max(s.a.y, s.b.y) + pad) / CELL); cy++) {
          const k = `${cx},${cy}`;
          const list = grid.get(k);
          if (list) list.push(s);
          else grid.set(k, [s]);
        }
    }
    grids.set(graph, grid);
  }
  const out = new Set<RoadSegment>();
  for (let cx = Math.floor((p.x - r) / CELL); cx <= Math.floor((p.x + r) / CELL); cx++)
    for (let cy = Math.floor((p.y - r) / CELL); cy <= Math.floor((p.y + r) / CELL); cy++) for (const s of grid.get(`${cx},${cy}`) ?? []) out.add(s);
  return [...out];
}

export function nearestOnNetwork(graph: RoadGraph, p: LocalPoint): Projection | null {
  let best: Projection | null = null;
  // look nearby first; widen the search only when nothing is close
  let candidates = segmentsNear(graph, p, 60);
  if (!candidates.length) candidates = segmentsNear(graph, p, 400);
  if (!candidates.length) candidates = graph.segments;
  for (const s of candidates) {
    const pr = projectOnSegment(p, s.a, s.b);
    if (!best || pr.distance < best.distance) {
      best = { point: pr.point, distance: pr.distance, segment: s, along: pr.t * s.length };
    }
  }
  return best;
}

/** Distance from a point to the nearest road centreline minus half its width (<= 0 means on the road). */
export function distanceToRoadEdge(graph: RoadGraph, p: LocalPoint): number {
  let best = Infinity;
  const near = segmentsNear(graph, p, 40);
  for (const s of near.length ? near : graph.segments) {
    const d = projectOnSegment(p, s.a, s.b).distance - s.width / 2;
    if (d < best) best = d;
  }
  return best;
}

class MinHeap {
  private items: { id: number; f: number }[] = [];
  get size() {
    return this.items.length;
  }
  push(id: number, f: number) {
    const a = this.items;
    a.push({ id, f });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p]!.f <= a[i]!.f) break;
      [a[p], a[i]] = [a[i]!, a[p]!];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]!.f < a[m]!.f) m = l;
        if (r < a.length && a[r]!.f < a[m]!.f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Shortest route along connected roads between two arbitrary points. Both
 * points are projected onto the nearest road; the off-road legs at either end
 * are included so the line reaches the actual entrance or pickup point.
 * Falls back to a straight line if the network is empty or disconnected.
 */
export function findRoute(graph: RoadGraph, from: LocalPoint, to: LocalPoint): Route {
  const straight = { points: [from, to], length: Math.hypot(to.x - from.x, to.y - from.y) };
  const ps = nearestOnNetwork(graph, from);
  const pe = nearestOnNetwork(graph, to);
  if (!ps || !pe) return straight;

  // Same segment: no graph search needed.
  if (ps.segment === pe.segment) {
    const pts = [from, ps.point, pe.point, to];
    return { points: pts, length: polylineLength(pts) };
  }

  const START = -1;
  const END = -2;
  const g = new Map<number, number>();
  const prev = new Map<number, number>();
  const nodes = graph.nodes;
  const h = (id: number) => {
    if (id === END) return 0;
    const n = id === START ? ps.point : nodes[id]!;
    return Math.hypot(n.x - pe.point.x, n.y - pe.point.y);
  };
  const neighbours = (id: number): { to: number; length: number }[] => {
    if (id === START) {
      return [
        { to: ps.segment.fromNode, length: ps.along },
        { to: ps.segment.toNode, length: ps.segment.length - ps.along },
      ];
    }
    const list: { to: number; length: number }[] = nodes[id]!.edges.slice();
    if (id === pe.segment.fromNode) list.push({ to: END, length: pe.along });
    if (id === pe.segment.toNode) list.push({ to: END, length: pe.segment.length - pe.along });
    return list;
  };

  const heap = new MinHeap();
  g.set(START, 0);
  heap.push(START, h(START));
  const closed = new Set<number>();
  while (heap.size) {
    const { id } = heap.pop();
    if (id === END) break;
    if (closed.has(id)) continue;
    closed.add(id);
    for (const e of neighbours(id)) {
      const cand = g.get(id)! + e.length;
      if (cand < (g.get(e.to) ?? Infinity)) {
        g.set(e.to, cand);
        prev.set(e.to, id);
        heap.push(e.to, cand + h(e.to));
      }
    }
  }
  if (!g.has(END)) return straight;

  const chain: LocalPoint[] = [];
  let cur: number | undefined = prev.get(END);
  while (cur !== undefined && cur !== START) {
    chain.push({ x: nodes[cur]!.x, y: nodes[cur]!.y });
    cur = prev.get(cur);
  }
  chain.reverse();
  const pts = [from, ps.point, ...chain, pe.point, to];
  return { points: pts, length: polylineLength(pts) };
}

export function polylineLength(pts: LocalPoint[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return s;
}

export function routeBetween(graph: RoadGraph, district: DistrictData, a: LatLng, b: LatLng): Route {
  return findRoute(graph, toLocal(a, district.origin), toLocal(b, district.origin));
}
