// Settings for the time of day and the weather (atmosphere.ts).

import { useEffect, useReducer, useState } from 'react';
import { WEATHERS, type Atmosphere, type Weather } from './atmosphere';

const NAMES: Record<Weather, [string, string]> = {
  clear: ['مشمس', 'Sunny'],
  cloudy: ['غائم', 'Cloudy'],
  rain: ['مطر خفيف', 'Light rain'],
  storm: ['مطر غزير', 'Heavy rain'],
  fog: ['ضباب', 'Fog'],
};

function clock(h: number) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function AtmosSettings({ atmos, lang }: { atmos: Atmosphere | null | undefined; lang: 'ar' | 'en' }) {
  const [, refresh] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    if (!atmos) return;
    atmos.setListener(refresh);
    // the clock moves on its own while the panel is open
    const id = window.setInterval(refresh, 1000);
    return () => {
      atmos.setListener(null);
      window.clearInterval(id);
    };
  }, [atmos]);
  if (!atmos) return null;
  const ar = lang === 'ar';
  const s = atmos.state();
  return (
    <>
      <h3>
        {ar ? 'الوقت' : 'Time of day'} <span className="muted small" dir="ltr">{clock(s.hour)}</span>
      </h3>
      <div className="seg-tabs">
        <button className={s.autoTime ? 'on' : ''} onClick={() => atmos.set({ autoTime: true })} data-testid="time-auto">
          {ar ? 'دورة تلقائية' : 'Automatic cycle'}
        </button>
        <button className={!s.autoTime ? 'on' : ''} onClick={() => atmos.set({ autoTime: false })} data-testid="time-manual">
          {ar ? 'يدوي' : 'Manual'}
        </button>
      </div>
      <input
        type="range"
        min={0}
        max={23.75}
        step={0.25}
        value={s.hour}
        aria-label={ar ? 'الساعة' : 'Hour'}
        data-testid="time-slider"
        style={{ width: '100%' }}
        onChange={(e) => atmos.set({ hour: Number(e.target.value), autoTime: false })}
      />
      <div className="seg-tabs">
        {[
          [6.3, ar ? 'شروق' : 'Sunrise'],
          [12, ar ? 'ظهر' : 'Noon'],
          [17.6, ar ? 'غروب' : 'Sunset'],
          [22, ar ? 'ليل' : 'Night'],
        ].map(([h, label]) => (
          <button key={String(h)} onClick={() => atmos.set({ hour: h as number, autoTime: false })}>
            {label}
          </button>
        ))}
      </div>
      <h3>{ar ? 'الطقس' : 'Weather'}</h3>
      <div className="seg-tabs">
        <button className={s.autoWeather && !s.live ? 'on' : ''} onClick={() => atmos.set({ autoWeather: true, live: false })} data-testid="weather-auto">
          {ar ? 'تلقائي' : 'Automatic'}
        </button>
        {WEATHERS.map((w) => (
          <button key={w} className={!s.autoWeather && !s.live && s.weather === w ? 'on' : ''} onClick={() => atmos.set({ weather: w, autoWeather: false, live: false })} data-testid={`weather-${w}`}>
            {NAMES[w][ar ? 0 : 1]}
          </button>
        ))}
      </div>
      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <input type="checkbox" checked={s.live} onChange={(e) => atmos.set({ live: e.target.checked, autoWeather: true })} />
        {ar ? 'طقس أربيل الحالي (اختياري، يحتاج إنترنت)' : "Erbil's current weather (optional, needs internet)"}
        {s.live && (
          <span className="muted">
            {atmos.liveStatus === 'ok' ? (ar ? '✓' : '✓') : atmos.liveStatus === 'offline' ? (ar ? '— غير متصل، الطقس التلقائي' : '— offline, automatic weather') : '…'}
          </span>
        )}
      </label>
      <p className="small muted">
        {ar ? 'الآن:' : 'Now:'} {NAMES[s.weather][ar ? 0 : 1]}
        {s.live && atmos.liveStatus === 'ok' && (
          <>
            {' · '}
            <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
              Weather data by Open-Meteo.com
            </a>
          </>
        )}
      </p>
    </>
  );
}

export function SoundToggle({ engine, lang }: { engine: { audio: { muted: boolean; setMuted(m: boolean): void } } | null; lang: 'ar' | 'en' }) {
  const [muted, setMuted] = useState(engine?.audio.muted ?? false);
  if (!engine) return null;
  const set = (m: boolean) => {
    engine.audio.setMuted(m);
    setMuted(m);
  };
  return (
    <>
      <h3>{lang === 'ar' ? 'الصوت' : 'Sound'}</h3>
      <div className="seg-tabs">
        <button className={!muted ? 'on' : ''} onClick={() => set(false)}>
          {lang === 'ar' ? 'تشغيل' : 'On'}
        </button>
        <button className={muted ? 'on' : ''} onClick={() => set(true)}>
          {lang === 'ar' ? 'كتم' : 'Off'}
        </button>
      </div>
    </>
  );
}

interface MirrorEngine {
  mirrorSettings(): { on: boolean; yaw: number; pitch: number };
  setMirrors(s: { on?: boolean; yaw?: number; pitch?: number }): void;
}

export function MirrorSettings({ engine, lang }: { engine: MirrorEngine | null; lang: 'ar' | 'en' }) {
  const [s, setS] = useState(engine?.mirrorSettings() ?? { on: true, yaw: 0, pitch: 0 });
  if (!engine) return null;
  const ar = lang === 'ar';
  const set = (p: Partial<typeof s>) => {
    engine.setMirrors(p);
    setS(engine.mirrorSettings());
  };
  return (
    <>
      <h3>{ar ? 'المرايا' : 'Mirrors'}</h3>
      <div className="seg-tabs">
        <button className={s.on ? 'on' : ''} onClick={() => set({ on: true })} data-testid="mirrors-on">
          {ar ? 'تشغيل' : 'On'}
        </button>
        <button className={!s.on ? 'on' : ''} onClick={() => set({ on: false })}>
          {ar ? 'إيقاف (أسرع)' : 'Off (faster)'}
        </button>
      </div>
      {s.on && (
        <div className="small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, alignItems: 'center' }}>
          <span>{ar ? 'زاوية أفقية' : 'Angle out'}</span>
          <input type="range" min={-12} max={12} step={1} value={Math.round(s.yaw)} onChange={(e) => set({ yaw: Number(e.target.value) })} />
          <span>{ar ? 'زاوية عمودية' : 'Angle up/down'}</span>
          <input type="range" min={-10} max={10} step={1} value={Math.round(s.pitch)} onChange={(e) => set({ pitch: Number(e.target.value) })} />
        </div>
      )}
    </>
  );
}

export function TrafficSettings({ engine, lang }: { engine: { trafficDensity: number; setTrafficDensity(d: number): void } | null; lang: 'ar' | 'en' }) {
  const [d, setD] = useState(engine?.trafficDensity ?? 1);
  if (!engine) return null;
  const ar = lang === 'ar';
  const opts: [number, string, string][] = [
    [0.5, 'خفيفة', 'Light'],
    [1, 'عادية', 'Normal'],
    [1.5, 'زحمة', 'Heavy'],
  ];
  return (
    <>
      <h3>{ar ? 'حركة المرور' : 'Traffic'}</h3>
      <div className="seg-tabs">
        {opts.map(([v, a, e]) => (
          <button
            key={v}
            className={d === v ? 'on' : ''}
            onClick={() => {
              engine.setTrafficDensity(v);
              setD(v);
            }}
          >
            {ar ? a : e}
          </button>
        ))}
      </div>
    </>
  );
}
