import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { district } from '../shared/district';
import { toLocal } from '../shared/geo';
import type { Merchant, Mission } from '../shared/types';
import type { Db } from '../server/db';
import { resetDemo } from '../server/seed';
import { placeBeside } from '../server/placement';
import { Client, PNG, setup, teardown } from './helpers';

let app: FastifyInstance;
let db: Db;

beforeAll(async () => {
  ({ app, db } = await setup());
});
afterAll(async () => teardown(app, db));
beforeEach(async () => resetDemo(db, null));

const local = (p: { lat: number; lng: number }) => toLocal(p, district.origin);

function newMerchantBody(categoryId: number, overrides: Record<string, unknown> = {}) {
  const p = placeBeside('sixty-meter', 0.45, -1, 'restaurant');
  return {
    name_ar: 'مطعم الاختبار',
    name_en: 'Test Kitchen',
    category_id: categoryId,
    building_type: 'restaurant',
    location: p.location,
    entrance: p.entrance,
    pickup: p.pickup,
    dropoff: p.dropoff,
    menu: [{ name_ar: 'كباب', name_en: 'Kebab', price_iqd: 9000 }],
    ...overrides,
  };
}

/** Pretend the rider has been travelling for a while (the server refuses impossible speeds). */
async function ageCollection(runId: string, seconds = 600) {
  await db.query(`UPDATE mission_runs SET collected_at = now() - make_interval(secs => $2) WHERE id = $1`, [runId, seconds]);
}

describe('public world', () => {
  it('serves the seeded fictional dataset', async () => {
    const c = new Client(app);
    const r = await c.get('/api/world');
    expect(r.status).toBe(200);
    const w = r.body;
    expect(w.merchants.length).toBeGreaterThanOrEqual(13);
    const byCat = (slug: string) => w.merchants.filter((m: Merchant) => m.category?.slug === slug).length;
    expect(byCat('restaurants')).toBeGreaterThanOrEqual(5);
    expect(byCat('factories') + byCat('industrial')).toBeGreaterThanOrEqual(2);
    expect(byCat('warehouses')).toBeGreaterThanOrEqual(2);
    expect(byCat('offices')).toBeGreaterThanOrEqual(1);
    expect(w.packages.map((p: { slug: string }) => p.slug)).toEqual(['basic', 'featured', 'business']);
    const abuAli = w.merchants.find((m: Merchant) => m.name_en === 'Abu Ali Restaurant');
    expect(abuAli.name_ar).toBe('مطعم أبو علي');
    expect(abuAli.is_fictional).toBe(true);
    expect(abuAli.sponsorship.package_slug).toBe('featured');
    expect(w.merchants.every((m: Merchant) => m.logo_url)).toBe(true);
    // expired and scheduled demo campaigns are not in force
    expect(w.merchants.find((m: Merchant) => m.name_en === 'Citadel View Café').sponsorship).toBeNull();
    expect(w.merchants.find((m: Merchant) => m.name_en === 'Pizza Sixty').sponsorship).toBeNull();
  });

  it('serves logos as images with a sandboxing CSP', async () => {
    const c = new Client(app);
    const w = (await c.get('/api/world')).body;
    const res = await c.get(w.merchants[0].logo_url);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(String(res.headers['content-security-policy'])).toContain('sandbox');
  });
});

describe('admin security', () => {
  it('refuses admin routes without a session', async () => {
    const c = new Client(app);
    expect((await c.get('/api/admin/merchants')).status).toBe(401);
    expect((await c.post('/api/admin/merchants', {})).status).toBe(401);
    expect((await c.post('/api/admin/demo/reset', { confirm: 'RESET' })).status).toBe(401);
  });

  it('rejects a wrong password and accepts the right one', async () => {
    const c = new Client(app);
    const bad = await c.post('/api/admin/login', { email: 'admin@test.local', password: 'nope-nope-nope' });
    expect(bad.status).toBe(401);
    await c.login();
    expect((await c.get('/api/admin/me')).status).toBe(200);
  });

  it('refuses state-changing requests without the client header or from another origin', async () => {
    const c = await new Client(app).login();
    const noHeader = await app.inject({
      method: 'POST',
      url: '/api/admin/categories',
      headers: { cookie: [...c.cookies].map(([k, v]) => `${k}=${v}`).join('; ') },
      payload: {},
    });
    expect(noHeader.statusCode).toBe(403);
    const crossSite = await c.req('POST', '/api/admin/categories', {}, { origin: 'https://evil.example' });
    expect(crossSite.status).toBe(403);
  });

  it('a player session cannot use admin endpoints', async () => {
    const c = new Client(app);
    await c.post('/api/player/session');
    expect((await c.get('/api/admin/merchants')).status).toBe(401);
  });
});

