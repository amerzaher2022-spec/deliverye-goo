import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Category, Merchant, Mission, SponsorshipPackage } from '../../../shared/types';
import { ApiError, api } from '../api';
import { useI18n } from '../i18n';

/** Bilingual inline string: L('عربي', 'English'). */
export function useL() {
  const { lang } = useI18n();
  return useCallback((ar: string, en: string) => (lang === 'ar' ? ar : en), [lang]);
}

export interface AdminMission extends Mission {
  delivered: number;
  in_progress: number;
}

export interface SponsorshipRow {
  id: number;
  merchant_id: number;
  package_id: number;
  starts_on: string;
  ends_on: string;
  status: 'active' | 'paused' | 'cancelled';
  state: 'active' | 'paused' | 'cancelled' | 'expired' | 'scheduled';
  notes: string;
  merchant_name_ar: string;
  merchant_name_en: string;
  merchant_status: string;
  package_name_ar: string;
  package_name_en: string;
  price_usd: number;
}

interface AdminData {
  categories: Category[];
  merchants: Merchant[];
  packages: SponsorshipPackage[];
  missions: AdminMission[];
  sponsorships: SponsorshipRow[];
  loaded: boolean;
  reload: (what?: ('categories' | 'merchants' | 'packages' | 'missions' | 'sponsorships')[]) => Promise<void>;
  upsertMerchant: (m: Merchant) => void;
}

const DataCtx = createContext<AdminData | null>(null);

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<AdminData, 'reload' | 'upsertMerchant'>>({
    categories: [],
    merchants: [],
    packages: [],
    missions: [],
    sponsorships: [],
    loaded: false,
  });
  const reload = useCallback(async (what?: ('categories' | 'merchants' | 'packages' | 'missions' | 'sponsorships')[]) => {
    const want = new Set(what ?? ['categories', 'merchants', 'packages', 'missions', 'sponsorships']);
    const [categories, merchants, packages, missions, sponsorships] = await Promise.all([
      want.has('categories') ? api.get<Category[]>('/api/admin/categories') : null,
      want.has('merchants') ? api.get<Merchant[]>('/api/admin/merchants?status=all') : null,
      want.has('packages') ? api.get<SponsorshipPackage[]>('/api/admin/packages') : null,
      want.has('missions') ? api.get<AdminMission[]>('/api/admin/missions') : null,
      want.has('sponsorships') ? api.get<SponsorshipRow[]>('/api/admin/sponsorships') : null,
    ]);
    setState((s) => ({
      categories: categories ?? s.categories,
      merchants: merchants ?? s.merchants,
      packages: packages ?? s.packages,
      missions: missions ?? s.missions,
      sponsorships: sponsorships ?? s.sponsorships,
      loaded: true,
    }));
  }, []);
  const upsertMerchant = useCallback((m: Merchant) => {
    setState((s) => {
      const i = s.merchants.findIndex((x) => x.id === m.id);
      const merchants = i >= 0 ? s.merchants.map((x) => (x.id === m.id ? m : x)) : [...s.merchants, m];
      return { ...s, merchants };
    });
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return <DataCtx.Provider value={{ ...state, reload, upsertMerchant }}>{children}</DataCtx.Provider>;
}

export function useAdminData() {
  const v = useContext(DataCtx);
  if (!v) throw new Error('useAdminData outside provider');
  return v;
}

export type FieldErrors = Record<string, string>;

export function errorsFrom(e: unknown): { message: string; fields: FieldErrors } {
  if (e instanceof ApiError) {
    const fields: FieldErrors = {};
    if (Array.isArray(e.details)) for (const d of e.details) fields[d.path] = d.message;
    return { message: e.message, fields };
  }
  return { message: e instanceof Error ? e.message : String(e), fields: {} };
}

export function Field({
  label,
  error,
  children,
  span,
}: {
  label: ReactNode;
  error?: string;
  children: ReactNode;
  span?: number;
}) {
  return (
    <label className={`a-field ${error ? 'err' : ''}`} style={span ? { gridColumn: `span ${span}` } : undefined}>
      <span>{label}</span>
      {children}
      {error && <span className="err-msg">{error}</span>}
    </label>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const L = useL();
  const labels: Record<string, [string, string]> = {
    active: ['فعّال', 'Active'],
    disabled: ['معطّل', 'Disabled'],
    archived: ['مؤرشف', 'Archived'],
    paused: ['موقوف', 'Paused'],
    cancelled: ['ملغى', 'Cancelled'],
    expired: ['منتهي', 'Expired'],
    scheduled: ['مجدول', 'Scheduled'],
  };
  const l = labels[status];
  return <span className={`a-badge ${status}`}>{l ? L(l[0], l[1]) : status}</span>;
}

export const todayErbil = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

export type PointKey = 'location' | 'entrance' | 'pickup' | 'dropoff';

export function pointLabel(k: PointKey, lang: 'ar' | 'en') {
  const labels: Record<PointKey, [string, string]> = {
    location: ['موقع المبنى', 'Building position'],
    entrance: ['المدخل', 'Entrance'],
    pickup: ['نقطة الاستلام', 'Pickup point'],
    dropoff: ['نقطة التسليم', 'Drop-off point'],
  };
  return labels[k][lang === 'ar' ? 0 : 1];
}
