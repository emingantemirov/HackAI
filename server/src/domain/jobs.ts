// Hintergrundjobs mit nachvollziehbarem Fortschritt und Idempotenz.
// Unique (org, kind, idempotency_key): eine wiederholte Anfrage erzeugt keinen zweiten Lauf und keine Dubletten.

import type { Db, Q } from '../db.js';

export interface JobCtx {
  progress(done: number, total: number, message?: string): Promise<void>;
}

const running = new Map<string, Promise<void>>();

export async function startJob(
  db: Db,
  p: { orgId: string; kind: string; key: string; userId: string | null; run: (ctx: JobCtx) => Promise<unknown> },
): Promise<{ jobId: string; reused: boolean }> {
  const ex = await db.query('select id, status from jobs where org_id = $1 and kind = $2 and idempotency_key = $3', [p.orgId, p.kind, p.key]);
  let jobId: string;
  if (ex.rowCount) {
    jobId = ex.rows[0].id;
    // erfolgreiche oder laufende Jobs werden wiederverwendet; nur fehlgeschlagene dürfen erneut laufen
    if (ex.rows[0].status !== 'failed') return { jobId, reused: true };
    await db.query(`update jobs set status = 'queued', error = null, progress = 0, message = null, updated_at = now() where id = $1`, [jobId]);
  } else {
    const ins = await db.query(
      `insert into jobs(org_id, kind, idempotency_key, created_by) values ($1,$2,$3,$4) on conflict (org_id, kind, idempotency_key) do nothing returning id`,
      [p.orgId, p.kind, p.key, p.userId],
    );
    if (!ins.rowCount) {
      const again = await db.query('select id from jobs where org_id = $1 and kind = $2 and idempotency_key = $3', [p.orgId, p.kind, p.key]);
      return { jobId: again.rows[0].id, reused: true };
    }
    jobId = ins.rows[0].id;
  }
  const ctx: JobCtx = {
    async progress(done, total, message) {
      await db.query(`update jobs set progress = $2, total = $3, message = coalesce($4, message), updated_at = now() where id = $1`, [jobId, done, total, message ?? null]);
    },
  };
  const exec = (async () => {
    await db.query(`update jobs set status = 'running', updated_at = now() where id = $1`, [jobId]);
    try {
      const result = await p.run(ctx);
      await db.query(`update jobs set status = 'succeeded', result = $2, updated_at = now() where id = $1`, [jobId, JSON.stringify(result ?? {})]);
    } catch (e: any) {
      await db.query(`update jobs set status = 'failed', error = $2, updated_at = now() where id = $1`, [jobId, String(e?.message ?? e).slice(0, 1000)]);
    }
  })().finally(() => running.delete(jobId));
  running.set(jobId, exec);
  return { jobId, reused: false };
}

export async function waitForJob(db: Db, jobId: string, timeoutMs = 60000): Promise<any> {
  const p = running.get(jobId);
  if (p) await Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Job-Timeout')), timeoutMs))]);
  const r = await db.query('select * from jobs where id = $1', [jobId]);
  return r.rows[0];
}

export async function getJob(q: Q, orgId: string, jobId: string) {
  const r = await q.query('select * from jobs where id = $1 and org_id = $2', [jobId, orgId]);
  return r.rows[0] ?? null;
}

/** Beim Start: verwaiste „running“-Jobs (Prozess wurde beendet) als fehlgeschlagen kennzeichnen. */
export async function recoverJobs(db: Db): Promise<void> {
  await db.query(`update jobs set status = 'failed', error = 'Unterbrochen durch Neustart des Servers. Bitte erneut starten.', updated_at = now() where status in ('running','queued')`);
}
