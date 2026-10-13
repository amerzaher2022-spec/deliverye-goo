import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../server/app';
import { ensureBootstrapAdmin } from '../server/auth';
import { loadConfig } from '../server/config';
import { createPool, type Db } from '../server/db';
import { migrate } from '../server/migrate';
import { resetDemo } from '../server/seed';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://dg:dg@localhost:5432/deliverygo_test';
export const ADMIN = { email: 'admin@test.local', password: 'correct-horse-battery' };

export async function setup(opts: { demoMode?: boolean } = {}) {
  const config = loadConfig({
    DATABASE_URL: TEST_DB,
    DEMO_MODE: opts.demoMode === false ? 'false' : 'true',
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv);
  const db = createPool(TEST_DB);
  await migrate(db, join(import.meta.dirname, '..', 'db', 'migrations'));
  await ensureBootstrapAdmin(db, ADMIN.email, ADMIN.password, 'Test admin');
  await resetDemo(db, null);
  const app = await buildApp({ db, config });
  return { app, db };
}

/** Minimal cookie-keeping client around app.inject. */
export class Client {
  cookies = new Map<string, string>();
  constructor(private app: FastifyInstance) {}

  async req(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { 'x-dg-client': '1', ...extra };
    if (this.cookies.size) headers.cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      headers,
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    for (const c of res.cookies) this.cookies.set(c.name, c.value);
    return { status: res.statusCode, body: res.body ? safeJson(res.body) : null, headers: res.headers, raw: res };
  }
  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  put = (url: string, body: unknown) => this.req('PUT', url, body);
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);

  async login() {
    const r = await this.post('/api/admin/login', ADMIN);
    if (r.status !== 200) throw new Error(`login failed ${r.status}`);
    return this;
  }

  async upload(url: string, filename: string, mime: string, data: Buffer) {
    const boundary = '----dgtest' + Math.random().toString(16).slice(2);
    const payload = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.req('POST', url, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
  }
}

function safeJson(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export async function teardown(app: FastifyInstance, db: Db) {
  await app.close();
  await db.end();
}

/** A real 2×2 PNG. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);
