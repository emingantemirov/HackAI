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
  if (databaseUrl.startsWith('pglite:')) return createEmbedded(databaseUrl.slice('pglite:'.length).replace(/^\/\//, '')) as unknown as Db;
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

/**
 * Eingebettetes PostgreSQL (PGlite, WebAssembly): keine Datenbankinstallation nötig. Gleiche SQL-Syntax, Trigger und Constraints.
 * PGlite kennt genau eine Verbindung; Zugriffe werden daher nacheinander ausgeführt (Transaktionen halten die Sperre bis zum Ende).
 * Zum Betrieb mit mehreren Nutzern gleichzeitig ist ein echter PostgreSQL-Server (DATABASE_URL=postgres://…) vorgesehen.
 */
function createEmbedded(location: string) {
  let ready: Promise<any> | null = null;
  const open = () => (ready ??= (async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = location === 'memory' || location === '' ? undefined : location;
    if (dir) fs.mkdirSync(dir, { recursive: true });
    return new PGlite(dir);
  })());
  let chain: Promise<void> = Promise.resolve();
  const lock = async () => { let release!: () => void; const prev = chain; chain = new Promise<void>((r) => (release = r)); await prev; return release; };
  const opts = { parsers: { 1082: (v: string) => v, 20: (v: string) => Number(v) } };
  const run = async (conn: any, text: string, params?: unknown[]) => {
    if (!params || params.length === 0) {
      const res = await conn.exec(text, opts);
      const last = res[res.length - 1] ?? { rows: [], affectedRows: 0 };
      return { rows: last.rows, rowCount: last.rows.length || last.affectedRows || 0, fields: last.fields };
    }
    let r: any;
    try { r = await conn.query(text, params.map((x) => (x === undefined ? null : x)), opts); } catch (e: any) { if (process.env.DEBUG_SQL) console.error('SQL-Fehler:', text.slice(0, 200), JSON.stringify(params).slice(0, 300)); throw e; }
    return { rows: r.rows, rowCount: r.rows.length || r.affectedRows || 0, fields: r.fields };
  };
  return {
    async query(text: string, params?: unknown[]) { const rel = await lock(); try { return await run(await open(), text, params); } finally { rel(); } },
    async connect() {
      const rel = await lock(); const conn = await open();
      return { query: (text: string, params?: unknown[]) => run(conn, text, params), release: () => rel() };
    },
    async end() { const rel = await lock(); try { if (ready) await (await ready).close(); } finally { rel(); } },
  };
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
