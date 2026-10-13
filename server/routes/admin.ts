import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { district } from '../../shared/district';
import { haversine } from '../../shared/geo';
import {
  BUILDING_TYPES,
  MERCHANT_STATUSES,
  MISSION_TYPES,
  SIGN_POSITIONS,
  SIGN_SIZES,
  type Merchant,
} from '../../shared/types';
import type { AppContext } from '../app';
import { adminForToken, createAdminSession, deleteAdminSession, sha256, verifyPassword, ADMIN_SESSION_DAYS } from '../auth';
import { withTx, type Queryable } from '../db';
import { HttpError, badRequest, conflict, forbidden, notFound, unauthorized } from '../errors';
import { insideDistrict } from '../placement';
import {
  TODAY_SQL,
  audit,
  bumpWorld,
  getMerchant,
  getMission,
  getPackage,
  listCategories,
  listMerchants,
  listMissions,
  listPackages,
} from '../repo';
import { resetDemo } from '../seed';

const COOKIE = 'dg_admin';

type Admin = { id: number; email: string; name: string };

declare module 'fastify' {
  interface FastifyRequest {
    admin?: Admin;
  }
}

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const point = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const text = (max: number) => z.string().trim().max(max);
const idParam = z.object({ id: z.coerce.number().int().positive() });

const menuItem = z.object({
  name_ar: text(120).min(1),
  name_en: text(120).min(1),
  description_ar: text(300).default(''),
  description_en: text(300).default(''),
  price_iqd: z.number().int().min(0).max(100_000_000).nullable().default(null),
});

