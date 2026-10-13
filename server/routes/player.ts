import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { district } from '../../shared/district';
import { toLocal } from '../../shared/geo';
import {
  ACTIVE_RUN_STATUSES,
  DISCOVERY_RADIUS_M,
  DROPOFF_RADIUS_M,
  MAX_GAME_SPEED_MS,
  ON_TIME_BONUS,
  PICKUP_RADIUS_M,
  canTransition,
  dailyChallenges,
  erbilDay,
  levelForXp,
  unlockedVehicles,
  xpForLevel,
} from '../../shared/rules';
import { VEHICLES, type MissionRun, type PlayerProfile, type RunStatus, type VehicleId } from '../../shared/types';
import type { AppContext } from '../app';
import { newToken, sha256 } from '../auth';
import { withTx, type Queryable, type Tx } from '../db';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../errors';
import { getMission, listMissions } from '../repo';

const COOKIE = 'dg_player';

interface PlayerRow {
  id: string;
  display_name: string;
  xp: number;
  level: number;
  coins: number;
  deliveries: number;
  vehicle: VehicleId;
}

const RUN_COLUMNS = `id, mission_id, status, accepted_at, collected_at, delivered_at, cancelled_at, deadline_at,
  reward_coins, reward_xp, bonus_coins, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, est_distance_m`;

function runDto(r: Record<string, any>): MissionRun {
  const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
  return {
    id: r.id,
    mission_id: r.mission_id,
    status: r.status,
    accepted_at: iso(r.accepted_at)!,
    collected_at: iso(r.collected_at),
    delivered_at: iso(r.delivered_at),
    cancelled_at: iso(r.cancelled_at),
    deadline_at: iso(r.deadline_at),
    reward_coins: r.reward_coins,
    reward_xp: r.reward_xp,
    bonus_coins: r.bonus_coins,
  };
}

const position = z.object({ x: z.number().finite(), y: z.number().finite() });

