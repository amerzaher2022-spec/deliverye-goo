import { useEffect, useRef, useState } from 'react';
import { paintSign } from '../signPainter';
import { BUILDING_TYPES, SIGN_POSITIONS, SIGN_SIZES, type BuildingType, type GeoPoint, type Merchant, type MerchantHours, type SignPosition, type SignSize } from '../../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { Icon } from '../icons';
import { Field, StatusBadge, errorsFrom, pointLabel, useAdminData, useL, type FieldErrors } from './common';

export type { PointKey } from './common';
import type { PointKey } from './common';

export interface DraftMenuItem {
  id?: number;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  price_iqd: number | null;
}

export interface Draft {
  id?: number;
  name_ar: string;
  name_en: string;
  category_id: number;
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
  hours: MerchantHours;
  hoursEnabled: boolean;
  phone: string;
  website: string;
  interior_enabled: boolean;
  notes: string;
  menu: DraftMenuItem[];
}

export function emptyDraft(categoryId: number, buildingType: BuildingType): Draft {
  const p = { lat: 0, lng: 0 };
  return {
    name_ar: '',
    name_en: '',
    category_id: categoryId,
    description_ar: '',
    description_en: '',
    address_ar: '',
    address_en: '',
    location: p,
    entrance: p,
    pickup: p,
    dropoff: p,
    building_type: buildingType,
    sign_size: 'medium',
    sign_position: 'front',
    brand_color: '#c0392b',
    hours: { open: '09:00', close: '23:00', days: 'Daily' },
    hoursEnabled: true,
    phone: '',
    website: '',
    interior_enabled: false,
    notes: '',
    menu: [],
  };
}

const BUILDING_LABELS: Record<BuildingType, [string, string]> = {
  restaurant: ['مطعم / مقهى', 'Restaurant / café'],
  shop: ['متجر', 'Shop'],
  factory: ['مصنع', 'Factory'],
  warehouse: ['مستودع', 'Warehouse'],
  office: ['مكتب شركة', 'Corporate office'],
};

