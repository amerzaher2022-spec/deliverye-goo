// Phone-sized checks (iPhone 13 viewport, touch). Real-device testing is still
// required: this runs Chromium with device emulation and a software GPU.

import { expect, test } from '@playwright/test';

test('game menu, touch controls and throttle on a phone screen', async ({ page }) => {
  await page.goto('/?debug=1');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('vehicle-card')).toBeVisible();
  await page.getByTestId('start').tap();
  // tutorial
  for (let i = 0; i < 3; i++) await page.getByTestId('manager-dialog').getByRole('button').tap();
  const gas = page.getByRole('button', { name: 'throttle' });
  await expect(gas).toBeVisible();
  await expect(page.getByRole('button', { name: /يسار|Steer left/ })).toBeVisible();
  // hold the throttle (pointer events, as a finger would)
  const box = (await gas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(async () => Number(await page.getByTestId('speed').textContent()), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.mouse.up();
  // nothing overflows the screen horizontally
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByTestId('open-board').tap();
  await expect(page.locator('[data-testid^=mission-]').first()).toBeVisible();
});

test('dashboard is usable on a phone', async ({ page }) => {
  await page.goto('/admin');
  await page.getByTestId('login-email').fill('admin@e2e.local');
  await page.getByTestId('login-password').fill('e2e-password-123456');
  await page.getByTestId('login-submit').tap();
  await expect(page.getByTestId('map-manager')).toBeVisible();
  await expect(page.getByTestId('leaflet-map')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
