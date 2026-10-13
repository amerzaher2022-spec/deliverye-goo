// Runtime configuration, read once from the environment. Nothing secret has a
// default: the first administrator comes from ADMIN_EMAIL / ADMIN_PASSWORD.

function bool(v: string | undefined, fallback: boolean) {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  production: boolean;
  adminEmail: string | undefined;
  adminPassword: string | undefined;
  adminName: string;
  /** Allows the "reset demo data" action. Off unless explicitly enabled. */
  demoMode: boolean;
  /** Seed the fictional demo businesses when the database has no merchants. */
  seedOnEmpty: boolean;
  /** Max upload size in bytes. */
  maxUploadBytes: number;
  /** Behind a TLS-terminating proxy (Render, Fly, etc.). */
  trustProxy: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  return {
    databaseUrl,
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    production: env.NODE_ENV === 'production',
    adminEmail: env.ADMIN_EMAIL?.trim().toLowerCase() || undefined,
    adminPassword: env.ADMIN_PASSWORD || undefined,
    adminName: env.ADMIN_NAME ?? 'Administrator',
    demoMode: bool(env.DEMO_MODE, false),
    seedOnEmpty: bool(env.SEED_ON_EMPTY, true),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 2 * 1024 * 1024),
    trustProxy: bool(env.TRUST_PROXY, env.NODE_ENV === 'production'),
  };
}
