import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '../src/config.js';
import { createPool, migrate, resetSchema, type Db } from '../src/db.js';
import { HaiClient } from '../src/ai/hai.js';
import { buildApp } from '../src/app.js';
import { seedBase, seedDemo, DEMO_USERS } from '../src/seed.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://eel:eel_dev_password@127.0.0.1:5432/eel_pruefportal_test';
export const PW = 'Demo-Passwort-2026!';

export interface Ctx { db: Db; app: FastifyInstance; cfg: AppConfig; hai: HaiClient; as: (email: string) => Client }
export interface Client { get(url: string): Promise<R>; post(url: string, body?: unknown): Promise<R>; patch(url: string, body?: unknown): Promise<R>; upload(url: string, file: { name: string; data: Buffer }, fields?: Record<string, string>): Promise<R> }
export interface R { status: number; json: any; raw: Buffer }

export async function setup(opts: { demo?: boolean; fetchImpl?: typeof fetch; apiKey?: string } = {}): Promise<Ctx> {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'eel-test-'));
  const cfg = loadConfig({ ...process.env, DATABASE_URL: TEST_DB, STORAGE_DIR: storage, DEMO_AI_MODE: 'true', HAI_API_KEY: opts.apiKey ?? '', LOG_LEVEL: process.env.TEST_LOG ?? 'silent' } as any);
  const db = createPool(cfg.databaseUrl);
  await resetSchema(db); await migrate(db);
  await seedBase(db, PW);
  if (opts.demo !== false) { const log = console.log; console.log = () => undefined; try { await seedDemo(db, cfg); } finally { console.log = log; } }
  const hai = new HaiClient(cfg, db, opts.fetchImpl);
  const app = await buildApp({ db, cfg, hai });
  const as = mkAs(app);
  return { db, app, cfg, hai, as };
}

export function mkAs(app: FastifyInstance) {
  const cookies = new Map<string, string>();
  return (email: string): Client => {
    const call = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}, payload?: Buffer): Promise<R> => {
      if (!cookies.has(email) && !url.startsWith('/api/auth/login')) {
        const l = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json', 'x-eel-portal': '1' }, payload: JSON.stringify({ email, password: PW }) });
        if (l.statusCode !== 200) throw new Error(`Login ${email}: ${l.body}`);
        cookies.set(email, String(l.cookies[0].value));
      }
      const res = await app.inject({ method: method as any, url, headers: { 'x-eel-portal': '1', cookie: `eel_session=${cookies.get(email)}`, ...(payload ? {} : { 'content-type': 'application/json' }), ...headers }, payload: payload ?? (body === undefined ? undefined : JSON.stringify(body)) });
      let json: any = null; try { json = res.body ? JSON.parse(res.body) : null; } catch { /* binär */ }
      return { status: res.statusCode, json, raw: res.rawPayload };
    };
    return {
      get: (u) => call('GET', u), post: (u, b) => call('POST', u, b ?? {}), patch: (u, b) => call('PATCH', u, b ?? {}),
      upload: (u, f, fields = {}) => {
        const boundary = '----eeltest' + Math.random().toString(16).slice(2);
        const parts: Buffer[] = [];
        for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
        parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), f.data, Buffer.from(`\r\n--${boundary}--\r\n`));
        return call('POST', u, undefined, { 'content-type': `multipart/form-data; boundary=${boundary}` }, Buffer.concat(parts));
      },
    };
  };
}

export async function teardown(c: Ctx) { await c.app.close(); await c.db.end(); }
export const USERS = Object.fromEntries(DEMO_USERS.map((u) => [u.role + (u.email.includes('2') ? '2' : ''), u.email]));
export const FB = 'fachbearbeitung@demo.example', PR = 'pruefer@demo.example', PR2 = 'pruefer2@demo.example', AD = 'admin@demo.example', KU = 'kunde@demo.example', KU2 = 'kunde2@demo.example';
