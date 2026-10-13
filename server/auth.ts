import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Db, Queryable } from './db';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { ...PARAMS, N: Number(n) });
  return timingSafeEqual(key, expected);
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export const ADMIN_SESSION_DAYS = 7;

export async function createAdminSession(db: Queryable, adminId: number): Promise<string> {
  const token = newToken();
  await db.query(
    `INSERT INTO admin_sessions(token_hash, admin_id, expires_at) VALUES ($1, $2, now() + interval '${ADMIN_SESSION_DAYS} days')`,
    [sha256(token), adminId],
  );
  return token;
}

export async function adminForToken(db: Queryable, token: string | undefined) {
  if (!token) return null;
  const { rows } = await db.query(
    `SELECT a.id, a.email, a.name FROM admin_sessions s JOIN admin_users a ON a.id = s.admin_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return (rows[0] as { id: number; email: string; name: string } | undefined) ?? null;
}

export async function deleteAdminSession(db: Queryable, token: string) {
  await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [sha256(token)]);
}

/**
 * Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD. An existing
 * account is left alone, so changing the variables later never silently resets a password.
 */
export async function ensureBootstrapAdmin(db: Db, email: string | undefined, password: string | undefined, name: string) {
  if (!email || !password) return 'skipped' as const;
  if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
  const existing = await db.query('SELECT id FROM admin_users WHERE email = $1', [email]);
  if (existing.rowCount) return 'exists' as const;
  await db.query('INSERT INTO admin_users(email, name, password_hash) VALUES ($1, $2, $3)', [
    email,
    name,
    await hashPassword(password),
  ]);
  return 'created' as const;
}

/** Small in-memory limiter for the login form (per IP). */
export class LoginLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private max = 8,
    private windowMs = 10 * 60_000,
  ) {}
  allow(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }
  reset(key: string) {
    this.hits.delete(key);
  }
}
