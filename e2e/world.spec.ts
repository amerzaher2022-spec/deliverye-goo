// The living world, checked in a real browser (software GPU, low quality so frames come quickly):
// a crash into a building wall throws the scooter down and the rider is put back on the road; the
// mirrors really render the street behind; night turns on lamps, car lights and lit windows; rain wets
// the road, lowers grip and dries up afterwards.

import { expect, test, type Page } from '@playwright/test';

async function frames(page: Page, n: number) {
  for (let i = 0; i < n; i++) await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(0))));
}

async function startGame(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('dg.settings', JSON.stringify({ quality: 'low', autoQuality: false, controls: 'buttons', camera: 'rider' }));
    localStorage.setItem('dg.lang', 'en');
  });
  await page.goto('/?debug=1');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 120_000 });
  await page.waitForFunction(() => (window as any).__dg);
  await page.getByTestId('start').click();
  for (let i = 0; i < 3; i++) await page.getByTestId('manager-dialog').getByRole('button').click();
}

test('crash into a wall: the scooter goes down and the rider is put back on the road', async ({ page }) => {
  await startGame(page);
  const placed = await page.evaluate(() => {
    const e = (window as any).__dg.engine;
    const v = e.vehicle;
    // a solid wall near the start, approached square on at 45 km/h
    const boxes = e.world.grid.near(v.x, v.y, 300).filter((b: any) => b.enabled !== false && b.z0 === undefined && b.hw > 4);
    boxes.sort((a: any, b: any) => Math.hypot(a.cx - v.x, a.cy - v.y) - Math.hypot(b.cx - v.x, b.cy - v.y));
    const b = boxes[0];
    if (!b) return null;
    const nx = -b.uy;
    const ny = b.ux;
    v.x = b.cx + nx * (b.hd + 2.2);
    v.y = b.cy + ny * (b.hd + 2.2);
    v.z = 0;
    v.heading = Math.atan2(-nx, -ny);
    v.speed = 12.5;
    v.sync();
    return { cx: b.cx, cy: b.cy };
  });
  expect(placed).not.toBeNull();
  // step until the impact (frames are slow on the software GPU)
  for (let i = 0; i < 12; i++) {
    await frames(page, 1);
    if (await page.evaluate(() => (window as any).__dg.engine.vehicle.fallenAt > 0)) break;
  }
  const after = await page.evaluate(() => {
    const v = (window as any).__dg.engine.vehicle;
    return { fellAt: v.fallenAt, engineOn: v.engineOn, speed: Math.abs(v.speed) };
  });
  // it went down, did not pass through the wall, and the engine keeps running
  expect(after.fellAt).toBeGreaterThan(0);
  expect(after.engineOn).toBe(true);
  expect(after.speed).toBeLessThan(6);
  // a moment later the rider is back on the road, upright, engine running
  await expect.poll(() => page.evaluate(() => (window as any).__dg.engine.vehicle.fallen), { timeout: 90_000 }).toBe(false);
  const onRoad = await page.evaluate(() => {
    const e = (window as any).__dg.engine;
    return { fallen: e.vehicle.fallen, edge: e.prevEdge, engineOn: e.vehicle.engineOn };
  });
  expect(onRoad.fallen).toBe(false);
  expect(onRoad.engineOn).toBe(true);
  expect(onRoad.edge).toBeLessThanOrEqual(0);
});

test('mirrors render the street behind', async ({ page }) => {
  await startGame(page);
  await frames(page, 8);
  const stats = await page.evaluate(() => {
    const e = (window as any).__dg.engine;
    const m = e.mirrors.list;
    return m.map((mm: any) => {
      const rt = mm.rt;
      const px = new Uint8Array(rt.width * rt.height * 4);
      e.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, px);
      let sum = 0;
      let sum2 = 0;
      const n = rt.width * rt.height;
      for (let i = 0; i < n; i++) {
        const l = (px[i * 4]! + px[i * 4 + 1]! + px[i * 4 + 2]!) / 3;
        sum += l;
        sum2 += l * l;
      }
      const mean = sum / n;
      return { mean, sd: Math.sqrt(sum2 / n - mean * mean) };
    });
  });
  expect(stats.length).toBe(2);
  for (const s of stats) {
    // a real picture: not empty, not one flat colour
    expect(s.mean).toBeGreaterThan(20);
    expect(s.sd).toBeGreaterThan(8);
  }
});

test('night: street lamps, car lights and windows come on; rain wets the road and dries', async ({ page }) => {
  await startGame(page);
  await page.evaluate(() => {
    const a = (window as any).__dg.engine.atmos;
    a.set({ hour: 22, autoTime: false, weather: 'clear', autoWeather: false });
    a.settle();
  });
  await frames(page, 3);
  const night = await page.evaluate(() => {
    const e = (window as any).__dg.engine;
    const facadeUniforms = (window as any).__dg.facade;
    return {
      night: e.atmos.night,
      pools: e.nightLights.poolMat.opacity,
      carLights: e.traffic.carLights?.visible ?? false,
      sun: e.sun.intensity,
      windows: facadeUniforms.uNight.value,
    };
  });
  expect(night.night).toBeGreaterThan(0.9);
  expect(night.pools).toBeGreaterThan(0.3);
  expect(night.carLights).toBe(true);
  expect(night.sun).toBeLessThan(0.5);
  expect(night.windows).toBeGreaterThan(0.9);

  await page.evaluate(() => {
    const a = (window as any).__dg.engine.atmos;
    a.set({ hour: 13, weather: 'storm' });
    a.settle();
  });
  await frames(page, 3);
  const rain = await page.evaluate(() => {
    const e = (window as any).__dg.engine;
    return { rainVisible: e.atmos.rainMesh.visible, wet: e.atmos.wet, grip: e.atmos.gripFactor(), fogFar: e.scene.fog.far };
  });
  expect(rain.rainVisible).toBe(true);
  expect(rain.wet).toBe(1);
  expect(rain.grip).toBeLessThan(0.75);
  expect(rain.fogFar).toBeLessThan(260);

  // after the rain stops the road dries over (game) time
  const dry = await page.evaluate(() => {
    const e = (window as any).__dg.engine;
    const a = e.atmos;
    a.set({ weather: 'clear' });
    const cam = e.camera.position;
    for (let i = 0; i < 10; i++) a.step(5, cam);
    const mid = a.wet;
    for (let i = 0; i < 400; i++) a.step(5, cam);
    return { mid, end: a.wet, grip: a.gripFactor() };
  });
  expect(dry.mid).toBeLessThan(1);
  expect(dry.mid).toBeGreaterThan(0);
  expect(dry.end).toBe(0);
  expect(dry.grip).toBeGreaterThan(0.95);
});
