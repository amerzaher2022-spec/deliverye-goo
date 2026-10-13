import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { useI18n } from '../i18n';
import { Icon, type IconName } from '../icons';
import '../styles/admin.css';
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

const NAV: { group: [string, string]; items: { tab: Tab; icon: IconName; label: [string, string]; desc: [string, string] }[] }[] = [
  {
    group: ['العمليات', 'Operations'],
    items: [
      { tab: 'map', icon: 'map', label: ['خريطة المدينة', 'City map'], desc: ['ضع الأنشطة على خريطة أربيل وحدد المداخل ونقاط الاستلام.', 'Place businesses on the Erbil map and set entrances and pickup points.'] },
      { tab: 'merchants', icon: 'store', label: ['الأنشطة التجارية', 'Businesses'], desc: ['كل الأنشطة الوهمية في العرض، مع حالتها ورعايتها.', 'Every demo business with its status and sponsorship.'] },
      { tab: 'missions', icon: 'package', label: ['مهام التوصيل', 'Delivery missions'], desc: ['المهام التي يقبلها اللاعبون داخل اللعبة.', 'The jobs players accept in the game.'] },
    ],
  },
  {
    group: ['التجاري', 'Commercial'],
    items: [
      { tab: 'packages', icon: 'star', label: ['باقات الرعاية', 'Sponsorship packages'], desc: ['باقات توضيحية — لا دفع ولا اشتراك في هذا النموذج.', 'Illustrative packages — no payment or subscription in this prototype.'] },
      { tab: 'sponsorships', icon: 'handshake', label: ['الرعايات', 'Sponsorships'], desc: ['إسناد الباقات للأنشطة وتواريخ الحملات.', 'Assign packages to businesses and set campaign dates.'] },
      { tab: 'analytics', icon: 'chart', label: ['التحليلات', 'Analytics'], desc: ['أحداث مسجلة من النموذج، مع تمييز بيانات العرض.', 'Events recorded by the prototype, with demo data labelled.'] },
    ],
  },
  {
    group: ['الإعدادات', 'Settings'],
    items: [
      { tab: 'categories', icon: 'tag', label: ['التصنيفات', 'Categories'], desc: ['تصنيفات الأنشطة ونوع المبنى الافتراضي لكل منها.', 'Business categories and their default building type.'] },
      { tab: 'audit', icon: 'file', label: ['سجل التدقيق', 'Audit log'], desc: ['كل تغيير أجراه المسؤولون.', 'Every change made by administrators.'] },
      { tab: 'demo', icon: 'reset', label: ['بيانات العرض', 'Demo data'], desc: ['استعادة البيانات الوهمية الأصلية.', 'Restore the original fictional dataset.'] },
    ],
  },
];

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
        <div className="a-row" style={{ marginBottom: 18 }}>
          <span className="a-brand-mark">
            <Icon name="package" size={18} />
          </span>
          <div>
            <div style={{ fontWeight: 600 }}>{L('عالم توصيل أربيل', 'Erbil Delivery World')}</div>
            <div className="small" style={{ color: 'var(--muted)' }}>
              {L('لوحة إدارة الأعمال', 'Business console')}
            </div>
          </div>
          <span className="a-spacer" />
          <button type="button" className="a-btn sm ghost" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}>
            <Icon name="globe" size={15} /> {lang === 'ar' ? 'EN' : 'ع'}
          </button>
        </div>
        <h2 style={{ fontSize: '1.15rem', margin: '0 0 4px' }}>{L('تسجيل الدخول', 'Sign in')}</h2>
        <p className="small" style={{ color: 'var(--muted)', margin: '0 0 14px' }}>
          {L('للمسؤولين المخولين فقط.', 'Authorised administrators only.')}
        </p>
        {err && (
          <div className="a-alert err">
            <Icon name="alert" size={16} /> {err}
          </div>
        )}
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label={L('البريد الإلكتروني', 'Email')}>
            <input type="email" dir="ltr" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required data-testid="login-email" />
          </Field>
          <Field label={L('كلمة المرور', 'Password')}>
            <input type="password" dir="ltr" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required data-testid="login-password" />
          </Field>
          <button className="a-btn primary" style={{ minHeight: 40 }} disabled={busy} data-testid="login-submit">
            {busy ? L('جارٍ الدخول…', 'Signing in…') : L('تسجيل الدخول', 'Sign in')}
          </button>
          <a href="/" className="small" style={{ color: 'var(--muted)', textAlign: 'center' }}>
            {L('العودة إلى اللعبة', 'Back to the game')}
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
  const tiles: [string, string, string][] = [
    ['active_merchants', 'أنشطة فعّالة', 'Active businesses'],
    ['active_missions', 'مهام فعّالة', 'Active missions'],
    ['active_sponsorships', 'رعايات فعّالة', 'Active sponsorships'],
    ['players', 'لاعبون', 'Players'],
    ['deliveries', 'توصيلات مكتملة', 'Completed deliveries'],
  ];
  return (
    <div className="a-grid" style={{ marginBottom: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
      {tiles.map(([k, ar, en]) => (
        <div key={k} className="stat-tile">
          <span>{L(ar, en)}</span>
          {o ? <b>{o[k] ?? 0}</b> : <div className="a-skeleton" style={{ width: 60, height: 24, marginTop: 6 }} />}
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
    return NAV.some((g) => g.items.some((i) => i.tab === h)) ? h : 'map';
  });
  const [focus, setFocus] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);
  const current = NAV.flatMap((g) => g.items).find((i) => i.tab === tab)!;
  const go = (t: Tab) => {
    setTab(t);
    setOpen(false);
  };
  return (
    <div className="admin">
      <div className={`a-shell ${open ? 'open' : ''}`}>
        <aside className="a-side" aria-label={L('التنقل', 'Navigation')}>
          <div className="a-brand">
            <span className="a-brand-mark">
              <Icon name="package" size={18} />
            </span>
            <div>
              <b>{L('عالم توصيل أربيل', 'Erbil Delivery World')}</b>
              <small>{L('لوحة إدارة الأعمال', 'Business console')}</small>
            </div>
          </div>
          {NAV.map((g) => (
            <div key={g.group[1]}>
              <div className="a-nav-group">{L(...g.group)}</div>
              {g.items.map((i) => (
                <button key={i.tab} className={`a-nav-item ${tab === i.tab ? 'on' : ''}`} onClick={() => go(i.tab)} data-testid={`tab-${i.tab}`}>
                  <Icon name={i.icon} size={17} />
                  {L(...i.label)}
                </button>
              ))}
            </div>
          ))}
          <div className="a-side-foot">
            <div className="a-user">
              <span className="a-avatar">{me.email.slice(0, 1).toUpperCase()}</span>
              <span>{me.email}</span>
            </div>
            <button className="a-nav-item" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} data-testid="admin-lang">
              <Icon name="globe" size={17} /> {lang === 'ar' ? 'English' : 'العربية'}
            </button>
            <a className="a-nav-item" href="/" style={{ textDecoration: 'none' }}>
              <Icon name="gamepad" size={17} /> {L('فتح اللعبة', 'Open the game')}
            </a>
            <button className="a-nav-item" onClick={onLogout}>
              <Icon name="logout" size={17} /> {L('تسجيل الخروج', 'Sign out')}
            </button>
          </div>
        </aside>
        <div className="a-scrim" onClick={() => setOpen(false)} />
        <div className="a-content">
          <header className="a-header">
            <button className="a-btn icon a-menu-btn" onClick={() => setOpen(true)} aria-label={L('القائمة', 'Menu')}>
              <Icon name="list" size={18} />
            </button>
            <div style={{ minWidth: 0 }}>
              <h1>{L(...current.label)}</h1>
              <p>{L(...current.desc)}</p>
            </div>
          </header>
          <main className="a-main">
            {(tab === 'merchants' || tab === 'missions' || tab === 'sponsorships') && <Overview />}
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
      </div>
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
  if (me === undefined)
    return (
      <div className="admin login">
        <div className="a-skeleton" style={{ width: 200 }} />
      </div>
    );
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
