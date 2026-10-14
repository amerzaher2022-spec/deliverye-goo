// The sun follows Erbil's real path: it rises in the east around 6, stands highest at noon in the south
// and sets in the west around 18 (mid October); at midnight it is below the horizon.
import { describe, expect, it } from 'vitest';
import { sunDirection } from '../web/src/game/atmosphere';

const OCT_14 = 287;
const deg = (r: number) => (r * 180) / Math.PI;

describe('sun path over Erbil', () => {
  it('is highest at noon, due south, about 44 degrees up in mid October', () => {
    const s = sunDirection(12, OCT_14);
    expect(deg(Math.asin(s.y))).toBeGreaterThan(40);
    expect(deg(Math.asin(s.y))).toBeLessThan(48);
    // south is +z in scene space (north is -z)
    expect(s.z).toBeGreaterThan(0.6);
    expect(Math.abs(s.x)).toBeLessThan(0.01);
  });
  it('rises in the east and sets in the west', () => {
    const morning = sunDirection(6.5, OCT_14);
    const evening = sunDirection(17.5, OCT_14);
    expect(morning.y).toBeGreaterThan(0);
    expect(morning.x).toBeGreaterThan(0.5);
    expect(evening.y).toBeGreaterThan(0);
    expect(evening.x).toBeLessThan(-0.5);
    expect(sunDirection(5.5, OCT_14).y).toBeLessThan(0);
    expect(sunDirection(18.5, OCT_14).y).toBeLessThan(0);
  });
  it('is below the horizon at midnight and higher in summer than in winter', () => {
    expect(sunDirection(0, OCT_14).y).toBeLessThan(-0.5);
    expect(sunDirection(12, 172).y).toBeGreaterThan(sunDirection(12, 355).y);
  });
});
