import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app';
import { ensureBootstrapAdmin } from './auth';
import { loadConfig } from './config';
import { createPool } from './db';
import { migrate } from './migrate';
import { seedIfEmpty } from './seed';

// Works both from source (tsx server/main.ts) and from the bundle (dist/server/main.mjs).
const here = dirname(fileURLToPath(import.meta.url));
const root = here.endsWith(join('dist', 'server')) ? join(here, '..', '..') : join(here, '..');

async function main() {
  const config = loadConfig();
  const db = createPool(config.databaseUrl);
  const applied = await migrate(db, join(root, 'db', 'migrations'));
  if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
  const admin = await ensureBootstrapAdmin(db, config.adminEmail, config.adminPassword, config.adminName);
  console.log(`bootstrap admin: ${admin}`);
  if (config.seedOnEmpty && (await seedIfEmpty(db))) console.log('demo data seeded');

  const app = await buildApp({ db, config, webDir: join(root, 'dist', 'web'), logger: true });
  const shutdown = async () => {
    await app.close();
    await db.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await app.listen({ port: config.port, host: config.host });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