export function MerchantEditor({
  draft,
  setDraft,
  tool,
  setTool,
  onSnap,
  onDone,
}: {
  draft: Draft;
  setDraft: (fn: (d: Draft | null) => Draft | null) => void;
  tool: PointKey | null;
  setTool: (t: PointKey | null) => void;
  onSnap: () => void;
  onDone: (m: Merchant | null) => void;
}) {
  const { lang, pick } = useI18n();
  const L = useL();
  const data = useAdminData();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<{ kind: 'err' | 'ok'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState<{ logo?: File; cover?: File }>({});
  const existing = draft.id ? data.merchants.find((m) => m.id === draft.id) : undefined;

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const save = async () => {
    setSaving(true);
    setErrors({});
    setMessage(null);
    const body = {
      name_ar: draft.name_ar,
      name_en: draft.name_en,
      category_id: draft.category_id,
      description_ar: draft.description_ar,
      description_en: draft.description_en,
      address_ar: draft.address_ar,
      address_en: draft.address_en,
      location: draft.location,
      entrance: draft.entrance,
      pickup: draft.pickup,
      dropoff: draft.dropoff,
      building_type: draft.building_type,
      sign_size: draft.sign_size,
      sign_position: draft.sign_position,
      brand_color: draft.brand_color,
      hours: draft.hoursEnabled ? draft.hours : null,
      phone: draft.phone,
      website: draft.website,
      interior_enabled: draft.interior_enabled,
      notes: draft.notes,
      menu: draft.menu.filter((i) => i.name_ar.trim() || i.name_en.trim()),
    };
    try {
      let m = draft.id ? await api.put<Merchant>(`/api/admin/merchants/${draft.id}`, body) : await api.post<Merchant>('/api/admin/merchants', body);
      for (const kind of ['logo', 'cover'] as const) {
        const f = pending[kind];
        if (f) m = await api.upload<Merchant>(`/api/admin/merchants/${m.id}/images/${kind}`, f);
      }
      data.upsertMerchant(m);
      void data.reload(['missions', 'sponsorships']);
      setPending({});
      onDone(m);
    } catch (e) {
      const { message: text, fields } = errorsFrom(e);
      setErrors(fields);
      setMessage({ kind: 'err', text });
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind: 'logo' | 'cover' | 'gallery', file: File | undefined) => {
    if (!file) return;
    if (!draft.id) {
      if (kind !== 'gallery') setPending((p) => ({ ...p, [kind]: file }));
      return;
    }
    try {
      const m = await api.upload<Merchant>(`/api/admin/merchants/${draft.id}/images/${kind}`, file);
      data.upsertMerchant(m);
      setMessage({ kind: 'ok', text: L('تم رفع الصورة وحفظها', 'Image uploaded and saved') });
    } catch (e) {
      setMessage({ kind: 'err', text: errorsFrom(e).message });
    }
  };

  const setStatus = async (status: 'active' | 'disabled' | 'archived') => {
    if (!draft.id) return;
    try {
      const m = await api.post<Merchant>(`/api/admin/merchants/${draft.id}/status`, { status });
      data.upsertMerchant(m);
      void data.reload(['missions']);
      setMessage({ kind: 'ok', text: L('تم تحديث الحالة', 'Status updated') });
    } catch (e) {
      setMessage({ kind: 'err', text: errorsFrom(e).message });
    }
  };

  const preview = (kind: 'logo' | 'cover') => {
    const f = pending[kind];
    if (f) return URL.createObjectURL(f);
    return kind === 'logo' ? existing?.logo_url : existing?.cover_url;
  };

  return (
    <div className="a-card" data-testid="merchant-editor">
      <div className="editor-head">
        {preview('logo') ? <img className="a-logo" style={{ width: 44, height: 44 }} src={preview('logo')!} alt="" /> : <span className="a-logo" style={{ width: 44, height: 44 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="small" style={{ color: 'var(--muted)' }}>
            {draft.id ? L('تعديل النشاط', 'Edit business') : L('نشاط جديد', 'New business')}
            {existing && ` · ${existing.code}`}
          </div>
          <div style={{ fontWeight: 600, fontSize: '1.02rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pick(draft.name_ar, draft.name_en) || L('بدون اسم', 'Untitled')}
          </div>
        </div>
        {existing && <StatusBadge status={existing.status} />}
      </div>
      {existing && (
        <div className="a-row" style={{ margin: '12px 0 4px' }}>
          <span className="small" style={{ color: 'var(--muted)' }}>
            {L('الحالة', 'Status')}
          </span>
          <div className="a-seg">
            <button className={existing.status === 'active' ? 'on' : ''} onClick={() => existing.status !== 'active' && void setStatus('active')} data-testid="restore-merchant">
              {L('فعّال', 'Active')}
            </button>
            <button className={existing.status === 'disabled' ? 'on' : ''} onClick={() => existing.status !== 'disabled' && void setStatus('disabled')} data-testid="disable-merchant">
              {L('معطّل', 'Disabled')}
            </button>
            <button className={existing.status === 'archived' ? 'on' : ''} onClick={() => existing.status !== 'archived' && void setStatus('archived')} data-testid="archive-merchant">
              {L('مؤرشف', 'Archived')}
            </button>
          </div>
        </div>
      )}
      {message && <div className={`a-alert ${message.kind}`} style={{ marginTop: 8 }} data-testid="editor-message">{message.text}</div>}

      <h3>{L('النقاط على الخريطة', 'Points on the map')}</h3>
      <div className="point-tools">
        {(['location', 'entrance', 'pickup', 'dropoff'] as const).map((k) => (
          <button key={k} type="button" className={tool === k ? 'on' : ''} onClick={() => setTool(tool === k ? null : k)} data-testid={`tool-${k}`}>
            {pointLabel(k, lang)}
            <small dir="ltr">
              {draft[k].lat.toFixed(5)}
              <br />
              {draft[k].lng.toFixed(5)}
            </small>
          </button>
        ))}
      </div>
      {(errors.location || errors.entrance || errors.pickup || errors.dropoff) && (
        <div className="a-alert err" style={{ marginTop: 6 }}>
          {['location', 'entrance', 'pickup', 'dropoff']
            .filter((k) => errors[k])
            .map((k) => `${pointLabel(k as PointKey, lang)}: ${errors[k]}`)
            .join(' · ')}
        </div>
      )}
      <div className="a-row" style={{ marginTop: 6 }}>
        <button className="a-btn sm" type="button" onClick={onSnap}>
          <Icon name="magnet" size={15} /> {L('ضبط المدخل والاستلام على أقرب شارع', 'Snap entrance & pickup to nearest road')}
        </button>
      </div>
      <p className="small" style={{ color: 'var(--a-muted)', margin: '6px 0 0' }}>
        {L('اسحب النقاط على الخريطة أو اختر نقطة ثم انقر على الخريطة.', 'Drag the points on the map, or choose a point and click the map.')}
      </p>

      <h3>{L('الهوية', 'Identity')}</h3>
      <div className="a-grid">
        <Field label={L('الاسم بالعربية', 'Arabic name')} error={errors.name_ar}>
          <input dir="rtl" value={draft.name_ar} onChange={(e) => set('name_ar', e.target.value)} data-testid="f-name_ar" />
        </Field>
        <Field label={L('الاسم بالإنجليزية', 'English name')} error={errors.name_en}>
          <input dir="ltr" value={draft.name_en} onChange={(e) => set('name_en', e.target.value)} data-testid="f-name_en" />
        </Field>
        <Field label={L('التصنيف', 'Category')} error={errors.category_id}>
          <select
            value={draft.category_id}
            onChange={(e) => {
              const c = data.categories.find((x) => x.id === Number(e.target.value));
              setDraft((d) => (d ? { ...d, category_id: Number(e.target.value), building_type: c?.default_building_type ?? d.building_type } : d));
            }}
            data-testid="f-category"
          >
            {data.categories
              .filter((c) => !c.archived || c.id === draft.category_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {pick(c.name_ar, c.name_en)}
                </option>
              ))}
          </select>
        </Field>
        <Field label={L('نوع المبنى', 'Building type')}>
          <select value={draft.building_type} onChange={(e) => set('building_type', e.target.value as BuildingType)} data-testid="f-building">
            {BUILDING_TYPES.map((b) => (
              <option key={b} value={b}>
                {pick(BUILDING_LABELS[b][0], BUILDING_LABELS[b][1])}
              </option>
            ))}
          </select>
        </Field>
        <Field label={L('لون العلامة', 'Brand colour')} error={errors.brand_color}>
          <input type="color" value={draft.brand_color} onChange={(e) => set('brand_color', e.target.value)} style={{ height: 36, padding: 2 }} />
        </Field>
        <Field label={L('حجم اللافتة', 'Sign size')}>
          <select value={draft.sign_size} onChange={(e) => set('sign_size', e.target.value as SignSize)}>
            {SIGN_SIZES.map((s) => (
              <option key={s} value={s}>
                {pick({ small: 'صغيرة', medium: 'متوسطة', large: 'كبيرة' }[s], s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={L('مكان اللافتة', 'Sign position')}>
          <select value={draft.sign_position} onChange={(e) => set('sign_position', e.target.value as SignPosition)}>
            {SIGN_POSITIONS.map((s) => (
              <option key={s} value={s}>
                {pick({ front: 'الواجهة', roof: 'السطح', pylon: 'عمود جانبي' }[s], { front: 'Storefront', roof: 'Roof', pylon: 'Pylon' }[s])}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <h3>{L('اللافتة داخل اللعبة', 'In-game sign')}</h3>
      <SignPreview nameAr={draft.name_ar} nameEn={draft.name_en} color={draft.brand_color} logoUrl={preview('logo') ?? null} />

      <h3>{L('الصور', 'Images')}</h3>
      <div className="a-grid">
        {(['logo', 'cover'] as const).map((kind) => (
          <div key={kind} className={`img-slot ${kind === 'cover' ? 'cover' : ''}`}>
            {preview(kind) ? <img src={preview(kind)!} alt="" data-testid={`preview-${kind}`} /> : <img alt="" />}
            <label className="a-field" style={{ flex: 1 }}>
              <span>{kind === 'logo' ? L('الشعار', 'Logo') : L('صورة الغلاف', 'Cover image')}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void upload(kind, e.target.files?.[0])} data-testid={`upload-${kind}`} />
            </label>
          </div>
        ))}
      </div>
      <p className="small" style={{ color: 'var(--a-muted)', margin: '4px 0' }}>
        PNG / JPEG / WebP · {L('حتى 2 ميغابايت', 'up to 2 MB')}
        {!draft.id && ` · ${L('تُرفع بعد الحفظ', 'uploaded on save')}`}
      </p>
      {draft.id && (
        <div>
          <label className="a-field">
            <span>{L('معرض الصور', 'Gallery')}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void upload('gallery', e.target.files?.[0])} />
          </label>
          <div className="a-row" style={{ marginTop: 6 }}>
            {existing?.gallery.map((g) => (
              <div key={g.id} style={{ position: 'relative' }}>
                <img src={g.url} alt="" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8 }} />
                <button
                  className="a-btn sm danger"
                  style={{ position: 'absolute', top: 2, insetInlineEnd: 2, padding: '0 6px' }}
                  onClick={async () => data.upsertMerchant(await api.del<Merchant>(`/api/admin/merchants/${draft.id}/gallery/${g.id}`))}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3>{L('التفاصيل', 'Details')}</h3>
      <div className="a-grid">
        <Field label={L('الوصف بالعربية', 'Description (Arabic)')} span={2}>
          <textarea dir="rtl" value={draft.description_ar} onChange={(e) => set('description_ar', e.target.value)} />
        </Field>
        <Field label={L('الوصف بالإنجليزية', 'Description (English)')} span={2}>
          <textarea dir="ltr" value={draft.description_en} onChange={(e) => set('description_en', e.target.value)} />
        </Field>
        <Field label={L('العنوان بالعربية', 'Address (Arabic)')}>
          <input dir="rtl" value={draft.address_ar} onChange={(e) => set('address_ar', e.target.value)} />
        </Field>
        <Field label={L('العنوان بالإنجليزية', 'Address (English)')}>
          <input dir="ltr" value={draft.address_en} onChange={(e) => set('address_en', e.target.value)} />
        </Field>
        <Field label={L('الهاتف (اختياري)', 'Phone (optional)')} error={errors.phone}>
          <input dir="ltr" value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label={L('الموقع الإلكتروني (اختياري)', 'Website (optional)')} error={errors.website}>
          <input dir="ltr" value={draft.website} onChange={(e) => set('website', e.target.value)} placeholder="https://" />
        </Field>
      </div>
      <div className="a-row" style={{ marginTop: 8 }}>
        <label className="a-check">
          <input type="checkbox" checked={draft.hoursEnabled} onChange={(e) => set('hoursEnabled', e.target.checked)} />
          {L('ساعات العمل (للمحاكاة)', 'Opening hours (simulation)')}
        </label>
        {draft.hoursEnabled && (
          <>
            <input className="a-input" type="time" value={draft.hours.open} onChange={(e) => set('hours', { ...draft.hours, open: e.target.value })} />
            –
            <input className="a-input" type="time" value={draft.hours.close} onChange={(e) => set('hours', { ...draft.hours, close: e.target.value })} />
            <input className="a-input" style={{ width: 100 }} value={draft.hours.days} onChange={(e) => set('hours', { ...draft.hours, days: e.target.value })} placeholder="Sat–Thu" />
          </>
        )}
      </div>
      <label className="a-check" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={draft.interior_enabled} onChange={(e) => set('interior_enabled', e.target.checked)} />
        {L('تفعيل مشهد الاستلام من الداخل', 'Enable the interior pickup scene')}
      </label>

      <h3>
        {draft.building_type === 'restaurant' ? L('قائمة الطعام (أسعار توضيحية)', 'Menu (illustrative prices)') : L('المنتجات / الخدمات', 'Products / services')}
      </h3>
      <div style={{ display: 'grid', gap: 6 }}>
        {draft.menu.map((item, i) => (
          <div key={i} className="a-row" style={{ flexWrap: 'nowrap' }}>
            <input className="a-input" dir="rtl" style={{ flex: 1 }} value={item.name_ar} placeholder={L('بالعربية', 'Arabic')} onChange={(e) => set('menu', draft.menu.map((x, k) => (k === i ? { ...x, name_ar: e.target.value } : x)))} data-testid={`menu-ar-${i}`} />
            <input className="a-input" dir="ltr" style={{ flex: 1 }} value={item.name_en} placeholder="English" onChange={(e) => set('menu', draft.menu.map((x, k) => (k === i ? { ...x, name_en: e.target.value } : x)))} data-testid={`menu-en-${i}`} />
            <input
              className="a-input"
              type="number"
              min={0}
              style={{ width: 95 }}
              value={item.price_iqd ?? ''}
              placeholder="IQD"
              onChange={(e) => set('menu', draft.menu.map((x, k) => (k === i ? { ...x, price_iqd: e.target.value === '' ? null : Number(e.target.value) } : x)))}
              data-testid={`menu-price-${i}`}
            />
            <button className="a-btn sm danger" type="button" onClick={() => set('menu', draft.menu.filter((_, k) => k !== i))}>
              <Icon name="close" size={14} />
            </button>
          </div>
        ))}
        <button
          className="a-btn sm"
          type="button"
          style={{ justifySelf: 'start' }}
          onClick={() => set('menu', [...draft.menu, { name_ar: '', name_en: '', description_ar: '', description_en: '', price_iqd: null }])}
          data-testid="menu-add"
        >
          <Icon name="plus" size={15} /> {L('إضافة صنف', 'Add item')}
        </button>
      </div>

      <h3>{L('ملاحظات إدارية', 'Admin notes')}</h3>
      <Field label="">
        <textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>

      <div className="editor-foot">
        <button className="a-btn primary" onClick={() => void save()} disabled={saving} data-testid="save-merchant">
          <Icon name="check" size={15} /> {saving ? L('جارٍ الحفظ…', 'Saving…') : L('حفظ التغييرات', 'Save changes')}
        </button>
        <button className="a-btn" onClick={() => onDone(null)} disabled={saving}>
          {L('إلغاء', 'Cancel')}
        </button>
        <span className="a-spacer" />
        {draft.id && (
          <a className="a-btn ghost" href={`/?focus=${draft.id}`} target="_blank" rel="noreferrer">
            <Icon name="external" size={15} /> {L('عرض في اللعبة', 'View in game')}
          </a>
        )}
      </div>
    </div>
  );
}

/** Live preview of the storefront sign, painted exactly as the game paints it. */
function SignPreview({ nameAr, nameEn, color, logoUrl }: { nameAr: string; nameEn: string; color: string; logoUrl: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [logo, setLogo] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!logoUrl) return setLogo(null);
    const img = new Image();
    img.onload = () => setLogo(img);
    img.onerror = () => setLogo(null);
    img.src = logoUrl;
  }, [logoUrl]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    void document.fonts.load('700 40px "IBM Plex Sans Arabic"').finally(() =>
      paintSign(c.getContext('2d')!, c.width, c.height, { nameAr, nameEn, color, logo }),
    );
  }, [nameAr, nameEn, color, logo]);
  return <canvas ref={ref} width={768} height={192} className="sign-preview" data-testid="sign-preview" />;
}