export async function playerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, config } = ctx;
  const estimate = ctx.estimate;

  const cookieOpts = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.production,
    maxAge: 365 * 24 * 3600,
  };

  async function currentPlayer(req: FastifyRequest, q: Queryable = db, lock = false): Promise<PlayerRow> {
    const token = req.cookies[COOKIE];
    if (!token) throw unauthorized();
    const { rows } = await q.query(
      `SELECT id, display_name, xp, level, coins, deliveries, vehicle FROM players WHERE token_hash = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [sha256(token)],
    );
    if (!rows[0]) throw unauthorized();
    return rows[0];
  }

  async function profile(q: Queryable, p: PlayerRow): Promise<PlayerProfile> {
    const [ach, active] = await Promise.all([
      q.query('SELECT code, unlocked_at FROM player_achievements WHERE player_id = $1 ORDER BY unlocked_at', [p.id]),
      q.query(`SELECT ${RUN_COLUMNS} FROM mission_runs WHERE player_id = $1 AND status = ANY($2)`, [p.id, ACTIVE_RUN_STATUSES]),
    ]);
    let activeRun: MissionRun | null = null;
    if (active.rows[0]) {
      activeRun = runDto(active.rows[0]);
      const mission = await getMission(q, activeRun.mission_id, estimate);
      if (mission) {
        // the run keeps the points it was accepted with
        mission.pickup = { lat: active.rows[0].pickup_lat, lng: active.rows[0].pickup_lng };
        mission.destination = { lat: active.rows[0].dropoff_lat, lng: active.rows[0].dropoff_lng };
        mission.est_distance_m = active.rows[0].est_distance_m;
        activeRun.mission = mission;
      }
    }
    const level = levelForXp(p.xp);
    return {
      id: p.id,
      display_name: p.display_name,
      level,
      xp: p.xp,
      xp_level_start: xpForLevel(level),
      xp_for_next: xpForLevel(level + 1),
      coins: p.coins,
      deliveries: p.deliveries,
      vehicle: p.vehicle,
      unlocked_vehicles: unlockedVehicles(level),
      achievements: ach.rows.map((a) => ({ code: a.code, unlocked_at: new Date(a.unlocked_at).toISOString() })),
      active_run: activeRun,
    };
  }

  async function lockRun(tx: Tx, playerId: string, runId: string) {
    const { rows } = await tx.query(`SELECT ${RUN_COLUMNS} FROM mission_runs WHERE id = $1 AND player_id = $2 FOR UPDATE`, [
      runId,
      playerId,
    ]);
    if (!rows[0]) throw notFound('Mission run not found');
    return rows[0];
  }

  function requireTransition(from: RunStatus, to: RunStatus) {
    if (from === 'delivered' && to === 'delivered') throw conflict('already_delivered', 'This delivery was already completed');
    if (!canTransition(from, to)) throw conflict('invalid_transition', `Cannot go from ${from} to ${to}`);
  }

  async function awardAchievements(tx: Tx, playerId: string, codes: string[]) {
    if (!codes.length) return [] as string[];
    const { rows } = await tx.query(
      `INSERT INTO player_achievements(player_id, code) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING RETURNING code`,
      [playerId, codes],
    );
    return rows.map((r) => r.code as string);
  }

  const runIdParams = z.object({ runId: z.uuid() });

  // Get or create the anonymous player bound to this browser.
  app.post('/session', async (req, reply: FastifyReply) => {
    const token = req.cookies[COOKIE];
    if (token) {
      const { rows } = await db.query(
        `UPDATE players SET last_seen_at = now() WHERE token_hash = $1
         RETURNING id, display_name, xp, level, coins, deliveries, vehicle`,
        [sha256(token)],
      );
      if (rows[0]) return profile(db, rows[0]);
    }
    const fresh = newToken();
    const name = `Rider ${Math.floor(1000 + Math.random() * 9000)}`;
    const { rows } = await db.query(
      `INSERT INTO players(token_hash, display_name) VALUES ($1, $2)
       RETURNING id, display_name, xp, level, coins, deliveries, vehicle`,
      [sha256(fresh), name],
    );
    reply.setCookie(COOKIE, fresh, cookieOpts);
    return profile(db, rows[0]);
  });

  app.get('/', async (req) => profile(db, await currentPlayer(req)));

  app.patch('/', async (req) => {
    const body = z
      .object({
        display_name: z.string().trim().min(2).max(40).optional(),
        vehicle: z.enum(VEHICLES).optional(),
      })
      .parse(req.body);
    const p = await currentPlayer(req);
    if (body.vehicle && !unlockedVehicles(levelForXp(p.xp)).includes(body.vehicle)) {
      throw forbidden('This vehicle is still locked');
    }
    const { rows } = await db.query(
      `UPDATE players SET display_name = COALESCE($2, display_name), vehicle = COALESCE($3, vehicle)
       WHERE id = $1 RETURNING id, display_name, xp, level, coins, deliveries, vehicle`,
      [p.id, body.display_name ?? null, body.vehicle ?? null],
    );
    return profile(db, rows[0]);
  });

  app.get('/missions', async (req) => {
    await currentPlayer(req);
    return listMissions(db, estimate, { playable: true });
  });

  app.get('/history', async (req) => {
    const p = await currentPlayer(req);
    const { rows } = await db.query(
      `SELECT r.id, r.mission_id, r.status, r.accepted_at, r.collected_at, r.delivered_at, r.cancelled_at, r.deadline_at,
              r.reward_coins, r.reward_xp, r.bonus_coins, r.est_distance_m, j.title_ar, j.title_en, j.type, j.code
         FROM mission_runs r JOIN missions j ON j.id = r.mission_id
        WHERE r.player_id = $1 ORDER BY r.accepted_at DESC LIMIT 50`,
      [p.id],
    );
    return rows.map((r) => ({
      ...runDto(r),
      title_ar: r.title_ar,
      title_en: r.title_en,
      type: r.type,
      code: r.code,
      est_distance_m: r.est_distance_m,
    }));
  });

  app.post('/missions/:id/accept', async (req) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);
    return withTx(db, async (tx) => {
      const p = await currentPlayer(req, tx, true);
      const active = await tx.query(`SELECT id FROM mission_runs WHERE player_id = $1 AND status = ANY($2)`, [
        p.id,
        ACTIVE_RUN_STATUSES,
      ]);
      if (active.rowCount) throw conflict('run_in_progress', 'Finish or cancel your current delivery first');
      const mission = await getMission(tx, id, estimate, true);
      if (!mission) throw notFound('This mission is not available');
      const { rows } = await tx.query(
        `INSERT INTO mission_runs(player_id, mission_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
           est_distance_m, reward_coins, reward_xp, deadline_at)
         VALUES ($1,$2,'accepted',$3,$4,$5,$6,$7,$8,$9, CASE WHEN $10::int IS NULL THEN NULL ELSE now() + make_interval(secs => $10::int) END)
         RETURNING ${RUN_COLUMNS}`,
        [
          p.id,
          mission.id,
          mission.pickup.lat,
          mission.pickup.lng,
          mission.destination.lat,
          mission.destination.lng,
          mission.est_distance_m,
          mission.reward_coins,
          mission.reward_xp,
          mission.time_limit_s,
        ],
      );
      await tx.query(
        `INSERT INTO analytics_events(type, merchant_id, mission_id, player_id) VALUES ('mission_accept', $1, $2, $3)`,
        [mission.origin_merchant_id, mission.id, p.id],
      );
      return { run: { ...runDto(rows[0]), mission }, player: await profile(tx, p) };
    });
  });

  app.post('/runs/:runId/advance', async (req) => {
    const { runId } = runIdParams.parse(req.params);
    const { to } = z.object({ to: z.enum(['going_to_pickup', 'going_to_destination']) }).parse(req.body);
    return withTx(db, async (tx) => {
      const p = await currentPlayer(req, tx);
      const run = await lockRun(tx, p.id, runId);
      if (run.status === to) return { run: runDto(run) };
      requireTransition(run.status, to);
      const { rows } = await tx.query(`UPDATE mission_runs SET status = $2 WHERE id = $1 RETURNING ${RUN_COLUMNS}`, [runId, to]);
      return { run: runDto(rows[0]) };
    });
  });

  app.post('/runs/:runId/collect', async (req) => {
    const { runId } = runIdParams.parse(req.params);
    const pos = position.parse(req.body);
    return withTx(db, async (tx) => {
      const p = await currentPlayer(req, tx);
      const run = await lockRun(tx, p.id, runId);
      requireTransition(run.status, 'collected');
      const target = toLocal({ lat: run.pickup_lat, lng: run.pickup_lng }, district.origin);
      const d = Math.hypot(pos.x - target.x, pos.y - target.y);
      if (d > PICKUP_RADIUS_M) {
        throw badRequest('not_at_pickup', `You are ${Math.round(d)} m from the pickup point`, { distance: d });
      }
      const { rows } = await tx.query(
        `UPDATE mission_runs SET status = 'collected', collected_at = now() WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
        [runId],
      );
      return { run: runDto(rows[0]) };
    });
  });

  app.post('/runs/:runId/deliver', async (req) => {
    const { runId } = runIdParams.parse(req.params);
    const pos = position.parse(req.body);
    return withTx(db, async (tx) => {
      const p = await currentPlayer(req, tx, true);
      const run = await lockRun(tx, p.id, runId);
      requireTransition(run.status, 'delivered');
      const drop = toLocal({ lat: run.dropoff_lat, lng: run.dropoff_lng }, district.origin);
      const d = Math.hypot(pos.x - drop.x, pos.y - drop.y);
      if (d > DROPOFF_RADIUS_M) {
        throw badRequest('not_at_dropoff', `You are ${Math.round(d)} m from the drop-off point`, { distance: d });
      }
      // The package cannot travel faster than the fastest vehicle in the game.
      const pick = toLocal({ lat: run.pickup_lat, lng: run.pickup_lng }, district.origin);
      const straight = Math.hypot(drop.x - pick.x, drop.y - pick.y);
      const minSeconds = Math.max(0, straight / MAX_GAME_SPEED_MS - 2);
      const { rows: timing } = await tx.query(
        `SELECT extract(epoch FROM (now() - collected_at)) AS elapsed, deadline_at IS NOT NULL AND now() <= deadline_at AS on_time
           FROM mission_runs WHERE id = $1`,
        [runId],
      );
      if (Number(timing[0].elapsed) < minSeconds) {
        throw badRequest('too_fast', 'Delivery arrived faster than any vehicle can travel');
      }
      const onTime = timing[0].on_time === true;
      const bonus = onTime ? Math.round(run.reward_coins * ON_TIME_BONUS) : 0;
      const coins = run.reward_coins + bonus;
      const xp = run.reward_xp;

      const { rows } = await tx.query(
        `UPDATE mission_runs SET status = 'delivered', delivered_at = now(), bonus_coins = $2 WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
        [runId, bonus],
      );
      // run_id is UNIQUE in rewards: a second payout for this run is impossible.
      await tx.query(`INSERT INTO rewards(player_id, run_id, coins, xp, reason) VALUES ($1, $2, $3, $4, 'delivery')`, [
        p.id,
        runId,
        coins,
        xp,
      ]);
      const before = levelForXp(p.xp);
      const { rows: updated } = await tx.query(
        `UPDATE players SET coins = coins + $2, xp = xp + $3, deliveries = deliveries + 1,
           level = $4 WHERE id = $1 RETURNING id, display_name, xp, level, coins, deliveries, vehicle`,
        [p.id, coins, xp, levelForXp(p.xp + xp)],
      );
      const mission = await getMission(tx, run.mission_id, estimate);
      if (mission) {
        await tx.query(
          `INSERT INTO analytics_events(type, merchant_id, mission_id, player_id) VALUES ('mission_complete', $1, $2, $3)`,
          [mission.origin_merchant_id, mission.id, p.id],
        );
      }
      const after = updated[0];
      const codes: string[] = [];
      if (after.deliveries >= 1) codes.push('first_delivery');
      if (after.deliveries >= 5) codes.push('five_deliveries');
      if (onTime) codes.push('on_time');
      if (mission && (mission.type === 'warehouse_shipment' || mission.type === 'b2b_parcel')) codes.push('industrial');
      const newAchievements = await awardAchievements(tx, p.id, codes);
      return {
        run: runDto(rows[0]),
        reward: { coins: run.reward_coins, bonus, xp, onTime },
        leveledUp: levelForXp(after.xp) > before,
        newAchievements,
        player: await profile(tx, after),
      };
    });
  });

  app.post('/runs/:runId/cancel', async (req) => {
    const { runId } = runIdParams.parse(req.params);
    return withTx(db, async (tx) => {
      const p = await currentPlayer(req, tx);
      const run = await lockRun(tx, p.id, runId);
      requireTransition(run.status, 'cancelled');
      const { rows } = await tx.query(
        `UPDATE mission_runs SET status = 'cancelled', cancelled_at = now() WHERE id = $1 RETURNING ${RUN_COLUMNS}`,
        [runId],
      );
      return { run: runDto(rows[0]) };
    });
  });

  app.post('/discover', async (req) => {
    const body = z.object({ merchant_id: z.number().int().positive(), x: z.number().finite(), y: z.number().finite() }).parse(req.body);
    return withTx(db, async (tx) => {
      const p = await currentPlayer(req, tx);
      const { rows } = await tx.query(`SELECT lat, lng FROM merchants WHERE id = $1 AND status = 'active'`, [body.merchant_id]);
      if (!rows[0]) throw notFound('Merchant not found');
      const at = toLocal({ lat: rows[0].lat, lng: rows[0].lng }, district.origin);
      // generous: the building centre sits behind its frontage
      if (Math.hypot(body.x - at.x, body.y - at.y) > DISCOVERY_RADIUS_M * 2) {
        throw badRequest('too_far', 'Get closer to discover this business');
      }
      const ins = await tx.query(
        `INSERT INTO player_discoveries(player_id, merchant_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING merchant_id`,
        [p.id, body.merchant_id],
      );
      let newAchievements: string[] = [];
      if (ins.rowCount) {
        await tx.query(`INSERT INTO analytics_events(type, merchant_id, player_id) VALUES ('map_discovery', $1, $2)`, [
          body.merchant_id,
          p.id,
        ]);
        const { rows: c } = await tx.query('SELECT count(*) AS n FROM player_discoveries WHERE player_id = $1', [p.id]);
        if (Number(c[0].n) >= 5) newAchievements = await awardAchievements(tx, p.id, ['explorer']);
      }
      return { discovered: ins.rowCount === 1, newAchievements };
    });
  });

  app.get('/discoveries', async (req) => {
    const p = await currentPlayer(req);
    const { rows } = await db.query('SELECT merchant_id FROM player_discoveries WHERE player_id = $1', [p.id]);
    return rows.map((r) => r.merchant_id as number);
  });

  // Profile views and mission offers, de-duplicated per player so a reopened card
  // or a re-rendered list does not inflate the merchant's numbers.
  const recent = new Map<string, number>();
  app.post('/events', async (req) => {
    const body = z
      .object({
        type: z.enum(['profile_view', 'mission_offer']),
        merchant_id: z.number().int().positive(),
        mission_ids: z.array(z.number().int().positive()).max(30).optional(),
      })
      .parse(req.body);
    const p = await currentPlayer(req);
    const now = Date.now();
    if (recent.size > 50_000) recent.clear();
    const keys =
      body.type === 'mission_offer' && body.mission_ids?.length
        ? body.mission_ids.map((m) => `${p.id}:offer:${m}`)
        : [`${p.id}:${body.type}:${body.merchant_id}`];
    const windowMs = body.type === 'profile_view' ? 60_000 : 10 * 60_000;
    const fresh = keys.filter((k) => now - (recent.get(k) ?? 0) > windowMs);
    if (!fresh.length) return { recorded: 0 };
    for (const k of fresh) recent.set(k, now);
    if (body.type === 'profile_view') {
      await db.query(`INSERT INTO analytics_events(type, merchant_id, player_id) SELECT 'profile_view', id, $2 FROM merchants WHERE id = $1`, [
        body.merchant_id,
        p.id,
      ]);
      return { recorded: 1 };
    }
    const missionIds = body.mission_ids?.length
      ? fresh.map((k) => Number(k.split(':')[2]))
      : [];
    const { rowCount } = await db.query(
      `INSERT INTO analytics_events(type, merchant_id, mission_id, player_id)
       SELECT 'mission_offer', origin_merchant_id, id, $2 FROM missions WHERE id = ANY($1) AND origin_merchant_id = $3`,
      [missionIds, p.id, body.merchant_id],
    );
    return { recorded: rowCount };
  });

  async function challengeProgress(q: Queryable, playerId: string, day: string) {
    const { rows } = await q.query(
      `WITH runs AS (
         SELECT r.*, j.type, o.building_type FROM mission_runs r
           JOIN missions j ON j.id = r.mission_id JOIN merchants o ON o.id = j.origin_merchant_id
          WHERE r.player_id = $1 AND r.status = 'delivered'
            AND (r.delivered_at AT TIME ZONE 'Asia/Baghdad')::date = $2::date)
       SELECT (SELECT count(*) FROM runs) AS deliveries,
              (SELECT count(*) FROM runs WHERE building_type = 'restaurant') AS restaurant_deliveries,
              (SELECT count(*) FROM runs WHERE building_type IN ('factory','warehouse')) AS industrial_deliveries,
              (SELECT count(*) FROM runs WHERE bonus_coins > 0) AS on_time,
              (SELECT count(*) FROM player_discoveries
                WHERE player_id = $1 AND (discovered_at AT TIME ZONE 'Asia/Baghdad')::date = $2::date) AS discoveries`,
      [playerId, day],
    );
    const claimed = await q.query(`SELECT challenge_key FROM rewards WHERE player_id = $1 AND challenge_key LIKE $2`, [
      playerId,
      `${day}:%`,
    ]);
    const claimedSet = new Set(claimed.rows.map((r) => r.challenge_key as string));
    return dailyChallenges(day).map((c) => ({
      ...c,
      progress: Math.min(c.target, Number(rows[0][c.metric])),
      claimed: claimedSet.has(`${day}:${c.code}`),
    }));
  }

  app.get('/challenges', async (req) => {
    const p = await currentPlayer(req);
    const day = erbilDay();
    return { day, challenges: await challengeProgress(db, p.id, day) };
  });

  app.post('/challenges/:code/claim', async (req) => {
    const { code } = z.object({ code: z.string().max(40) }).parse(req.params);
    return withTx(db, async (tx) => {
      const p = await currentPlayer(req, tx, true);
      const day = erbilDay();
      const list = await challengeProgress(tx, p.id, day);
      const c = list.find((x) => x.code === code);
      if (!c) throw notFound('No such challenge today');
      if (c.claimed) throw conflict('already_claimed', 'Reward already claimed');
      if (c.progress < c.target) throw badRequest('not_complete', 'Challenge not complete yet');
      await tx.query(
        `INSERT INTO rewards(player_id, challenge_key, coins, xp, reason) VALUES ($1, $2, $3, 0, 'daily_challenge')`,
        [p.id, `${day}:${code}`, c.reward_coins],
      );
      const { rows } = await tx.query(
        `UPDATE players SET coins = coins + $2 WHERE id = $1 RETURNING id, display_name, xp, level, coins, deliveries, vehicle`,
        [p.id, c.reward_coins],
      );
      return { player: await profile(tx, rows[0]), challenges: await challengeProgress(tx, p.id, day) };
    });
  });
}
