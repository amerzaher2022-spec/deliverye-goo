import { describe, expect, it } from 'vitest';
import { district } from '../shared/district';
import { haversine, toLatLng, toLocal } from '../shared/geo';
import { buildRoadGraph, distanceToRoadEdge, findRoute } from '../shared/roads';
import { canTransition, dailyChallenges, levelForXp, xpForLevel } from '../shared/rules';

const graph = buildRoadGraph(district);

describe('coordinate transform', () => {
  it('round-trips lat/lng through the game plane', () => {
    const p = { lat: 36.1949, lng: 43.9843 };
    const back = toLatLng(toLocal(p, district.origin), district.origin);
    expect(back.lat).toBeCloseTo(p.lat, 10);
    expect(back.lng).toBeCloseTo(p.lng, 10);
  });

  it('local distances match great-circle distances inside the district', () => {
    const a = { lat: district.bounds.south, lng: district.bounds.west };
    const b = { lat: district.bounds.north, lng: district.bounds.east };
    const la = toLocal(a, district.origin);
    const lb = toLocal(b, district.origin);
    const local = Math.hypot(la.x - lb.x, la.y - lb.y);
    expect(Math.abs(local - haversine(a, b)) / haversine(a, b)).toBeLessThan(0.002);
  });
});

describe('road network', () => {
  it('connects every road into one network', () => {
    const seen = new Set<number>([0]);
    const queue = [0];
    while (queue.length) for (const e of graph.nodes[queue.pop()!]!.edges) if (!seen.has(e.to)) seen.add(e.to), queue.push(e.to);
    expect(seen.size).toBe(graph.nodes.length);
  });

  it('routes along streets, never shorter than the straight line', () => {
    const a = toLocal({ lat: district.landmarks[0]!.lat, lng: district.landmarks[0]!.lng }, district.origin);
    const last = district.landmarks[district.landmarks.length - 1]!;
    const b = toLocal({ lat: last.lat, lng: last.lng }, district.origin);
    const route = findRoute(graph, a, b);
    expect(route.length).toBeGreaterThanOrEqual(Math.hypot(a.x - b.x, a.y - b.y) - 0.01);
    for (const p of route.points.slice(1, -1)) expect(distanceToRoadEdge(graph, p)).toBeLessThanOrEqual(0.5);
  });
});

describe('rules', () => {
  it('only allows forward mission transitions', () => {
    expect(canTransition('accepted', 'going_to_pickup')).toBe(true);
    expect(canTransition('going_to_pickup', 'delivered')).toBe(false);
    expect(canTransition('delivered', 'delivered')).toBe(false);
    expect(canTransition('cancelled', 'collected')).toBe(false);
  });

  it('levels and daily challenges are deterministic', () => {
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(xpForLevel(3))).toBe(3);
    expect(dailyChallenges('2026-10-13')).toEqual(dailyChallenges('2026-10-13'));
    expect(dailyChallenges('2026-10-13')).toHaveLength(3);
  });
});