describe('merchant management', () => {
  it('creates a merchant with Arabic/English names and separate entrance and pickup, and it appears in the world', async () => {
    const admin = await new Client(app).login();
    const cats = (await admin.get('/api/admin/categories')).body;
    const before = (await admin.get('/api/world/version')).body.version;
    const body = newMerchantBody(cats[0].id);
    const r = await admin.post('/api/admin/merchants', body);
    expect(r.status).toBe(200);
    const m: Merchant = r.body;
    expect(m.name_ar).toBe('مطعم الاختبار');
    expect(m.name_en).toBe('Test Kitchen');
    expect(m.location.lat).toBeCloseTo(body.location.lat, 9);
    expect(m.entrance.lng).toBeCloseTo(body.entrance.lng, 9);
    expect(m.pickup.lat).toBeCloseTo(body.pickup.lat, 9);
    expect(m.entrance).not.toEqual(m.pickup);
    expect(m.menu).toHaveLength(1);

    const world = (await new Client(app).get('/api/world')).body;
    expect(world.version).toBeGreaterThan(before);
    const inWorld = world.merchants.find((x: Merchant) => x.id === m.id);
    expect(inWorld.name_ar).toBe('مطعم الاختبار');
    expect(inWorld.location).toEqual(m.location);
  });

  it('rejects locations outside the playable district and missing names', async () => {
    const admin = await new Client(app).login();
    const cats = (await admin.get('/api/admin/categories')).body;
    const far = { lat: 36.3, lng: 44.2 };
    const r = await admin.post('/api/admin/merchants', newMerchantBody(cats[0].id, { location: far, entrance: far, pickup: far }));
    expect(r.status).toBe(400);
    expect(r.body.details.map((d: { path: string }) => d.path)).toContain('location');
    const r2 = await admin.post('/api/admin/merchants', newMerchantBody(cats[0].id, { name_ar: '' }));
    expect(r2.status).toBe(400);
  });

  it('uploads and replaces a logo, and rejects non-images and oversized files', async () => {
    const admin = await new Client(app).login();
    const cats = (await admin.get('/api/admin/categories')).body;
    const m: Merchant = (await admin.post('/api/admin/merchants', newMerchantBody(cats[0].id))).body;
    const up1 = await admin.upload(`/api/admin/merchants/${m.id}/images/logo`, 'logo.png', 'image/png', PNG);
    expect(up1.status).toBe(200);
    const url1 = up1.body.logo_url as string;
    const img = await new Client(app).get(url1);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');

    const up2 = await admin.upload(`/api/admin/merchants/${m.id}/images/logo`, 'logo2.png', 'image/png', Buffer.concat([PNG, Buffer.from([0])]));
    expect(up2.status).toBe(200);
    expect(up2.body.logo_url).not.toBe(url1);
    expect((await new Client(app).get(url1)).status).toBe(404); // old file removed

    const svg = await admin.upload(`/api/admin/merchants/${m.id}/images/logo`, 'x.svg', 'image/svg+xml', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    expect(svg.status).toBe(400);
    const fake = await admin.upload(`/api/admin/merchants/${m.id}/images/logo`, 'x.png', 'image/png', Buffer.from('this is not really a png file at all'));
    expect(fake.status).toBe(400);
    const big = await admin.upload(`/api/admin/merchants/${m.id}/images/cover`, 'big.png', 'image/png', Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]));
    expect(big.status).toBe(413);
  });

  it('edits, moves, disables and restores a merchant without losing its record', async () => {
    const admin = await new Client(app).login();
    const list: Merchant[] = (await admin.get('/api/admin/merchants')).body;
    const m = list.find((x) => x.name_en === 'Abu Ali Restaurant')!;
    const moved = placeBeside('sixty-meter', 0.47, -1, 'restaurant');
    const r = await admin.put(`/api/admin/merchants/${m.id}`, {
      ...newMerchantBody(m.category_id),
      name_ar: 'مطعم أبو علي الجديد',
      name_en: 'Abu Ali Grill',
      location: moved.location,
      entrance: moved.entrance,
      pickup: moved.pickup,
      dropoff: moved.dropoff,
    });
    expect(r.status).toBe(200);
    expect(r.body.name_en).toBe('Abu Ali Grill');
    expect(r.body.location.lat).toBeCloseTo(moved.location.lat, 9);

    // missions follow the new pickup point
    const player = new Client(app);
    await player.post('/api/player/session');
    const missions: Mission[] = (await player.get('/api/player/missions')).body;
    const fromAbuAli = missions.filter((x) => x.origin_merchant_id === m.id);
    expect(fromAbuAli.length).toBeGreaterThan(0);
    expect(fromAbuAli[0]!.pickup.lat).toBeCloseTo(moved.pickup.lat, 9);

    expect((await admin.post(`/api/admin/merchants/${m.id}/status`, { status: 'disabled' })).status).toBe(200);
    const world = (await player.get('/api/world')).body;
    expect(world.merchants.some((x: Merchant) => x.id === m.id)).toBe(false);
    const missionsAfter: Mission[] = (await player.get('/api/player/missions')).body;
    expect(missionsAfter.some((x) => x.origin_merchant_id === m.id || x.destination_merchant_id === m.id)).toBe(false);
    expect((await player.get(`/api/merchants/${m.id}`)).status).toBe(404);
    // record kept
    expect((await admin.get(`/api/admin/merchants/${m.id}`)).body.name_en).toBe('Abu Ali Grill');

    expect((await admin.post(`/api/admin/merchants/${m.id}/status`, { status: 'archived' })).status).toBe(200);
    expect((await admin.post(`/api/admin/merchants/${m.id}/status`, { status: 'active' })).status).toBe(200);
    expect((await player.get('/api/world')).body.merchants.some((x: Merchant) => x.id === m.id)).toBe(true);
    const audit = (await admin.get('/api/admin/audit')).body.map((a: { action: string }) => a.action);
    expect(audit).toEqual(expect.arrayContaining(['merchant.move', 'merchant.disable', 'merchant.archive', 'merchant.restore']));
  });

  it('adds categories without code changes', async () => {
    const admin = await new Client(app).login();
    const r = await admin.post('/api/admin/categories', {
      slug: 'flower-shops',
      name_ar: 'محلات زهور',
      name_en: 'Flower shops',
      default_building_type: 'shop',
      color: '#ff66aa',
    });
    expect(r.status).toBe(200);
    const dup = await admin.post('/api/admin/categories', { slug: 'flower-shops', name_ar: 'x', name_en: 'x', default_building_type: 'shop', color: '#ff66aa' });
    expect(dup.status).toBe(409);
    expect((await new Client(app).get('/api/world')).body.categories.some((c: { slug: string }) => c.slug === 'flower-shops')).toBe(true);
  });
});

