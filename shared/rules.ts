// Game rules that the server enforces and the client displays. Keeping them in
// one place means the HUD never promises something the server will refuse.

import type { MissionType, RunStatus, VehicleId } from './types';

/** Radius (metres) around a pickup point inside which collection is allowed. */
export const PICKUP_RADIUS_M = 14;
/** Radius (metres) around a drop-off point inside which delivery is allowed. */
export const DROPOFF_RADIUS_M = 16;
/** Distance at which a merchant counts as "discovered" by the player. */
export const DISCOVERY_RADIUS_M = 45;
/** No vehicle in the game is faster than this (m/s); used to reject impossible deliveries. */
export const MAX_GAME_SPEED_MS = 37;
/** On-time bonus as a fraction of the base coin reward. */
export const ON_TIME_BONUS = 0.25;

export const ALLOWED_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  accepted: ['going_to_pickup', 'collected', 'cancelled'],
  going_to_pickup: ['collected', 'cancelled'],
  collected: ['going_to_destination', 'delivered', 'cancelled'],
  going_to_destination: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export const ACTIVE_RUN_STATUSES: RunStatus[] = ['accepted', 'going_to_pickup', 'collected', 'going_to_destination'];

export interface VehicleSpec {
  id: VehicleId;
  name_ar: string;
  name_en: string;
  /** m/s */
  maxSpeed: number;
  /** m/s² */
  acceleration: number;
  /** m/s² */
  braking: number;
  /** rad/s at low speed */
  steering: number;
  /** collision radius in metres */
  radius: number;
  unlockLevel: number;
}

export const VEHICLE_SPECS: Record<VehicleId, VehicleSpec> = {
  bicycle: {
    id: 'bicycle',
    name_ar: 'دراجة هوائية',
    name_en: 'Bicycle',
    maxSpeed: 11,
    acceleration: 3.8,
    braking: 7,
    steering: 2.6,
    radius: 0.9,
    unlockLevel: 1,
  },
  motorcycle: {
    id: 'motorcycle',
    name_ar: 'دراجة نارية',
    name_en: 'Motorcycle',
    maxSpeed: 27.8,
    acceleration: 8.5,
    braking: 11,
    steering: 2.2,
    radius: 1.1,
    unlockLevel: 1,
  },
  car: {
    id: 'car',
    name_ar: 'سيارة توصيل',
    name_en: 'Delivery car',
    maxSpeed: 36.1,
    acceleration: 7.2,
    braking: 12,
    steering: 1.6,
    radius: 2.1,
    unlockLevel: 2,
  },
};

/** Total XP needed to reach a level: 0, 100, 250, 450, 700, ... */
export function xpForLevel(level: number): number {
  return 25 * (level - 1) * (level + 2);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function unlockedVehicles(level: number): VehicleId[] {
  return (Object.values(VEHICLE_SPECS) as VehicleSpec[]).filter((v) => v.unlockLevel <= level).map((v) => v.id);
}

export const MISSION_TYPE_LABELS: Record<MissionType, { ar: string; en: string }> = {
  restaurant_order: { ar: 'طلب مطعم', en: 'Restaurant order' },
  retail_parcel: { ar: 'طرد متجر', en: 'Retail parcel' },
  warehouse_shipment: { ar: 'شحنة مستودع', en: 'Warehouse shipment' },
  document_delivery: { ar: 'توصيل مستندات', en: 'Document delivery' },
  b2b_parcel: { ar: 'طرد بين شركتين', en: 'Company-to-company parcel' },
  interior_pickup: { ar: 'استلام من الداخل', en: 'Interior pickup' },
};

export const ACHIEVEMENTS: { code: string; ar: string; en: string; desc_ar: string; desc_en: string }[] = [
  { code: 'first_delivery', ar: 'أول توصيلة', en: 'First delivery', desc_ar: 'أكمل أول توصيل', desc_en: 'Complete your first delivery' },
  { code: 'five_deliveries', ar: 'سائق محترف', en: 'Seasoned rider', desc_ar: 'أكمل 5 توصيلات', desc_en: 'Complete 5 deliveries' },
  { code: 'on_time', ar: 'في الموعد', en: 'Right on time', desc_ar: 'سلّم طلباً قبل انتهاء الوقت', desc_en: 'Deliver before the timer runs out' },
  { code: 'explorer', ar: 'مستكشف أربيل', en: 'Erbil explorer', desc_ar: 'اكتشف 5 محلات', desc_en: 'Discover 5 businesses' },
  { code: 'industrial', ar: 'خط الإمداد', en: 'Supply line', desc_ar: 'أكمل مهمة لمصنع أو مستودع', desc_en: 'Complete a factory or warehouse job' },
];

export interface DailyChallenge {
  code: string;
  ar: string;
  en: string;
  target: number;
  reward_coins: number;
  metric: 'deliveries' | 'restaurant_deliveries' | 'industrial_deliveries' | 'discoveries' | 'on_time';
}

const CHALLENGE_POOL: DailyChallenge[] = [
  { code: 'deliver_2', ar: 'أكمل توصيلتين اليوم', en: 'Complete 2 deliveries today', target: 2, reward_coins: 60, metric: 'deliveries' },
  { code: 'deliver_3', ar: 'أكمل 3 توصيلات اليوم', en: 'Complete 3 deliveries today', target: 3, reward_coins: 90, metric: 'deliveries' },
  { code: 'restaurant_1', ar: 'وصّل طلب مطعم', en: 'Deliver a restaurant order', target: 1, reward_coins: 40, metric: 'restaurant_deliveries' },
  { code: 'industrial_1', ar: 'أكمل مهمة صناعية', en: 'Complete an industrial job', target: 1, reward_coins: 50, metric: 'industrial_deliveries' },
  { code: 'discover_3', ar: 'اكتشف 3 محلات', en: 'Discover 3 businesses', target: 3, reward_coins: 30, metric: 'discoveries' },
  { code: 'on_time_1', ar: 'سلّم طلباً في الوقت', en: 'Make an on-time delivery', target: 1, reward_coins: 45, metric: 'on_time' },
];

/** Three challenges per calendar day (Asia/Baghdad), the same for every player. */
export function dailyChallenges(day: string): DailyChallenge[] {
  let seed = 0;
  for (const ch of day) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const pool = CHALLENGE_POOL.slice();
  const picked: DailyChallenge[] = [];
  // never two "deliver N" challenges on the same day
  while (picked.length < 3 && pool.length) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const c = pool.splice(seed % pool.length, 1)[0]!;
    if (c.metric === 'deliveries' && picked.some((p) => p.metric === 'deliveries')) continue;
    picked.push(c);
  }
  return picked;
}

/** Calendar day in Erbil (UTC+3, no DST) as YYYY-MM-DD. */
export function erbilDay(d: Date = new Date()): string {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

/** Seconds after accepting during which a mission can be cancelled for free (an accidental accept). */
export const CANCEL_GRACE_S = 30;

/**
 * Coins lost by cancelling a mission: nothing within the grace period if the order was not collected;
 * otherwise 20 % of the reward (at least 5) before collecting, and 50 % once the order is in hand.
 */
export function cancelPenalty(run: { reward_coins: number; accepted_at: string | Date | null; collected_at: string | Date | null }, nowMs: number): number {
  const accepted = run.accepted_at ? new Date(run.accepted_at).getTime() : nowMs;
  if (!run.collected_at && nowMs - accepted < CANCEL_GRACE_S * 1000) return 0;
  return Math.max(5, Math.round(run.reward_coins * (run.collected_at ? 0.5 : 0.2)));
}
