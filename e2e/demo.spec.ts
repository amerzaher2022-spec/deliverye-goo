// The investor demo, end to end, in a real browser: dashboard -> map -> new
// business with logo -> mission -> game -> pickup -> delivery -> reward ->
// live rename/logo change -> warehouse -> package edit -> analytics -> disable
// -> demo reset.
//
// Driving across the district is replaced by the debug teleport (`?debug=1`):
// the headless browser renders with a software GPU at a few frames per second.
// The server still checks that the player stands in the pickup/drop-off zone.

import { expect, test, type Page } from '@playwright/test';
import { placeBeside } from '../server/placement';

const ADMIN = { email: 'admin@e2e.local', password: 'e2e-password-123456' };

async function adminLogin(page: Page) {
  await page.goto('/admin');
  await page.getByTestId('login-email').fill(ADMIN.email);
  await page.getByTestId('login-password').fill(ADMIN.password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('tab-map')).toBeVisible();
}

async function clickMapAt(page: Page, lat: number, lng: number) {
  await page.evaluate(([la, ln]) => (window as any).__dgMap.setView([la, ln], 18, { animate: false }), [lat, lng]);
  await page.waitForTimeout(800);
  const pt = await page.evaluate(([la, ln]) => {
    const p = (window as any).__dgMap.latLngToContainerPoint([la, ln]);
    return { x: p.x, y: p.y };
  }, [lat, lng]);
  const box = (await page.getByTestId('leaflet-map').boundingBox())!;
  await page.mouse.click(box.x + pt.x, box.y + pt.y);
}

async function addBusinessOnMap(
  page: Page,
  opts: { lat: number; lng: number; ar: string; en: string; category?: string; building?: string; logo: string; menu?: [string, string, number] },
) {
  await page.getByTestId('tab-map').click();
  await page.getByTestId('add-merchant').click();
  const editor = page.getByTestId('merchant-editor');
  // the map can still be settling right after the view jumps (slow CI machines): click again if the
  // editor did not open
  for (let attempt = 0; attempt < 3 && !(await editor.isVisible()); attempt++) {
    await clickMapAt(page, opts.lat, opts.lng);
    await editor.waitFor({ state: 'visible', timeout: 6000 }).catch(() => undefined);
  }
  await expect(editor).toBeVisible();
  await page.getByTestId('f-name_ar').fill(opts.ar);
  await page.getByTestId('f-name_en').fill(opts.en);
  if (opts.category) await page.getByTestId('f-category').selectOption({ label: opts.category });
  if (opts.building) await page.getByTestId('f-building').selectOption(opts.building);
  await page.getByTestId('upload-logo').setInputFiles(opts.logo);
  if (opts.menu) {
    await page.getByTestId('menu-add').click();
    await page.getByTestId('menu-ar-0').fill(opts.menu[0]);
    await page.getByTestId('menu-en-0').fill(opts.menu[1]);
    await page.getByTestId('menu-price-0').fill(String(opts.menu[2]));
  }
  await page.getByTestId('save-merchant').click();
  await expect(page.getByTestId('selected-merchant')).toContainText(opts.ar);
  const id = await page.evaluate(async (en) => {
    const r = await fetch('/api/admin/merchants?status=all');
    const list = await r.json();
    return list.find((m: { name_en: string }) => m.name_en === en).id as number;
  }, opts.en);
  return id;
}