describe('missions and rewards', () => {
  async function acceptFirst(player: Client, pick: (m: Mission) => boolean = () => true) {
    const missions: Mission[] = (await player.get('/api/player/missions')).body;
    const mission = missions.find(pick)!;
    const r = await player.post(`/api/player/missions/${mission.id}/accept`);
    expect(r.status).toBe(200);
    return { mission, run: r.body.run };
  }

  it('runs the full lifecycle and pays the reward exactly once', async () => {
    const player = new Client(app);
    const start = (await player.post('/api/player/session')).body;
    expect(start.coins).toBe(0);
    const { mission, run } = await acceptFirst(player, (m) => m.time_limit_s === null);
    expect(run.status).toBe('accepted');

    expect((await player.post(`/api/player/runs/${run.id}/advance`, { to: 'going_to_pickup' })).body.run.status).toBe('going_to_pickup');

    // cannot deliver before collecting
    const early = await player.post(`/api/player/runs/${run.id}/deliver`, local(mission.destination));
    expect(early.status).toBe(409);

    // cannot collect from somewhere else on the map
    const p = local(mission.pickup);
    const away = await player.post(`/api/player/runs/${run.id}/collect`, { x: p.x + 60, y: p.y });
    expect(away.status).toBe(400);
    expect(away.body.error).toBe('not_at_pickup');

    const col = await player.post(`/api/player/runs/${run.id}/collect`, { x: p.x + 3, y: p.y - 2 });
    expect(col.status).toBe(200);
    expect(col.body.run.status).toBe('collected');

    const d = local(mission.destination);
    // cannot hand over away from the drop-off
    const wrong = await player.post(`/api/player/runs/${run.id}/deliver`, { x: d.x + 100, y: d.y });
    expect(wrong.body.error).toBe('not_at_dropoff');
    // cannot arrive faster than any vehicle
    const tooFast = await player.post(`/api/player/runs/${run.id}/deliver`, d);
    if (Math.hypot(d.x - p.x, d.y - p.y) > 120) expect(tooFast.body.error).toBe('too_fast');

    await ageCollection(run.id);
    const ok = await player.post(`/api/player/runs/${run.id}/deliver`, d);
    expect(ok.status).toBe(200);
    expect(ok.body.reward.coins).toBe(mission.reward_coins);
    expect(ok.body.player.coins).toBe(mission.reward_coins);
    expect(ok.body.player.deliveries).toBe(1);
    expect(ok.body.newAchievements).toContain('first_delivery');

    const again = await player.post(`/api/player/runs/${run.id}/deliver`, d);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_delivered');
    const me = (await player.get('/api/player')).body;
    expect(me.coins).toBe(mission.reward_coins);
    const { rows } = await db.query('SELECT count(*)::int AS n FROM rewards WHERE run_id = $1', [run.id]);
    expect(rows[0].n).toBe(1);

    const history = (await player.get('/api/player/history')).body;
    expect(history[0].status).toBe('delivered');
  });

  it('pays once even when two deliver requests race', async () => {
    const player = new Client(app);
    await player.post('/api/player/session');
    const { mission, run } = await acceptFirst(player);
    await player.post(`/api/player/runs/${run.id}/collect`, local(mission.pickup));
    await ageCollection(run.id);
    const d = local(mission.destination);
    const results = await Promise.all([1, 2, 3].map(() => player.post(`/api/player/runs/${run.id}/deliver`, d)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const me = (await player.get('/api/player')).body;
    expect(me.coins).toBeLessThanOrEqual(Math.round(mission.reward_coins * 1.25));
    const { rows } = await db.query('SELECT count(*)::int AS n FROM rewards WHERE player_id = $1', [me.id]);
    expect(rows[0].n).toBe(1);
  });

  it('allows only one active mission and supports cancellation', async () => {
    const player = new Client(app);
    await player.post('/api/player/session');
    const { run } = await acceptFirst(player);
    const missions: Mission[] = (await player.get('/api/player/missions')).body;
    const second = await player.post(`/api/player/missions/${missions[1]!.id}/accept`);
    expect(second.status).toBe(409);
    expect((await player.post(`/api/player/runs/${run.id}/cancel`)).body.run.status).toBe('cancelled');
    expect((await player.post(`/api/player/missions/${missions[1]!.id}/accept`)).status).toBe(200);
  });

  it("a player cannot act on someone else's run", async () => {
    const a = new Client(app);
    const b = new Client(app);
    await a.post('/api/player/session');
    await b.post('/api/player/session');
    const { mission, run } = await acceptFirst(a);
    expect((await b.post(`/api/player/runs/${run.id}/collect`, local(mission.pickup))).status).toBe(404);
  });

  it('records analytics events for accept and complete', async () => {
    const player = new Client(app);
    await player.post('/api/player/session');
    const { mission, run } = await acceptFirst(player);
    await player.post(`/api/player/runs/${run.id}/collect`, local(mission.pickup));
    await ageCollection(run.id);
    await player.post(`/api/player/runs/${run.id}/deliver`, local(mission.destination));
    const { rows } = await db.query(
      `SELECT type, count(*)::int AS n FROM analytics_events WHERE NOT is_demo AND merchant_id = $1 GROUP BY type`,
      [mission.origin_merchant_id],
    );
    const counts = Object.fromEntries(rows.map((r) => [r.type, r.n]));
    expect(counts.mission_accept).toBe(1);
    expect(counts.mission_complete).toBe(1);
  });

  it('lets admins create missions to a map point', async () => {
    const admin = await new Client(app).login();
    const merchants: Merchant[] = (await admin.get('/api/admin/merchants')).body;
    const origin = merchants[0]!;
    const r = await admin.post('/api/admin/missions', {
      type: 'document_delivery',
      title_ar: 'مستندات',
      title_en: 'Documents',
      origin_merchant_id: origin.id,
      destination: { lat: district.origin.lat, lng: district.origin.lng },
      destination_label_ar: 'زبون',
      destination_label_en: 'Customer',
      reward_coins: 10,
      reward_xp: 10,
    });
    expect(r.status).toBe(200);
    expect(r.body.est_distance_m).toBeGreaterThan(0);
    const bad = await admin.post('/api/admin/missions', { ...r.body, destination: null, destination_merchant_id: null });
    expect(bad.status).toBe(400);
  });
});

describe('sponsorship packages', () => {
  it('edits package definitions and the game sees them', async () => {
    const admin = await new Client(app).login();
    const pkgs = (await admin.get('/api/admin/packages')).body;
    const featured = pkgs.find((p: { slug: string }) => p.slug === 'featured');
    const r = await admin.put(`/api/admin/packages/${featured.id}`, {
      ...featured,
      name_en: 'Featured Plus',
      price_usd: 35,
      benefits: { ...featured.benefits, signScale: 1.8 },
    });
    expect(r.status).toBe(200);
    const world = (await new Client(app).get('/api/world')).body;
    expect(world.packages.find((p: { slug: string }) => p.slug === 'featured').name_en).toBe('Featured Plus');
    const abuAli = world.merchants.find((m: Merchant) => m.name_en === 'Abu Ali Restaurant');
    expect(abuAli.sponsorship.benefits.signScale).toBe(1.8);
  });

  it('enforces category eligibility and the concurrent location limit; expiry never deletes the business', async () => {
    const admin = await new Client(app).login();
    const pkgs = (await admin.get('/api/admin/packages')).body;
    const business = pkgs.find((p: { slug: string }) => p.slug === 'business');
    const merchants: Merchant[] = (await admin.get('/api/admin/merchants')).body;
    await admin.put(`/api/admin/packages/${business.id}`, { ...business, location_limit: 1 });
    const today = new Date().toISOString().slice(0, 10);
    const r = await admin.post('/api/admin/sponsorships', {
      merchant_id: merchants.find((m) => m.name_en === 'Zagros Electronics')!.id,
      package_id: business.id,
      starts_on: today,
      ends_on: '2099-01-01',
    });
    expect(r.status).toBe(409);
    const cats = (await admin.get('/api/admin/categories')).body;
    const restaurants = cats.find((c: { slug: string }) => c.slug === 'restaurants');
    await admin.put(`/api/admin/packages/${business.id}`, { ...business, location_limit: 0, eligible_category_ids: [restaurants.id] });
    const r2 = await admin.post('/api/admin/sponsorships', {
      merchant_id: merchants.find((m) => m.name_en === 'Zagros Electronics')!.id,
      package_id: business.id,
      starts_on: today,
      ends_on: '2099-01-01',
    });
    expect(r2.status).toBe(400);
    expect(r2.body.error).toBe('not_eligible');

    const sp = (await admin.get('/api/admin/sponsorships')).body.find((s: { merchant_name_en: string; state: string }) => s.merchant_name_en === 'Abu Ali Restaurant' && s.state === 'active');
    await admin.put(`/api/admin/sponsorships/${sp.id}`, { ...sp, starts_on: '2020-01-01', ends_on: '2020-02-01' });
    const world = (await new Client(app).get('/api/world')).body;
    const abuAli = world.merchants.find((m: Merchant) => m.name_en === 'Abu Ali Restaurant');
    expect(abuAli).toBeTruthy();
    expect(abuAli.sponsorship).toBeNull();
  });
});

describe('analytics and demo reset', () => {
  it('labels demo events and can exclude them', async () => {
    const admin = await new Client(app).login();
    const withDemo = (await admin.get('/api/admin/analytics')).body;
    expect(withDemo.demoEvents).toBeGreaterThan(0);
    const real = (await admin.get('/api/admin/analytics?includeDemo=false')).body;
    expect(real.demoEvents).toBe(0);
    expect(real.totalEvents).toBeLessThan(withDemo.totalEvents);
  });

  it('requires the RESET confirmation and restores the seed', async () => {
    const admin = await new Client(app).login();
    const merchants: Merchant[] = (await admin.get('/api/admin/merchants')).body;
    await admin.post(`/api/admin/merchants/${merchants[0]!.id}/status`, { status: 'archived' });
    expect((await admin.post('/api/admin/demo/reset', { confirm: 'yes' })).status).toBe(400);
    expect((await admin.post('/api/admin/demo/reset', { confirm: 'RESET' })).status).toBe(200);
    const after: Merchant[] = (await admin.get('/api/admin/merchants')).body;
    expect(after.every((m) => m.status === 'active')).toBe(true);
    expect(after).toHaveLength(merchants.length);
    // admin still signed in, reset is in the audit log
    expect((await admin.get('/api/admin/audit')).body.some((a: { action: string }) => a.action === 'demo.reset')).toBe(true);
  });
});

describe('daily challenges', () => {
  it('pays a challenge reward once', async () => {
    const player = new Client(app);
    await player.post('/api/player/session');
    const { challenges } = (await player.get('/api/player/challenges')).body;
    expect(challenges).toHaveLength(3);
    // force-complete: satisfy every metric
    const me = (await player.get('/api/player')).body;
    const missions: Mission[] = (await player.get('/api/player/missions')).body;
    for (const m of missions.filter((x) => x.time_limit_s).slice(0, 3)) {
      const r = (await player.post(`/api/player/missions/${m.id}/accept`)).body.run;
      await player.post(`/api/player/runs/${r.id}/collect`, local(m.pickup));
      await db.query(`UPDATE mission_runs SET collected_at = now() - interval '30 seconds' WHERE id = $1`, [r.id]);
      const res = await player.post(`/api/player/runs/${r.id}/deliver`, local(m.destination));
      expect(res.status).toBe(200);
    }
    const merchants: Merchant[] = (await player.get('/api/world')).body.merchants;
    for (const m of merchants.slice(0, 3)) {
      const at = local(m.location);
      await player.post('/api/player/discover', { merchant_id: m.id, x: at.x, y: at.y });
    }
    const list = (await player.get('/api/player/challenges')).body.challenges;
    const done = list.find((c: { progress: number; target: number }) => c.progress >= c.target);
    expect(done).toBeTruthy();
    const coinsBefore = (await player.get('/api/player')).body.coins;
    const claim = await player.post(`/api/player/challenges/${done.code}/claim`);
    expect(claim.status).toBe(200);
    expect(claim.body.player.coins).toBe(coinsBefore + done.reward_coins);
    expect((await player.post(`/api/player/challenges/${done.code}/claim`)).status).toBe(409);
    expect(me.id).toBeTruthy();
  });
});

describe('demo reset protection', () => {
  it('is refused when DEMO_MODE is off', async () => {
    const off = await setup({ demoMode: false });
    try {
      const admin = await new Client(off.app).login();
      const r = await admin.post('/api/admin/demo/reset', { confirm: 'RESET' });
      expect(r.status).toBe(403);
    } finally {
      await teardown(off.app, off.db);
    }
  });
});
