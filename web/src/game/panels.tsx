import { useEffect, useState, type ReactNode } from 'react';
import { ACHIEVEMENTS, MISSION_TYPE_LABELS } from '../../../shared/rules';
import type { Merchant, Mission, MissionRun, PlayerProfile, SponsorshipPackage } from '../../../shared/types';
import { api } from '../api';
import { useI18n, type StringKey } from '../i18n';
import { Coin, Icon } from '../icons';
import { fmtClock, fmtDistance, isOpenNow } from './time';

export function Sheet({
  title,
  onClose,
  children,
  wide,
  icon,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  icon?: Parameters<typeof Icon>[0]['name'];
}) {
  const { t } = useI18n();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={wide ? { width: 'min(780px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="sheet-head">
          {icon && <Icon name={icon} size={18} style={{ color: 'var(--text-3)' }} />}
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('close')} style={{ background: 'transparent' }}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

function Reward({ coins, xp }: { coins: number; xp?: number }) {
  const { fmtNumber, t } = useI18n();
  return (
    <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
      <Coin /> {fmtNumber(coins)}
      {xp !== undefined && (
        <span className="faint" style={{ fontWeight: 500, marginInlineStart: 6 }}>
          +{xp} {t('xp')}
        </span>
      )}
    </span>
  );
}

export function MissionRow({
  mission,
  merchants,
  distanceToPickup,
  onAccept,
  busy,
  disabled,
}: {
  mission: Mission;
  merchants: Map<number, Merchant>;
  distanceToPickup: number | null;
  onAccept: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  const { t, pick, lang } = useI18n();
  const origin = merchants.get(mission.origin_merchant_id);
  const branded = mission.branded && !!origin?.sponsorship?.benefits.brandedMissions;
  return (
    <div className={`card ${branded ? 'featured' : ''}`} data-testid={`mission-${mission.id}`}>
      <div className="row-between" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          {origin?.logo_url && <img className="logo sm" src={origin.logo_url} alt="" />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{pick(mission.title_ar, mission.title_en)}</div>
            <div className="small faint" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
              {pick(MISSION_TYPE_LABELS[mission.type].ar, MISSION_TYPE_LABELS[mission.type].en)}
              {branded && <span className="chip amber">{t('sponsored')}</span>}
            </div>
          </div>
        </div>
        <Reward coins={mission.reward_coins} />
      </div>
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>{t('pickupAt')}</dt>
        <dd>
          {origin ? pick(origin.name_ar, origin.name_en) : '—'}
          {distanceToPickup !== null && <span className="faint"> · {fmtDistance(distanceToPickup, lang)}</span>}
        </dd>
        <dt>{t('deliverTo')}</dt>
        <dd>{pick(mission.destination_label_ar, mission.destination_label_en)}</dd>
        <dt>{t('package')}</dt>
        <dd className="muted">{pick(mission.package_ar, mission.package_en)}</dd>
      </dl>
      <div className="row-between" style={{ marginTop: 10 }}>
        <span className="small faint num" style={{ display: 'flex', gap: 12 }}>
          <span>{fmtDistance(mission.est_distance_m, lang)}</span>
          <span>{mission.time_limit_s ? fmtClock(mission.time_limit_s) : t('noTimeLimit')}</span>
          <span>
            +{mission.reward_xp} {t('xp')}
          </span>
        </span>
        <button className="btn primary" onClick={onAccept} disabled={busy || disabled} data-testid={`accept-${mission.id}`}>
          {t('accept')}
        </button>
      </div>
    </div>
  );
}

export function MissionBoard({
  missions,
  merchants,
  position,
  onAccept,
  onClose,
  busy,
  hasActive,
}: {
  missions: Mission[];
  merchants: Map<number, Merchant>;
  position: (m: Mission) => number;
  onAccept: (m: Mission) => void;
  onClose: () => void;
  busy: boolean;
  hasActive: boolean;
}) {
  const { t } = useI18n();
  const sorted = [...missions].sort((a, b) => {
    const brandedA = a.branded && merchants.get(a.origin_merchant_id)?.sponsorship?.benefits.brandedMissions ? 1 : 0;
    const brandedB = b.branded && merchants.get(b.origin_merchant_id)?.sponsorship?.benefits.brandedMissions ? 1 : 0;
    return brandedB - brandedA || position(a) - position(b);
  });
  return (
    <Sheet title={t('missionBoard')} icon="list" onClose={onClose}>
      {hasActive && (
        <div className="card small" style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Icon name="info" size={16} /> {t('runInProgress')}
        </div>
      )}
      <div className="list">
        {sorted.length === 0 && <p className="muted">{t('noMissions')}</p>}
        {sorted.map((m) => (
          <MissionRow key={m.id} mission={m} merchants={merchants} distanceToPickup={position(m)} onAccept={() => onAccept(m)} busy={busy} disabled={hasActive} />
        ))}
      </div>
    </Sheet>
  );
}

export function MerchantCard({
  merchantId,
  fallback,
  featured,
  distance,
  missions,
  merchants,
  onAccept,
  onClose,
  busy,
  hasActive,
}: {
  merchantId: number;
  fallback: Merchant | undefined;
  featured: boolean;
  distance: number | null;
  missions: Mission[];
  merchants: Map<number, Merchant>;
  onAccept: (m: Mission) => void;
  onClose: () => void;
  busy: boolean;
  hasActive: boolean;
}) {
  const { t, pick, lang, fmtNumber } = useI18n();
  const [m, setM] = useState<Merchant | undefined>(fallback);
  const [tab, setTab] = useState<'menu' | 'about' | 'missions'>('menu');
  useEffect(() => {
    let live = true;
    api
      .get<Merchant>(`/api/merchants/${merchantId}`)
      .then((x) => live && setM(x))
      .catch(() => {});
    api.post('/api/player/events', { type: 'profile_view', merchant_id: merchantId }).catch(() => {});
    return () => {
      live = false;
    };
  }, [merchantId]);
  const own = missions.filter((x) => x.origin_merchant_id === merchantId);
  useEffect(() => {
    if (own.length) {
      api.post('/api/player/events', { type: 'mission_offer', merchant_id: merchantId, mission_ids: own.map((x) => x.id) }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, own.length]);
  if (!m) return null;
  const open = isOpenNow(m.hours);
  const industrial = ['factory', 'warehouse', 'office'].includes(m.building_type);
  const hasPrices = m.menu.some((i) => i.price_iqd !== null);
  return (
    <Sheet title={pick(m.name_ar, m.name_en)} onClose={onClose}>
      <div data-testid="merchant-card" data-merchant={m.id}>
        <div className="merchant-cover" style={{ backgroundImage: m.cover_url ? `url(${m.cover_url})` : undefined, backgroundColor: m.brand_color }}>
          {m.logo_url && <img className="logo" src={m.logo_url} alt="" data-testid="merchant-logo" />}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="chip">
            <span className="dot" style={{ background: m.category?.color }} />
            {pick(m.category?.name_ar, m.category?.name_en)}
          </span>
          {m.sponsorship && (
            <span className="chip amber">
              <Icon name="star" size={12} /> {pick(m.sponsorship.package_name_ar, m.sponsorship.package_name_en)}
            </span>
          )}
          {featured && <span className="chip amber">{t('featured')}</span>}
          {open !== null && (
            <span className={`chip ${open ? 'green' : 'red'}`}>
              <span className="dot" style={{ background: 'currentColor' }} />
              {open ? t('openNow') : t('closedNow')}
            </span>
          )}
          {m.is_fictional && <span className="chip">{t('fictional')}</span>}
        </div>
        <div className="small muted" style={{ marginTop: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Icon name="pin" size={14} />
          {pick(m.address_ar, m.address_en)}
          {distance !== null && (
            <span className="faint">
              · {fmtDistance(distance, lang)} {t('fromYou')}
            </span>
          )}
        </div>
        <div className="seg-tabs" role="tablist">
          <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}>
            {industrial ? t('companyServices') : m.building_type === 'restaurant' ? t('menuTab') : t('products')}
          </button>
          <button className={tab === 'missions' ? 'on' : ''} onClick={() => setTab('missions')}>
            {t('availableMissions')} · {own.length}
          </button>
          <button className={tab === 'about' ? 'on' : ''} onClick={() => setTab('about')}>
            {t('about')}
          </button>
        </div>
        {tab === 'menu' && (
          <>
            {m.menu.length === 0 && <p className="muted">{t('none')}</p>}
            <div className="menu-items">
              {m.menu.map((i, k) => (
                <div key={k} style={{ display: 'contents' }}>
                  <div>
                    {pick(i.name_ar, i.name_en)}
                    {(i.description_ar || i.description_en) && <div className="small faint">{pick(i.description_ar, i.description_en)}</div>}
                  </div>
                  <div className="price">{i.price_iqd !== null ? `${fmtNumber(i.price_iqd)} ${t('iqd')}` : t('priceOnRequest')}</div>
                </div>
              ))}
            </div>
            {hasPrices && <p className="small faint">{t('illustrativePrices')}</p>}
          </>
        )}
        {tab === 'missions' && (
          <div className="list">
            {own.length === 0 && <p className="muted">{t('noMissions')}</p>}
            {own.map((x) => (
              <MissionRow key={x.id} mission={x} merchants={merchants} distanceToPickup={distance} onAccept={() => onAccept(x)} busy={busy} disabled={hasActive} />
            ))}
          </div>
        )}
        {tab === 'about' && (
          <div style={{ display: 'grid', gap: 12 }}>
            <p style={{ margin: 0, lineHeight: 1.7 }} className="muted">
              {pick(m.description_ar, m.description_en)}
            </p>
            <dl className="kv">
              {m.hours && (
                <>
                  <dt>{t('hours')}</dt>
                  <dd className="num">
                    {m.hours.open}–{m.hours.close} {m.hours.days && `· ${m.hours.days}`}
                  </dd>
                </>
              )}
              <dt>{t('location')}</dt>
              <dd className="num" dir="ltr" style={{ textAlign: 'start' }}>
                {m.location.lat.toFixed(5)}, {m.location.lng.toFixed(5)}
              </dd>
              {m.phone && (
                <>
                  <dt>☎</dt>
                  <dd dir="ltr" style={{ textAlign: 'start' }}>
                    {m.phone}
                  </dd>
                </>
              )}
            </dl>
            {m.gallery.length > 0 && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                {m.gallery.map((g) => (
                  <img key={g.id} src={g.url} alt="" style={{ height: 84, borderRadius: 8 }} />
                ))}
              </div>
            )}
          </div>
        )}
        {own.length > 0 && tab !== 'missions' && (
          <div style={{ marginTop: 14, display: 'flex' }}>
            <button className="btn primary lg" style={{ flex: 1 }} onClick={() => onAccept(own[0]!)} disabled={busy || hasActive} data-testid="card-accept">
              {t('accept')} · {pick(own[0]!.title_ar, own[0]!.title_en)}
            </button>
          </div>
        )}
      </div>
    </Sheet>
  );
}

export interface DeliveryResult {
  reward: { coins: number; bonus: number; xp: number; onTime: boolean };
  leveledUp: boolean;
  newAchievements: string[];
  player: PlayerProfile;
  title: string;
}

export function ResultScreen({ result, onClose }: { result: DeliveryResult; onClose: () => void }) {
  const { t, pick, fmtNumber } = useI18n();
  return (
    <Sheet title={t('delivered')} onClose={onClose}>
      <div className="result" data-testid="delivery-result">
        <div className="check">
          <Icon name="check" size={26} strokeWidth={2.2} />
        </div>
        <div className="muted">{result.title}</div>
        <div className="big">
          <Coin size={26} /> +{fmtNumber(result.reward.coins + result.reward.bonus)}
        </div>
        <div className="summary">
          <div>
            <span>{t('reward')}</span>
            <b className="num">{fmtNumber(result.reward.coins)}</b>
          </div>
          {result.reward.bonus > 0 && (
            <div>
              <span>{t('onTimeBonus')}</span>
              <b className="num">+{fmtNumber(result.reward.bonus)}</b>
            </div>
          )}
          <div>
            <span>{t('xp')}</span>
            <b className="num">+{result.reward.xp}</b>
          </div>
          {result.leveledUp && (
            <div>
              <span>{t('levelUp')}</span>
              <b>
                {t('level')} {result.player.level}
              </b>
            </div>
          )}
          {result.newAchievements.map((code) => {
            const a = ACHIEVEMENTS.find((x) => x.code === code);
            return a ? (
              <div key={code}>
                <span>{t('newAchievement')}</span>
                <b>{pick(a.ar, a.en)}</b>
              </div>
            ) : null;
          })}
        </div>
        <button className="btn primary lg" style={{ marginTop: 16, width: '100%' }} onClick={onClose} data-testid="result-continue">
          {t('continue')}
        </button>
      </div>
    </Sheet>
  );
}

interface HistoryRow extends MissionRun {
  title_ar: string;
  title_en: string;
  code: string;
  est_distance_m: number;
}

interface Challenge {
  code: string;
  ar: string;
  en: string;
  target: number;
  progress: number;
  reward_coins: number;
  claimed: boolean;
}

export function ProgressPanel({
  player,
  onClose,
  onPlayer,
  initialTab = 'history',
}: {
  player: PlayerProfile;
  onClose: () => void;
  onPlayer: (p: PlayerProfile) => void;
  initialTab?: 'history' | 'achievements' | 'challenges';
}) {
  const { t, pick, fmtNumber } = useI18n();
  const [tab, setTab] = useState(initialTab);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  useEffect(() => {
    api.get<HistoryRow[]>('/api/player/history').then(setHistory).catch(() => setHistory([]));
    api
      .get<{ challenges: Challenge[] }>('/api/player/challenges')
      .then((r) => setChallenges(r.challenges))
      .catch(() => setChallenges([]));
  }, []);
  const unlocked = new Set(player.achievements.map((a) => a.code));
  return (
    <Sheet title={`${player.display_name} · ${t('level')} ${player.level}`} onClose={onClose}>
      <div className="small muted" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
          <Coin /> {fmtNumber(player.coins)}
        </span>
        <span className="num">
          {player.xp} {t('xp')}
        </span>
        <span>
          {t('deliveries')}: {player.deliveries}
        </span>
      </div>
      <div className="seg-tabs">
        {(['history', 'achievements', 'challenges'] as const).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(k === 'history' ? 'history' : k === 'achievements' ? 'achievements' : 'dailyChallenges')}
          </button>
        ))}
      </div>
      {tab === 'history' && (
        <div className="list">
          {history === null && <p className="faint">{t('loading')}</p>}
          {history?.length === 0 && <p className="muted">{t('none')}</p>}
          {history?.map((h) => (
            <div key={h.id} className="card row-between small">
              <div>
                <div style={{ fontWeight: 600 }}>{pick(h.title_ar, h.title_en)}</div>
                <div className="faint num">{new Date(h.accepted_at).toLocaleString()}</div>
              </div>
              <div style={{ textAlign: 'end', display: 'grid', gap: 4, justifyItems: 'end' }}>
                <span className={`chip ${h.status === 'delivered' ? 'green' : h.status === 'cancelled' ? 'red' : ''}`}>{t(`status_${h.status}` as StringKey)}</span>
                {h.status === 'delivered' && <Reward coins={h.reward_coins + h.bonus_coins} />}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'achievements' && (
        <div className="list">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.code} className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', opacity: unlocked.has(a.code) ? 1 : 0.55 }}>
              <Icon name="trophy" size={20} style={{ color: unlocked.has(a.code) ? 'var(--amber-hi)' : 'var(--text-3)' }} />
              <div>
                <div style={{ fontWeight: 600 }}>{pick(a.ar, a.en)}</div>
                <div className="small faint">{pick(a.desc_ar, a.desc_en)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'challenges' && (
        <div className="list">
          {challenges === null && <p className="faint">{t('loading')}</p>}
          {challenges?.map((c) => (
            <div key={c.code} className="card">
              <div className="row-between">
                <div>
                  <div style={{ fontWeight: 600 }}>{pick(c.ar, c.en)}</div>
                  <div className="small faint num" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 2 }}>
                    {c.progress}/{c.target} · <Coin size={12} /> {c.reward_coins}
                  </div>
                </div>
                <button
                  className="btn"
                  disabled={c.claimed || c.progress < c.target}
                  onClick={async () => {
                    const r = await api.post<{ player: PlayerProfile; challenges: Challenge[] }>(`/api/player/challenges/${c.code}/claim`);
                    onPlayer(r.player);
                    setChallenges(r.challenges);
                  }}
                >
                  {c.claimed ? t('claimed') : t('claim')}
                </button>
              </div>
              <div className="xp" style={{ marginTop: 10 }}>
                <div className="bar">
                  <i style={{ width: `${(c.progress / c.target) * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function PackagesPanel({ packages, onClose }: { packages: SponsorshipPackage[]; onClose: () => void }) {
  const { t, pick } = useI18n();
  return (
    <Sheet title={t('advertise')} icon="megaphone" onClose={onClose} wide>
      <p className="small muted" style={{ marginTop: 0, lineHeight: 1.6 }}>
        {t('packagesInfo')}
      </p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
        {packages.map((p) => (
          <div key={p.id} className={`card ${p.benefits.featuredCard ? 'featured' : ''}`}>
            <div style={{ fontWeight: 600 }}>{pick(p.name_ar, p.name_en)}</div>
            <div style={{ fontSize: '1.7rem', fontWeight: 700, margin: '6px 0' }} className="num">
              ${p.price_usd} <span className="small faint" style={{ fontWeight: 500 }}>{t('perMonth')}</span>
            </div>
            <ul className="small muted" style={{ paddingInlineStart: 18, margin: 0, lineHeight: 1.8 }}>
              {p.features.map((f, i) => (
                <li key={i}>{pick(f.ar, f.en)}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

export function ManagerDialog({ text, onNext, buttonLabel }: { text: string; onNext: () => void; buttonLabel?: string }) {
  const { t } = useI18n();
  return (
    <div className="dialog panel" data-testid="manager-dialog" role="status">
      <div className="avatar" aria-hidden>
        <img src="/img/dispatcher.webp" alt="" onError={(e) => (e.currentTarget.style.display = 'none')} />
        <Icon name="headset" size={20} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="who">{t('managerName')}</div>
        <p>{text}</p>
      </div>
      <button className="btn primary" onClick={onNext}>
        {buttonLabel ?? t('ok')}
      </button>
    </div>
  );
}

export function DirectoryPanel({
  merchants,
  featured,
  distance,
  onOpen,
  onClose,
}: {
  merchants: Merchant[];
  featured: Set<number>;
  distance: (m: Merchant) => number | null;
  onOpen: (id: number) => void;
  onClose: () => void;
}) {
  const { t, pick, lang } = useI18n();
  const sorted = [...merchants].sort((a, b) => Number(featured.has(b.id)) - Number(featured.has(a.id)) || (distance(a) ?? 0) - (distance(b) ?? 0));
  return (
    <Sheet title={t('businesses')} icon="store" onClose={onClose} wide>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }} data-testid="directory">
        {sorted.map((m) => {
          const d = distance(m);
          return (
            <button key={m.id} className={`card ${featured.has(m.id) ? 'featured' : ''}`} style={{ textAlign: 'start', display: 'flex', gap: 10, alignItems: 'center' }} onClick={() => onOpen(m.id)}>
              {m.logo_url && <img className="logo sm" src={m.logo_url} alt="" />}
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pick(m.name_ar, m.name_en)}</span>
                <span className="small faint">
                  {pick(m.category?.name_ar, m.category?.name_en)}
                  {d !== null && ` · ${fmtDistance(d, lang)}`}
                </span>
              </span>
              {featured.has(m.id) && <span className="chip amber">{t('featured')}</span>}
            </button>
          );
        })}
      </div>
    </Sheet>
  );
}

export function InteriorPickup({ merchant, onCollect, onClose, busy }: { merchant: Merchant; onCollect: () => void; onClose: () => void; busy: boolean }) {
  const { t, pick, lang } = useI18n();
  return (
    <Sheet title={pick(merchant.name_ar, merchant.name_en)} icon="door" onClose={onClose}>
      <div className="interior" style={{ background: `linear-gradient(180deg, ${merchant.brand_color} 0 10%, #3b2f27 10% 56%, #2a211b 56% 62%, #8c7a63 62%)` }} />
      <p className="muted">{lang === 'ar' ? 'دخلت إلى المحل. الطلب جاهز على الكاونتر.' : 'You stepped inside. The order is ready at the counter.'}</p>
      <button className="btn primary lg" style={{ width: '100%' }} onClick={onCollect} disabled={busy} data-testid="interior-collect">
        <Icon name="hand" size={18} /> {t('collect')}
      </button>
    </Sheet>
  );
}

export type { ReactNode };