const merchantInput = z.object({
  name_ar: text(120).min(1, 'Arabic name is required'),
  name_en: text(120).min(1, 'English name is required'),
  category_id: z.number().int().positive(),
  description_ar: text(2000).default(''),
  description_en: text(2000).default(''),
  address_ar: text(300).default(''),
  address_en: text(300).default(''),
  location: point,
  entrance: point,
  pickup: point,
  dropoff: point.optional(),
  building_type: z.enum(BUILDING_TYPES),
  sign_size: z.enum(SIGN_SIZES).default('medium'),
  sign_position: z.enum(SIGN_POSITIONS).default('front'),
  brand_color: hex.default('#1d4ed8'),
  hours: z.object({ open: hhmm, close: hhmm, days: text(60).default('') }).nullable().default(null),
  phone: text(40).default(''),
  website: text(200)
    .default('')
    .refine((v) => v === '' || /^https?:\/\//.test(v), 'Website must start with http:// or https://'),
  interior_enabled: z.boolean().default(false),
  notes: text(4000).default(''),
  menu: z.array(menuItem).max(60).default([]),
});
type MerchantInput = z.infer<typeof merchantInput>;

function checkGeometry(m: MerchantInput) {
  const issues: { path: string; message: string }[] = [];
  const pts = { location: m.location, entrance: m.entrance, pickup: m.pickup, dropoff: m.dropoff ?? m.pickup };
  for (const [k, p] of Object.entries(pts)) {
    if (!insideDistrict(p)) issues.push({ path: k, message: 'Outside the playable district' });
  }
  if (haversine(m.location, m.entrance) > 90) issues.push({ path: 'entrance', message: 'Entrance must be within 90 m of the building' });
  if (haversine(m.location, m.pickup) > 150) issues.push({ path: 'pickup', message: 'Pickup point must be within 150 m of the building' });
  if (haversine(m.location, pts.dropoff) > 150) issues.push({ path: 'dropoff', message: 'Drop-off point must be within 150 m of the building' });
  if (issues.length) throw badRequest('validation', 'Some locations are invalid', issues);
}

const ALLOWED_IMAGE_TYPES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

function imageSize(mime: string, b: Buffer): { width: number; height: number } | null {
  try {
    if (mime === 'image/png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < b.length) {
        if (b[i] !== 0xff) return null;
        const marker = b[i + 1]!;
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    return null;
  }
  return null;
}

const missionInput = z
  .object({
    type: z.enum(MISSION_TYPES),
    title_ar: text(160).min(1),
    title_en: text(160).min(1),
    origin_merchant_id: z.number().int().positive(),
    destination_merchant_id: z.number().int().positive().nullable().default(null),
    destination: point.nullable().default(null),
    destination_label_ar: text(160).default(''),
    destination_label_en: text(160).default(''),
    package_ar: text(300).default(''),
    package_en: text(300).default(''),
    time_limit_s: z.number().int().min(30).max(3600).nullable().default(null),
    reward_coins: z.number().int().min(0).max(10_000),
    reward_xp: z.number().int().min(0).max(10_000),
    branded: z.boolean().default(false),
    active: z.boolean().default(true),
  })
  .refine((m) => m.destination_merchant_id !== null || m.destination !== null, {
    message: 'Choose a destination business or a point on the map',
    path: ['destination'],
  })
  .refine((m) => m.destination_merchant_id !== m.origin_merchant_id, {
    message: 'Destination must differ from the origin',
    path: ['destination_merchant_id'],
  });

const benefitsSchema = z.object({
  highlightMarker: z.boolean(),
  featuredCard: z.boolean(),
  enhancedSignage: z.boolean(),
  brandedMissions: z.boolean(),
  loadingZoneBranding: z.boolean(),
  districtSponsor: z.boolean(),
  analyticsLevel: z.enum(['basic', 'expanded']),
  signScale: z.number().min(0.5).max(2.5),
});

const packageInput = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'Lowercase letters, digits and dashes'),
  name_ar: text(120).min(1),
  name_en: text(120).min(1),
  description_ar: text(1000).default(''),
  description_en: text(1000).default(''),
  price_usd: z.number().min(0).max(100_000),
  period: z.enum(['month', 'quarter', 'year', 'campaign']).default('month'),
  features: z.array(z.object({ ar: text(200).min(1), en: text(200).min(1) })).max(30),
  benefits: benefitsSchema,
  location_limit: z.number().int().min(0).max(1000),
  featured_limit: z.number().int().min(0).max(1000),
  eligible_category_ids: z.array(z.number().int().positive()).max(100).default([]),
  default_duration_days: z.number().int().min(1).max(3650).default(30),
  active: z.boolean().default(true),
  sort: z.number().int().min(0).max(1000).default(0),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const sponsorshipInput = z
  .object({
    merchant_id: z.number().int().positive(),
    package_id: z.number().int().positive(),
    starts_on: isoDate,
    ends_on: isoDate,
    status: z.enum(['active', 'paused', 'cancelled']).default('active'),
    notes: text(1000).default(''),
  })
  .refine((s) => s.ends_on >= s.starts_on, { message: 'End date must be on or after the start date', path: ['ends_on'] });

const categoryInput = z.object({
  slug: z.string().trim().regex(/^[a-z0-9-]{2,40}$/, 'Lowercase letters, digits and dashes'),
  name_ar: text(120).min(1),
  name_en: text(120).min(1),
  default_building_type: z.enum(BUILDING_TYPES),
  color: hex,
  sort: z.number().int().min(0).max(1000).default(0),
  archived: z.boolean().default(false),
});

const SPONSORSHIP_STATE_SQL = `CASE WHEN s.status <> 'active' THEN s.status
  WHEN s.ends_on < ${TODAY_SQL} THEN 'expired'
  WHEN s.starts_on > ${TODAY_SQL} THEN 'scheduled' ELSE 'active' END`;

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;

  const cookieOpts = {
    path: '/api/admin',
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.production,
    maxAge: ADMIN_SESSION_DAYS * 24 * 3600,
  };

  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (req.url.startsWith('/api/admin/login')) return;
    const admin = await adminForToken(db, req.cookies[COOKIE]);
    if (!admin) throw unauthorized();
    req.admin = admin;
  });

  const adminId = (req: FastifyRequest) => req.admin!.id;

  app.post('/login', async (req, reply) => {
    const body = z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }).parse(req.body);
    const key = `${req.ip}`;
    if (!ctx.loginLimiter.allow(key)) {
      throw new HttpError(429, 'rate_limited', 'Too many attempts. Try again in a few minutes.');
    }
    const { rows } = await db.query('SELECT id, email, name, password_hash FROM admin_users WHERE email = $1', [body.email]);
    const ok = rows[0] ? await verifyPassword(body.password, rows[0].password_hash) : false;
    if (!ok) throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
    ctx.loginLimiter.reset(key);
    const token = await createAdminSession(db, rows[0].id);
    await audit(db, rows[0].id, 'admin.login', 'admin', rows[0].id);
    reply.setCookie(COOKIE, token, cookieOpts);
    return { id: rows[0].id, email: rows[0].email, name: rows[0].name, demoMode: config.demoMode };
  });

  app.post('/logout', async (req, reply) => {
    const token = req.cookies[COOKIE];
    if (token) await deleteAdminSession(db, token);
    reply.clearCookie(COOKIE, { path: '/api/admin' });
    return { ok: true };
  });

  app.get('/me', async (req) => ({ ...req.admin!, demoMode: config.demoMode }));

  app.get('/overview', async () => {
    const { rows } = await db.query(`SELECT
      (SELECT count(*) FROM merchants WHERE status = 'active') AS active_merchants,
      (SELECT count(*) FROM merchants WHERE status = 'disabled') AS disabled_merchants,
      (SELECT count(*) FROM merchants WHERE status = 'archived') AS archived_merchants,
      (SELECT count(*) FROM missions WHERE active) AS active_missions,
      (SELECT count(*) FROM players) AS players,
      (SELECT count(*) FROM mission_runs WHERE status = 'delivered') AS deliveries,
      (SELECT count(*) FROM sponsorships s WHERE ${SPONSORSHIP_STATE_SQL} = 'active') AS active_sponsorships`);
    return rows[0];
  });

  // ---- categories --------------------------------------------------------
  app.get('/categories', async () => listCategories(db, true));

  app.post('/categories', async (req) => {
    const c = categoryInput.parse(req.body);
    return withTx(db, async (tx) => {
      const { rows } = await tx
        .query(
          `INSERT INTO categories(slug, name_ar, name_en, default_building_type, color, sort, archived) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [c.slug, c.name_ar, c.name_en, c.default_building_type, c.color, c.sort, c.archived],
        )
        .catch(uniqueToConflict('A category with this slug already exists'));
      await audit(tx, adminId(req), 'category.create', 'category', rows[0].id, c);
      await bumpWorld(tx);
      return rows[0];
    });
  });

  app.put('/categories/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const c = categoryInput.parse(req.body);
    return withTx(db, async (tx) => {
      const { rows } = await tx
        .query(
          `UPDATE categories SET slug=$2, name_ar=$3, name_en=$4, default_building_type=$5, color=$6, sort=$7, archived=$8 WHERE id=$1 RETURNING *`,
          [id, c.slug, c.name_ar, c.name_en, c.default_building_type, c.color, c.sort, c.archived],
        )
        .catch(uniqueToConflict('A category with this slug already exists'));
      if (!rows[0]) throw notFound('Category not found');
      await audit(tx, adminId(req), 'category.update', 'category', id, c);
      await bumpWorld(tx);
      return rows[0];
    });
  });

  // ---- merchants ---------------------------------------------------------
  app.get('/merchants', async (req) => {
    const { status } = z.object({ status: z.enum([...MERCHANT_STATUSES, 'all']).default('all') }).parse(req.query);
    return listMerchants(db, { statuses: status === 'all' ? [...MERCHANT_STATUSES] : [status], includeNotes: true });
  });

  app.get('/merchants/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const m = await getMerchant(db, id, { includeNotes: true });
    if (!m) throw notFound('Merchant not found');
    return m;
  });

  async function writeMenu(tx: Queryable, merchantId: number, menu: MerchantInput['menu']) {
    await tx.query('DELETE FROM menu_items WHERE merchant_id = $1', [merchantId]);
    for (const [i, item] of menu.entries()) {
      await tx.query(
        `INSERT INTO menu_items(merchant_id, name_ar, name_en, description_ar, description_en, price_iqd, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [merchantId, item.name_ar, item.name_en, item.description_ar, item.description_en, item.price_iqd, i],
      );
    }
  }

  async function assertCategory(q: Queryable, id: number) {
    const { rowCount } = await q.query('SELECT 1 FROM categories WHERE id = $1 AND NOT archived', [id]);
    if (!rowCount) throw badRequest('validation', 'Choose an existing category', [{ path: 'category_id', message: 'Unknown category' }]);
  }

  app.post('/merchants', async (req) => {
    const m = merchantInput.parse(req.body);
    checkGeometry(m);
    const dropoff = m.dropoff ?? m.pickup;
    return withTx(db, async (tx) => {
      await assertCategory(tx, m.category_id);
      const { rows: seq } = await tx.query(`SELECT COALESCE(max(id), 0) + 1 AS n FROM merchants`);
      const code = `M-${String(seq[0].n).padStart(4, '0')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const { rows } = await tx.query(
        `INSERT INTO merchants(code, name_ar, name_en, category_id, description_ar, description_en, address_ar, address_en,
           lat, lng, entrance_lat, entrance_lng, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, building_type, sign_size,
           sign_position, brand_color, hours, phone, website, interior_enabled, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
        [
          code, m.name_ar, m.name_en, m.category_id, m.description_ar, m.description_en, m.address_ar, m.address_en,
          m.location.lat, m.location.lng, m.entrance.lat, m.entrance.lng, m.pickup.lat, m.pickup.lng, dropoff.lat, dropoff.lng,
          m.building_type, m.sign_size, m.sign_position, m.brand_color, m.hours ? JSON.stringify(m.hours) : null,
          m.phone, m.website, m.interior_enabled, m.notes,
        ],
      );
      const id = rows[0].id as number;
      await writeMenu(tx, id, m.menu);
      await audit(tx, adminId(req), 'merchant.create', 'merchant', id, { name_en: m.name_en, location: m.location });
      await bumpWorld(tx);
      return getMerchant(tx, id, { includeNotes: true });
    });
  });

  app.put('/merchants/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const m = merchantInput.parse(req.body);
    checkGeometry(m);
    const dropoff = m.dropoff ?? m.pickup;
    return withTx(db, async (tx) => {
      await assertCategory(tx, m.category_id);
      const before = await getMerchant(tx, id, { includeNotes: true });
      if (!before) throw notFound('Merchant not found');
      await tx.query(
        `UPDATE merchants SET name_ar=$2, name_en=$3, category_id=$4, description_ar=$5, description_en=$6, address_ar=$7, address_en=$8,
           lat=$9, lng=$10, entrance_lat=$11, entrance_lng=$12, pickup_lat=$13, pickup_lng=$14, dropoff_lat=$15, dropoff_lng=$16,
           building_type=$17, sign_size=$18, sign_position=$19, brand_color=$20, hours=$21, phone=$22, website=$23,
           interior_enabled=$24, notes=$25, updated_at=now()
         WHERE id=$1`,
        [
          id, m.name_ar, m.name_en, m.category_id, m.description_ar, m.description_en, m.address_ar, m.address_en,
          m.location.lat, m.location.lng, m.entrance.lat, m.entrance.lng, m.pickup.lat, m.pickup.lng, dropoff.lat, dropoff.lng,
          m.building_type, m.sign_size, m.sign_position, m.brand_color, m.hours ? JSON.stringify(m.hours) : null,
          m.phone, m.website, m.interior_enabled, m.notes,
        ],
      );
      await writeMenu(tx, id, m.menu);
      const moved = haversine(before.location, m.location) > 0.5;
      await audit(tx, adminId(req), moved ? 'merchant.move' : 'merchant.update', 'merchant', id, {
        name_en: m.name_en,
        ...(moved ? { from: before.location, to: m.location } : {}),
      });
      await bumpWorld(tx);
      return getMerchant(tx, id, { includeNotes: true });
    });
  });

  app.post('/merchants/:id/status', async (req) => {
    const { id } = idParam.parse(req.params);
    const { status } = z.object({ status: z.enum(MERCHANT_STATUSES) }).parse(req.body);
    return withTx(db, async (tx) => {
      const { rows } = await tx.query(`UPDATE merchants SET status=$2, updated_at=now() WHERE id=$1 RETURNING id`, [id, status]);
      if (!rows[0]) throw notFound('Merchant not found');
      await audit(tx, adminId(req), `merchant.${status === 'active' ? 'restore' : status === 'disabled' ? 'disable' : 'archive'}`, 'merchant', id);
      await bumpWorld(tx);
      return getMerchant(tx, id, { includeNotes: true });
    });
  });

  app.post('/merchants/:id/images/:kind', async (req) => {
    const { id, kind } = z.object({ id: z.coerce.number().int().positive(), kind: z.enum(['logo', 'cover', 'gallery']) }).parse(req.params);
    const file = await req.file();
    if (!file) throw badRequest('no_file', 'Attach an image file');
    const buf = await file.toBuffer();
    if (file.file.truncated) throw new HttpError(413, 'too_large', 'File is larger than the upload limit');
    if (buf.length < 16) throw badRequest('bad_image', 'The file is empty or too small');
    const type = ALLOWED_IMAGE_TYPES.find((t) => t.test(buf));
    if (!type) throw badRequest('bad_image', 'Only PNG, JPEG or WebP images are accepted');
    const dims = imageSize(type.mime, buf);
    if (dims && (dims.width > 6000 || dims.height > 6000)) throw badRequest('bad_image', 'Image dimensions are too large (max 6000 px)');

    return withTx(db, async (tx) => {
      const exists = await tx.query('SELECT logo_image_id, cover_image_id FROM merchants WHERE id = $1 FOR UPDATE', [id]);
      if (!exists.rows[0]) throw notFound('Merchant not found');
      const { rows } = await tx.query(
        'INSERT INTO images(mime, bytes, size, sha256, width, height) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [type.mime, buf, buf.length, sha256(buf), dims?.width ?? null, dims?.height ?? null],
      );
      const imageId = rows[0].id as string;
      if (kind === 'gallery') {
        const { rows: c } = await tx.query('SELECT count(*) AS n FROM merchant_gallery WHERE merchant_id = $1', [id]);
        if (Number(c[0].n) >= 12) throw badRequest('gallery_full', 'A gallery holds at most 12 images');
        await tx.query('INSERT INTO merchant_gallery(merchant_id, image_id, sort) VALUES ($1,$2,$3)', [id, imageId, Number(c[0].n)]);
      } else {
        const col = kind === 'logo' ? 'logo_image_id' : 'cover_image_id';
        const old = exists.rows[0][col] as string | null;
        await tx.query(`UPDATE merchants SET ${col} = $2, updated_at = now() WHERE id = $1`, [id, imageId]);
        if (old) await tx.query('DELETE FROM images WHERE id = $1', [old]);
      }
      await tx.query('UPDATE merchants SET updated_at = now() WHERE id = $1', [id]);
      await audit(tx, adminId(req), `merchant.image.${kind}`, 'merchant', id, { image: imageId, bytes: buf.length, mime: type.mime });
      await bumpWorld(tx);
      return getMerchant(tx, id, { includeNotes: true });
    });
  });

  app.delete('/merchants/:id/gallery/:imageId', async (req) => {
    const { id, imageId } = z.object({ id: z.coerce.number().int().positive(), imageId: z.uuid() }).parse(req.params);
    return withTx(db, async (tx) => {
      const { rowCount } = await tx.query('DELETE FROM merchant_gallery WHERE merchant_id = $1 AND image_id = $2', [id, imageId]);
      if (!rowCount) throw notFound('Image not found');
      await tx.query('DELETE FROM images WHERE id = $1', [imageId]);
      await tx.query('UPDATE merchants SET updated_at = now() WHERE id = $1', [id]);
      await audit(tx, adminId(req), 'merchant.image.remove', 'merchant', id, { image: imageId });
      await bumpWorld(tx);
      return getMerchant(tx, id, { includeNotes: true });
    });
  });

  // ---- missions ----------------------------------------------------------
  app.get('/missions', async () => {
    const missions = await listMissions(db, ctx.estimate);
    const { rows } = await db.query(
      `SELECT mission_id, count(*) FILTER (WHERE status = 'delivered') AS delivered,
              count(*) FILTER (WHERE status = ANY('{accepted,going_to_pickup,collected,going_to_destination}')) AS in_progress
         FROM mission_runs GROUP BY mission_id`,
    );
    const stats = new Map(rows.map((r) => [r.mission_id as number, r]));
    return missions.map((m) => ({ ...m, delivered: Number(stats.get(m.id)?.delivered ?? 0), in_progress: Number(stats.get(m.id)?.in_progress ?? 0) }));
  });

  async function validateMissionRefs(q: Queryable, m: z.infer<typeof missionInput>) {
    const ids = [m.origin_merchant_id, ...(m.destination_merchant_id ? [m.destination_merchant_id] : [])];
    const { rows } = await q.query('SELECT id FROM merchants WHERE id = ANY($1)', [ids]);
    if (rows.length !== ids.length) throw badRequest('validation', 'Unknown business in origin or destination');
    if (!m.destination_merchant_id && m.destination && !insideDistrict(m.destination)) {
      throw badRequest('validation', 'Destination is outside the playable district', [{ path: 'destination', message: 'Outside the playable district' }]);
    }
  }

  const missionParams = (m: z.infer<typeof missionInput>) => [
    m.type, m.title_ar, m.title_en, m.origin_merchant_id, m.destination_merchant_id,
    m.destination_merchant_id ? null : m.destination!.lat, m.destination_merchant_id ? null : m.destination!.lng,
    m.destination_label_ar, m.destination_label_en, m.package_ar, m.package_en, m.time_limit_s,
    m.reward_coins, m.reward_xp, m.branded, m.active,
  ];

  app.post('/missions', async (req) => {
    const m = missionInput.parse(req.body);
    return withTx(db, async (tx) => {
      await validateMissionRefs(tx, m);
      const { rows: seq } = await tx.query(`SELECT COALESCE(max(id), 0) + 1 AS n FROM missions`);
      const code = `J-${String(seq[0].n).padStart(3, '0')}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
      const { rows } = await tx.query(
        `INSERT INTO missions(type, title_ar, title_en, origin_merchant_id, destination_merchant_id, destination_lat, destination_lng,
           destination_label_ar, destination_label_en, package_ar, package_en, time_limit_s, reward_coins, reward_xp, branded, active, code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [...missionParams(m), code],
      );
      await audit(tx, adminId(req), 'mission.create', 'mission', rows[0].id, { title_en: m.title_en });
      await bumpWorld(tx);
      return getMission(tx, rows[0].id, ctx.estimate);
    });
  });

  app.put('/missions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const m = missionInput.parse(req.body);
    return withTx(db, async (tx) => {
      await validateMissionRefs(tx, m);
      const { rowCount } = await tx.query(
        `UPDATE missions SET type=$1, title_ar=$2, title_en=$3, origin_merchant_id=$4, destination_merchant_id=$5, destination_lat=$6,
           destination_lng=$7, destination_label_ar=$8, destination_label_en=$9, package_ar=$10, package_en=$11, time_limit_s=$12,
           reward_coins=$13, reward_xp=$14, branded=$15, active=$16, updated_at=now() WHERE id=$17`,
        [...missionParams(m), id],
      );
      if (!rowCount) throw notFound('Mission not found');
      await audit(tx, adminId(req), 'mission.update', 'mission', id, { title_en: m.title_en, active: m.active });
      await bumpWorld(tx);
      return getMission(tx, id, ctx.estimate);
    });
  });

  // ---- packages ----------------------------------------------------------
  app.get('/packages', async () => listPackages(db));

  app.post('/packages', async (req) => {
    const p = packageInput.parse(req.body);
    return withTx(db, async (tx) => {
      const { rows } = await tx
        .query(
          `INSERT INTO packages(slug, name_ar, name_en, description_ar, description_en, price_usd, period, features, benefits,
             location_limit, featured_limit, eligible_category_ids, default_duration_days, active, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
          [p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.price_usd, p.period, JSON.stringify(p.features),
           JSON.stringify(p.benefits), p.location_limit, p.featured_limit, p.eligible_category_ids, p.default_duration_days, p.active, p.sort],
        )
        .catch(uniqueToConflict('A package with this slug already exists'));
      await audit(tx, adminId(req), 'package.create', 'package', rows[0].id, { name_en: p.name_en, price_usd: p.price_usd });
      await bumpWorld(tx);
      return getPackage(tx, rows[0].id);
    });
  });

  app.put('/packages/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const p = packageInput.parse(req.body);
    return withTx(db, async (tx) => {
      const { rowCount } = await tx
        .query(
          `UPDATE packages SET slug=$2, name_ar=$3, name_en=$4, description_ar=$5, description_en=$6, price_usd=$7, period=$8, features=$9,
             benefits=$10, location_limit=$11, featured_limit=$12, eligible_category_ids=$13, default_duration_days=$14, active=$15, sort=$16
           WHERE id=$1`,
          [id, p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.price_usd, p.period, JSON.stringify(p.features),
           JSON.stringify(p.benefits), p.location_limit, p.featured_limit, p.eligible_category_ids, p.default_duration_days, p.active, p.sort],
        )
        .catch(uniqueToConflict('A package with this slug already exists'));
      if (!rowCount) throw notFound('Package not found');
      await audit(tx, adminId(req), 'package.update', 'package', id, { name_en: p.name_en, price_usd: p.price_usd, active: p.active });
      await bumpWorld(tx);
      return getPackage(tx, id);
    });
  });

  // ---- sponsorships ------------------------------------------------------
  const SPONSORSHIP_LIST = `
    SELECT s.*, ${SPONSORSHIP_STATE_SQL} AS state, m.name_ar AS merchant_name_ar, m.name_en AS merchant_name_en,
           m.status AS merchant_status, p.name_ar AS package_name_ar, p.name_en AS package_name_en, p.price_usd
      FROM sponsorships s JOIN merchants m ON m.id = s.merchant_id JOIN packages p ON p.id = s.package_id`;

  app.get('/sponsorships', async () => {
    const { rows } = await db.query(`${SPONSORSHIP_LIST} ORDER BY s.ends_on DESC, s.id DESC`);
    return rows;
  });

  async function validateSponsorship(q: Queryable, s: z.infer<typeof sponsorshipInput>, selfId: number | null) {
    const pkg = await getPackage(q, s.package_id);
    if (!pkg) throw badRequest('validation', 'Unknown package');
    const { rows } = await q.query('SELECT category_id FROM merchants WHERE id = $1', [s.merchant_id]);
    if (!rows[0]) throw badRequest('validation', 'Unknown business');
    if (pkg.eligible_category_ids.length && !pkg.eligible_category_ids.includes(rows[0].category_id)) {
      throw badRequest('not_eligible', 'This package is not available for this business category');
    }
    if (pkg.location_limit > 0 && s.status === 'active') {
      const { rows: c } = await q.query(
        `SELECT count(DISTINCT merchant_id) AS n FROM sponsorships
          WHERE package_id = $1 AND status = 'active' AND id <> COALESCE($2, -1) AND merchant_id <> $3
            AND starts_on <= $5::date AND ends_on >= $4::date`,
        [s.package_id, selfId, s.merchant_id, s.starts_on, s.ends_on],
      );
      if (Number(c[0].n) >= pkg.location_limit) {
        throw conflict('limit_reached', `This package allows ${pkg.location_limit} sponsored locations at the same time`);
      }
    }
  }

  app.post('/sponsorships', async (req) => {
    const s = sponsorshipInput.parse(req.body);
    return withTx(db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(727276)');
      await validateSponsorship(tx, s, null);
      const { rows } = await tx.query(
        `INSERT INTO sponsorships(merchant_id, package_id, starts_on, ends_on, status, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [s.merchant_id, s.package_id, s.starts_on, s.ends_on, s.status, s.notes],
      );
      await audit(tx, adminId(req), 'sponsorship.create', 'sponsorship', rows[0].id, s);
      await bumpWorld(tx);
      return (await tx.query(`${SPONSORSHIP_LIST} WHERE s.id = $1`, [rows[0].id])).rows[0];
    });
  });

  app.put('/sponsorships/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const s = sponsorshipInput.parse(req.body);
    return withTx(db, async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock(727276)');
      await validateSponsorship(tx, s, id);
      const { rowCount } = await tx.query(
        `UPDATE sponsorships SET merchant_id=$2, package_id=$3, starts_on=$4, ends_on=$5, status=$6, notes=$7 WHERE id=$1`,
        [id, s.merchant_id, s.package_id, s.starts_on, s.ends_on, s.status, s.notes],
      );
      if (!rowCount) throw notFound('Sponsorship not found');
      await audit(tx, adminId(req), 'sponsorship.update', 'sponsorship', id, s);
      await bumpWorld(tx);
      return (await tx.query(`${SPONSORSHIP_LIST} WHERE s.id = $1`, [id])).rows[0];
    });
  });

  // ---- analytics ---------------------------------------------------------
  app.get('/analytics', async (req) => {
    const q = z
      .object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        includeDemo: z.enum(['true', 'false']).default('true'),
      })
      .parse(req.query);
    const to = q.to ?? new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
    const from = q.from ?? new Date(Date.parse(to) - 13 * 86400_000).toISOString().slice(0, 10);
    if (from > to) throw badRequest('validation', 'Start date must be before end date');
    const includeDemo = q.includeDemo === 'true';
    const range = `(e.created_at AT TIME ZONE 'Asia/Baghdad')::date BETWEEN $1::date AND $2::date ${includeDemo ? '' : 'AND NOT e.is_demo'}`;

    const [perMerchant, series, totals, demoCount] = await Promise.all([
      db.query(
        `SELECT m.id, m.code, m.name_ar, m.name_en, m.status, c.name_ar AS category_ar, c.name_en AS category_en,
                count(*) FILTER (WHERE e.type = 'profile_view') AS profile_view,
                count(*) FILTER (WHERE e.type = 'map_discovery') AS map_discovery,
                count(*) FILTER (WHERE e.type = 'mission_offer') AS mission_offer,
                count(*) FILTER (WHERE e.type = 'mission_accept') AS mission_accept,
                count(*) FILTER (WHERE e.type = 'mission_complete') AS mission_complete,
                count(*) FILTER (WHERE e.is_demo) AS demo_events,
                count(e.id) AS all_events
           FROM merchants m JOIN categories c ON c.id = m.category_id
           LEFT JOIN analytics_events e ON e.merchant_id = m.id AND ${range}
          GROUP BY m.id, c.name_ar, c.name_en ORDER BY count(e.id) DESC, m.id`,
        [from, to],
      ),
      db.query(
        `SELECT to_char((e.created_at AT TIME ZONE 'Asia/Baghdad')::date, 'YYYY-MM-DD') AS day, e.type, count(*) AS n
           FROM analytics_events e WHERE ${range} GROUP BY 1, 2 ORDER BY 1`,
        [from, to],
      ),
      db.query(`SELECT e.type, count(*) AS n FROM analytics_events e WHERE ${range} GROUP BY e.type`, [from, to]),
      db.query(`SELECT count(*) FILTER (WHERE e.is_demo) AS demo, count(*) AS total FROM analytics_events e WHERE ${range}`, [from, to]),
    ]);

    const sponsorships = await db.query(
      `SELECT DISTINCT ON (s.merchant_id) s.merchant_id, ${SPONSORSHIP_STATE_SQL} AS state, s.starts_on, s.ends_on,
              p.name_ar AS package_name_ar, p.name_en AS package_name_en, p.benefits->>'analyticsLevel' AS analytics_level
         FROM sponsorships s JOIN packages p ON p.id = s.package_id
        ORDER BY s.merchant_id, (${SPONSORSHIP_STATE_SQL} = 'active') DESC, s.ends_on DESC`,
    );
    const spByMerchant = new Map(sponsorships.rows.map((r) => [r.merchant_id as number, r]));
    const activeSponsored = sponsorships.rows.filter((r) => r.state === 'active').length;

    return {
      from,
      to,
      includeDemo,
      totals: Object.fromEntries(totals.rows.map((r) => [r.type, Number(r.n)])),
      demoEvents: Number(demoCount.rows[0].demo),
      totalEvents: Number(demoCount.rows[0].total),
      activeSponsoredLocations: activeSponsored,
      series: series.rows.map((r) => ({ day: r.day, type: r.type, n: Number(r.n) })),
      merchants: perMerchant.rows.map((r) => ({
        ...r,
        profile_view: Number(r.profile_view),
        map_discovery: Number(r.map_discovery),
        mission_offer: Number(r.mission_offer),
        mission_accept: Number(r.mission_accept),
        mission_complete: Number(r.mission_complete),
        demo_events: Number(r.demo_events),
        all_events: Number(r.all_events),
        sponsorship: spByMerchant.get(r.id) ?? null,
      })),
    };
  });

  app.get('/audit', async () => {
    const { rows } = await db.query(
      `SELECT l.id, l.action, l.entity, l.entity_id, l.details, l.created_at, a.email AS admin_email
         FROM audit_log l LEFT JOIN admin_users a ON a.id = l.admin_id ORDER BY l.id DESC LIMIT 200`,
    );
    return rows;
  });

  // ---- demo reset --------------------------------------------------------
  app.get('/demo', async () => ({ enabled: config.demoMode }));

  app.post('/demo/reset', async (req) => {
    if (!config.demoMode) throw forbidden('Demo reset is disabled on this deployment (DEMO_MODE is off)');
    const { confirm } = z.object({ confirm: z.string() }).parse(req.body);
    if (confirm !== 'RESET') throw badRequest('confirm', 'Type RESET to confirm');
    await resetDemo(db, adminId(req));
    return { ok: true };
  });
}

function uniqueToConflict(message: string) {
  return (err: { code?: string }) => {
    if (err.code === '23505') throw conflict('duplicate', message);
    throw err;
  };
}

export type { Merchant };
