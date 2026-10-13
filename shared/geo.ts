// One coordinate system for everything: the admin map stores latitude/longitude,
// the game works in metres on a local tangent plane centred on the district origin.
// Both sides call these functions, so a saved merchant position always lands on
// the same spot in the 3D world.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Local plane position in metres: x grows east, y grows north. */
export interface LocalPoint {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

/** Metres per degree of latitude at the given latitude (WGS84 series). */
export function metresPerDegLat(lat: number): number {
  const p = lat * DEG;
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p);
}

/** Metres per degree of longitude at the given latitude (WGS84 series). */
export function metresPerDegLng(lat: number): number {
  const p = lat * DEG;
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p);
}

export function toLocal(point: LatLng, origin: LatLng): LocalPoint {
  return {
    x: (point.lng - origin.lng) * metresPerDegLng(origin.lat),
    y: (point.lat - origin.lat) * metresPerDegLat(origin.lat),
  };
}

export function toLatLng(point: LocalPoint, origin: LatLng): LatLng {
  return {
    lat: origin.lat + point.y / metresPerDegLat(origin.lat),
    lng: origin.lng + point.x / metresPerDegLng(origin.lat),
  };
}

export function localDistance(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const R = 6371008.8;
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}
