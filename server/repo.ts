// Reads that turn database rows into the shared DTOs. The game, the public API
// and the dashboard all go through these, so they always show the same data.

import type {
  ActiveSponsorship,
  Category,
  Merchant,
  MerchantStatus,
  Mission,
  SponsorshipPackage,
} from '../shared/types';
import type { Queryable } from './db';

export const imageUrl = (id: string | null | undefined) => (id ? `/api/images/${id}` : null);

/** Today's date in Erbil (UTC+3) as a SQL expression. */
export const TODAY_SQL = `(now() AT TIME ZONE 'Asia/Baghdad')::date`;

export async function bumpWorld(q: Queryable) {
  await q.query(
    `INSERT INTO app_state(key, value) VALUES ('world_version', to_jsonb((extract(epoch FROM clock_timestamp()) * 1000)::bigint))
     ON CONFLICT (key) DO UPDATE SET value = to_jsonb(GREATEST((app_state.value)::bigint + 1, (extract(epoch FROM clock_timestamp()) * 1000)::bigint))`,
  );
}

export async function worldVersion(q: Queryable): Promise<number> {
  const { rows } = await q.query(`SELECT value FROM app_state WHERE key = 'world_version'`);
  return rows[0] ? Number(rows[0].value) : 0;
}

export async function listCategories(q: Queryable, includeArchived = false): Promise<Category[]> {
  const { rows } = await q.query(
    `SELECT id, slug, name_ar, name_en, default_building_type, color, sort, archived FROM categories
      ${includeArchived ? '' : 'WHERE NOT archived'} ORDER BY sort, id`,
  );
  return rows;
}

function packageRow(r: Record<string, unknown>): SponsorshipPackage {
  return {
    id: r.id as number,
    slug: r.slug as string,
    name_ar: r.name_ar as string,
    name_en: r.name_en as string,
    description_ar: r.description_ar as string,
    description_en: r.description_en as string,
    price_usd: Number(r.price_usd),
    period: r.period as string,
    features: r.features as SponsorshipPackage['features'],
    benefits: r.benefits as SponsorshipPackage['benefits'],
    location_limit: r.location_limit as number,
    featured_limit: r.featured_limit as number,
    eligible_category_ids: (r.eligible_category_ids as number[]) ?? [],
    default_duration_days: r.default_duration_days as number,
    active: r.active as boolean,
    sort: r.sort as number,
  };
}

export async function listPackages(q: Queryable, onlyActive = false): Promise<SponsorshipPackage[]> {
  const { rows } = await q.query(`SELECT * FROM packages ${onlyActive ? 'WHERE active' : ''} ORDER BY sort, id`);
  return rows.map(packageRow);
}

export async function getPackage(q: Queryable, id: number) {
  const { rows } = await q.query('SELECT * FROM packages WHERE id = $1', [id]);
  return rows[0] ? packageRow(rows[0]) : null;
}

// The sponsorship in force today for a merchant: active status, inside its
// dates, on an active package. If several overlap the most premium wins.
const ACTIVE_SPONSORSHIP_JOIN = `
  LEFT JOIN LATERAL (
    SELECT s.id, s.package_id, s.starts_on, s.ends_on, p.slug AS package_slug, p.name_ar AS package_name_ar,
           p.name_en AS package_name_en, p.benefits
      FROM sponsorships s JOIN packages p ON p.id = s.package_id
     WHERE s.merchant_id = m.id AND s.status = 'active' AND p.active
       AND s.starts_on <= ${TODAY_SQL} AND s.ends_on >= ${TODAY_SQL}
     ORDER BY p.sort DESC, s.ends_on DESC
     LIMIT 1
  ) sp ON true`;

const MERCHANT_SELECT = `
  SELECT m.*, c.slug AS cat_slug, c.name_ar AS cat_name_ar, c.name_en AS cat_name_en, c.color AS cat_color,
         sp.id AS sp_id, sp.package_id AS sp_package_id, sp.starts_on AS sp_starts_on, sp.ends_on AS sp_ends_on,
         sp.package_slug AS sp_package_slug, sp.package_name_ar AS sp_package_name_ar,
         sp.package_name_en AS sp_package_name_en, sp.benefits AS sp_benefits
    FROM merchants m
    JOIN categories c ON c.id = m.category_id
    ${ACTIVE_SPONSORSHIP_JOIN}`;

function merchantRow(r: Record<string, any>, includeNotes: boolean): Merchant {
  const sponsorship: ActiveSponsorship | null = r.sp_id
    ? {
        id: r.sp_id,
        package_id: r.sp_package_id,
        package_slug: r.sp_package_slug,
        package_name_ar: r.sp_package_name_ar,
        package_name_en: r.sp_package_name_en,
        starts_on: r.sp_starts_on,
        ends_on: r.sp_ends_on,
        benefits: r.sp_benefits,
      }
    : null;
  return {
    id: r.id,
    code: r.code,
    name_ar: r.name_ar,
    name_en: r.name_en,
    category_id: r.category_id,
    category: { slug: r.cat_slug, name_ar: r.cat_name_ar, name_en: r.cat_name_en, color: r.cat_color },
    description_ar: r.description_ar,
    description_en: r.description_en,
    address_ar: r.address_ar,
    address_en: r.address_en,
    location: { lat: r.lat, lng: r.lng },
    entrance: { lat: r.entrance_lat, lng: r.entrance_lng },
    pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
    dropoff: { lat: r.dropoff_lat, lng: r.dropoff_lng },
    building_type: r.building_type,
    sign_size: r.sign_size,
    sign_position: r.sign_position,
    brand_color: r.brand_color,
    logo_url: imageUrl(r.logo_image_id),
    cover_url: imageUrl(r.cover_image_id),
    gallery: [],
    hours: r.hours,
    phone: r.phone,
    website: r.website,
    status: r.status,
    interior_enabled: r.interior_enabled,
    is_fictional: r.is_fictional,
    ...(includeNotes ? { notes: r.notes } : {}),
    menu: [],
    sponsorship,
    updated_at: new Date(r.updated_at).toISOString(),
  };
}

