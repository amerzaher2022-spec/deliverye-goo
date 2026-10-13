// Helpers that place a building beside a road: given a road and a position
// along it, return the building centre, its front entrance and a kerbside
// pickup point. Used by the seed data and by "snap to road" in the dashboard API.

import { district } from '../shared/district';
import { toLatLng, toLocal, type LatLng, type LocalPoint } from '../shared/geo';
import type { BuildingType } from '../shared/types';

export const BUILDING_DEPTH: Record<BuildingType, number> = {
  restaurant: 14,
  shop: 14,
  factory: 42,
  warehouse: 36,
  office: 22,
};

export interface Placement {
  location: LatLng;
  entrance: LatLng;
  pickup: LatLng;
  dropoff: LatLng;
}

function roadLocal(roadId: string): { pts: LocalPoint[]; width: number } {
  const road = district.roads.find((r) => r.id === roadId) ?? district.aliases?.[roadId];
  if (!road) throw new Error(`Unknown road ${roadId}`);
  return { pts: road.coords.map(([lat, lng]) => toLocal({ lat, lng }, district.origin)), width: road.width };
}

/** Point and unit tangent at a fraction (0..1) of the road's length. */
export function pointAlong(roadId: string, fraction: number) {
  const { pts, width } = roadLocal(roadId);
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
  const total = lengths.reduce((a, b) => a + b, 0);
  let target = Math.max(0, Math.min(1, fraction)) * total;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]!;
    if (target <= len || i === lengths.length - 1) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const t = len ? Math.min(1, target / len) : 0;
      const tx = (b.x - a.x) / (len || 1);
      const ty = (b.y - a.y) / (len || 1);
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, tangent: { x: tx, y: ty }, width };
    }
    target -= len;
  }
  throw new Error('unreachable');
}

export function placeBeside(
  roadId: string,
  fraction: number,
  side: 1 | -1,
  buildingType: BuildingType,
  setback = 8,
): Placement {
  const { point, tangent, width } = pointAlong(roadId, fraction);
  const normal = { x: -tangent.y * side, y: tangent.x * side };
  const at = (d: number) => toLatLng({ x: point.x + normal.x * d, y: point.y + normal.y * d }, district.origin);
  const front = width / 2 + setback;
  const depth = BUILDING_DEPTH[buildingType];
  const kerb = at(width / 2 + 3);
  return {
    location: at(front + depth / 2),
    entrance: at(front),
    pickup: kerb,
    dropoff: kerb,
  };
}

/** A kerbside point on a road (used for customer drop-off locations). */
export function kerbPoint(roadId: string, fraction: number, side: 1 | -1): LatLng {
  const { point, tangent, width } = pointAlong(roadId, fraction);
  const normal = { x: -tangent.y * side, y: tangent.x * side };
  return toLatLng({ x: point.x + normal.x * (width / 2 + 3), y: point.y + normal.y * (width / 2 + 3) }, district.origin);
}

export function insideDistrict(p: LatLng): boolean {
  const b = district.bounds;
  return p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;
}
