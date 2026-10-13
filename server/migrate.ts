import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db';
import { withTx } from './db';

/** Applies db/migrations/*.sql in order, once each, under an advisory lock. */
export async function migrate(db: Db, dir: string): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return withTx(db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(727274)');
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    const done = new Set((await tx.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f)) continue;
      await tx.query(readFileSync(join(dir, f), 'utf8'));
      await tx.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
      applied.push(f);
    }
    return applied;
  });
}
