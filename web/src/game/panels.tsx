import { useEffect, useState, type ReactNode } from 'react';
import { ACHIEVEMENTS, MISSION_TYPE_LABELS } from '../../../shared/rules';
import type { Merchant, Mission, MissionRun, PlayerProfile, SponsorshipPackage } from '../../../shared/types';
import { api } from '../api';
import { useI18n, type StringKey } from '../i18n';
import { fmtClock, fmtDistance, isOpenNow } from './time';

export function Sheet({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" style={wide ? { width: 'min(760px, 100%)' } : undefined} onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label={t('close')}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SponsorChips({ m, featured }: { m: Merchant; featured: boolean }) {
  const { t, pick } = useI18n();
  return (
    <>
      {m.sponsorship && <span className="chip gold">★ {pick(m.sponsorship.package_name_ar, m.sponsorship.package_name_en)}</span>}
      {featured && <span className="chip gold">{t('featured')}</span>}
      {m.is_fictional && <span className="chip">{t('fictional')}</span>}
    </>
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
  const { t, pick, lang, fmtNumber } = useI18n();
  const origin = merchants.get(mission.origin_merchant_id);
  return (
    <div className={`card ${mission.branded && origin?.sponsorship?.benefits.brandedMissions ? 'branded' : ''}`} data-testid={`mission-${mission.id}`}>
      <div className="row-between">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
          {origin?.logo_url && <img className="logo sm" src={origin.logo_url} alt="" />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{pick(mission.title_ar, mission.title_en)}</div>
            <div className="small muted">
              {pick(MISSION_TYPE_LABELS[mission.type].ar, MISSION_TYPE_LABELS[mission.type].en)}
              {mission.branded && origin?.sponsorship?.benefits.brandedMissions && <> · <span className="chip gold">{t('sponsored')}</span></>}
            </div>
          </div>
        </div>
        <span className="chip gold">
          +{fmtNumber(mission.reward_coins)} 🪙
        </span>
      </div>
      <div className="small" style={{ marginTop: 6, display: 'grid', gap: 2 }}>
        <div>
          📦 {t('pickupAt')}: <b>{origin ? pick(origin.name_ar, origin.name_en) : '—'}</b>
          {distanceToPickup !== null && <span className="muted"> · {fmtDistance(distanceToPickup, lang)}</span>}
        </div>
        <div>
          📍 {t('deliverTo')}: <b>{pick(mission.destination_label_ar, mission.destination_label_en)}</b>
        </div>
        <div className="muted">
          {t('package')}: {pick(mission.package_ar, mission.package_en)}
        </div>
        <div className="muted">
          {t('distance')}: {fmtDistance(mission.est_distance_m, lang)} · {mission.time_limit_s ? `⏱ ${fmtClock(mission.time_limit_s)}` : t('noTimeLimit')} · +
          {mission.reward_xp} {t('xp')}
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
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
    <Sheet title={`📋 ${t('missionBoard')}`} onClose={onClose}>
      {hasActive && <p className="chip blue">{t('runInProgress')}</p>}
      <div className="list">
        {sorted.length === 0 && <p className="muted">{t('noMissions')}</p>}
        {sorted.map((m) => (
          <MissionRow
            key={m.id}
            mission={m}
            merchants={merchants}
            distanceToPickup={position(m)}
            onAccept={() => onAccept(m)}
            busy={busy}
            disabled={hasActive}
          />
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
        <div
          className="merchant-cover"
          style={{ backgroundImage: m.cover_url ? `url(${m.cover_url})` : `linear-gradient(135deg, ${m.brand_color}, #0f1b2d)` }}
        >
          {m.logo_url && <img className="logo" src={m.logo_url} alt="" data-testid="merchant-logo" />}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 22 }}>
          <span className="chip" style={{ background: m.category?.color }}>
            {pick(m.category?.name_ar, m.category?.name_en)}
          </span>
          <SponsorChips m={m} featured={featured} />
          {open !== null && <span className={`chip ${open ? 'green' : 'red'}`}>{open ? t('openNow') : t('closedNow')}</span>}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          {pick(m.name_en, m.name_ar)} · {pick(m.address_ar, m.address_en)}
          {distance !== null && (
            <>
              {' '}
              · <b>{fmtDistance(distance, lang)}</b> {t('fromYou')}
            </>
          )}
        </div>
        <div className="tabs">
          <button className={tab === 'menu' ? 'on' : ''} onClick={() => setTab('menu')}>
            {industrial ? t('companyServices') : m.building_type === 'restaurant' ? t('menuTab') : t('products')}
          </button>
          <button className={tab === 'missions' ? 'on' : ''} onClick={() => setTab('missions')}>
            {t('availableMissions')} ({own.length})
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
                    {(i.description_ar || i.description_en) && <div className="small muted">{pick(i.description_ar, i.description_en)}</div>}
                  </div>
                  <div style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                    {i.price_iqd !== null ? `${fmtNumber(i.price_iqd)} ${t('iqd')}` : t('priceOnRequest')}
                  </div>
                </div>
              ))}
            </div>
            {hasPrices && <p className="small muted">* {t('illustrativePrices')}</p>}
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
          <div className="small" style={{ display: 'grid', gap: 6 }}>
            <p style={{ margin: 0 }}>{pick(m.description_ar, m.description_en)}</p>
            {m.hours && (
              <div>
                🕒 {t('hours')}: {m.hours.open}–{m.hours.close} {m.hours.days && `(${m.hours.days})`}
              </div>
            )}
            <div>
              📍 {t('location')}: {m.location.lat.toFixed(5)}, {m.location.lng.toFixed(5)}
            </div>
            {m.phone && <div dir="ltr">☎ {m.phone}</div>}
            {m.gallery.length > 0 && (
              <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
                {m.gallery.map((g) => (
                  <img key={g.id} src={g.url} alt="" style={{ height: 80, borderRadius: 10 }} />
                ))}
              </div>
            )}
          </div>
        )}
        {own.length > 0 && tab !== 'missions' && (
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={() => onAccept(own[0]!)} disabled={busy || hasActive} data-testid="card-accept">
              {t('accept')}: {pick(own[0]!.title_ar, own[0]!.title_en)}
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
    <Sheet title={`✅ ${t('delivered')}`} onClose={onClose}>
      <div className="result" data-testid="delivery-result">
        <p className="muted">{result.title}</p>
        <div className="big">+{fmtNumber(result.reward.coins + result.reward.bonus)} 🪙</div>
        {result.reward.bonus > 0 && (
          <div className="chip green">
            {t('onTimeBonus')} +{result.reward.bonus}
          </div>
        )}
        <div style={{ marginTop: 6 }}>
          +{result.reward.xp} {t('xp')}
        </div>
        {result.leveledUp && (
          <h3 style={{ color: 'var(--accent-2)' }}>
            🎉 {t('levelUp')} — {t('level')} {result.player.level}
          </h3>
        )}
        {result.newAchievements.map((code) => {
          const a = ACHIEVEMENTS.find((x) => x.code === code);
          return a ? (
            <div key={code} className="card" style={{ marginTop: 8 }}>
              🏅 {t('newAchievement')}: <b>{pick(a.ar, a.en)}</b>
            </div>
          ) : null;
        })}
        <button className="btn primary" style={{ marginTop: 14 }} onClick={onClose} data-testid="result-continue">
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
    <Sheet title={`${t('level')} ${player.level} · ${player.display_name}`} onClose={onClose}>
      <div className="small muted">
        🪙 {fmtNumber(player.coins)} {t('coins')} · {player.xp} {t('xp')} · {t('deliveries')}: {player.deliveries}
      </div>
      <div className="tabs">
        {(['history', 'achievements', 'challenges'] as const).map((k) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {t(k === 'history' ? 'history' : k === 'achievements' ? 'achievements' : 'dailyChallenges')}
          </button>
        ))}
      </div>
      {tab === 'history' && (
        <div className="list">
          {history?.length === 0 && <p className="muted">{t('none')}</p>}
          {history?.map((h) => (
            <div key={h.id} className="card row-between small">
              <div>
                <b>{pick(h.title_ar, h.title_en)}</b>
                <div className="muted">{new Date(h.accepted_at).toLocaleString()}</div>
              </div>
              <div style={{ textAlign: 'end' }}>
                <span className={`chip ${h.status === 'delivered' ? 'green' : h.status === 'cancelled' ? 'red' : 'blue'}`}>
                  {t(`status_${h.status}` as StringKey)}
                </span>
                {h.status === 'delivered' && <div>+{h.reward_coins + h.bonus_coins} 🪙</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'achievements' && (
        <div className="list">
          {ACHIEVEMENTS.map((a) => (
            <div key={a.code} className="card row-between" style={{ opacity: unlocked.has(a.code) ? 1 : 0.5 }}>
              <div>
                <b>
                  {unlocked.has(a.code) ? '🏅' : '🔒'} {pick(a.ar, a.en)}
                </b>
                <div className="small muted">{pick(a.desc_ar, a.desc_en)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {tab === 'challenges' && (
        <div className="list">
          {challenges?.map((c) => (
            <div key={c.code} className="card row-between">
              <div>
                <b>{pick(c.ar, c.en)}</b>
                <div className="small muted">
                  {c.progress}/{c.target} · +{c.reward_coins} 🪙
                </div>
              </div>
              <button
                className="btn good"
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
          ))}
        </div>
      )}
    </Sheet>
  );
}

export function PackagesPanel({ packages, onClose }: { packages: SponsorshipPackage[]; onClose: () => void }) {
  const { t, pick } = useI18n();
  return (
    <Sheet title={`📣 ${t('advertise')}`} onClose={onClose} wide>
      <p className="chip blue" style={{ whiteSpace: 'normal' }}>
        {t('packagesInfo')}
      </p>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginTop: 10 }}>
        {packages.map((p) => (
          <div key={p.id} className={`card ${p.benefits.featuredCard ? 'branded' : ''}`}>
            <b>{pick(p.name_ar, p.name_en)}</b>
            <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>
              ${p.price_usd} <span className="small muted">{t('perMonth')}</span>
            </div>
            <ul className="small" style={{ paddingInlineStart: 18, margin: '6px 0 0' }}>
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
    <div className="dialog" data-testid="manager-dialog">
      <div className="avatar" aria-hidden />
      <div style={{ flex: 1 }}>
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
    <Sheet title={`🏪 ${t('businesses')}`} onClose={onClose} wide>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }} data-testid="directory">
        {sorted.map((m) => {
          const d = distance(m);
          return (
            <button key={m.id} className={`card ${featured.has(m.id) ? 'branded' : ''}`} style={{ textAlign: 'start', display: 'flex', gap: 10, alignItems: 'center' }} onClick={() => onOpen(m.id)}>
              {m.logo_url && <img className="logo sm" src={m.logo_url} alt="" />}
              <span style={{ minWidth: 0 }}>
                <b style={{ display: 'block' }}>{pick(m.name_ar, m.name_en)}</b>
                <span className="small muted">
                  {pick(m.category?.name_ar, m.category?.name_en)}
                  {d !== null && ` · ${fmtDistance(d, lang)}`}
                </span>
                {featured.has(m.id) && (
                  <span className="chip gold" style={{ marginTop: 4 }}>
                    ★ {t('featured')}
                  </span>
                )}
              </span>
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
    <Sheet title={`🚪 ${pick(merchant.name_ar, merchant.name_en)}`} onClose={onClose}>
      <div className="interior" style={{ background: `linear-gradient(180deg, ${merchant.brand_color} 0 12%, #6b4a2f 12% 55%, #3a2a1c 55% 62%, #c8a77e 62%)` }} />
      <p>{lang === 'ar' ? 'دخلت إلى المحل. الطلب جاهز على الكاونتر.' : 'You stepped inside. The order is ready at the counter.'}</p>
      <button className="btn primary" onClick={onCollect} disabled={busy} data-testid="interior-collect">
        🤲 {t('collect')}
      </button>
    </Sheet>
  );
}
