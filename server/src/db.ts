import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// DATE-Spalten als 'YYYY-MM-DD'-Strings liefern (keine Zeitzonenverschiebung)
pg.types.setTypeParser(1082, (v: string) => v);
// COUNT(*) etc. als Zahl
pg.types.setTypeParser(20, (v: string) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Q = Db | Tx;

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/** Transaktion mit automatischem Rollback. Statusübergänge laufen immer in einer Transaktion. */
export async function tx<T>(db: Db, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

/** Fortlaufende fachliche Kennungen (K-001, T-001, KL-001, B-001), transaktionssicher. */
export async function nextCode(q: Q, orgId: string, key: string, prefix: string): Promise<string> {
  const r = await q.query(
    `insert into counters(org_id, key, value) values ($1, $2, 1)
     on conflict (org_id, key) do update set value = counters.value + 1 returning value`,
    [orgId, key],
  );
  return `${prefix}-${String(r.rows[0].value).padStart(3, '0')}`;
}

export async function migrate(db: Db, log: (m: string) => void = () => undefined): Promise<void> {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const done = await db.query('select 1 from schema_migrations where name = $1', [f]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(db, async (c) => {
      await c.query(sql);
      await c.query('insert into schema_migrations(name) values ($1)', [f]);
    });
    log(`Migration angewendet: ${f}`);
  }
}

/** Setzt die Datenbank zurück (nur Tests/Demo-Reset). */
export async function resetSchema(db: Db): Promise<void> {
  await db.query('drop schema public cascade; create schema public;');
}