async function attachChildren(q: Queryable, merchants: Merchant[]) {
  if (!merchants.length) return merchants;
  const ids = merchants.map((m) => m.id);
  const byId = new Map(merchants.map((m) => [m.id, m]));
  const menu = await q.query(
    `SELECT id, merchant_id, name_ar, name_en, description_ar, description_en, price_iqd, sort
       FROM menu_items WHERE merchant_id = ANY($1) ORDER BY sort, id`,
    [ids],
  );
  for (const row of menu.rows) {
    const { merchant_id, ...item } = row;
    byId.get(merchant_id)!.menu.push(item);
  }
  const gallery = await q.query(
    `SELECT merchant_id, image_id FROM merchant_gallery WHERE merchant_id = ANY($1) ORDER BY sort, image_id`,
    [ids],
  );
  for (const row of gallery.rows) byId.get(row.merchant_id)!.gallery.push({ id: row.image_id, url: imageUrl(row.image_id)! });
  return merchants;
}

export async function listMerchants(
  q: Queryable,
  opts: { statuses?: MerchantStatus[]; includeNotes?: boolean } = {},
): Promise<Merchant[]> {
  const statuses = opts.statuses ?? ['active'];
  const { rows } = await q.query(`${MERCHANT_SELECT} WHERE m.status = ANY($1) ORDER BY m.id`, [statuses]);
  return attachChildren(
    q,
    rows.map((r) => merchantRow(r, !!opts.includeNotes)),
  );
}

export async function getMerchant(q: Queryable, id: number, opts: { includeNotes?: boolean; activeOnly?: boolean } = {}) {
  const { rows } = await q.query(
    `${MERCHANT_SELECT} WHERE m.id = $1 ${opts.activeOnly ? `AND m.status = 'active'` : ''}`,
    [id],
  );
  if (!rows[0]) return null;
  const [m] = await attachChildren(q, [merchantRow(rows[0], !!opts.includeNotes)]);
  return m!;
}

const MISSION_SELECT = `
  SELECT j.*, o.pickup_lat AS o_pickup_lat, o.pickup_lng AS o_pickup_lng, o.status AS o_status,
         d.dropoff_lat AS d_dropoff_lat, d.dropoff_lng AS d_dropoff_lng, d.status AS d_status,
         d.name_ar AS d_name_ar, d.name_en AS d_name_en
    FROM missions j
    JOIN merchants o ON o.id = j.origin_merchant_id
    LEFT JOIN merchants d ON d.id = j.destination_merchant_id`;

function missionRow(r: Record<string, any>, estimate: (m: Mission) => number): Mission {
  const destination = r.destination_merchant_id
    ? { lat: r.d_dropoff_lat, lng: r.d_dropoff_lng }
    : { lat: r.destination_lat, lng: r.destination_lng };
  const m: Mission = {
    id: r.id,
    code: r.code,
    type: r.type,
    title_ar: r.title_ar,
    title_en: r.title_en,
    origin_merchant_id: r.origin_merchant_id,
    destination_merchant_id: r.destination_merchant_id,
    destination,
    destination_label_ar: r.destination_merchant_id ? r.d_name_ar : r.destination_label_ar,
    destination_label_en: r.destination_merchant_id ? r.d_name_en : r.destination_label_en,
    pickup: { lat: r.o_pickup_lat, lng: r.o_pickup_lng },
    package_ar: r.package_ar,
    package_en: r.package_en,
    est_distance_m: 0,
    time_limit_s: r.time_limit_s,
    reward_coins: r.reward_coins,
    reward_xp: r.reward_xp,
    branded: r.branded,
    active: r.active,
  };
  m.est_distance_m = Math.round(estimate(m));
  return m;
}

/**
 * Missions a player can take: active mission, active origin merchant and, for
 * merchant destinations, an active destination merchant.
 */
export async function listMissions(
  q: Queryable,
  estimate: (m: Mission) => number,
  opts: { playable?: boolean; originId?: number } = {},
): Promise<Mission[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.playable) {
    where.push(`j.active AND o.status = 'active' AND (j.destination_merchant_id IS NULL OR d.status = 'active')`);
  }
  if (opts.originId) {
    params.push(opts.originId);
    where.push(`j.origin_merchant_id = $${params.length}`);
  }
  const { rows } = await q.query(
    `${MISSION_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY j.id`,
    params,
  );
  return rows.map((r) => missionRow(r, estimate));
}

export async function getMission(q: Queryable, id: number, estimate: (m: Mission) => number, playable = false) {
  const { rows } = await q.query(
    `${MISSION_SELECT} WHERE j.id = $1 ${
      playable ? `AND j.active AND o.status = 'active' AND (j.destination_merchant_id IS NULL OR d.status = 'active')` : ''
    }`,
    [id],
  );
  return rows[0] ? missionRow(rows[0], estimate) : null;
}

export async function audit(
  q: Queryable,
  adminId: number | null,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: unknown = {},
) {
  await q.query(`INSERT INTO audit_log(admin_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)`, [
    adminId,
    action,
    entity,
    entityId === null ? null : String(entityId),
    JSON.stringify(details),
  ]);
}
