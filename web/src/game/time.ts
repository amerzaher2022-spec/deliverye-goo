import type { MerchantHours } from '../../../shared/types';

/** Simulated opening state using Erbil local time (UTC+3). */
export function isOpenNow(hours: MerchantHours | null, now = new Date()): boolean | null {
  if (!hours) return null;
  const erbil = new Date(now.getTime() + 3 * 3600_000);
  const mins = erbil.getUTCHours() * 60 + erbil.getUTCMinutes();
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const open = toMin(hours.open);
  const close = toMin(hours.close);
  return open <= close ? mins >= open && mins < close : mins >= open || mins < close;
}

export function fmtDistance(m: number, lang: 'ar' | 'en') {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} ${lang === 'ar' ? 'كم' : 'km'}`;
  return `${Math.round(m)} ${lang === 'ar' ? 'م' : 'm'}`;
}

export function fmtClock(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
