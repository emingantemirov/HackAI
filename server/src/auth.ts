import crypto from 'node:crypto';
import type { Db, Q } from './db.js';

export type Role = 'admin' | 'fachbearbeitung' | 'pruefer' | 'kunde';

export interface Actor {
  kind: 'user' | 'ki' | 'system';
  id: string | null;
  label: string;
  orgId: string | null;
  role?: Role;
  orgKind?: 'pruefstelle' | 'hersteller';
}

export const systemActor: Actor = { kind: 'system', id: null, label: 'System', orgId: null };
export const aiActor = (model: string): Actor => ({ kind: 'ki', id: null, label: `KI (${model})`, orgId: null });

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}
export const forbidden = (msg = 'Dafür fehlt die Berechtigung.') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Objekt') => new HttpError(404, 'NOT_FOUND', `${what} wurde nicht gefunden.`);
export const conflict = (code: string, msg: string, details?: unknown) => new HttpError(409, code, msg, details);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details);

// ---------------------------------------------------------------------------
// Passwörter (scrypt) und Sessions
// ---------------------------------------------------------------------------

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, saltHex, keyHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 32);
  const expected = Buffer.from(keyHex, 'hex');
  return key.length === expected.length && crypto.timingSafeEqual(key, expected);
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export async function createSession(db: Db, userId: string, ttlHours = 12): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(`insert into sessions(token_hash, user_id, expires_at) values ($1, $2, now() + ($3 || ' hours')::interval)`, [sha(token), userId, String(ttlHours)]);
  return token;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.query('delete from sessions where token_hash = $1', [sha(token)]);
}

export async function actorFromToken(db: Db, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const r = await db.query(
    `select u.id, u.name, u.role, u.org_id, o.kind as org_kind
       from sessions s join users u on u.id = s.user_id and u.active join organizations o on o.id = u.org_id
      where s.token_hash = $1 and s.expires_at > now()`,
    [sha(token)],
  );
  if (!r.rowCount) return null;
  const u = r.rows[0];
  return { kind: 'user', id: u.id, label: u.name, orgId: u.org_id, role: u.role, orgKind: u.org_kind };
}

export async function createUser(
  q: Q,
  p: { orgId: string; email: string; name: string; role: Role; password: string },
): Promise<string> {
  const org = await q.query('select kind from organizations where id = $1', [p.orgId]);
  if (!org.rowCount) throw badRequest('Organisation unbekannt.');
  const kind = org.rows[0].kind;
  if (p.role === 'kunde' && kind !== 'hersteller') throw badRequest('Die Rolle „Kunde/Hersteller“ gehört zu einer Herstellerorganisation.');
  if (p.role !== 'kunde' && kind !== 'pruefstelle') throw badRequest('Diese Rolle gehört zur Prüfstelle.');
  const r = await q.query(
    `insert into users(org_id, email, name, role, password_hash) values ($1,$2,$3,$4,$5) returning id`,
    [p.orgId, p.email.toLowerCase(), p.name, p.role, hashPassword(p.password)],
  );
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// Rechte. Serverseitig erzwungen – Oberflächen blenden Aktionen nur zusätzlich aus.
// ---------------------------------------------------------------------------

export type Permission =
  | 'source:write' | 'content:write' | 'content:submit' | 'ai:run'
  | 'approval:decide' | 'clarification:decide' | 'certification:decide'
  | 'settings:write' | 'users:manage' | 'campaign:manage' | 'import:upload' | 'report:release';

const MATRIX: Record<Role, Permission[]> = {
  admin: ['settings:write', 'users:manage'],
  fachbearbeitung: ['source:write', 'content:write', 'content:submit', 'ai:run', 'campaign:manage', 'import:upload'],
  pruefer: ['source:write', 'content:write', 'content:submit', 'ai:run', 'campaign:manage', 'import:upload',
    'approval:decide', 'clarification:decide', 'certification:decide', 'report:release'],
  kunde: ['import:upload'],
};

export function can(actor: Actor, p: Permission): boolean {
  return actor.kind === 'user' && !!actor.role && MATRIX[actor.role].includes(p);
}

export function require(actor: Actor, p: Permission): void {
  if (!can(actor, p)) throw forbidden();
}

/** Hersteller sehen ausschließlich Kampagnen ihrer eigenen Organisation (serverseitige Mandantentrennung). */
export async function assertCampaignAccess(q: Q, actor: Actor, campaignId: string): Promise<{ org_id: string; customer_org_id: string }> {
  const r = await q.query('select id, org_id, customer_org_id from campaigns where id = $1', [campaignId]);
  if (!r.rowCount) throw notFound('Prüfung');
  const c = r.rows[0];
  if (actor.role === 'kunde') {
    if (c.customer_org_id !== actor.orgId) throw notFound('Prüfung'); // bewusst 404: Existenz fremder Prüfungen nicht verraten
  } else if (c.org_id !== actor.orgId) {
    throw notFound('Prüfung');
  }
  return c;
}

export const isStaff = (a: Actor) => a.role !== undefined && a.role !== 'kunde';
