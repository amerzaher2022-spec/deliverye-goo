// Types shared by the server, the game and the dashboard.

export interface DistrictRoad {
  id: string;
  name_ar: string;
  name_en: string;
  kind: 'arterial' | 'primary' | 'secondary' | 'local';
  width: number;
  oneway?: boolean;
  /** [lat, lng] pairs */
  coords: [number, number][];
  /** height of the road surface above the ground at each coordinate, metres (tunnels and their ramps
   * are negative, bridges positive); missing means at ground level */
  elev?: number[];
  /** the road is covered here (OpenStreetMap tunnel=yes) or carried on a deck (bridge=yes) */
  tunnel?: boolean;
  bridge?: boolean;
}

export interface DistrictData {
  id: string;
  name_ar: string;
  name_en: string;
  source: 'schematic' | 'osm';
  sourceNote: string;
  attribution: string;
  citadel: { lat: number; lng: number };
  origin: { lat: number; lng: number };
  bounds: { south: number; west: number; north: number; east: number };
  roads: DistrictRoad[];
  zones: { kind: 'commercial' | 'industrial' | 'residential'; name_en: string; polygon: [number, number][] }[];
  landmarks: { name_ar: string; name_en: string; kind: string; lat: number; lng: number }[];
  /** named shops, restaurants and offices from OpenStreetMap: their signs go on the nearest buildings */
  pois?: { name_ar: string; name_en: string; kind: string; lat: number; lng: number }[];
  /** long stretches of real streets that stand in for the road ids used by the demo data */
  aliases?: Record<string, { coords: [number, number][]; width: number }>;
}

export const BUILDING_TYPES = ['restaurant', 'shop', 'factory', 'warehouse', 'office'] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const MERCHANT_STATUSES = ['active', 'disabled', 'archived'] as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

export const SIGN_SIZES = ['small', 'medium', 'large'] as const;
export type SignSize = (typeof SIGN_SIZES)[number];

export const SIGN_POSITIONS = ['front', 'roof', 'pylon'] as const;
export type SignPosition = (typeof SIGN_POSITIONS)[number];

export const MISSION_TYPES = [
  'restaurant_order',
  'retail_parcel',
  'warehouse_shipment',
  'document_delivery',
  'b2b_parcel',
  'interior_pickup',
] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

export const RUN_STATUSES = [
  'accepted',
  'going_to_pickup',
  'collected',
  'going_to_destination',
  'delivered',
  'cancelled',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const VEHICLES = ['bicycle', 'motorcycle', 'car'] as const;
export type VehicleId = (typeof VEHICLES)[number];

export interface PackageBenefits {
  highlightMarker: boolean;
  featuredCard: boolean;
  enhancedSignage: boolean;
  brandedMissions: boolean;
  loadingZoneBranding: boolean;
  districtSponsor: boolean;
  analyticsLevel: 'basic' | 'expanded';
  /** multiplier on sign size in the game, 1 = normal */
  signScale: number;
}

export interface PackageFeature {
  ar: string;
  en: string;
}

export interface SponsorshipPackage {
  id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  price_usd: number;
  period: string;
  features: PackageFeature[];
  benefits: PackageBenefits;
  location_limit: number;
  featured_limit: number;
  eligible_category_ids: number[];
  default_duration_days: number;
  active: boolean;
  sort: number;
}

export interface Category {
  id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  default_building_type: BuildingType;
  color: string;
  sort: number;
  archived: boolean;
}

export interface MenuItem {
  id?: number;
  name_ar: string;
  name_en: string;
  description_ar?: string;
  description_en?: string;
  price_iqd: number | null;
  sort?: number;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface MerchantHours {
  open: string; // HH:MM
  close: string; // HH:MM
  days: string; // free text, e.g. "Sat–Thu"
}

export interface ActiveSponsorship {
  id: number;
  package_id: number;
  package_slug: string;
  package_name_ar: string;
  package_name_en: string;
  starts_on: string;
  ends_on: string;
  benefits: PackageBenefits;
}

export interface Merchant {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  category_id: number;
  category?: Pick<Category, 'slug' | 'name_ar' | 'name_en' | 'color'>;
  description_ar: string;
  description_en: string;
  address_ar: string;
  address_en: string;
  location: GeoPoint;
  entrance: GeoPoint;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  building_type: BuildingType;
  sign_size: SignSize;
  sign_position: SignPosition;
  brand_color: string;
  logo_url: string | null;
  cover_url: string | null;
  gallery: { id: string; url: string }[];
  hours: MerchantHours | null;
  phone: string;
  website: string;
  status: MerchantStatus;
  interior_enabled: boolean;
  is_fictional: boolean;
  notes?: string;
  menu: MenuItem[];
  sponsorship: ActiveSponsorship | null;
  updated_at: string;
}

export interface Mission {
  id: number;
  code: string;
  type: MissionType;
  title_ar: string;
  title_en: string;
  origin_merchant_id: number;
  destination_merchant_id: number | null;
  destination: GeoPoint;
  destination_label_ar: string;
  destination_label_en: string;
  pickup: GeoPoint;
  package_ar: string;
  package_en: string;
  est_distance_m: number;
  time_limit_s: number | null;
  reward_coins: number;
  reward_xp: number;
  branded: boolean;
  active: boolean;
}

export interface MissionRun {
  id: string;
  mission_id: number;
  status: RunStatus;
  accepted_at: string;
  collected_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  deadline_at: string | null;
  reward_coins: number;
  reward_xp: number;
  bonus_coins: number;
  mission?: Mission;
}

export interface PlayerProfile {
  id: string;
  display_name: string;
  level: number;
  xp: number;
  xp_for_next: number;
  xp_level_start: number;
  coins: number;
  deliveries: number;
  vehicle: VehicleId;
  unlocked_vehicles: VehicleId[];
  achievements: { code: string; unlocked_at: string }[];
  active_run: MissionRun | null;
}
