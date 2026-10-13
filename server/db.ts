import pg from 'pg';

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

// bigint counts come back as strings by default; the numbers here stay small.
pg.types.setTypeParser(20, (v) => Number(v));
// numeric -> number (package prices)
pg.types.setTypeParser(1700, (v) => Number(v));
// date -> plain YYYY-MM-DD string, no timezone shifts
pg.types.setTypeParser(1082, (v) => v);

export function createPool(url: string): Db {
  const ssl =
    /sslmode=require/.test(url) || process.env.PGSSL === 'require' ? { rejectUnauthorized: false } : undefined;
  return new pg.Pool({ connectionString: url, max: 8, ssl });
}

export async function withTx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
