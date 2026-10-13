import { useEffect, useState } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';
import { StatusBadge, addDays, todayErbil, useL } from './common';

const TYPES = ['profile_view', 'map_discovery', 'mission_offer', 'mission_accept', 'mission_complete'] as const;
type EventType = (typeof TYPES)[number];

// categorical slots 1–5 of the reference palette, fixed order (validated for adjacent pairs)
const COLORS: Record<EventType, string> = {
  profile_view: '#2a78d6',
  map_discovery: '#eb6834',
  mission_offer: '#1baf7a',
  mission_accept: '#eda100',
  mission_complete: '#e87ba4',
};

const LABELS: Record<EventType, [string, string]> = {
  profile_view: ['مشاهدات الملف', 'Profile views'],
  map_discovery: ['اكتشافات الخريطة', 'Map discoveries'],
  mission_offer: ['عروض المهام', 'Mission offers'],
  mission_accept: ['قبول المهام', 'Mission acceptances'],
  mission_complete: ['توصيلات مكتملة', 'Completed deliveries'],
};

interface MerchantRow extends Record<EventType, number> {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  status: string;
  category_ar: string;
  category_en: string;
  demo_events: number;
  all_events: number;
  sponsorship: { state: string; starts_on: string; ends_on: string; package_name_ar: string; package_name_en: string; analytics_level: string } | null;
}

interface Report {
  from: string;
  to: string;
  includeDemo: boolean;
  totals: Partial<Record<EventType, number>>;
  demoEvents: number;
  totalEvents: number;
  activeSponsoredLocations: number;
  series: { day: string; type: EventType; n: number }[];
  merchants: MerchantRow[];
}

