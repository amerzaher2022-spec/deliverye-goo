import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { district } from '../shared/district';
import { buildRoadGraph, routeBetween, type RoadGraph } from '../shared/roads';
import type { Mission } from '../shared/types';
import type { Config } from './config';
import type { Db } from './db';
import { HttpError } from './errors';
import { LoginLimiter } from './auth';
import { publicRoutes } from './routes/public';
import { playerRoutes } from './routes/player';
import { adminRoutes } from './routes/admin';

export interface AppContext {
  db: Db;
  config: Config;
  graph: RoadGraph;
  estimate: (m: Mission) => number;
  loginLimiter: LoginLimiter;
}

export interface BuildOptions {
  db: Db;
  config: Config;
  /** Directory of the built web app (dist/web). Omit in tests. */
  webDir?: string;
  logger?: boolean;
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Leaflet positions tiles and markers with inline styles
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org",
  // blob: lets three.js decode the textures embedded in the GLB models (ImageBitmapLoader uses fetch)
  "connect-src 'self' blob: https://nominatim.openstreetmap.org https://api.open-meteo.com",
  "font-src 'self' data:",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export async function buildApp(opts: BuildOptions): Promise<FastifyInstance> {
  const { db, config } = opts;
  const app = Fastify({
    logger: opts.logger ?? false,
    trustProxy: config.trustProxy,
    bodyLimit: 256 * 1024,
  });

  const graph = buildRoadGraph(district);
  const ctx: AppContext = {
    db,
    config,
    graph,
    estimate: (m) => routeBetween(graph, district, m.pickup, m.destination).length,
    loginLimiter: new LoginLimiter(),
  };

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5 } });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.production) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('text/html')) reply.header('Content-Security-Policy', CSP);
    if (req.url.startsWith('/api/') && !req.url.startsWith('/api/images/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  // State-changing API calls must come from this site's own scripts: they carry
  // a custom header (which cross-site forms cannot send) and, when the browser
  // supplies an Origin, it must match the host.
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (req.headers['x-dg-client'] !== '1') {
      return reply.code(403).send({ error: 'forbidden', message: 'Missing client header' });
    }
    const origin = req.headers.origin;
    if (origin) {
      let host: string | undefined;
      try {
        host = new URL(origin).host;
      } catch {
        host = undefined;
      }
      const expected = req.headers['x-forwarded-host'] ?? req.headers.host;
      if (!host || host !== expected) {
        return reply.code(403).send({ error: 'forbidden', message: 'Cross-origin request refused' });
      }
    }
  });

  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation',
        message: 'Some fields are invalid',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const e = err as { statusCode?: number; code?: string; message?: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') {
      return reply.code(413).send({ error: 'too_large', message: 'File is larger than the upload limit' });
    }
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: e.code ?? 'bad_request', message: e.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong' });
  });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  await app.register(async (s) => publicRoutes(s, ctx), { prefix: '/api' });
  await app.register(async (s) => playerRoutes(s, ctx), { prefix: '/api/player' });
  await app.register(async (s) => adminRoutes(s, ctx), { prefix: '/api/admin' });

  if (opts.webDir && existsSync(opts.webDir)) {
    const indexHtml = readFileSync(join(opts.webDir, 'index.html'), 'utf8');
    await app.register(fastifyStatic, {
      root: opts.webDir,
      wildcard: false,
      index: false,
      // the build writes .br and .gz copies of the larger files (scripts/build-server.mjs)
      preCompressed: true,
      setHeaders(res, path) {
        if (/\/assets\//.test(path)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
    const sendIndex = (_req: FastifyRequest, reply: FastifyReply) =>
      reply.header('Cache-Control', 'no-cache').type('text/html; charset=utf-8').send(indexHtml);
    app.get('/', sendIndex);
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.method !== 'GET') {
        return reply.code(404).send({ error: 'not_found', message: 'Not found' });
      }
      // static file present? (wildcard: false only registers files known at start)
      const clean = req.url.split('?')[0]!;
      const file = join(opts.webDir!, clean);
      if (file.startsWith(opts.webDir!) && existsSync(file) && !clean.endsWith('/')) {
        return reply.sendFile(clean.slice(1));
      }
      return sendIndex(req, reply);
    });
  }

  return app;
}
