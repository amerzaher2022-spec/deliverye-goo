import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { district as bundledDistrict } from '../../../shared/district';
import { toLocal } from '../../../shared/geo';
import { buildRoadGraph } from '../../../shared/roads';
import { VEHICLE_SPECS } from '../../../shared/rules';
import { VEHICLES, type Category, type DistrictData, type Merchant, type Mission, type MissionRun, type PlayerProfile, type SponsorshipPackage, type VehicleId } from '../../../shared/types';
import { ApiError, api } from '../api';
import { Coin, Icon } from '../icons';
import '../styles/game.css';
import { useI18n } from '../i18n';
import { TouchControls } from './Controls';
import { Engine, type CameraMode, type HudState } from './engine';
import { FullMap, Minimap } from './Minimap';
import { DirectoryPanel, InteriorPickup, ManagerDialog, MerchantCard, MissionBoard, PackagesPanel, ProgressPanel, ResultScreen, Sheet, type DeliveryResult } from './panels';
import { fontsReady } from './textures';
import { fmtClock, fmtDistance } from './time';
import type { Quality } from './world';

interface WorldPayload {
  version: number;
  district: DistrictData;
  categories: Category[];
  merchants: Merchant[];
  packages: SponsorshipPackage[];
  featured_ids: number[];
}

interface Settings {
  quality: Quality;
  /** false once the player picks a quality by hand */
  autoQuality: boolean;
  controls: 'buttons' | 'joystick';
  camera: CameraMode;
}

