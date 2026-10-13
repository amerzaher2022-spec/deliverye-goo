import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { district } from '../../../shared/district';
import { MISSION_TYPE_LABELS } from '../../../shared/rules';
import { BUILDING_TYPES, MISSION_TYPES, type BuildingType, type Category, type GeoPoint, type MissionType, type PackageBenefits, type SponsorshipPackage } from '../../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Field, StatusBadge, addDays, errorsFrom, todayErbil, useAdminData, useL, type AdminMission, type FieldErrors, type SponsorshipRow } from './common';

function Msg({ msg }: { msg: { kind: 'ok' | 'err' | 'info'; text: string } | null }) {
  return msg ? <div className={`a-alert ${msg.kind}`}>{msg.text}</div> : null;
}

// ---------------------------------------------------------------- merchants table

export function MerchantsPage({ onEditOnMap }: { onEditOnMap: (id: number) => void }) {
  const { pick } = useI18n();
  const L_ = useL();
  const data = useAdminData();
  const [q, setQ] = useState('');
  const rows = data.merchants.filter((m) => `${m.name_ar} ${m.name_en} ${m.code}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="a-card">
      <div className="a-row">
        <h2 style={{ margin: 0 }}>{L_('الأنشطة التجارية', 'Businesses')}</h2>
        <span className="a-badge demo">{L_('جميعها وهمية للعرض', 'All fictional demo businesses')}</span>
        <span className="a-spacer" />
        <input className="a-input" placeholder={L_('بحث', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="a-table-wrap" style={{ marginTop: 10 }}>
        <table className="a-table">
          <thead>
            <tr>
              <th />
              <th>{L_('الرمز', 'Code')}</th>
              <th>{L_('الاسم', 'Name')}</th>
              <th>{L_('التصنيف', 'Category')}</th>
              <th>{L_('المبنى', 'Building')}</th>
              <th>{L_('الرعاية', 'Sponsorship')}</th>
              <th>{L_('الحالة', 'Status')}</th>
              <th>{L_('الإحداثيات', 'Coordinates')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.logo_url && <img className="a-logo" src={m.logo_url} alt="" />}</td>
                <td>{m.code}</td>
                <td>
                  <b>{m.name_ar}</b>
                  <div style={{ color: 'var(--a-muted)' }}>{m.name_en}</div>
                </td>
                <td>{pick(m.category?.name_ar, m.category?.name_en)}</td>
                <td>{m.building_type}</td>
                <td>{m.sponsorship ? <span className="a-badge gold">★ {pick(m.sponsorship.package_name_ar, m.sponsorship.package_name_en)}</span> : '—'}</td>
                <td>
                  <StatusBadge status={m.status} />
                </td>
                <td dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {m.location.lat.toFixed(5)}, {m.location.lng.toFixed(5)}
                </td>
                <td>
                  <button className="a-btn sm" onClick={() => onEditOnMap(m.id)}>
                    🗺 {L_('على الخريطة', 'On map')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- mini map picker

function PointPicker({ value, onChange }: { value: GeoPoint | null; onChange: (p: GeoPoint) => void }) {
  const div = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.Marker | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!div.current || map.current) return;
    const b = district.bounds;
    const m = L.map(div.current).fitBounds([
      [b.south, b.west],
      [b.north, b.east],
    ]);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    for (const r of district.roads) L.polyline(r.coords as [number, number][], { color: r.kind === 'arterial' ? '#f59e0b' : '#64748b', weight: 4, opacity: 0.8 }).addTo(m);
    m.on('click', (e: L.LeafletMouseEvent) => cb.current({ lat: e.latlng.lat, lng: e.latlng.lng }));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current) return;
    marker.current?.remove();
    if (value) {
      marker.current = L.marker([value.lat, value.lng], {
        icon: L.divIcon({ className: '', html: '<div class="pt" style="background:#ea580c">D</div>', iconSize: [26, 26], iconAnchor: [13, 13] }),
      }).addTo(map.current);
    }
  }, [value]);
  return <div ref={div} style={{ height: 240, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--a-line)' }} />;
}

// ---------------------------------------------------------------- missions

interface MissionForm {
  id?: number;
  type: MissionType;
  title_ar: string;
  title_en: string;
  origin_merchant_id: number;
  destKind: 'merchant' | 'point';
  destination_merchant_id: number | null;
  destination: GeoPoint | null;
  destination_label_ar: string;
  destination_label_en: string;
  package_ar: string;
  package_en: string;
  time_limit_s: number | null;
  reward_coins: number;
  reward_xp: number;
  branded: boolean;
  active: boolean;
}

export function MissionsPage() {
  const { pick } = useI18n();
  const L_ = useL();
  const data = useAdminData();
  const [form, setForm] = useState<MissionForm | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const name = (id: number | null) => {
    const m = data.merchants.find((x) => x.id === id);
    return m ? pick(m.name_ar, m.name_en) : '—';
  };
  const edit = (m: AdminMission) =>
    setForm({
      id: m.id,
      type: m.type,
      title_ar: m.title_ar,
      title_en: m.title_en,
      origin_merchant_id: m.origin_merchant_id,
      destKind: m.destination_merchant_id ? 'merchant' : 'point',
      destination_merchant_id: m.destination_merchant_id,
      destination: m.destination_merchant_id ? null : m.destination,
      destination_label_ar: m.destination_merchant_id ? '' : m.destination_label_ar,
      destination_label_en: m.destination_merchant_id ? '' : m.destination_label_en,
      package_ar: m.package_ar,
      package_en: m.package_en,
      time_limit_s: m.time_limit_s,
      reward_coins: m.reward_coins,
      reward_xp: m.reward_xp,
      branded: m.branded,
      active: m.active,
    });
  const save = async () => {
    if (!form) return;
    setErrors({});
    const body = {
      type: form.type,
      title_ar: form.title_ar,
      title_en: form.title_en,
      origin_merchant_id: form.origin_merchant_id,
      destination_merchant_id: form.destKind === 'merchant' ? form.destination_merchant_id : null,
      destination: form.destKind === 'point' ? form.destination : null,
      destination_label_ar: form.destination_label_ar,
      destination_label_en: form.destination_label_en,
      package_ar: form.package_ar,
      package_en: form.package_en,
      time_limit_s: form.time_limit_s,
      reward_coins: form.reward_coins,
      reward_xp: form.reward_xp,
      branded: form.branded,
      active: form.active,
    };
    try {
      if (form.id) await api.put(`/api/admin/missions/${form.id}`, body);
      else await api.post('/api/admin/missions', body);
      await data.reload(['missions']);
      setForm(null);
      setMsg({ kind: 'ok', text: L_('تم حفظ المهمة', 'Mission saved') });
    } catch (e) {
      const r = errorsFrom(e);
      setErrors(r.fields);
      setMsg({ kind: 'err', text: r.message });
    }
  };
  const active = data.merchants.filter((m) => m.status !== 'archived');
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Msg msg={msg} />
      {form && (
        <div className="a-card" data-testid="mission-form">
          <h2>{form.id ? L_('تعديل مهمة', 'Edit mission') : L_('مهمة جديدة', 'New mission')}</h2>
          <div className="a-grid">
            <Field label={L_('النوع', 'Type')}>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as MissionType })}>
                {MISSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {pick(MISSION_TYPE_LABELS[t].ar, MISSION_TYPE_LABELS[t].en)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={L_('العنوان بالعربية', 'Title (Arabic)')} error={errors.title_ar}>
              <input dir="rtl" value={form.title_ar} onChange={(e) => setForm({ ...form, title_ar: e.target.value })} data-testid="m-title_ar" />
            </Field>
            <Field label={L_('العنوان بالإنجليزية', 'Title (English)')} error={errors.title_en}>
              <input dir="ltr" value={form.title_en} onChange={(e) => setForm({ ...form, title_en: e.target.value })} data-testid="m-title_en" />
            </Field>
            <Field label={L_('الاستلام من', 'Pickup from')} error={errors.origin_merchant_id}>
              <select value={form.origin_merchant_id} onChange={(e) => setForm({ ...form, origin_merchant_id: Number(e.target.value) })} data-testid="m-origin">
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {pick(m.name_ar, m.name_en)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={L_('نوع الوجهة', 'Destination kind')}>
              <select value={form.destKind} onChange={(e) => setForm({ ...form, destKind: e.target.value as 'merchant' | 'point' })} data-testid="m-destkind">
                <option value="merchant">{L_('نشاط تجاري', 'Business')}</option>
                <option value="point">{L_('نقطة على الخريطة (زبون)', 'Map point (customer)')}</option>
              </select>
            </Field>
            {form.destKind === 'merchant' && (
              <Field label={L_('التسليم إلى', 'Deliver to')} error={errors.destination_merchant_id}>
                <select value={form.destination_merchant_id ?? ''} onChange={(e) => setForm({ ...form, destination_merchant_id: Number(e.target.value) })} data-testid="m-dest">
                  <option value="">—</option>
                  {active
                    .filter((m) => m.id !== form.origin_merchant_id)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {pick(m.name_ar, m.name_en)}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label={L_('الطلبية بالعربية', 'Package (Arabic)')}>
              <input dir="rtl" value={form.package_ar} onChange={(e) => setForm({ ...form, package_ar: e.target.value })} />
            </Field>
            <Field label={L_('الطلبية بالإنجليزية', 'Package (English)')}>
              <input dir="ltr" value={form.package_en} onChange={(e) => setForm({ ...form, package_en: e.target.value })} />
            </Field>
            <Field label={L_('الوقت المحدد (ثانية، اختياري)', 'Time limit (seconds, optional)')} error={errors.time_limit_s}>
              <input type="number" min={30} value={form.time_limit_s ?? ''} onChange={(e) => setForm({ ...form, time_limit_s: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label={L_('مكافأة (عملة افتراضية)', 'Reward (virtual coins)')} error={errors.reward_coins}>
              <input type="number" min={0} value={form.reward_coins} onChange={(e) => setForm({ ...form, reward_coins: Number(e.target.value) })} data-testid="m-coins" />
            </Field>
            <Field label={L_('نقاط الخبرة', 'XP')} error={errors.reward_xp}>
              <input type="number" min={0} value={form.reward_xp} onChange={(e) => setForm({ ...form, reward_xp: Number(e.target.value) })} />
            </Field>
          </div>
          {form.destKind === 'point' && (
            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
              <div className="a-grid">
                <Field label={L_('اسم الوجهة بالعربية', 'Destination label (Arabic)')}>
                  <input dir="rtl" value={form.destination_label_ar} onChange={(e) => setForm({ ...form, destination_label_ar: e.target.value })} />
                </Field>
                <Field label={L_('اسم الوجهة بالإنجليزية', 'Destination label (English)')}>
                  <input dir="ltr" value={form.destination_label_en} onChange={(e) => setForm({ ...form, destination_label_en: e.target.value })} />
                </Field>
              </div>
              {errors.destination && <div className="a-alert err">{errors.destination}</div>}
              <div className="small" style={{ color: 'var(--a-muted)' }}>
                {L_('انقر على الخريطة لتحديد نقطة التسليم', 'Click the map to set the drop-off point')}
                {form.destination && (
                  <span dir="ltr">
                    {' '}
                    · {form.destination.lat.toFixed(5)}, {form.destination.lng.toFixed(5)}
                  </span>
                )}
              </div>
              <PointPicker value={form.destination} onChange={(p) => setForm({ ...form, destination: p })} />
            </div>
          )}
          <div className="a-row" style={{ marginTop: 10 }}>
            <label className="a-check">
              <input type="checkbox" checked={form.branded} onChange={(e) => setForm({ ...form, branded: e.target.checked })} />
              {L_('مهمة بعلامة تجارية (تظهر للرعاة فقط)', 'Branded mission (shown as branded for sponsors)')}
            </label>
            <label className="a-check">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              {L_('فعّالة', 'Active')}
            </label>
          </div>
          <div className="a-row" style={{ marginTop: 10 }}>
            <button className="a-btn primary" onClick={() => void save()} data-testid="save-mission">
              💾 {L_('حفظ', 'Save')}
            </button>
            <button className="a-btn" onClick={() => setForm(null)}>
              {L_('إلغاء', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      <div className="a-card">
        <div className="a-row">
          <h2 style={{ margin: 0 }}>{L_('مهام التوصيل', 'Delivery missions')}</h2>
          <span className="a-spacer" />
          <button
            className="a-btn primary"
            onClick={() =>
              setForm({
                type: 'restaurant_order',
                title_ar: '',
                title_en: '',
                origin_merchant_id: active[0]?.id ?? 0,
                destKind: 'merchant',
                destination_merchant_id: active[1]?.id ?? null,
                destination: null,
                destination_label_ar: '',
                destination_label_en: '',
                package_ar: '',
                package_en: '',
                time_limit_s: null,
                reward_coins: 50,
                reward_xp: 50,
                branded: false,
                active: true,
              })
            }
            data-testid="new-mission"
          >
            ＋ {L_('مهمة جديدة', 'New mission')}
          </button>
        </div>
        <div className="a-table-wrap" style={{ marginTop: 10 }}>
          <table className="a-table">
            <thead>
              <tr>
                <th>{L_('الرمز', 'Code')}</th>
                <th>{L_('العنوان', 'Title')}</th>
                <th>{L_('النوع', 'Type')}</th>
                <th>{L_('من', 'From')}</th>
                <th>{L_('إلى', 'To')}</th>
                <th>{L_('المسافة', 'Route')}</th>
                <th>{L_('المكافأة', 'Reward')}</th>
                <th>{L_('مُنجزة', 'Done')}</th>
                <th>{L_('الحالة', 'Status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.missions.map((m) => (
                <tr key={m.id}>
                  <td>{m.code}</td>
                  <td>
                    {pick(m.title_ar, m.title_en)} {m.branded && <span className="a-badge gold">★</span>}
                  </td>
                  <td>{pick(MISSION_TYPE_LABELS[m.type].ar, MISSION_TYPE_LABELS[m.type].en)}</td>
                  <td>{name(m.origin_merchant_id)}</td>
                  <td>{m.destination_merchant_id ? name(m.destination_merchant_id) : pick(m.destination_label_ar, m.destination_label_en)}</td>
                  <td>{(m.est_distance_m / 1000).toFixed(2)} km</td>
                  <td>
                    {m.reward_coins} 🪙 · {m.reward_xp} XP
                  </td>
                  <td>{m.delivered}</td>
                  <td>
                    <StatusBadge status={m.active ? 'active' : 'disabled'} />
                  </td>
                  <td>
                    <button className="a-btn sm" onClick={() => edit(m)}>
                      ✎
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- categories

export function CategoriesPage() {
  const { pick } = useI18n();
  const L_ = useL();
  const data = useAdminData();
  const blank = { slug: '', name_ar: '', name_en: '', default_building_type: 'shop' as BuildingType, color: '#2563eb', sort: data.categories.length, archived: false };
  const [form, setForm] = useState<(Omit<Category, 'id'> & { id?: number }) | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      if (id) await api.put(`/api/admin/categories/${id}`, body);
      else await api.post('/api/admin/categories', body);
      await data.reload(['categories', 'merchants']);
      setForm(null);
      setErrors({});
      setMsg({ kind: 'ok', text: L_('تم حفظ التصنيف', 'Category saved') });
    } catch (e) {
      const r = errorsFrom(e);
      setErrors(r.fields);
      setMsg({ kind: 'err', text: r.message });
    }
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Msg msg={msg} />
      {form && (
        <div className="a-card" data-testid="category-form">
          <h2>{form.id ? L_('تعديل تصنيف', 'Edit category') : L_('تصنيف جديد', 'New category')}</h2>
          <div className="a-grid">
            <Field label={L_('المعرّف (لاتيني)', 'Slug')} error={errors.slug}>
              <input dir="ltr" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} data-testid="c-slug" />
            </Field>
            <Field label={L_('الاسم بالعربية', 'Arabic name')} error={errors.name_ar}>
              <input dir="rtl" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} data-testid="c-name_ar" />
            </Field>
            <Field label={L_('الاسم بالإنجليزية', 'English name')} error={errors.name_en}>
              <input dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} data-testid="c-name_en" />
            </Field>
            <Field label={L_('نوع المبنى الافتراضي', 'Default building')}>
              <select value={form.default_building_type} onChange={(e) => setForm({ ...form, default_building_type: e.target.value as BuildingType })}>
                {BUILDING_TYPES.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </Field>
            <Field label={L_('اللون', 'Colour')}>
              <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ height: 36, padding: 2 }} />
            </Field>
            <Field label={L_('الترتيب', 'Sort')}>
              <input type="number" value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) })} />
            </Field>
          </div>
          <label className="a-check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={form.archived} onChange={(e) => setForm({ ...form, archived: e.target.checked })} />
            {L_('مؤرشف (مخفي من القوائم)', 'Archived (hidden from pickers)')}
          </label>
          <div className="a-row" style={{ marginTop: 10 }}>
            <button className="a-btn primary" onClick={() => void save()} data-testid="save-category">
              💾 {L_('حفظ', 'Save')}
            </button>
            <button className="a-btn" onClick={() => setForm(null)}>
              {L_('إلغاء', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      <div className="a-card">
        <div className="a-row">
          <h2 style={{ margin: 0 }}>{L_('التصنيفات', 'Categories')}</h2>
          <span className="a-spacer" />
          <button className="a-btn primary" onClick={() => setForm(blank)} data-testid="new-category">
            ＋ {L_('تصنيف جديد', 'New category')}
          </button>
        </div>
        <table className="a-table" style={{ marginTop: 10 }}>
          <thead>
            <tr>
              <th />
              <th>{L_('الاسم', 'Name')}</th>
              <th>{L_('المعرّف', 'Slug')}</th>
              <th>{L_('المبنى', 'Building')}</th>
              <th>{L_('الأنشطة', 'Businesses')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.id} style={{ opacity: c.archived ? 0.5 : 1 }}>
                <td>
                  <span className="pin" style={{ background: c.color, display: 'inline-block' }} />
                </td>
                <td>{pick(c.name_ar, c.name_en)}</td>
                <td dir="ltr">{c.slug}</td>
                <td>{c.default_building_type}</td>
                <td>{data.merchants.filter((m) => m.category_id === c.id).length}</td>
                <td>
                  <button className="a-btn sm" onClick={() => setForm(c)}>
                    ✎
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- packages

const BENEFIT_LABELS: [keyof PackageBenefits, string, string][] = [
  ['highlightMarker', 'علامة بارزة على الخريطة وفي اللعبة', 'Highlighted map / in-game marker'],
  ['featuredCard', 'بطاقة مميزة في الدليل', 'Featured directory card'],
  ['enhancedSignage', 'لافتة وواجهة محسّنة', 'Enhanced storefront & signage'],
  ['brandedMissions', 'مهام بعلامة تجارية', 'Branded missions'],
  ['loadingZoneBranding', 'شعار على منطقة التحميل', 'Loading-zone branding'],
  ['districtSponsor', 'لوحة راعي المنطقة', 'District sponsor billboard'],
];

export function PackagesPage() {
  const { pick } = useI18n();
  const L_ = useL();
  const data = useAdminData();
  const [form, setForm] = useState<(Omit<SponsorshipPackage, 'id'> & { id?: number }) | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      if (id) await api.put(`/api/admin/packages/${id}`, body);
      else await api.post('/api/admin/packages', body);
      await data.reload(['packages', 'merchants', 'sponsorships']);
      setForm(null);
      setErrors({});
      setMsg({ kind: 'ok', text: L_('تم حفظ الباقة — تنعكس على اللعبة فوراً', 'Package saved — the game picks it up immediately') });
    } catch (e) {
      const r = errorsFrom(e);
      setErrors(r.fields);
      setMsg({ kind: 'err', text: r.message });
    }
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="a-alert info">
        {L_(
          'الأسعار توضيحية لأغراض العرض فقط. لا يوجد دفع أو فوترة أو اشتراك أو تجديد تلقائي في هذا النموذج.',
          'Prices are illustrative for the demo only. There is no payment, billing, subscription or auto-renewal in this prototype.',
        )}
      </div>
      <Msg msg={msg} />
      {form && (
        <div className="a-card" data-testid="package-form">
          <h2>{form.id ? L_('تعديل باقة', 'Edit package') : L_('باقة جديدة', 'New package')}</h2>
          <div className="a-grid">
            <Field label={L_('المعرّف', 'Slug')} error={errors.slug}>
              <input dir="ltr" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
            </Field>
            <Field label={L_('الاسم بالعربية', 'Arabic name')} error={errors.name_ar}>
              <input dir="rtl" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} data-testid="p-name_ar" />
            </Field>
            <Field label={L_('الاسم بالإنجليزية', 'English name')} error={errors.name_en}>
              <input dir="ltr" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} data-testid="p-name_en" />
            </Field>
            <Field label={L_('السعر التوضيحي (دولار)', 'Illustrative price (USD)')} error={errors.price_usd}>
              <input type="number" min={0} step="0.01" value={form.price_usd} onChange={(e) => setForm({ ...form, price_usd: Number(e.target.value) })} data-testid="p-price" />
            </Field>
            <Field label={L_('الفترة', 'Period')}>
              <select value={form.period} onChange={(e) => setForm({ ...form, period: e.target.value })}>
                {['month', 'quarter', 'year', 'campaign'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </Field>
            <Field label={L_('مدة الحملة الافتراضية (يوم)', 'Default campaign length (days)')}>
              <input type="number" min={1} value={form.default_duration_days} onChange={(e) => setForm({ ...form, default_duration_days: Number(e.target.value) })} />
            </Field>
            <Field label={L_('حد المواقع المتزامنة (0 = بلا حد)', 'Concurrent locations limit (0 = none)')}>
              <input type="number" min={0} value={form.location_limit} onChange={(e) => setForm({ ...form, location_limit: Number(e.target.value) })} />
            </Field>
            <Field label={L_('حد الظهور المميز', 'Featured placement limit')}>
              <input type="number" min={0} value={form.featured_limit} onChange={(e) => setForm({ ...form, featured_limit: Number(e.target.value) })} />
            </Field>
            <Field label={L_('حجم اللافتة في اللعبة', 'In-game sign scale')}>
              <input
                type="number"
                min={0.5}
                max={2.5}
                step="0.05"
                value={form.benefits.signScale}
                onChange={(e) => setForm({ ...form, benefits: { ...form.benefits, signScale: Number(e.target.value) } })}
              />
            </Field>
            <Field label={L_('مستوى التحليلات', 'Analytics level')}>
              <select
                value={form.benefits.analyticsLevel}
                onChange={(e) => setForm({ ...form, benefits: { ...form.benefits, analyticsLevel: e.target.value as 'basic' | 'expanded' } })}
              >
                <option value="basic">basic</option>
                <option value="expanded">expanded</option>
              </select>
            </Field>
            <Field label={L_('الوصف بالعربية', 'Description (Arabic)')}>
              <input dir="rtl" value={form.description_ar} onChange={(e) => setForm({ ...form, description_ar: e.target.value })} />
            </Field>
            <Field label={L_('الوصف بالإنجليزية', 'Description (English)')}>
              <input dir="ltr" value={form.description_en} onChange={(e) => setForm({ ...form, description_en: e.target.value })} />
            </Field>
          </div>
          <h3>{L_('المزايا داخل اللعبة', 'In-game benefits')}</h3>
          <div className="a-grid">
            {BENEFIT_LABELS.map(([k, ar, en]) => (
              <label key={k} className="a-check">
                <input
                  type="checkbox"
                  checked={form.benefits[k] as boolean}
                  onChange={(e) => setForm({ ...form, benefits: { ...form.benefits, [k]: e.target.checked } })}
                  data-testid={`benefit-${k}`}
                />
                {pick(ar, en)}
              </label>
            ))}
          </div>
          <h3>{L_('التصنيفات المؤهلة (فارغ = الكل)', 'Eligible categories (none = all)')}</h3>
          <div className="a-grid">
            {data.categories.map((c) => (
              <label key={c.id} className="a-check">
                <input
                  type="checkbox"
                  checked={form.eligible_category_ids.includes(c.id)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      eligible_category_ids: e.target.checked ? [...form.eligible_category_ids, c.id] : form.eligible_category_ids.filter((x) => x !== c.id),
                    })
                  }
                />
                {pick(c.name_ar, c.name_en)}
              </label>
            ))}
          </div>
          <h3>{L_('قائمة المزايا المعروضة', 'Feature list shown to merchants')}</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {form.features.map((f, i) => (
              <div key={i} className="a-row" style={{ flexWrap: 'nowrap' }}>
                <input className="a-input" dir="rtl" style={{ flex: 1 }} value={f.ar} onChange={(e) => setForm({ ...form, features: form.features.map((x, k) => (k === i ? { ...x, ar: e.target.value } : x)) })} />
                <input className="a-input" dir="ltr" style={{ flex: 1 }} value={f.en} onChange={(e) => setForm({ ...form, features: form.features.map((x, k) => (k === i ? { ...x, en: e.target.value } : x)) })} />
                <button className="a-btn sm danger" onClick={() => setForm({ ...form, features: form.features.filter((_, k) => k !== i) })}>
                  ✕
                </button>
              </div>
            ))}
            <button className="a-btn sm" style={{ justifySelf: 'start' }} onClick={() => setForm({ ...form, features: [...form.features, { ar: '', en: '' }] })}>
              ＋ {L_('ميزة', 'Feature')}
            </button>
          </div>
          <label className="a-check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            {L_('فعّالة', 'Active')}
          </label>
          <div className="a-row" style={{ marginTop: 10 }}>
            <button className="a-btn primary" onClick={() => void save()} data-testid="save-package">
              💾 {L_('حفظ', 'Save')}
            </button>
            <button className="a-btn" onClick={() => setForm(null)}>
              {L_('إلغاء', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      <div className="a-row">
        <h2 style={{ margin: 0 }}>{L_('باقات الرعاية', 'Sponsorship packages')}</h2>
        <span className="a-spacer" />
        <button
          className="a-btn primary"
          onClick={() =>
            setForm({
              slug: '',
              name_ar: '',
              name_en: '',
              description_ar: '',
              description_en: '',
              price_usd: 0,
              period: 'month',
              features: [],
              benefits: { highlightMarker: false, featuredCard: false, enhancedSignage: false, brandedMissions: false, loadingZoneBranding: false, districtSponsor: false, analyticsLevel: 'basic', signScale: 1 },
              location_limit: 0,
              featured_limit: 0,
              eligible_category_ids: [],
              default_duration_days: 30,
              active: true,
              sort: data.packages.length,
            })
          }
        >
          ＋ {L_('باقة جديدة', 'New package')}
        </button>
      </div>
      <div className="a-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
        {data.packages.map((p) => (
          <div key={p.id} className="a-card" data-testid={`package-${p.slug}`}>
            <div className="a-row">
              <b>{pick(p.name_ar, p.name_en)}</b>
              <span className="a-spacer" />
              <StatusBadge status={p.active ? 'active' : 'disabled'} />
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>
              ${p.price_usd} <span className="small" style={{ color: 'var(--a-muted)' }}>/ {p.period} · {L_('توضيحي', 'illustrative')}</span>
            </div>
            <ul className="small" style={{ paddingInlineStart: 18 }}>
              {p.features.map((f, i) => (
                <li key={i}>{pick(f.ar, f.en)}</li>
              ))}
            </ul>
            <div className="small" style={{ color: 'var(--a-muted)' }}>
              {L_('حد المواقع', 'Location limit')}: {p.location_limit || '∞'} · {L_('حد الظهور المميز', 'Featured limit')}: {p.featured_limit} ·{' '}
              {L_('الرعاة الحاليون', 'Current sponsors')}: {data.sponsorships.filter((s) => s.package_id === p.id && s.state === 'active').length}
            </div>
            <button className="a-btn sm" style={{ marginTop: 8 }} onClick={() => setForm(p)} data-testid={`edit-package-${p.slug}`}>
              ✎ {L_('تعديل', 'Edit')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- sponsorships

export function SponsorshipsPage() {
  const { pick } = useI18n();
  const L_ = useL();
  const data = useAdminData();
  const [form, setForm] = useState<{ id?: number; merchant_id: number; package_id: number; starts_on: string; ends_on: string; status: 'active' | 'paused' | 'cancelled'; notes: string } | null>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const save = async () => {
    if (!form) return;
    try {
      const { id, ...body } = form;
      if (id) await api.put(`/api/admin/sponsorships/${id}`, body);
      else await api.post('/api/admin/sponsorships', body);
      await data.reload(['sponsorships', 'merchants']);
      setForm(null);
      setMsg({ kind: 'ok', text: L_('تم حفظ الرعاية (عرض فقط — لا دفع)', 'Sponsorship saved (demo only — no payment taken)') });
    } catch (e) {
      setMsg({ kind: 'err', text: errorsFrom(e).message });
    }
  };
  const newForm = () => {
    const pkg = data.packages.find((p) => p.active) ?? data.packages[0];
    const today = todayErbil();
    setForm({ merchant_id: data.merchants[0]?.id ?? 0, package_id: pkg?.id ?? 0, starts_on: today, ends_on: addDays(today, pkg?.default_duration_days ?? 30), status: 'active', notes: '' });
  };
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="a-alert info">
        {L_(
          'تعيين الرعاية هنا إجراء توضيحي للعرض: لا يمثل عقداً ولا دفعة حقيقية. انتهاء الرعاية أو إيقافها لا يحذف النشاط.',
          'Assigning a sponsorship here is a demo action: it is not a contract and no payment is taken. Expired or paused sponsorships never delete the business.',
        )}
      </div>
      <Msg msg={msg} />
      {form && (
        <div className="a-card" data-testid="sponsorship-form">
          <h2>{form.id ? L_('تعديل رعاية', 'Edit sponsorship') : L_('رعاية جديدة', 'New sponsorship')}</h2>
          <div className="a-grid">
            <Field label={L_('النشاط', 'Business')}>
              <select value={form.merchant_id} onChange={(e) => setForm({ ...form, merchant_id: Number(e.target.value) })}>
                {data.merchants.map((m) => (
                  <option key={m.id} value={m.id}>
                    {pick(m.name_ar, m.name_en)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={L_('الباقة', 'Package')}>
              <select
                value={form.package_id}
                onChange={(e) => {
                  const p = data.packages.find((x) => x.id === Number(e.target.value));
                  setForm({ ...form, package_id: Number(e.target.value), ends_on: addDays(form.starts_on, p?.default_duration_days ?? 30) });
                }}
              >
                {data.packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {pick(p.name_ar, p.name_en)} (${p.price_usd})
                  </option>
                ))}
              </select>
            </Field>
            <Field label={L_('البداية', 'Start')}>
              <input type="date" value={form.starts_on} onChange={(e) => setForm({ ...form, starts_on: e.target.value })} />
            </Field>
            <Field label={L_('النهاية', 'End')}>
              <input type="date" value={form.ends_on} onChange={(e) => setForm({ ...form, ends_on: e.target.value })} />
            </Field>
            <Field label={L_('الحالة', 'Status')}>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as 'active' | 'paused' | 'cancelled' })}>
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="cancelled">cancelled</option>
              </select>
            </Field>
            <Field label={L_('ملاحظات', 'Notes')}>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </Field>
          </div>
          <div className="a-row" style={{ marginTop: 10 }}>
            <button className="a-btn primary" onClick={() => void save()} data-testid="save-sponsorship">
              💾 {L_('حفظ (عرض فقط)', 'Save (demo only)')}
            </button>
            <button className="a-btn" onClick={() => setForm(null)}>
              {L_('إلغاء', 'Cancel')}
            </button>
          </div>
        </div>
      )}
      <div className="a-card">
        <div className="a-row">
          <h2 style={{ margin: 0 }}>{L_('الرعايات', 'Sponsorships')}</h2>
          <span className="a-spacer" />
          <button className="a-btn primary" onClick={newForm} data-testid="new-sponsorship">
            ＋ {L_('رعاية جديدة', 'New sponsorship')}
          </button>
        </div>
        <div className="a-table-wrap" style={{ marginTop: 10 }}>
          <table className="a-table">
            <thead>
              <tr>
                <th>{L_('النشاط', 'Business')}</th>
                <th>{L_('الباقة', 'Package')}</th>
                <th>{L_('من', 'From')}</th>
                <th>{L_('إلى', 'To')}</th>
                <th>{L_('الحالة الآن', 'State today')}</th>
                <th>{L_('ملاحظات', 'Notes')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.sponsorships.map((s: SponsorshipRow) => (
                <tr key={s.id}>
                  <td>{pick(s.merchant_name_ar, s.merchant_name_en)}</td>
                  <td>
                    {pick(s.package_name_ar, s.package_name_en)} (${s.price_usd})
                  </td>
                  <td>{s.starts_on}</td>
                  <td>{s.ends_on}</td>
                  <td>
                    <StatusBadge status={s.state} />
                  </td>
                  <td className="small">{s.notes}</td>
                  <td>
                    <button className="a-btn sm" onClick={() => setForm({ id: s.id, merchant_id: s.merchant_id, package_id: s.package_id, starts_on: s.starts_on, ends_on: s.ends_on, status: s.status, notes: s.notes })}>
                      ✎
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- audit + demo

export function AuditPage() {
  const L_ = useL();
  const [rows, setRows] = useState<{ id: number; action: string; entity: string; entity_id: string; details: unknown; created_at: string; admin_email: string }[]>([]);
  useEffect(() => {
    api.get<typeof rows>('/api/admin/audit').then(setRows).catch(() => {});
  }, []);
  return (
    <div className="a-card">
      <h2>{L_('سجل التدقيق', 'Audit log')}</h2>
      <div className="a-table-wrap">
        <table className="a-table">
          <thead>
            <tr>
              <th>{L_('الوقت', 'Time')}</th>
              <th>{L_('المسؤول', 'Admin')}</th>
              <th>{L_('الإجراء', 'Action')}</th>
              <th>{L_('العنصر', 'Item')}</th>
              <th>{L_('التفاصيل', 'Details')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td dir="ltr">{new Date(r.created_at).toLocaleString()}</td>
                <td>{r.admin_email ?? '—'}</td>
                <td>{r.action}</td>
                <td>
                  {r.entity} {r.entity_id}
                </td>
                <td className="small" dir="ltr" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {JSON.stringify(r.details)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function DemoPage({ enabled }: { enabled: boolean }) {
  const L_ = useL();
  const data = useAdminData();
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="a-card" style={{ maxWidth: 640 }}>
      <h2>{L_('إعادة ضبط بيانات العرض', 'Reset the demo data')}</h2>
      <p>
        {L_(
          'يحذف كل الأنشطة والمهام والباقات والرعايات وتقدم اللاعبين والتحليلات، ثم يعيد البيانات الوهمية الأصلية. حسابات المسؤولين وسجل التدقيق لا تُحذف.',
          'Deletes all businesses, missions, packages, sponsorships, player progress and analytics, then restores the original fictional dataset. Admin accounts and the audit log are kept.',
        )}
      </p>
      {!enabled && (
        <div className="a-alert err">
          {L_('إعادة الضبط معطلة على هذا الخادم (DEMO_MODE غير مفعّل).', 'Reset is disabled on this deployment (DEMO_MODE is off).')}
        </div>
      )}
      <Msg msg={msg} />
      <Field label={L_('اكتب RESET للتأكيد', 'Type RESET to confirm')}>
        <input dir="ltr" value={confirm} onChange={(e) => setConfirm(e.target.value)} disabled={!enabled} data-testid="reset-confirm" />
      </Field>
      <button
        className="a-btn danger"
        style={{ marginTop: 10 }}
        disabled={!enabled || confirm !== 'RESET' || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await api.post('/api/admin/demo/reset', { confirm });
            await data.reload();
            setConfirm('');
            setMsg({ kind: 'ok', text: L_('تمت استعادة بيانات العرض الأصلية', 'The original demo data has been restored') });
          } catch (e) {
            setMsg({ kind: 'err', text: errorsFrom(e).message });
          } finally {
            setBusy(false);
          }
        }}
        data-testid="reset-demo"
      >
        ↺ {L_('إعادة الضبط', 'Reset demo')}
      </button>
    </div>
  );
}
