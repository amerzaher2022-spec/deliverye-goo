import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { useI18n } from '../i18n';
import { AnalyticsPage } from './Analytics';
import { AdminDataProvider, Field, useAdminData, useL } from './common';
import { MapManager } from './MapManager';
import { AuditPage, CategoriesPage, DemoPage, MerchantsPage, MissionsPage, PackagesPage, SponsorshipsPage } from './pages';

interface Me {
  id: number;
  email: string;
  name: string;
  demoMode: boolean;
}

type Tab = 'map' | 'merchants' | 'missions' | 'categories' | 'packages' | 'sponsorships' | 'analytics' | 'audit' | 'demo';

function Login({ onDone }: { onDone: (me: Me) => void }) {
  const L = useL();
  const { lang, setLang } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="admin login">
      <form
        className="a-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            onDone(await api.post<Me>('/api/admin/login', { email, password }));
          } catch (e2) {
            setErr(e2 instanceof ApiError ? e2.message : String(e2));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="a-row">
          <h2 style={{ margin: 0 }}>🛠 {L('لوحة إدارة عالم توصيل أربيل', 'Erbil Delivery World admin')}</h2>
          <span className="a-spacer" />
          <button type="button" className="a-btn sm" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            {lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
        {err && <div className="a-alert err" style={{ marginTop: 10 }}>{err}</div>}
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <Field label={L('البريد الإلكتروني', 'Email')}>
            <input type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="login-email" />
          </Field>
          <Field label={L('كلمة المرور', 'Password')}>
            <input type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="login-password" />
          </Field>
          <button className="a-btn primary" disabled={busy} data-testid="login-submit">
            {busy ? '…' : L('تسجيل الدخول', 'Sign in')}
          </button>
          <a href="/" className="small">
            ← {L('العودة إلى اللعبة', 'Back to the game')}
          </a>
        </div>
      </form>
    </div>
  );
}

function Overview() {
  const L = useL();
  const [o, setO] = useState<Record<string, number> | null>(null);
  const data = useAdminData();
  useEffect(() => {
    api.get<Record<string, number>>('/api/admin/overview').then(setO).catch(() => {});
  }, [data.merchants, data.missions]);
  if (!o) return null;
  const tiles: [string, string, string][] = [
    ['active_merchants', 'أنشطة فعّالة', 'Active businesses'],
    ['active_missions', 'مهام فعّالة', 'Active missions'],
    ['active_sponsorships', 'رعايات فعّالة', 'Active sponsorships'],
    ['players', 'لاعبون', 'Players'],
    ['deliveries', 'توصيلات مكتملة', 'Completed deliveries'],
  ];
  return (
    <div className="a-grid" style={{ marginBottom: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
      {tiles.map(([k, ar, en]) => (
        <div key={k} className="stat-tile">
          <span>{L(ar, en)}</span>
          <b>{o[k] ?? 0}</b>
        </div>
      ))}
    </div>
  );
}

function Shell({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const L = useL();
  const { lang, setLang } = useI18n();
  const [tab, setTab] = useState<Tab>(() => {
    const h = location.hash.slice(1) as Tab;
    return h || 'map';
  });
  const [focus, setFocus] = useState<number | null>(null);
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);
  const tabs: [Tab, string, string][] = [
    ['map', '🗺 خريطة المدينة', '🗺 City map'],
    ['merchants', '🏪 الأنشطة', '🏪 Businesses'],
    ['missions', '📦 المهام', '📦 Missions'],
    ['categories', '🏷 التصنيفات', '🏷 Categories'],
    ['packages', '⭐ الباقات', '⭐ Packages'],
    ['sponsorships', '🤝 الرعايات', '🤝 Sponsorships'],
    ['analytics', '📊 التحليلات', '📊 Analytics'],
    ['audit', '📝 السجل', '📝 Audit log'],
    ['demo', '↺ العرض', '↺ Demo reset'],
  ];
  return (
    <div className="admin">
      <header className="a-top">
        <h1>🛠 {L('لوحة إدارة عالم توصيل أربيل', 'Erbil Delivery World — admin')}</h1>
        <span className="who">{me.email}</span>
        <button className="a-btn sm" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} data-testid="admin-lang">
          {lang === 'ar' ? 'English' : 'العربية'}
        </button>
        <a className="a-btn sm" href="/" style={{ textDecoration: 'none' }}>
          🎮 {L('اللعبة', 'Game')}
        </a>
        <button className="a-btn sm" onClick={onLogout}>
          {L('خروج', 'Sign out')}
        </button>
      </header>
      <nav className="a-nav">
        {tabs.map(([k, ar, en]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} data-testid={`tab-${k}`}>
            {L(ar, en)}
          </button>
        ))}
      </nav>
      <main className="a-main">
        {tab !== 'map' && <Overview />}
        {tab === 'map' && <MapManager key={focus ?? 'map'} initialSelect={focus} />}
        {tab === 'merchants' && (
          <MerchantsPage
            onEditOnMap={(id) => {
              setFocus(id);
              setTab('map');
            }}
          />
        )}
        {tab === 'missions' && <MissionsPage />}
        {tab === 'categories' && <CategoriesPage />}
        {tab === 'packages' && <PackagesPage />}
        {tab === 'sponsorships' && <SponsorshipsPage />}
        {tab === 'analytics' && <AnalyticsPage />}
        {tab === 'audit' && <AuditPage />}
        {tab === 'demo' && <DemoPage enabled={me.demoMode} />}
      </main>
    </div>
  );
}

export default function AdminApp() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    api
      .get<Me>('/api/admin/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  if (me === undefined) return <div className="admin login">…</div>;
  if (!me) return <Login onDone={setMe} />;
  return (
    <AdminDataProvider>
      <Shell
        me={me}
        onLogout={async () => {
          await api.post('/api/admin/logout').catch(() => {});
          setMe(null);
        }}
      />
    </AdminDataProvider>
  );
}
