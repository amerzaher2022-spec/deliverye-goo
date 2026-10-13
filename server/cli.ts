// npm run db:migrate | npm run db:seed
import { join } from 'node:path';
import { createPool } from './db';
import { migrate } from './migrate';
import { seedIfEmpty } from './seed';

const cmd = process.argv[2];
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const db = createPool(url);
const dir = join(import.meta.dirname, '..', 'db', 'migrations');
try {
  if (cmd === 'migrate') console.log('applied:', await migrate(db, dir));
  else if (cmd === 'seed') {
    await migrate(db, dir);
    console.log((await seedIfEmpty(db)) ? 'seeded' : 'database already has data; use the dashboard demo reset to restore it');
  } else console.log('usage: cli.ts migrate|seed');
} finally {
  await db.end();
}