function loadSettings(): Settings {
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const def: Settings = { quality: coarse ? 'medium' : 'high', autoQuality: true, controls: 'buttons', camera: 'chase' };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem('dg.settings') ?? '{}') };
  } catch {
    return def;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem('dg.settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

function flag(key: string, set?: boolean): boolean {
  try {
    if (set !== undefined) localStorage.setItem(key, set ? '1' : '0');
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

type Overlay =
  | { kind: 'none' }
  | { kind: 'board' }
  | { kind: 'card'; id: number }
  | { kind: 'map' }
  | { kind: 'pause' }
  | { kind: 'settings' }
  | { kind: 'progress'; tab?: 'history' | 'achievements' | 'challenges' }
  | { kind: 'packages' }
  | { kind: 'directory' }
  | { kind: 'interior'; id: number }
  | { kind: 'result'; result: DeliveryResult };

export default function GameApp() {
  const { t, lang, setLang, pick, fmtNumber } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [world, setWorld] = useState<WorldPayload | null>(null);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<'menu' | 'play'>('menu');
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [hud, setHud] = useState<HudState | null>(null);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ lines: string[]; i: number } | null>(null);
  const [menuVehicle, setMenuVehicle] = useState<VehicleId>('motorcycle');
  const [now, setNow] = useState(Date.now());
  const [portrait, setPortrait] = useState(false);
  const versionRef = useRef(0);
  const worldRef = useRef<WorldPayload | null>(null);
  worldRef.current = world;

  const graph = useMemo(() => buildRoadGraph(world?.district ?? bundledDistrict), [world?.district]);
  const merchantMap = useMemo(() => new Map((world?.merchants ?? []).map((m) => [m.id, m])), [world?.merchants]);
  const featured = useMemo(() => new Set(world?.featured_ids ?? []), [world?.featured_ids]);
  const run = player?.active_run ?? null;

  const toast = useCallback((text: string) => {
    const id = Math.random();
    setToasts((x) => [...x.slice(-2), { id, text }]);
    setTimeout(() => setToasts((x) => x.filter((y) => y.id !== id)), 3200);
  }, []);

  const setSettings = (patch: Partial<Settings>) => {
    setSettingsState((s) => {
      const next = { ...s, ...patch };
      saveSettings(next);
      return next;
    });
  };

  // ---- load --------------------------------------------------------------
  const load = useCallback(async () => {
    setError(null);
    try {
      const [w, p] = await Promise.all([api.get<WorldPayload>('/api/world'), api.post<PlayerProfile>('/api/player/session'), fontsReady()]);
      const [ms, disc] = await Promise.all([api.get<Mission[]>('/api/player/missions'), api.get<number[]>('/api/player/discoveries')]);
      versionRef.current = w.version;
      setWorld(w);
      setPlayer(p);
      setMissions(ms);
      setMenuVehicle(p.vehicle);
      (window as unknown as { __dgDiscovered: number[] }).__dgDiscovered = disc;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ---- engine lifecycle -------------------------------------------------------
  useEffect(() => {
    if (!world || !player || !canvasRef.current || engineRef.current) return;
    const disc = (window as unknown as { __dgDiscovered?: number[] }).__dgDiscovered ?? [];
    const engine = new Engine(
      canvasRef.current,
      world.district,
      graph,
      world.merchants,
      { quality: settings.quality, vehicle: player.vehicle, discovered: disc },
      {
        onHud: setHud,
        onDiscover: (id) => {
          const pos = engine.position();
          api
            .post<{ discovered: boolean; newAchievements: string[] }>('/api/player/discover', { merchant_id: id, x: pos.x, y: pos.y })
            .then((r) => {
              const m = worldRef.current?.merchants.find((x) => x.id === id);
              if (r.discovered && m) toast(`${t('discovered')}: ${pick(m.name_ar, m.name_en)}`);
              if (r.newAchievements.length) void refreshPlayer();
            })
            .catch(() => {});
        },
        onTapMerchant: (id) => setOverlay({ kind: 'card', id }),
        onBump: () => toast(lang === 'ar' ? 'انتبه — الطلبية هشة' : 'Careful — the order is fragile'),
        onSlow: (q) => setSettingsState((s) => {
          if (!s.autoQuality || s.quality === q) return s;
          const next = { ...s, quality: q };
          saveSettings(next);
          return next;
        }),
      },
    );
    engineRef.current = engine;
    engine.setCameraMode('showcase');
    engine.setRun(player.active_run);
    if (new URLSearchParams(location.search).has('debug')) {
      (window as unknown as { __dg: unknown }).__dg = {
        engine,
        teleportTo: (lat: number, lng: number) => engine.teleport(toLocal({ lat, lng }, world.district.origin)),
        /** stand on a merchant's pickup point, facing the storefront (back off `back` metres) */
        goToMerchant: (id: number, back = 0) => engine.focusMerchant(id, back),
      };
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, player !== null]);

  useEffect(
    () => () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    },
    [],
  );

  useEffect(() => engineRef.current?.setQuality(settings.quality), [settings.quality]);
  useEffect(() => {
    if (engineRef.current) engineRef.current.adaptive = settings.autoQuality;
  }, [settings.autoQuality, world]);
  useEffect(() => {
    engineRef.current?.setCameraMode(screen === 'menu' ? 'showcase' : settings.camera);
  }, [screen, settings.camera]);
  // keep the vehicle clear of the menu panel: beside it on wide screens, above it on narrow ones
  useEffect(() => {
    const place = () => {
      const narrow = window.innerWidth <= 760;
      engineRef.current?.setShowcaseOffset(narrow ? 0 : lang === 'ar' ? 1.6 : -1.6, narrow ? -1.7 : 0);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [lang, world !== null, player !== null]);
  useEffect(() => {
    const paused = screen === 'play' && (overlay.kind === 'pause' || overlay.kind === 'settings');
    engineRef.current?.setPaused(paused);
  }, [overlay, screen]);
  useEffect(() => {
    engineRef.current?.setRun(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (screen === 'menu') engineRef.current?.setVehicle(menuVehicle);
  }, [menuVehicle, screen]);

  // clock for the delivery timer
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const check = () => setPortrait(window.innerHeight > window.innerWidth && matchMedia('(pointer: coarse)').matches);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // ---- live world updates from the dashboard --------------------------------
  const refreshWorld = useCallback(
    async (announce: boolean) => {
      const w = await api.get<WorldPayload>('/api/world');
      versionRef.current = w.version;
      setWorld((prev) => (prev ? { ...w, district: prev.district } : w));
      engineRef.current?.setMerchants(w.merchants);
      setMissions(await api.get<Mission[]>('/api/player/missions'));
      if (announce) toast(t('worldUpdated'));
    },
    [t, toast],
  );

  useEffect(() => {
    if (!world) return;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const { version } = await api.get<{ version: number }>('/api/world/version');
        if (version !== versionRef.current) await refreshWorld(true);
      } catch {
        /* offline for a moment */
      }
    };
    const i = setInterval(tick, 6000);
    const vis = () => !document.hidden && void tick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      clearInterval(i);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [world !== null, refreshWorld]);

  const refreshPlayer = useCallback(async () => {
    setPlayer(await api.get<PlayerProfile>('/api/player'));
  }, []);

  // ---- missions --------------------------------------------------------------
  const distanceTo = useCallback(
    (lat: number, lng: number) => {
      if (!hud || !world) return null;
      const p = toLocal({ lat, lng }, world.district.origin);
      return Math.hypot(p.x - hud.x, p.y - hud.y);
    },
    [hud, world],
  );

  const accept = async (m: Mission) => {
    setBusy(true);
    try {
      const r = await api.post<{ run: MissionRun; player: PlayerProfile }>(`/api/player/missions/${m.id}/accept`);
      const adv = await api.post<{ run: MissionRun }>(`/api/player/runs/${r.run.id}/advance`, { to: 'going_to_pickup' });
      setPlayer({ ...r.player, active_run: { ...adv.run, mission: r.run.mission } });
      setOverlay({ kind: 'none' });
      if (screen === 'menu') startPlaying();
      const origin = merchantMap.get(m.origin_merchant_id);
      setDialog({
        lines: [
          lang === 'ar'
            ? `طلب جديد: ${m.title_ar}. اذهب إلى ${origin?.name_ar ?? ''} واستلم الطلبية. اتبع خط المسار على الطريق.`
            : `New job: ${m.title_en}. Head to ${origin?.name_en ?? ''} to collect it. Follow the route line on the road.`,
        ],
        i: 0,
      });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('offlineError'));
    } finally {
      setBusy(false);
    }
  };

  const collect = async () => {
    if (!run || !engineRef.current) return;
    setBusy(true);
    try {
      const pos = engineRef.current.position();
      await api.post<{ run: MissionRun }>(`/api/player/runs/${run.id}/collect`, pos);
      const adv = await api.post<{ run: MissionRun }>(`/api/player/runs/${run.id}/advance`, { to: 'going_to_destination' });
      setPlayer((p) => (p ? { ...p, active_run: { ...adv.run, mission: run.mission } } : p));
      setDialog({ lines: [t('pickedUp')], i: 0 });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('offlineError'));
    } finally {
      setBusy(false);
    }
  };

  const deliver = async () => {
    if (!run || !engineRef.current) return;
    setBusy(true);
    try {
      const pos = engineRef.current.position();
      const r = await api.post<Omit<DeliveryResult, 'title'>>(`/api/player/runs/${run.id}/deliver`, pos);
      setPlayer(r.player);
      setOverlay({ kind: 'result', result: { ...r, title: run.mission ? pick(run.mission.title_ar, run.mission.title_en) : '' } });
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('offlineError'));
    } finally {
      setBusy(false);
    }
  };

  const cancelRun = async () => {
    if (!run) return;
    await api.post(`/api/player/runs/${run.id}/cancel`).catch(() => {});
    await refreshPlayer();
    setOverlay({ kind: 'none' });
  };

  const startPlaying = () => {
    setScreen('play');
    setOverlay({ kind: 'none' });
    // "View in game" from the dashboard: /?focus=<merchant id>
    const focus = Number(new URLSearchParams(location.search).get('focus'));
    if (focus && engineRef.current?.focusMerchant(focus)) {
      history.replaceState(null, '', location.pathname);
      setOverlay({ kind: 'card', id: focus });
      return;
    }
    if (!flag('dg.tutorial')) {
      setDialog({ lines: [t('tut1'), t('tut2'), t('tut3')], i: 0 });
      flag('dg.tutorial', true);
    }
  };

  const chooseVehicle = async (v: VehicleId) => {
    setMenuVehicle(v);
    if (!player?.unlocked_vehicles.includes(v)) return;
    try {
      setPlayer(await api.patch<PlayerProfile>('/api/player', { vehicle: v }));
    } catch {
      /* stays local */
    }
  };

  // ---- render ----------------------------------------------------------------
  if (error) {
    return (
      <div className="game" style={{ display: 'grid', placeItems: 'center', background: 'var(--charcoal)' }}>
        <div className="sheet" style={{ textAlign: 'center', padding: 24 }}>
          <Icon name="alert" size={28} style={{ color: 'var(--amber-hi)' }} />
          <h2 style={{ fontSize: '1.1rem' }}>{t('offlineError')}</h2>
          <p className="muted small">{error}</p>
          <button className="btn primary" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      </div>
    );
  }

  const mission = run?.mission;
  const toPickup = run && (run.status === 'accepted' || run.status === 'going_to_pickup');
  const deadline = run?.deadline_at ? new Date(run.deadline_at).getTime() : null;
  const remaining = deadline ? (deadline - now) / 1000 : null;
  const xpSpan = player ? Math.max(1, player.xp_for_next - player.xp_level_start) : 1;
  const nearMerchant = hud?.nearMerchantId ? merchantMap.get(hud.nearMerchantId) : undefined;
  const spec = VEHICLE_SPECS[menuVehicle];
  const vehicleLocked = player ? !player.unlocked_vehicles.includes(menuVehicle) : false;
  const vehicleClass: Record<VehicleId, [string, string]> = {
    bicycle: ['دراجة توصيل خفيفة', 'Light courier bicycle'],
    motorcycle: ['دراجة نارية 125cc', '125cc delivery scooter'],
    car: ['سيارة هاتشباك للتوصيل', 'Delivery hatchback'],
  };
  const stepVehicle = (dir: 1 | -1) => void chooseVehicle(VEHICLES[(VEHICLES.indexOf(menuVehicle) + VEHICLES.length + dir) % VEHICLES.length]!);
  const originName = mission ? pick(merchantMap.get(mission.origin_merchant_id)?.name_ar, merchantMap.get(mission.origin_merchant_id)?.name_en) : '';

  return (
    <div className="game">
      <canvas ref={canvasRef} className="scene" data-testid="game-canvas" />
      {!world && (
        <div className="loading-screen">
          <div>
            <div className="brand" style={{ justifyContent: 'center' }}>
              <span className="brand-mark">
                <Icon name="package" size={18} />
              </span>
              {t('appName')}
            </div>
            <div className="bar">
              <i />
            </div>
            <p className="small faint" style={{ marginTop: 12 }}>
              {t('loadingWorld')}
            </p>
          </div>
        </div>
      )}

      {world && player && screen === 'menu' && (
        <div className="menu" data-testid="main-menu">
          <div className="menu-col">
            <div className="brand">
              <span className="brand-mark">
                <Icon name="package" size={18} />
              </span>
              {lang === 'ar' ? 'Erbil Delivery World' : 'عالم توصيل أربيل'}
            </div>
            <div>
              <h1>{t('appName')}</h1>
              <p className="lede">{t('tagline')}</p>
            </div>

            <div className="panel vehicle-panel" data-testid="vehicle-card">
              <div className="head">
                <div style={{ flex: 1 }}>
                  <div className="cls">{pick(...vehicleClass[menuVehicle])}</div>
                  <div className="name">{pick(spec.name_ar, spec.name_en)}</div>
                </div>
                <button className="icon-btn" onClick={() => stepVehicle(lang === 'ar' ? 1 : -1)} aria-label="previous">
                  <Icon name="chevronLeft" size={18} />
                </button>
                <button className="icon-btn" onClick={() => stepVehicle(lang === 'ar' ? -1 : 1)} aria-label="next">
                  <Icon name="chevronRight" size={18} />
                </button>
              </div>
              <div className="specs">
                <span>{t('topSpeed')}</span>
                <span className="bar">
                  <i style={{ width: `${(spec.maxSpeed / 26) * 100}%` }} />
                </span>
                <span>{t('acceleration')}</span>
                <span className="bar">
                  <i style={{ width: `${(spec.acceleration / 7) * 100}%` }} />
                </span>
                <span>{t('handling')}</span>
                <span className="bar">
                  <i style={{ width: `${(spec.steering / 2.8) * 100}%` }} />
                </span>
              </div>
              <div className="row-between" style={{ marginTop: 12 }}>
                <div className="vehicle-dots">
                  {VEHICLES.map((v) => (
                    <i key={v} className={v === menuVehicle ? 'on' : ''} />
                  ))}
                </div>
                {vehicleLocked && (
                  <span className="chip">
                    {t('locked')} · {t('unlocksAtLevel', { n: spec.unlockLevel })}
                  </span>
                )}
              </div>
            </div>

            <div className="menu-actions">
              <button
                className="btn primary lg"
                style={{ flex: 1 }}
                disabled={vehicleLocked}
                onClick={() => {
                  engineRef.current?.setVehicle(menuVehicle);
                  startPlaying();
                }}
                data-testid="start"
              >
                <Icon name="play" size={16} /> {run ? t('resume') : t('play')}
              </button>
            </div>

            <div className="menu-links">
              <button className="btn" onClick={() => setOverlay({ kind: 'progress', tab: 'challenges' })}>
                <Icon name="target" size={17} /> {t('dailyChallenges')}
              </button>
              <button className="btn" onClick={() => setOverlay({ kind: 'progress', tab: 'history' })}>
                <Icon name="history" size={17} /> {t('history')}
              </button>
              <button className="btn" onClick={() => setOverlay({ kind: 'progress', tab: 'achievements' })}>
                <Icon name="trophy" size={17} /> {t('achievements')}
              </button>
              <button className="btn" onClick={() => setOverlay({ kind: 'directory' })} data-testid="open-directory">
                <Icon name="store" size={17} /> {t('businesses')}
              </button>
              <button className="btn" onClick={() => setOverlay({ kind: 'packages' })}>
                <Icon name="megaphone" size={17} /> {t('advertise')}
              </button>
              <a className="btn" href="/admin">
                <Icon name="dashboard" size={17} /> {t('dashboard')}
              </a>
            </div>
            <div className="fineprint">{t('demoNotice')}</div>
          </div>
          <div className="menu-top-right">
            <button className="btn" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} data-testid="lang-toggle" style={{ background: 'var(--surface)' }}>
              <Icon name="globe" size={16} /> {lang === 'ar' ? 'English' : 'العربية'}
            </button>
            <button className="icon-btn" onClick={() => setOverlay({ kind: 'settings' })} aria-label={t('settings')}>
              <Icon name="settings" size={18} />
            </button>
          </div>
        </div>
      )}

      {world && player && screen === 'play' && (
        <>
          <div className="hud-top">
            <div className="panel status-bar" data-testid="stats">
              <span className="lvl num" title={t('level')}>
                {player.level}
              </span>
              <span className="xp">
                <small className="num">
                  {t('level')} {player.level} · {player.xp - player.xp_level_start}/{xpSpan} {t('xp')}
                </small>
                <span className="bar">
                  <i style={{ width: `${((player.xp - player.xp_level_start) / xpSpan) * 100}%` }} />
                </span>
              </span>
              <span className="balance">
                <Coin size={15} /> {fmtNumber(player.coins)}
              </span>
            </div>
            <div className="hud-actions">
              <button className="icon-btn" aria-label={t('missionBoard')} onClick={() => setOverlay({ kind: 'board' })} data-testid="open-board">
                <Icon name="list" size={19} />
              </button>
              <button className="icon-btn" aria-label={t('businesses')} onClick={() => setOverlay({ kind: 'directory' })}>
                <Icon name="store" size={19} />
              </button>
              <button
                className="icon-btn"
                aria-label={t('camera')}
                onClick={() => setSettings({ camera: settings.camera === 'chase' ? 'rider' : settings.camera === 'rider' ? 'far' : 'chase' })}
              >
                <Icon name="camera" size={19} />
              </button>
              <button className="icon-btn" aria-label={t('menu')} onClick={() => setOverlay({ kind: 'pause' })} data-testid="pause">
                <Icon name="pause" size={19} />
              </button>
            </div>
          </div>

          {hud && <Minimap graph={graph} district={world.district} merchants={world.merchants} featured={featured} hud={hud} onOpen={() => setOverlay({ kind: 'map' })} />}

          {run && mission && (
            <div className="panel mission-card" data-testid="mission-pill" data-status={run.status}>
              <div className="steps">
                <span className={toPickup ? 'on-text' : ''}>{t('goToPickup')}</span>
                <span className={`seg on`} />
                <span className={`seg ${toPickup ? '' : 'on'}`} />
                <span className={!toPickup ? 'on-text' : ''}>{t('goToDropoff')}</span>
              </div>
              <div className="dest">
                <Icon name={toPickup ? 'package' : 'flag'} size={17} style={{ color: 'var(--amber-hi)', flex: 'none' }} />
                <span>{toPickup ? originName : pick(mission.destination_label_ar, mission.destination_label_en)}</span>
              </div>
              <div className="meta">
                {hud?.routeRemaining != null && (
                  <span>
                    <b>{fmtDistance(hud.routeRemaining, lang)}</b>
                  </span>
                )}
                {remaining !== null && <span className={`timer ${remaining <= 0 ? 'late' : ''}`}>{remaining > 0 ? fmtClock(remaining) : t('timeUp')}</span>}
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginInlineStart: 'auto' }}>
                  <Coin size={12} /> {mission.reward_coins}
                </span>
              </div>
            </div>
          )}

          <div className="toast-stack">
            {toasts.map((x) => (
              <div key={x.id} className="panel toast">
                {x.text}
              </div>
            ))}
          </div>

          <div className="context-action">
            {hud?.zone === 'pickup' &&
              (() => {
                const origin = mission ? merchantMap.get(mission.origin_merchant_id) : undefined;
                const inside = origin?.interior_enabled || mission?.type === 'interior_pickup';
                return inside && origin ? (
                  <button className="btn primary" onClick={() => setOverlay({ kind: 'interior', id: origin.id })} disabled={busy} data-testid="collect">
                    <Icon name="door" size={18} /> {lang === 'ar' ? 'ادخل واستلم الطلب' : 'Go inside & collect'}
                  </button>
                ) : (
                  <button className="btn primary" onClick={() => void collect()} disabled={busy} data-testid="collect">
                    <Icon name="hand" size={18} /> {t('collect')}
                  </button>
                );
              })()}
            {hud?.zone === 'dropoff' && (
              <button className="btn primary" onClick={() => void deliver()} disabled={busy} data-testid="deliver">
                <Icon name="check" size={18} /> {t('deliver')}
              </button>
            )}
            {!hud?.zone && nearMerchant && (
              <button className="btn" style={{ background: 'var(--surface)' }} onClick={() => setOverlay({ kind: 'card', id: nearMerchant.id })} data-testid="near-merchant">
                <Icon name="info" size={17} /> {pick(nearMerchant.name_ar, nearMerchant.name_en)}
              </button>
            )}
          </div>

          <div className="panel speedo" dir="ltr">
            <b data-testid="speed">{Math.round(hud?.speedKmh ?? 0)}</b>
            <span>{lang === 'ar' ? 'كم/س' : 'KM/H'}</span>
          </div>

          <TouchControls input={engineRef.current?.touch ?? { throttle: 0, brake: 0, steer: 0 }} mode={settings.controls} />
          {portrait && (
            <div className="panel rotate-hint">
              <Icon name="reset" size={14} /> {t('rotateHint')}
            </div>
          )}
        </>
      )}

      {dialog && (
        <ManagerDialog
          text={dialog.lines[dialog.i]!}
          onNext={() => setDialog(dialog.i + 1 < dialog.lines.length ? { ...dialog, i: dialog.i + 1 } : null)}
        />
      )}

      {world && overlay.kind === 'board' && (
        <MissionBoard
          missions={missions}
          merchants={merchantMap}
          position={(m) => distanceTo(m.pickup.lat, m.pickup.lng) ?? m.est_distance_m}
          onAccept={(m) => void accept(m)}
          onClose={() => setOverlay({ kind: 'none' })}
          busy={busy}
          hasActive={!!run}
        />
      )}
      {world && overlay.kind === 'card' && (
        <MerchantCard
          key={overlay.id}
          merchantId={overlay.id}
          fallback={merchantMap.get(overlay.id)}
          featured={featured.has(overlay.id)}
          distance={(() => {
            const m = merchantMap.get(overlay.id);
            return m ? distanceTo(m.entrance.lat, m.entrance.lng) : null;
          })()}
          missions={missions}
          merchants={merchantMap}
          onAccept={(m) => void accept(m)}
          onClose={() => setOverlay({ kind: 'none' })}
          busy={busy}
          hasActive={!!run}
        />
      )}
      {world && overlay.kind === 'map' && (
        <FullMap
          title={`${t('map')} · ${pick(world.district.name_ar, world.district.name_en)}`}
          graph={graph}
          district={world.district}
          merchants={world.merchants}
          featured={featured}
          hud={hud}
          onPick={(id) => setOverlay({ kind: 'card', id })}
          onClose={() => setOverlay({ kind: 'none' })}
        />
      )}
      {overlay.kind === 'pause' && (
        <Sheet title={t('paused')} icon="pause" onClose={() => setOverlay({ kind: 'none' })}>
          <div className="list">
            <button className="btn primary" onClick={() => setOverlay({ kind: 'none' })}>
              <Icon name="play" size={14} /> {t('resume')}
            </button>
            <button className="btn" onClick={() => setOverlay({ kind: 'settings' })}>
              <Icon name="settings" size={17} /> {t('settings')}
            </button>
            <button className="btn" onClick={() => setOverlay({ kind: 'progress' })}>
              <Icon name="history" size={17} /> {t('history')} · {t('achievements')}
            </button>
            {run && (
              <button className="btn danger" onClick={() => void cancelRun()} data-testid="cancel-run">
                <Icon name="close" size={17} /> {t('cancelMission')}
              </button>
            )}
            <button
              className="btn ghost"
              onClick={() => {
                setScreen('menu');
                setOverlay({ kind: 'none' });
              }}
            >
              <Icon name="chevronLeft" size={17} /> {t('mainMenu')}
            </button>
            <a className="btn ghost" href="/admin" style={{ textAlign: 'center', textDecoration: 'none' }}>
              <Icon name="dashboard" size={17} /> {t('dashboard')}
            </a>
          </div>
        </Sheet>
      )}
      {overlay.kind === 'settings' && (
        <Sheet title={t('settings')} icon="settings" onClose={() => setOverlay(screen === 'play' ? { kind: 'pause' } : { kind: 'none' })}>
          <h3>{t('language')}</h3>
          <div className="seg-tabs">
            <button className={lang === 'ar' ? 'on' : ''} onClick={() => setLang('ar')}>
              العربية
            </button>
            <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>
              English
            </button>
          </div>
          <h3>{t('graphics')}</h3>
          <div className="seg-tabs">
            <button className={settings.autoQuality ? 'on' : ''} onClick={() => setSettings({ autoQuality: true })}>
              {lang === 'ar' ? 'تلقائي' : 'Auto'}
            </button>
            {(['low', 'medium', 'high'] as const).map((q) => (
              <button key={q} className={!settings.autoQuality && settings.quality === q ? 'on' : ''} onClick={() => setSettings({ quality: q, autoQuality: false })}>
                {t(q)}
              </button>
            ))}
          </div>
          <h3>{t('controls')}</h3>
          <div className="seg-tabs">
            <button className={settings.controls === 'buttons' ? 'on' : ''} onClick={() => setSettings({ controls: 'buttons' })}>
              {t('controlButtons')}
            </button>
            <button className={settings.controls === 'joystick' ? 'on' : ''} onClick={() => setSettings({ controls: 'joystick' })}>
              {t('controlJoystick')}
            </button>
          </div>
          <h3>{t('camera')}</h3>
          <div className="seg-tabs">
            {(['chase', 'rider', 'far'] as const).map((c) => (
              <button key={c} className={settings.camera === c ? 'on' : ''} onClick={() => setSettings({ camera: c })}>
                {pick({ chase: 'خلفية', rider: 'منظور السائق', far: 'علوية' }[c], { chase: 'Chase', rider: 'Rider view', far: 'Overhead' }[c])}
              </button>
            ))}
          </div>
          <p className="small muted">
            {lang === 'ar' ? 'لوحة المفاتيح: الأسهم أو WASD للقيادة، المسافة للفرامل.' : 'Keyboard: arrows or WASD to drive, Space to brake.'}
          </p>
          <p className="small muted">{world && pick(world.district.attribution, world.district.attribution)}</p>
        </Sheet>
      )}
      {player && overlay.kind === 'progress' && (
        <ProgressPanel player={player} initialTab={overlay.tab} onPlayer={setPlayer} onClose={() => setOverlay(screen === 'play' ? { kind: 'pause' } : { kind: 'none' })} />
      )}
      {world && overlay.kind === 'directory' && (
        <DirectoryPanel
          merchants={world.merchants}
          featured={featured}
          distance={(m) => distanceTo(m.entrance.lat, m.entrance.lng)}
          onOpen={(id) => setOverlay({ kind: 'card', id })}
          onClose={() => setOverlay({ kind: 'none' })}
        />
      )}
      {overlay.kind === 'interior' && merchantMap.get(overlay.id) && (
        <InteriorPickup
          merchant={merchantMap.get(overlay.id)!}
          busy={busy}
          onClose={() => setOverlay({ kind: 'none' })}
          onCollect={() => {
            setOverlay({ kind: 'none' });
            void collect();
          }}
        />
      )}
      {world && overlay.kind === 'packages' && <PackagesPanel packages={world.packages} onClose={() => setOverlay({ kind: 'none' })} />}
      {overlay.kind === 'result' && (
        <ResultScreen
          result={overlay.result}
          onClose={() => {
            setOverlay({ kind: 'none' });
            void refreshPlayer();
          }}
        />
      )}
    </div>
  );
}