test('investor demo: dashboard to delivery and back', async ({ page, context }) => {
  // 1-2. dashboard + map search
  await adminLogin(page);
  await page.getByTestId('map-search').fill('الستين');
  await page.getByTestId('map-search').press('Enter');
  await expect(page.getByTestId('search-results')).toContainText('شارع الستين');
  await page.getByTestId('search-results').locator('button').first().click();

  // 3-8. add a restaurant on Sixty Meter Street with names, logo, menu and points
  const spot = placeBeside('sixty-meter', 0.435, -1, 'restaurant').location;
  const grillId = await addBusinessOnMap(page, {
    lat: spot.lat,
    lng: spot.lng,
    ar: 'مشويات الشمال',
    en: 'North Grill',
    logo: 'e2e/fixtures/logo-north-grill.png',
    menu: ['تكة لحم', 'Lamb tikka', 11000],
  });
  const grill = await page.evaluate(async (id) => (await fetch(`/api/admin/merchants/${id}`)).json(), grillId);
  expect(grill.name_ar).toBe('مشويات الشمال');
  expect(grill.logo_url).toMatch(/^\/api\/images\//);
  expect(grill.entrance).not.toEqual(grill.pickup);
  expect(grill.menu[0].price_iqd).toBe(11000);

  // a delivery job from the new restaurant to Abu Ali
  await page.getByTestId('tab-missions').click();
  await page.getByTestId('new-mission').click();
  await page.getByTestId('m-title_ar').fill('طلب من مشويات الشمال');
  await page.getByTestId('m-title_en').fill('Order from North Grill');
  await page.getByTestId('m-origin').selectOption(String(grillId));
  await page.getByTestId('m-dest').selectOption({ label: 'مطعم أبو علي' });
  await page.getByTestId('m-coins').fill('77');
  await page.getByTestId('save-mission').click();
  await expect(page.locator('table')).toContainText('طلب من مشويات الشمال');

  // 9-14. open the game at the new business and check its card
  // (low graphics: the CI browser renders with a software GPU)
  await context.addInitScript(() => localStorage.setItem('dg.settings', JSON.stringify({ quality: 'low', autoQuality: false })));
  const game = await context.newPage();
  await game.goto(`/?debug=1&focus=${grillId}`);
  await game.getByTestId('start').click();
  await expect(game.getByTestId('merchant-card')).toBeVisible();
  await expect(game.getByTestId('merchant-card')).toContainText('مشويات الشمال');
  await expect(game.getByTestId('merchant-logo')).toHaveAttribute('src', grill.logo_url);
  // the building exists in the 3D world at the saved coordinates
  const inWorld = await game.evaluate((id) => {
    const e = (window as any).__dg.engine;
    const v = e.merchants.get(id);
    return v ? { name: v.merchant.name_en, x: v.frame.centre.x, y: v.frame.centre.y } : null;
  }, grillId);
  expect(inWorld?.name).toBe('North Grill');

  // 15-17. accept, collect at the pickup, deliver at Abu Ali
  await game.getByText('Lamb tikka').or(game.getByText('تكة لحم')).first().waitFor();
  await game.getByTestId('card-accept').click();
  await expect(game.getByTestId('mission-pill')).toHaveAttribute('data-status', 'going_to_pickup');
  await game.getByTestId('manager-dialog').getByRole('button').click();
  await game.evaluate((id) => (window as any).__dg.goToMerchant(id, 0), grillId);
  await game.getByTestId('collect').click();
  await expect(game.getByTestId('mission-pill')).toHaveAttribute('data-status', 'going_to_destination');
  await game.getByTestId('manager-dialog').getByRole('button').click();
  const abuAliId = await game.evaluate(async () => {
    const w = await (await fetch('/api/world')).json();
    return w.merchants.find((m: { name_en: string }) => m.name_en === 'Abu Ali Restaurant').id as number;
  });
  await game.evaluate((id) => {
    const e = (window as any).__dg.engine;
    e.teleport(e.merchantFrame(id).dropoff);
  }, abuAliId);
  await game.waitForTimeout(3500); // the server refuses deliveries faster than any vehicle
  await game.getByTestId('deliver').click();
  await expect(game.getByTestId('delivery-result')).toContainText('77');
  await game.getByTestId('result-continue').click();
  await expect(game.getByTestId('stats')).toContainText('77');

  // 18-20. rename + new logo in the dashboard; the running game picks it up
  await page.getByTestId('tab-map').click();
  await page.locator('.merchant-list button', { hasText: 'مشويات الشمال' }).click();
  await page.getByTestId('edit-merchant').click();
  await page.getByTestId('f-name_en').fill('North Grill Express');
  await page.getByTestId('f-name_ar').fill('مشويات الشمال السريعة');
  await page.getByTestId('upload-logo').setInputFiles('e2e/fixtures/logo-north-grill-v2.png');
  await expect(page.getByTestId('editor-message')).toContainText(/uploaded|رفع/);
  await page.getByTestId('save-merchant').click();
  await expect(page.getByTestId('selected-merchant')).toContainText('مشويات الشمال السريعة');
  await expect
    .poll(() => game.evaluate((id) => (window as any).__dg.engine.merchants.get(id)?.merchant.name_en, grillId), { timeout: 30_000 })
    .toBe('North Grill Express');

  // 21. a warehouse through the same workflow
  const wh = placeBeside('industrial-1', 0.2, 1, 'warehouse', 10).location;
  const whId = await addBusinessOnMap(page, {
    lat: wh.lat,
    lng: wh.lng,
    ar: 'مستودعات سفين',
    en: 'Safeen Warehousing',
    category: 'مستودعات',
    building: 'warehouse',
    logo: 'e2e/fixtures/logo-warehouse.png',
  });
  await expect
    .poll(() => game.evaluate((id) => (window as any).__dg.engine.merchants.get(id)?.merchant.building_type, whId), { timeout: 30_000 })
    .toBe('warehouse');

  // 22. package configuration
  await page.getByTestId('tab-packages').click();
  await page.getByTestId('edit-package-featured').click();
  await page.getByTestId('p-price').fill('32');
  await page.getByTestId('save-package').click();
  await expect(page.getByTestId('package-featured')).toContainText('$32');

  // 23. analytics: real (non-demo) events from this run are counted
  await page.getByTestId('tab-analytics').click();
  await expect(page.getByTestId('demo-label')).toBeVisible();
  await page.getByTestId('include-demo').uncheck();
  await expect(page.getByTestId('analytics-table')).toContainText('مشويات الشمال السريعة');
  const real = await page.evaluate(async () => (await (await fetch('/api/admin/analytics?includeDemo=false')).json()).totals);
  expect(real.mission_accept).toBeGreaterThanOrEqual(1);
  expect(real.mission_complete).toBeGreaterThanOrEqual(1);

  // disabling removes the building from the game without deleting the record
  await page.evaluate((id) => fetch(`/api/admin/merchants/${id}/status`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-dg-client': '1' }, body: JSON.stringify({ status: 'disabled' }) }), whId);
  await expect.poll(() => game.evaluate((id) => (window as any).__dg.engine.merchants.has(id), whId), { timeout: 30_000 }).toBe(false);

  // 24. reset the demo
  await page.getByTestId('tab-demo').click();
  await page.getByTestId('reset-confirm').fill('RESET');
  await page.getByTestId('reset-demo').click();
  await expect(page.locator('.a-alert.ok')).toBeVisible();
  const names = await page.evaluate(async () => (await (await fetch('/api/admin/merchants?status=all')).json()).map((m: { name_en: string }) => m.name_en));
  expect(names).not.toContain('North Grill Express');
  expect(names).toContain('Abu Ali Restaurant');
});

test('English interface keeps working and the admin API refuses anonymous writes', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('lang-toggle').click();
  await expect(page.getByTestId('main-menu')).toContainText('Sawa Erbil');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/admin/merchants', { method: 'POST', headers: { 'content-type': 'application/json', 'x-dg-client': '1' }, body: '{}' });
    return r.status;
  });
  expect(status).toBe(401);
});