export function AnalyticsPage() {
  const { pick, fmtNumber } = useI18n();
  const L = useL();
  const [range, setRange] = useState({ from: addDays(todayErbil(), -13), to: todayErbil(), includeDemo: true });
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ day: string; x: number } | null>(null);
  const [sortBy, setSortBy] = useState<EventType | 'all_events'>('all_events');

  useEffect(() => {
    api
      .get<Report>(`/api/admin/analytics?from=${range.from}&to=${range.to}&includeDemo=${range.includeDemo}`)
      .then((r) => {
        setReport(r);
        setError(null);
      })
      .catch((e) => setError(String(e.message ?? e)));
  }, [range]);

  const days: string[] = [];
  if (report) for (let d = report.from; d <= report.to; d = addDays(d, 1)) days.push(d);
  const byDay = new Map<string, Partial<Record<EventType, number>>>();
  for (const s of report?.series ?? []) {
    const row = byDay.get(s.day) ?? {};
    row[s.type] = s.n;
    byDay.set(s.day, row);
  }
  const dayTotal = (d: string) => TYPES.reduce((a, t) => a + (byDay.get(d)?.[t] ?? 0), 0);
  const maxDay = Math.max(1, ...days.map(dayTotal));
  const rows = [...(report?.merchants ?? [])].sort((a, b) => b[sortBy] - a[sortBy]);
  const maxCol = (k: EventType) => Math.max(1, ...rows.map((r) => r[k]));
  const realEvents = report ? report.totalEvents - report.demoEvents : 0;

  return (
    <div style={{ display: 'grid', gap: 12 }} data-testid="analytics">
      <div className="a-card">
        <div className="a-row">
          <h2 style={{ margin: 0 }}>{L('تحليلات التجار', 'Merchant analytics')}</h2>
          <span className="a-spacer" />
          <label className="a-field" style={{ flexDirection: 'row', alignItems: 'center' }}>
            {L('من', 'From')}
            <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          </label>
          <label className="a-field" style={{ flexDirection: 'row', alignItems: 'center' }}>
            {L('إلى', 'To')}
            <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          </label>
          {[7, 14, 30].map((n) => (
            <button key={n} className="a-btn sm" onClick={() => setRange({ ...range, from: addDays(todayErbil(), -(n - 1)), to: todayErbil() })}>
              {n} {L('يوم', 'd')}
            </button>
          ))}
          <label className="a-check">
            <input type="checkbox" checked={range.includeDemo} onChange={(e) => setRange({ ...range, includeDemo: e.target.checked })} data-testid="include-demo" />
            {L('تضمين بيانات العرض', 'Include demo data')}
          </label>
        </div>
        {error && <div className="a-alert err">{error}</div>}
        {report && (
          <div className="a-alert info" style={{ marginTop: 10, marginBottom: 0 }} data-testid="demo-label">
            <span className="a-badge demo">{L('بيانات عرض', 'Demo data')}</span>{' '}
            {L(
              `${fmtNumber(report.demoEvents)} حدث توضيحي مُولَّد مسبقاً و${fmtNumber(realEvents)} حدث حقيقي من تشغيل النموذج. لا تمثل طلبات أو زبائن أو إيرادات حقيقية.`,
              `${fmtNumber(report.demoEvents)} pre-generated illustrative events and ${fmtNumber(realEvents)} real events recorded by the running prototype. None represent real orders, customers or revenue.`,
            )}
          </div>
        )}
      </div>

      {report && (
        <>
          <div className="a-grid">
            {TYPES.map((t) => (
              <div key={t} className="stat-tile">
                <span>{pick(...LABELS[t])}</span>
                <b>{fmtNumber(report.totals[t] ?? 0)}</b>
              </div>
            ))}
            <div className="stat-tile">
              <span>{L('مواقع برعاية فعّالة', 'Active sponsored locations')}</span>
              <b>{report.activeSponsoredLocations}</b>
            </div>
          </div>

          <div className="a-card">
            <h2>{L('الأحداث اليومية', 'Events per day')}</h2>
            <div className="legend">
              {TYPES.map((t) => (
                <span key={t} style={{ ['--c' as string]: COLORS[t] }}>
                  {pick(...LABELS[t])}
                </span>
              ))}
            </div>
            <div style={{ position: 'relative' }} onMouseLeave={() => setHover(null)}>
              <div className="bars" dir="ltr" role="img" aria-label={L('أعمدة الأحداث اليومية', 'Daily events stacked bars')}>
                {days.map((d, i) => (
                  <div
                    key={d}
                    className="col"
                    style={{ height: '100%', cursor: 'default' }}
                    onMouseEnter={() => setHover({ day: d, x: (i + 0.5) / days.length })}
                  >
                    {TYPES.map((t) => {
                      const n = byDay.get(d)?.[t] ?? 0;
                      if (!n) return null;
                      return (
                        <i
                          key={t}
                          style={{
                            height: `calc(${(n / maxDay) * 100}% - 2px)`,
                            background: COLORS[t],
                            marginTop: 2,
                            borderRadius: t === TYPES.filter((x) => byDay.get(d)?.[x]).at(-1) ? '4px 4px 0 0' : 0,
                            opacity: hover && hover.day !== d ? 0.45 : 1,
                          }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
              {hover && (
                <div
                  className="a-card small"
                  style={{ position: 'absolute', top: 0, left: `${Math.min(80, Math.max(0, hover.x * 100 - 10))}%`, padding: 8, pointerEvents: 'none', boxShadow: '0 6px 18px rgba(0,0,0,.12)' }}
                >
                  <b dir="ltr">{hover.day}</b>
                  {TYPES.map((t) => (
                    <div key={t} className="a-row" style={{ gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: COLORS[t] }} />
                      {pick(...LABELS[t])}: <b>{byDay.get(hover.day)?.[t] ?? 0}</b>
                    </div>
                  ))}
                </div>
              )}
              <div className="a-row small" dir="ltr" style={{ justifyContent: 'space-between', color: 'var(--a-muted)' }}>
                <span>{days[0]}</span>
                <span>{days.at(-1)}</span>
              </div>
            </div>
          </div>

          <div className="a-card">
            <div className="a-row">
              <h2 style={{ margin: 0 }}>{L('مقارنة الأنشطة', 'Business comparison')}</h2>
              <span className="a-spacer" />
              <select className="a-input" value={sortBy} onChange={(e) => setSortBy(e.target.value as EventType | 'all_events')} aria-label="sort">
                <option value="all_events">{L('ترتيب: كل الأحداث', 'Sort: all events')}</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {L('ترتيب: ', 'Sort: ')}
                    {pick(...LABELS[t])}
                  </option>
                ))}
              </select>
            </div>
            <div className="a-table-wrap" style={{ marginTop: 10 }}>
              <table className="a-table" data-testid="analytics-table">
                <thead>
                  <tr>
                    <th>{L('النشاط', 'Business')}</th>
                    {TYPES.map((t) => (
                      <th key={t}>{pick(...LABELS[t])}</th>
                    ))}
                    <th>{L('الرعاية', 'Sponsorship')}</th>
                    <th>{L('الحملة', 'Campaign')}</th>
                    <th>{L('منها توضيحي', 'Demo share')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <b>{pick(r.name_ar, r.name_en)}</b>
                        <div className="small" style={{ color: 'var(--a-muted)' }}>
                          {pick(r.category_ar, r.category_en)} {r.status !== 'active' && <StatusBadge status={r.status} />}
                        </div>
                      </td>
                      {TYPES.map((t) => (
                        <td key={t}>
                          <div style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtNumber(r[t])}</div>
                          <div className="meter">
                            <i style={{ width: `${(r[t] / maxCol(t)) * 100}%`, background: COLORS[t] }} />
                          </div>
                        </td>
                      ))}
                      <td>
                        {r.sponsorship ? (
                          <>
                            {pick(r.sponsorship.package_name_ar, r.sponsorship.package_name_en)} <StatusBadge status={r.sponsorship.state} />
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td dir="ltr" className="small">
                        {r.sponsorship ? `${r.sponsorship.starts_on} → ${r.sponsorship.ends_on}` : '—'}
                      </td>
                      <td>{r.all_events ? `${Math.round((r.demo_events / r.all_events) * 100)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
