// Fresh demo data before the browser tests (never point this at real data).
import { join } from 'node:path';
import { createPool } from '../server/db';
import { migrate } from '../server/migrate';
import { resetDemo } from '../server/seed';

export default async function globalSetup() {
  if (process.env.E2E_BASE_URL) return;
  const db = createPool(process.env.E2E_DATABASE_URL ?? 'postgresql://dg:dg@localhost:5432/deliverygo_e2e');
  try {
    await migrate(db, join(import.meta.dirname, '..', 'db', 'migrations'));
    await resetDemo(db, null);
  } finally {
    await db.end();
  }
}
