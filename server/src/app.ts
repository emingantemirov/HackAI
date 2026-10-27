import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fstatic from '@fastify/static';
import { z, ZodError } from 'zod';
import type { AppConfig } from './config.js';
import { type Db, tx } from './db.js';
import { HaiClient, AiError } from './ai/hai.js';
import {
  type Actor, HttpError, actorFromToken, assertCampaignAccess, badRequest, can, conflict, createSession, createUser, destroySession, forbidden, notFound, require as requirePerm, verifyPassword,
} from './auth.js';
import { audit } from './audit.js';
import { readStored, findQuote, storeFile } from './extract.js';
import { GLOSSARY } from './glossary.js';
import { importSourceFile, importSourceText, compareSources, supplyReviewedText, removeSource } from './domain/sources.js';
import { createCriterion } from './domain/criteria.js';
import { deriveFromSource } from './domain/derive.js';
import { startJob, getJob } from './domain/jobs.js';
import { TABLES, type ObjType, currentVersion, decide, decisionHistory, getVersion, reviseVersion, submitForApproval, withdrawSubmission } from './domain/versions.js';
import { DBVO_CLARIFICATIONS, decideClarification, ensureClarification } from './domain/clarifications.js';
import { assertBasisCurrent, generateLibrary, refreshAfterClarification, libraryDefs, describeScenario } from './domain/testcases.js';
import { onCriterionApproved, listImpacts, refreshImpactStatus } from './domain/changes.js';
import * as camp from './domain/campaigns.js';
import { createReport, provideReport, refreshReport, CLASSIFICATIONS, validateClassification } from './domain/reports.js';
import { readiness, decideCertification } from './domain/certification.js';
import { dashboard, listApprovalQueue, listCurrent, listRuns, STATUS_FILTERS, RUN_FILTERS } from './domain/lists.js';
import { proposeTestcasesAi, explainImpactAi, draftReportAi, reviseRejectedAi } from './domain/aiTasks.js';
import { compareMoney } from './util/money.js';
import { needStaff, readMultipart, sendFile } from './routes/helpers.js';
import { formatDe } from './util/dates.js';

declare module 'fastify' { interface FastifyRequest { actor: Actor | null } }

const OBJ: Record<string, ObjType> = { criteria: 'criterion', testcases: 'testcase', reports: 'report' };

export interface Deps { db: Db; cfg: AppConfig; hai: HaiClient }

export async function buildApp({ db, cfg, hai }: Deps): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie'] }, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: cfg.maxUploadBytes, files: 1 } });
  app.decorateRequest('actor', null);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    if (err instanceof AiError) return reply.code(err.state === 'nicht_konfiguriert' ? 409 : 502).send({ error: { code: 'AI_' + err.state.toUpperCase(), message: err.message, state: err.state } });
    if (err instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: 'Eingabe ungültig: ' + err.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'Wert'}: ${i.message}`).join('; '), details: err.issues } });
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: { code: 'TOO_LARGE', message: 'Die Datei ist zu groß.' } });
    if (err?.code === 'P0001') return reply.code(409).send({ error: { code: 'LOCKED', message: String(err.message).replace(/^error: /i, '') } });
    if (err?.code === '23514' && /rejection_needs_reason/.test(err.message)) return reply.code(400).send({ error: { code: 'REASON_REQUIRED', message: 'Eine Ablehnung braucht eine Begründung.' } });
    req.log.error({ err: { message: err?.message, code: err?.code, stack: err?.stack } }, 'Unerwarteter Fehler');
    return reply.code(500).send({ error: { code: 'INTERNAL', message: 'Es ist ein unerwarteter Fehler aufgetreten. Die Eingaben wurden nicht verändert.' } });
  });

  // ---- Authentifizierung und CSRF-Schutz ----
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    req.actor = await actorFromToken(db, req.cookies?.eel_session);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-eel-portal'] !== '1') {
      return reply.code(403).send({ error: { code: 'CSRF', message: 'Ungültige Anfrage (fehlender Schutz-Header).' } });
    }
    const open = req.url.startsWith('/api/auth/login') || req.url.startsWith('/api/health');
    if (!open && !req.actor) return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Bitte anmelden.' } });
  });
  const A = (req: FastifyRequest): Actor => req.actor!;
  const orgOf = (a: Actor) => a.orgId!;
  const staff = (req: FastifyRequest): Actor => { const a = A(req); needStaff(a); return a; };

  app.get('/api/health', async () => ({ ok: true }));

  // ---- Anmeldung ----
  app.post('/api/auth/login', async (req, reply) => {
    const b = z.object({ email: z.string().min(3), password: z.string().min(1) }).parse(req.body);
    const u = (await db.query('select u.*, o.kind as org_kind, o.name as org_name from users u join organizations o on o.id = u.org_id where lower(u.email) = $1 and u.active', [b.email.toLowerCase()])).rows[0];
    if (!u || !verifyPassword(b.password, u.password_hash)) throw new HttpError(401, 'LOGIN_FAILED', 'E-Mail oder Passwort sind nicht korrekt.');
    const token = await createSession(db, u.id);
    reply.setCookie('eel_session', token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.COOKIE_SECURE === 'true', maxAge: 12 * 3600 });
    await audit(db, { actor: { kind: 'user', id: u.id, label: u.name, orgId: u.org_id, role: u.role }, action: 'anmeldung', objectType: 'user', objectId: u.id });
    return { user: { id: u.id, name: u.name, role: u.role, org: u.org_name, orgKind: u.org_kind } };
  });
  app.post('/api/auth/logout', async (req, reply) => { if (req.cookies?.eel_session) await destroySession(db, req.cookies.eel_session); reply.clearCookie('eel_session', { path: '/' }); return { ok: true }; });
  app.get('/api/auth/me', async (req) => {
    const a = A(req);
    const o = (await db.query('select name, kind from organizations where id = $1', [a.orgId])).rows[0];
    const perms = ['source:write', 'content:write', 'content:submit', 'ai:run', 'approval:decide', 'clarification:decide', 'certification:decide', 'settings:write', 'users:manage', 'campaign:manage', 'import:upload', 'report:release'].filter((p) => can(a, p as any));
    return { user: { id: a.id, name: a.label, role: a.role, org: o.name, orgKind: o.kind, permissions: perms } };
  });

  // ---- Meta ----
  app.get('/api/meta', async () => ({
    glossar: GLOSSARY, adapter: camp.ADAPTERS, simulatorFehlerbilder: camp.SIM_FAULTS, klassifikationen: CLASSIFICATIONS,
    statusFilter: Object.fromEntries(Object.entries(STATUS_FILTERS).map(([k, v]) => [k, v.label])), laufFilter: Object.fromEntries(Object.entries(RUN_FILTERS).map(([k, v]) => [k, v.label])),
    demoKiModus: cfg.demoAiMode,
  }));

  // ---- KI-Verbindung (Einstellungen). Der Schlüssel wird nie ausgeliefert. ----
  app.get('/api/ai/status', async (req) => { staff(req); return { ...(await hai.lastStatus()), konfiguriert: hai.configured, schluesselQuelle: hai.keySource, demoModus: cfg.demoAiMode }; });
  app.post('/api/ai/key', async (req) => {
    const a = A(req); requirePerm(a, 'settings:write');
    const b = z.object({ key: z.string().trim().max(500) }).parse(req.body);
    await hai.setKey(b.key || null);
    await audit(db, { actor: a, orgId: orgOf(a), action: b.key ? 'ki.schluessel_hinterlegt' : 'ki.schluessel_entfernt', objectType: 'settings' });
    return hai.testConnection();
  });
  app.post('/api/ai/test', async (req) => { const a = A(req); requirePerm(a, 'settings:write'); return hai.testConnection(); });

  // ---- Dashboard ----
  app.get('/api/dashboard', async (req) => dashboard(db, orgOf(staff(req))));

  // ---- Quellen ----
  app.get('/api/sources', async (req) => {
    const a = staff(req);
    const r = await db.query(
      `select d.id as document_id, d.title, d.publisher, d.area, sv.id, sv.version_label, sv.valid_from, sv.valid_to, sv.input_kind, sv.file_name, sv.sha256, sv.size_bytes, sv.extraction_status, sv.extraction_note, sv.created_at,
              (select count(*)::int from criteria_versions cv where cv.evidence @> jsonb_build_array(jsonb_build_object('source_version_id', sv.id))) as criteria_refs
         from source_documents d join source_versions sv on sv.document_id = d.id where d.org_id = $1 and sv.removed_at is null order by d.title, sv.created_at`, [orgOf(a)]);
    return { quellen: r.rows };
  });
  app.post('/api/sources/:id/remove', async (req) => {
    const a = staff(req); const { id } = req.params as { id: string };
    return { ok: true, ...(await tx(db, (t) => removeSource(t, a, id))) };
  });
  app.post('/api/sources', async (req) => {
    const a = staff(req);
    const ct = req.headers['content-type'] ?? '';
    const meta = (f: Record<string, any>) => ({ title: f.title, publisher: f.publisher, versionLabel: f.versionLabel, validFrom: f.validFrom || null, validTo: f.validTo || null, area: f.area, documentId: f.documentId || undefined });
    if (ct.startsWith('multipart/')) {
      const { fields, file } = await readMultipart(req);
      if (!file) throw badRequest('Bitte eine Datei auswählen oder Text einfügen.');
      return tx(db, (t) => importSourceFile(t, a, cfg, meta(fields), file.filename, file.mimetype, file.buffer));
    }
    const b = z.object({ title: z.string(), publisher: z.string().optional(), versionLabel: z.string(), validFrom: z.string().nullish(), validTo: z.string().nullish(), area: z.string().optional(), documentId: z.string().optional(), text: z.string().min(20) }).parse(req.body);
    return tx(db, (t) => importSourceText(t, a, cfg, meta(b), b.text));
  });
  app.get('/api/sources/compare', async (req) => {
    const a = staff(req); const q = z.object({ from: z.string().uuid(), to: z.string().uuid() }).parse(req.query);
    return compareSources(db, orgOf(a), q.from, q.to);
  });
  app.get('/api/sources/:id', async (req) => {
    const a = staff(req); const { id } = req.params as { id: string };
    const r = (await db.query(`select sv.*, d.title, d.publisher, d.area from source_versions sv join source_documents d on d.id = sv.document_id where sv.id = $1 and sv.org_id = $2`, [id, orgOf(a)])).rows[0];
    if (!r) throw notFound('Quelle');
    const crit = (await db.query(`select distinct c.id, c.code, c.slug, v.version, v.title, v.status from criteria c join criteria_versions v on v.criterion_id = c.id where c.org_id = $1 and v.evidence @> $2::jsonb order by c.code`, [orgOf(a), JSON.stringify([{ source_version_id: id }])])).rows;
    const { storage_path, ...rest } = r;
    return { ...rest, kriterien: crit };
  });
  app.get('/api/sources/:id/file', async (req, reply) => {
    const a = staff(req); const { id } = req.params as { id: string };
    const r = (await db.query('select * from source_versions where id = $1 and org_id = $2', [id, orgOf(a)])).rows[0];
    if (!r) throw notFound('Quelle');
    const mime = r.input_kind === 'pdf' ? 'application/pdf' : r.input_kind === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain; charset=utf-8';
    return sendFile(reply, r.file_name ?? `${r.version_label}.txt`, readStored(cfg.storageDir, r.storage_path), mime);
  });
  app.post('/api/sources/:id/ocr-text', async (req) => {
    const a = staff(req); const { id } = req.params as { id: string }; const b = z.object({ text: z.string().min(20) }).parse(req.body);
    await tx(db, (t) => supplyReviewedText(t, a, id, b.text)); return { ok: true };
  });
  app.post('/api/sources/:id/derive', async (req) => {
    const a = staff(req); const { id } = req.params as { id: string }; requirePerm(a, 'ai:run');
    const b = z.object({ mode: z.enum(['auto', 'uebernahme', 'ki', 'demo']) }).parse(req.body);
    if (b.mode === 'auto') {
      // Ein Knopf: KI, wenn verbunden; sonst die gekennzeichnete Demo-Ableitung (falls aktiv); sonst nur eingebettete Kriterien mit Original-ID.
      const pref = hai.configured ? 'ki' : cfg.demoAiMode ? 'demo' : 'uebernahme';
      return startJob(db, { orgId: orgOf(a), kind: 'ableitung:auto', key: `${id}:${pref}`, userId: a.id, run: async (ctx) => {
        const base = { db, cfg, hai, actor: a, orgId: orgOf(a), sourceVersionId: id, progress: ctx.progress };
        try { return await deriveFromSource({ ...base, mode: pref }); }
        catch (e) {
          if (pref === 'ki' && e instanceof AiError && cfg.demoAiMode) { const r = await deriveFromSource({ ...base, mode: 'demo' }); r.hinweis = `Die KI war nicht erreichbar (${e.message}). Stattdessen wurde die gekennzeichnete Demo-Ableitung verwendet. ` + r.hinweis; return r; }
          throw e;
        }
      } });
    }
    if (b.mode === 'demo' && !cfg.demoAiMode) throw conflict('DEMO_OFF', 'Der Demo-Modus ist nicht aktiviert (DEMO_AI_MODE=true). Er ersetzt die KI durch eine regelbasierte Ableitung und ist immer als Demo gekennzeichnet.');
    if (b.mode === 'ki' && !hai.configured) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert. Nutzen Sie „Eingebettete Kriterien übernehmen“, den Demo-Modus oder legen Sie Kriterien manuell an.');
    const r = await startJob(db, { orgId: orgOf(a), kind: 'ableitung:' + b.mode, key: id, userId: a.id, run: (ctx) => deriveFromSource({ db, cfg, hai, actor: a, orgId: orgOf(a), sourceVersionId: id, mode: b.mode as 'ki' | 'demo' | 'uebernahme', progress: ctx.progress }) });
    return r;
  });
  app.get('/api/jobs/:id', async (req) => { const a = staff(req); const j = await getJob(db, orgOf(a), (req.params as any).id); if (!j) throw notFound('Auftrag'); return j; });

  // ---- Versionierte Objekte: Kriterien, Testfälle, Berichte ----
  app.get('/api/objects/:type', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich');
    const q = z.object({ status: z.string().optional(), q: z.string().optional() }).parse(req.query);
    if (q.status && !STATUS_FILTERS[q.status]) throw badRequest('Unbekannter Statusfilter.');
    return { eintraege: await listCurrent(db, orgOf(a), type, q.status, q.q) };
  });
  app.get('/api/objects/:type/:id', async (req) => {
    const a = A(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich');
    const id = (req.params as any).id as string; const t = TABLES[type];
    const obj = (await db.query(`select * from ${t.obj} where id = $1 and org_id = $2`, [id, orgOf(a)])).rows[0];
    if (!obj) throw notFound(t.label);
    if (a.role === 'kunde') {
      if (type !== 'report') throw forbidden();
      const shown = (await db.query(`select v.id from report_versions v join report_dispatches d on d.report_version_id = v.id and d.kind = 'bereitstellung' join campaigns c on c.id = (select campaign_id from reports where id = v.report_id) where v.report_id = $1 and c.customer_org_id = $2`, [id, a.orgId])).rows;
      if (!shown.length) throw notFound('Bericht');
    }
    let versions = (await db.query(`select v.*, cb.name as created_by_name, sb.name as submitted_by_name from ${t.ver} v left join users cb on cb.id = v.created_by left join users sb on sb.id = v.submitted_by where v.${t.fk} = $1 order by v.version desc`, [id])).rows;
    // Hersteller sehen nur Berichtsversionen, die ihnen ausdrücklich bereitgestellt wurden (keine Entwürfe oder nicht bereitgestellte Fassungen).
    if (a.role === 'kunde') {
      const shown = new Set((await db.query(`select d.report_version_id from report_dispatches d join report_versions v on v.id = d.report_version_id where v.report_id = $1 and d.kind = 'bereitstellung'`, [id])).rows.map((r) => r.report_version_id));
      versions = versions.filter((v) => shown.has(v.id));
    }
    const extra: Record<string, unknown> = {};
    if (type === 'criterion') {
      extra.testfaelle = (await db.query(`select distinct t2.id, t2.code, tv.version, tv.title, tv.status from testcase_criteria tc join testcase_versions tv on tv.id = tc.testcase_version_id join testcases t2 on t2.id = tv.testcase_id where tc.criterion_id = $1 order by t2.code`, [id])).rows;
      extra.quellen = (await db.query(`select sv.id, sv.version_label, d.title from source_versions sv join source_documents d on d.id = sv.document_id where sv.org_id = $1`, [orgOf(a)])).rows;
    }
    if (type === 'testcase') {
      const cur = versions[0];
      extra.kriterien = (await db.query(`select c.id, c.code, c.slug, cv.version as linked_version, cv.title, (select max(v.version) from criteria_versions v where v.criterion_id = c.id and v.status = 'approved') as effective_version from testcase_criteria tc join criteria c on c.id = tc.criterion_id join criteria_versions cv on cv.id = tc.criterion_version_id where tc.testcase_version_id = $1 order by c.code`, [cur.id])).rows;
      extra.szenario = cur.initial_state?.scenario ? describeScenario(cur.initial_state.scenario) : null;
      extra.klaerungen = cur.blocked_by?.length ? (await db.query('select id, code, title, status from clarifications where id = any($1::uuid[])', [cur.blocked_by])).rows : [];
    }
    if (type === 'report' && a.role !== 'kunde') extra.bereitstellungen = (await db.query(`select d.* from report_dispatches d join report_versions v on v.id = d.report_version_id where v.report_id = $1 order by d.created_at desc`, [id])).rows;
    return { objekt: obj, versionen: versions, verlauf: a.role === 'kunde' ? [] : await decisionHistory(db, type, id), ...extra };
  });
  app.get('/api/objects/:type/:id/audit', async (req) => {
    const a = staff(req); const { id } = req.params as any;
    return { eintraege: (await db.query(`select at, actor_kind, actor_label, action, object_version, reason, details, ai_model, prompt_version from audit_events where object_id = $1 and (org_id = $2 or org_id is null) order by at desc, id desc limit 200`, [id, orgOf(a)])).rows };
  });
  app.post('/api/criteria', async (req) => {
    const a = staff(req); requirePerm(a, 'content:write');
    const b = z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/, 'nur Kleinbuchstaben, Ziffern und Bindestriche'), title: z.string().min(5), description: z.string().default(''), preconditions: z.string().default(''), rule: z.string().default(''), exceptions: z.string().default(''), expected_behavior: z.string().default(''), valid_from: z.string().nullish(), valid_to: z.string().nullish() }).parse(req.body);
    return tx(db, (t) => createCriterion(t, a, orgOf(a), { ...b, evidence: [], origin: 'manuell', open_questions: [{ text: 'Beleg aus einer Quelle ergänzen.' }] }));
  });
  app.post('/api/criteria/versions/:vid/evidence', async (req) => {
    const a = staff(req); requirePerm(a, 'content:write'); const { vid } = req.params as any;
    const b = z.object({ sourceVersionId: z.string().uuid(), quote: z.string().min(12) }).parse(req.body);
    return tx(db, async (t) => {
      const v = await getVersion(t, 'criterion', vid); if (v.org_id !== orgOf(a)) throw notFound('Kriterium');
      const sv = (await t.query('select * from source_versions where id = $1 and org_id = $2', [b.sourceVersionId, orgOf(a)])).rows[0]; if (!sv) throw notFound('Quelle');
      const m = findQuote(sv.extracted_text ?? '', sv.locators ?? [], b.quote);
      if (!m.found) throw badRequest('Das Zitat kommt in dieser Quelle nicht wörtlich vor. Belege müssen dem Originaltext entsprechen; sie werden nicht frei formuliert.');
      const ev = [...(v.evidence as any[]), { source_version_id: sv.id, quote: b.quote, locator: m.locator ?? null, verified: true }];
      return reviseVersion(t, a, 'criterion', vid, { evidence: ev }, 'Beleg ergänzt');
    });
  });
  app.patch('/api/objects/:type/versions/:vid', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich'); const { vid } = req.params as any;
    const b = z.object({ patch: z.record(z.any()), changeNote: z.string().optional() }).parse(req.body);
    const forbiddenKeys = ['evidence', 'status', 'origin', 'ai_meta', 'expected', 'initial_state', 'events', 'blocked_by', 'profile_requirements'];
    for (const k of Object.keys(b.patch)) if (forbiddenKeys.includes(k) && type !== 'report') throw badRequest(`Das Feld „${k}“ kann nicht direkt geändert werden (Belege über „Beleg ergänzen“, Soll-Werte über die Neuberechnung).`);
    return tx(db, async (t) => {
      const base = await getVersion(t, type, vid);
      const res = await reviseVersion(t, a, type, vid, b.patch, b.changeNote);
      if (type === 'testcase' && res.created) {
        const links = await t.query('select criterion_id, criterion_version_id from testcase_criteria where testcase_version_id = $1', [base.id]);
        for (const l of links.rows) await t.query('insert into testcase_criteria(testcase_version_id, criterion_id, criterion_version_id) values ($1,$2,$3) on conflict do nothing', [res.version.id, l.criterion_id, l.criterion_version_id]);
      }
      return res;
    });
  });
  app.post('/api/objects/:type/versions/:vid/submit', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich'); const { vid } = req.params as any;
    return tx(db, (t) => submitForApproval(t, a, type, vid, async (v) => {
      if (type === 'criterion') {
        if (!(v.evidence as any[]).some((e) => e.verified)) throw conflict('EVIDENCE_REQUIRED', 'Ein Kriterium braucht mindestens einen geprüften Beleg aus einer Quelle (wörtliches Zitat mit Fundstelle).');
        if (!v.rule?.trim() || !v.expected_behavior?.trim()) throw conflict('INCOMPLETE', 'Bitte „Prüfbare Regel“ und „Erwartetes Verhalten“ ausfüllen.');
      }
      if (type === 'testcase') await assertBasisCurrent(t, v.id);
    }));
  });
  app.post('/api/objects/:type/versions/:vid/withdraw', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich');
    await tx(db, (t) => withdrawSubmission(t, a, type, (req.params as any).vid)); return { ok: true };
  });
  app.post('/api/objects/:type/versions/:vid/decide', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich'); const { vid } = req.params as any;
    const b = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().optional(), hints: z.string().optional() }).parse(req.body);
    return tx(db, async (t) => {
      if (type === 'testcase' && b.decision === 'approved') await assertBasisCurrent(t, vid);
      return decide(t, a, type, { versionId: vid, ...b }, async (v) => {
        if (type === 'criterion') { await onCriterionApproved(t, a, orgOf(a), v); await refreshImpactStatus(t, orgOf(a)); }
        if (type === 'testcase') await refreshImpactStatus(t, orgOf(a));
      });
    });
  });
  // Stapelaktionen: jede Version wird einzeln (eigene Transaktion, volle Prüfungen, eigener Audit-Eintrag) behandelt.
  // Nicht Eingereichbares/Freigebbares wird mit Grund übersprungen. Ablehnen gibt es nur einzeln (Begründung nötig).
  const submitChecks = (type: ObjType, t: any) => async (v: any) => {
    if (type === 'criterion') {
      if (!(v.evidence as any[]).some((e) => e.verified)) throw conflict('EVIDENCE_REQUIRED', 'Kein geprüfter Beleg aus einer Quelle.');
      if (!v.rule?.trim() || !v.expected_behavior?.trim()) throw conflict('INCOMPLETE', 'Regel oder erwartetes Verhalten fehlt.');
    }
    if (type === 'testcase') await assertBasisCurrent(t, v.id);
  };
  app.post('/api/objects/:type/submit-batch', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich'); requirePerm(a, 'content:submit');
    const b = z.object({ versionIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {});
    const cur = await listCurrent(db, orgOf(a), type);
    const targets = cur.filter((r: any) => (b.versionIds ? b.versionIds.includes(r.version_id) : r.status === 'draft'));
    const out = { eingereicht: 0, uebersprungen: [] as { code: string; grund: string }[] };
    for (const r of targets) {
      try { await tx(db, (t) => submitForApproval(t, a, type, r.version_id, submitChecks(type, t) as any)); out.eingereicht++; }
      catch (e: any) { out.uebersprungen.push({ code: r.code, grund: e instanceof HttpError ? e.message : 'Nicht möglich.' }); }
    }
    return out;
  });
  app.post('/api/objects/:type/approve-batch', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (!type) throw notFound('Bereich'); requirePerm(a, 'approval:decide');
    const b = z.object({ versionIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {});
    const cur = await listCurrent(db, orgOf(a), type);
    const targets = cur.filter((r: any) => r.status === 'submitted' && (!b.versionIds || b.versionIds.includes(r.version_id)));
    const out: { freigegeben: number; uebersprungen: { code: string; grund: string }[]; testfaelle?: { angelegt: number } } = { freigegeben: 0, uebersprungen: [] };
    for (const r of targets) {
      try {
        await tx(db, async (t) => {
          if (type === 'testcase') await assertBasisCurrent(t, r.version_id);
          return decide(t, a, type, { versionId: r.version_id, decision: 'approved' }, async (v) => {
            if (type === 'criterion') { await onCriterionApproved(t, a, orgOf(a), v); await refreshImpactStatus(t, orgOf(a)); }
            if (type === 'testcase') await refreshImpactStatus(t, orgOf(a));
          });
        });
        out.freigegeben++;
      } catch (e: any) { out.uebersprungen.push({ code: r.code, grund: e instanceof HttpError ? e.message : 'Nicht möglich.' }); }
    }
    // Nach freigegebenen Kriterien entstehen die Testfall-Entwürfe automatisch (nur aus freigegebenen Grundlagen; Entwürfe, nie freigegeben).
    if (type === 'criterion' && out.freigegeben > 0 && can(a, 'content:write')) {
      try { const g = await tx(db, (t) => generateLibrary(t, a, orgOf(a))); out.testfaelle = { angelegt: g.angelegt.length + g.neueVersion.length }; } catch { /* Erzeugung bleibt manuell möglich */ }
    }
    return out;
  });
  // Direkte Prüfung eines Kriteriums-Entwurfs: Die KI bzw. die Ableitung hat den Entwurf erzeugt, der Mensch entscheidet.
  // Freigeben macht das Kriterium sofort für Testfälle aktiv. Ablehnen braucht eine Begründung; danach überarbeitet die KI den Entwurf als neue Version.
  app.post('/api/criteria/versions/:vid/review', async (req) => {
    const a = staff(req); const { vid } = req.params as any;
    const b = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().optional(), hints: z.string().optional() }).parse(req.body);
    const decided = await tx(db, async (t) => {
      const v = (await t.query(`select v.*, c.org_id from criteria_versions v join criteria c on c.id = v.criterion_id where v.id = $1`, [vid])).rows[0];
      if (!v || v.org_id !== orgOf(a)) throw notFound('Kriterium');
      // Abgeleitete Entwürfe darf jede Person mit Schreibrecht prüfen; manuell verfasste brauchen Freigeberrecht (und Vier-Augen).
      if (!can(a, 'approval:decide') && !(can(a, 'content:write') && v.origin !== 'manuell')) throw new HttpError(403, 'FORBIDDEN', 'Für diese Entscheidung fehlt die Berechtigung.');
      // Früher selbst eingereichte, abgeleitete Version: zurück in den Entwurf, damit die prüfende Person sie direkt entscheiden kann.
      if (v.status === 'submitted' && v.submitted_by === a.id && v.origin !== 'manuell') { await withdrawSubmission(t, a, 'criterion', vid); v.status = 'draft'; }
      if (v.status === 'draft') {
        // Von der Ableitung (KI, Demo, Übernahme) erzeugte Entwürfe: die prüfende Person ist die erste menschliche Instanz. Manuell verfasste Entwürfe behalten das Vier-Augen-Prinzip.
        const system = v.origin !== 'manuell';
        await submitForApproval(t, a, 'criterion', vid, submitChecks('criterion', t) as any, { systemDraft: system });
      }
      return decide(t, a, 'criterion', { versionId: vid, decision: b.decision, reason: b.reason, hints: b.hints }, async (x) => { await onCriterionApproved(t, a, orgOf(a), x); await refreshImpactStatus(t, orgOf(a)); }, { skipPerm: true });
    });
    if (b.decision === 'approved') {
      let testfaelle = 0;
      if (can(a, 'content:write')) { try { const g = await tx(db, (t) => generateLibrary(t, a, orgOf(a))); testfaelle = g.angelegt.length + g.neueVersion.length; } catch { /* manuell möglich */ } }
      return { ok: true, testfaelle };
    }
    // Abgelehnt: KI überarbeitet anhand der Begründung (neue Version, die abgelehnte bleibt erhalten).
    if (!hai.configured || !can(a, 'ai:run')) return { ok: true, ueberarbeitet: false, hinweis: 'Abgelehnt. Die KI ist nicht verbunden – bitte manuell überarbeiten oder den Schlüssel in den Einstellungen eintragen.' };
    try { const nv = await reviseRejectedAi(db, hai, a, orgOf(a), decided.id); return { ok: true, ueberarbeitet: true, version: nv.version }; }
    catch (e: any) { return { ok: true, ueberarbeitet: false, hinweis: `Abgelehnt. Die KI-Überarbeitung ist fehlgeschlagen: ${e?.message ?? 'unbekannter Fehler'}` }; }
  });
  // Testfälle und Berichte: erzeugte Entwürfe prüft die berechtigte Person direkt (Freigeben/Ablehnen). Das Soll-Ergebnis bleibt deterministisch; es gibt keine KI-Überarbeitung.
  const reviewOne = async (a: any, type: 'testcase' | 'report', vid: string, decision: 'approved' | 'rejected', reason?: string, hints?: string) => {
    if (!can(a, 'approval:decide') && !can(a, 'content:write')) throw new HttpError(403, 'FORBIDDEN', 'Für diese Entscheidung fehlt die Berechtigung.');
    return tx(db, async (t) => {
      const v = await getVersion(t, type, vid); if (!v || v.org_id !== orgOf(a)) throw notFound(type === 'testcase' ? 'Testfall' : 'Bericht');
      if (decision === 'approved' && type === 'testcase') await assertBasisCurrent(t, vid);
      if (v.status === 'submitted' && v.submitted_by === a.id) { await withdrawSubmission(t, a, type, vid); v.status = 'draft'; }
      if (v.status === 'draft') await submitForApproval(t, a, type, vid, submitChecks(type, t) as any, { systemDraft: true });
      return decide(t, a, type, { versionId: vid, decision, reason, hints }, async () => { if (type === 'testcase') await refreshImpactStatus(t, orgOf(a)); }, { skipPerm: true });
    });
  };
  app.post('/api/objects/:type/versions/:vid/review', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (type !== 'testcase' && type !== 'report') throw notFound('Bereich');
    const b = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().optional(), hints: z.string().optional() }).parse(req.body);
    await reviewOne(a, type, (req.params as any).vid, b.decision, b.reason, b.hints); return { ok: true };
  });
  app.post('/api/objects/:type/review-batch', async (req) => {
    const a = staff(req); const type = OBJ[(req.params as any).type]; if (type !== 'testcase' && type !== 'report') throw notFound('Bereich');
    const cur = await listCurrent(db, orgOf(a), type); const out = { freigegeben: 0, uebersprungen: [] as { code: string; grund: string }[] };
    for (const r of cur.filter((x: any) => x.status === 'draft' || x.status === 'submitted')) {
      try { await reviewOne(a, type, r.version_id, 'approved'); out.freigegeben++; } catch (e: any) { out.uebersprungen.push({ code: r.code, grund: e instanceof HttpError ? e.message : 'Nicht möglich.' }); }
    }
    return out;
  });
  app.post('/api/criteria/versions/:vid/ai-revise', async (req) => { const a = staff(req); return reviseRejectedAi(db, hai, a, orgOf(a), (req.params as any).vid); });
  app.get('/api/approvals', async (req) => { const a = staff(req); const q = z.object({ art: z.enum(['criterion', 'testcase', 'report']).optional() }).parse(req.query); return { eintraege: await listApprovalQueue(db, orgOf(a), q.art) }; });

  // ---- Klärungen ----
  app.get('/api/clarifications', async (req) => { const a = staff(req); return { eintraege: (await db.query(`select c.*, u.name as decided_by_name from clarifications c left join users u on u.id = c.decided_by where c.org_id = $1 order by c.code`, [orgOf(a)])).rows, katalog: DBVO_CLARIFICATIONS.map((d) => d.key) }; });
  app.post('/api/clarifications/ensure', async (req) => { const a = staff(req); requirePerm(a, 'content:write'); return tx(db, async (t) => { const out = []; for (const d of DBVO_CLARIFICATIONS) out.push(await ensureClarification(t, a, orgOf(a), d)); return { angelegt: out.filter((x) => x.created).length, gesamt: out.length }; }); });
  app.post('/api/clarifications/:id/decide', async (req) => {
    const a = staff(req); const b = z.object({ decisionKey: z.string(), note: z.string().optional() }).parse(req.body);
    return tx(db, async (t) => decideClarification(t, a, (req.params as any).id, b.decisionKey, b.note?.trim() || `Entschieden durch ${a.label}.`, async () => { await refreshAfterClarification(t, a, orgOf(a)); }));
  });

  // ---- Testfälle ----
  app.post('/api/testcases/generate', async (req) => { const a = staff(req); const b = z.object({ keys: z.array(z.string()).optional() }).parse(req.body ?? {}); return tx(db, (t) => generateLibrary(t, a, orgOf(a), b.keys)); });
  app.get('/api/testcases/library', async (req) => { staff(req); return { faelle: libraryDefs().map((d) => ({ key: d.key, title: d.title, type: d.test_type, criteria: d.criteria })) }; });
  app.post('/api/testcases/ai-propose', async (req) => { const a = staff(req); return proposeTestcasesAi(db, hai, a, orgOf(a)); });
  app.get('/api/impacts', async (req) => { const a = staff(req); const q = z.object({ status: z.enum(['offen', 'erledigt']).optional() }).parse(req.query); return { eintraege: await listImpacts(db, orgOf(a), q.status) }; });
  app.post('/api/impacts/:id/explain', async (req) => { const a = staff(req); return explainImpactAi(db, hai, a, orgOf(a), (req.params as any).id); });

  // ---- Softwareprofile, Regelwerke, Organisationen ----
  app.get('/api/software', async (req) => {
    const a = staff(req);
    const rows = (await db.query(`select sv.id, sv.version, sv.adapter_key, sp.vendor, sp.name as product from software_versions sv join software_products sp on sp.id = sv.product_id where sp.owner_org_id = $1 order by sp.vendor, sp.name, sv.version`, [orgOf(a)])).rows;
    return { eintraege: rows.map((r) => ({ ...r, adapter: camp.ADAPTERS.find((x) => x.key === r.adapter_key) })) };
  });
  app.post('/api/software', async (req) => { const a = staff(req); const b = z.object({ vendor: z.string(), product: z.string(), version: z.string(), adapterKey: z.string() }).parse(req.body); return { id: await tx(db, (t) => camp.createSoftwareVersion(t, a, b)) }; });
  app.get('/api/rulesets', async (req) => { const a = staff(req); return { eintraege: (await db.query('select * from rulesets where org_id = $1 order by valid_from desc', [orgOf(a)])).rows }; });
  app.post('/api/rulesets', async (req) => { const a = staff(req); const b = z.object({ label: z.string(), documentVersion: z.string(), recordVersion: z.string(), validFrom: z.string(), validTo: z.string().nullish(), transitionNote: z.string().optional() }).parse(req.body); return { id: await tx(db, (t) => camp.createRuleset(t, a, b)) }; });
  app.get('/api/customers', async (req) => { staff(req); return { eintraege: (await db.query(`select id, name from organizations where kind = 'hersteller' order by name`)).rows }; });
  app.get('/api/users', async (req) => { const a = A(req); requirePerm(a, 'users:manage'); return { eintraege: (await db.query(`select u.id, u.name, u.email, u.role, u.active, o.name as org from users u join organizations o on o.id = u.org_id order by o.name, u.name`)).rows }; });
  app.post('/api/users', async (req) => {
    const a = A(req); requirePerm(a, 'users:manage');
    const b = z.object({ orgId: z.string().uuid(), email: z.string().email(), name: z.string().min(2), role: z.enum(['admin', 'fachbearbeitung', 'pruefer', 'kunde']), password: z.string().min(10, 'mindestens 10 Zeichen') }).parse(req.body);
    const id = await tx(db, async (t) => { const x = await createUser(t, b); await audit(t, { actor: a, action: 'benutzer.angelegt', objectType: 'user', objectId: x, details: { rolle: b.role } }); return x; });
    return { id };
  });
  app.get('/api/organizations', async (req) => { const a = A(req); requirePerm(a, 'users:manage'); return { eintraege: (await db.query('select id, name, kind from organizations order by name')).rows }; });

  // ---- Prüfungen (Kampagnen) ----
  const campaignList = async (a: Actor) => (await db.query(
    `select c.id, c.name, c.status, c.test_date, c.scope_area, c.created_at, o.name as customer, sp.vendor, sp.name as product, sv.version as sw_version, sv.adapter_key,
            (select count(*)::int from test_runs r where r.campaign_id = c.id and r.superseded_by is null) as runs,
            (select count(*)::int from test_runs r where r.campaign_id = c.id and r.superseded_by is null and r.status = 'passed') as passed
       from campaigns c join organizations o on o.id = c.customer_org_id join software_versions sv on sv.id = c.software_version_id join software_products sp on sp.id = sv.product_id
      where ${a.role === 'kunde' ? 'c.customer_org_id' : 'c.org_id'} = $1 order by c.created_at desc`, [a.orgId])).rows;
  app.get('/api/campaigns', async (req) => ({ eintraege: await campaignList(A(req)) }));
  app.post('/api/campaigns', async (req) => {
    const a = staff(req);
    const b = z.object({ name: z.string(), customerOrgId: z.string().uuid(), softwareVersionId: z.string().uuid(), rulesetId: z.string().uuid(), testDate: z.string(), scopeNote: z.string().optional(), testcaseIds: z.array(z.string().uuid()).optional() }).parse(req.body);
    return tx(db, (t) => camp.createCampaign(t, a, b));
  });
  app.get('/api/campaigns/:id', async (req) => {
    const a = A(req); const id = (req.params as any).id as string; await assertCampaignAccess(db, a, id);
    const c = (await db.query(
      `select c.*, o.name as customer, sp.vendor, sp.name as product, sv.version as sw_version, sv.adapter_key, rs.label as rs_label, rs.document_version, rs.record_version, rs.valid_from as rs_from, rs.valid_to as rs_to, rs.transition_note
         from campaigns c join organizations o on o.id = c.customer_org_id join software_versions sv on sv.id = c.software_version_id join software_products sp on sp.id = sv.product_id join rulesets rs on rs.id = c.ruleset_id where c.id = $1`, [id])).rows[0];
    const runs = (await db.query(
      `select r.id, r.status, r.stage, r.azvu, r.basis_outdated, r.outdated_note, r.blocked_reason, r.finalized, r.completion_at, t.code, tv.version, tv.title, tv.test_type, tv.expects_no_message,
              (select count(*)::int from followup_replies f where f.test_run_id = r.id) as followups
         from test_runs r join testcases t on t.id = r.testcase_id join testcase_versions tv on tv.id = r.testcase_version_id where r.campaign_id = $1 and r.superseded_by is null order by t.code`, [id])).rows;
    const imports = (await db.query(`select i.id, i.file_name, i.status, i.error, i.warnings, i.size_bytes, i.encoding, i.uploaded_at, i.test_run_id, i.sha256, u.name as uploaded_by from import_files i left join users u on u.id = i.uploaded_by where i.campaign_id = $1 order by i.uploaded_at desc`, [id])).rows;
    const packages = (await db.query(`select id, package_no, file_name, adapter_key, sha256, created_at, manifest from export_packages where campaign_id = $1 order by package_no desc`, [id])).rows;
    const adapter = camp.ADAPTERS.find((x) => x.key === c.adapter_key);
    const base: any = { pruefung: { ...c }, laeufe: runs, importe: imports, pakete: packages, adapter };
    if (a.role !== 'kunde') {
      base.zertifizierung = await readiness(db, id);
      base.berichte = (await db.query(`select r.id, r.code, r.kind, v.version, v.status, v.title from reports r join report_versions v on v.report_id = r.id and v.version = (select max(version) from report_versions where report_id = r.id) where r.campaign_id = $1 order by r.code`, [id])).rows;
    } else {
      base.berichte = (await db.query(`select r.id, r.code, r.kind, v.id as version_id, v.version, v.title from reports r join report_versions v on v.report_id = r.id join report_dispatches d on d.report_version_id = v.id and d.kind = 'bereitstellung' where r.campaign_id = $1 order by r.code, v.version`, [id])).rows;
      base.laeufe = runs.map((r) => ({ ...r, blocked_reason: r.status === 'failed' ? null : r.blocked_reason }));
    }
    return base;
  });
  app.post('/api/campaigns/:id/runs', async (req) => { const a = staff(req); const b = z.object({ testcaseIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {}); return tx(db, (t) => camp.addRuns(t, a, (req.params as any).id, b.testcaseIds)); });
  app.get('/api/campaigns/:id/package/preview', async (req) => { const a = staff(req); return camp.previewPackage(db, a, (req.params as any).id); });
  app.post('/api/campaigns/:id/package', async (req) => { const a = staff(req); const b = z.object({ runIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {}); return tx(db, (t) => camp.createPackage(t, a, cfg, (req.params as any).id, b.runIds)); });
  app.get('/api/packages/:id/download', async (req, reply) => {
    const a = A(req); const p = (await db.query('select * from export_packages where id = $1', [(req.params as any).id])).rows[0]; if (!p) throw notFound('Prüfpaket');
    await assertCampaignAccess(db, a, p.campaign_id);
    return sendFile(reply, p.file_name, readStored(cfg.storageDir, p.storage_path), 'application/json');
  });
  app.post('/api/campaigns/:id/imports', async (req) => {
    const a = A(req); requirePerm(a, 'import:upload');
    const { fields, file } = await readMultipart(req); if (!file) throw badRequest('Bitte eine Datei auswählen.');
    return tx(db, (t) => camp.importOutput(t, a, cfg, (req.params as any).id, { fileName: file.filename, buf: file.buffer, encoding: fields.encoding || undefined, runId: fields.runId || undefined }));
  });
  app.get('/api/imports/:id', async (req) => {
    const a = A(req); const i = (await db.query('select * from import_files where id = $1', [(req.params as any).id])).rows[0]; if (!i) throw notFound('Importdatei');
    await assertCampaignAccess(db, a, i.campaign_id);
    const { storage_path, parsed, ...rest } = i;
    return { ...rest, meldungen: (parsed?.messages ?? []).map((m: any) => ({ index: m.index, zeile: m.line, abgabegrund: m.abgabegrund, dsid: m.dsid, refId: m.refId, dsidUr: m.dsidUr, azvu: m.azvu })), satzarten: parsed?.records?.map((r: any) => r.tag) ?? [], zeilenende: parsed?.lineEnding, kodierung: parsed?.encoding, kodierungGrundlage: parsed?.encodingBasis };
  });
  app.get('/api/imports/:id/raw', async (req, reply) => {
    const a = A(req); const i = (await db.query('select * from import_files where id = $1', [(req.params as any).id])).rows[0]; if (!i) throw notFound('Importdatei');
    await assertCampaignAccess(db, a, i.campaign_id);
    return sendFile(reply, i.file_name.replace(/^\[SIMULATOR\] /, ''), readStored(cfg.storageDir, i.storage_path));
  });
  app.get('/api/imports/:id/bytes', async (req) => {
    // Rohdaten-Ansicht für das Drill-down: Zeilen mit Positionen. Kein Dekodieren auf Verdacht – die gespeicherte Kodierung wird verwendet.
    const a = staff(req); const i = (await db.query('select * from import_files where id = $1', [(req.params as any).id])).rows[0]; if (!i) throw notFound('Importdatei');
    await assertCampaignAccess(db, a, i.campaign_id);
    const buf = readStored(cfg.storageDir, i.storage_path);
    const enc = i.encoding === 'iso-8859-1' || i.encoding === 'latin1' ? 'latin1' : 'utf8';
    const lines = buf.toString(enc as BufferEncoding).split(/\r\n|\n/);
    return { kodierung: i.encoding, zeilen: lines.map((l, n) => ({ nr: n + 1, text: l })).filter((l) => l.text !== '') };
  });
  app.post('/api/imports/:id/assign', async (req) => { const a = staff(req); const b = z.object({ runId: z.string().uuid() }).parse(req.body); return tx(db, (t) => camp.assignImport(t, a, (req.params as any).id, b.runId)); });

  // Testlauf-Detail. Hersteller sehen keine Soll-Werte und keine Vergleichszeilen (nur über bereitgestellte Berichte).
  app.get('/api/runs', async (req) => {
    const a = A(req); const q = z.object({ status: z.string().optional(), grundlage: z.string().optional() }).parse(req.query);
    if (q.status && !RUN_FILTERS[q.status]) throw badRequest('Unbekannter Filter.');
    let rows = await listRuns(db, orgOf(a), q.status, a.role === 'kunde' ? a.orgId! : undefined);
    if (q.grundlage === 'ueberholt') rows = rows.filter((r) => r.basis_outdated);
    return { eintraege: rows };
  });
  app.get('/api/runs/:id', async (req) => {
    const a = A(req); const run = await camp.getRunForActor(db, a, (req.params as any).id);
    const followups = (await db.query('select id, stage, file_name, note, created_at from followup_replies where test_run_id = $1 order by stage', [run.id])).rows;
    const out: any = { id: run.id, status: run.status, stage: run.stage, azvu: run.azvu, testfall: { code: run.tc_code, version: run.tc_version, titel: run.tc_title }, grund: run.blocked_reason, grundlageUeberholt: run.basis_outdated, hinweisGrundlage: run.outdated_note, folgeantworten: followups, campaign_id: run.campaign_id, erwartetKeineMeldung: run.expects_no_message };
    if (a.role !== 'kunde') {
      out.soll = run.expected; out.ereignisse = run.events; out.herleitung = run.derivation; out.beobachtung = run.observation_note; out.abschluss = run.completion_at ? { note: run.completion_note, at: run.completion_at } : null;
      out.eingangsdaten = run.initial_state?.scenario ? describeScenario(run.initial_state.scenario) : null;
      out.vergleiche = (await db.query('select id, outcome, summary, created_at from comparison_results where test_run_id = $1 order by created_at desc limit 20', [run.id])).rows;
    } else {
      out.ereignisse = (run.events as any[]).filter((e) => e.kind !== 'erwartet').map((e) => ({ stage: e.stage, actor: e.actor, kind: e.kind, text: e.text }));
    }
    return out;
  });
  app.get('/api/comparisons/:id', async (req) => {
    const a = staff(req); const c = (await db.query('select * from comparison_results where id = $1', [(req.params as any).id])).rows[0]; if (!c) throw notFound('Vergleich');
    const run = await camp.getRunForActor(db, a, c.test_run_id);
    return { ...c, testfall: { code: run.tc_code, version: run.tc_version, titel: run.tc_title }, azvu: run.azvu };
  });
  app.post('/api/runs/:id/followup', async (req) => { const a = staff(req); const r = await tx(db, (t) => camp.createFollowUp(t, a, cfg, (req.params as any).id)); const { storage_path, ...rest } = r; return rest; });
  app.get('/api/followups/:id/download', async (req, reply) => {
    const a = A(req); const f = (await db.query('select f.*, r.campaign_id from followup_replies f join test_runs r on r.id = f.test_run_id where f.id = $1', [(req.params as any).id])).rows[0]; if (!f) throw notFound('Folgeantwort');
    await assertCampaignAccess(db, a, f.campaign_id);
    return sendFile(reply, f.file_name, readStored(cfg.storageDir, f.storage_path));
  });
  app.post('/api/runs/:id/attest', async (req) => { const a = staff(req); const b = z.object({ note: z.string() }).parse(req.body); return tx(db, (t) => camp.attestCompletion(t, a, (req.params as any).id, b.note)); });
  app.post('/api/runs/:id/finalize', async (req) => { const a = staff(req); const b = z.object({ note: z.string() }).parse(req.body); return tx(db, (t) => camp.finalizeRun(t, a, (req.params as any).id, b.note)); });
  app.post('/api/campaigns/:id/simulator', async (req) => {
    const a = staff(req); const b = z.object({ fault: z.string().default('keine'), runIds: z.array(z.string().uuid()).optional() }).parse(req.body ?? {});
    return tx(db, (t) => camp.runSimulator(t, a, cfg, (req.params as any).id, b.fault as any, b.runIds));
  });
  // Demonstration des Betragsvergleichs (Cent-genau). Beispielwerte aus dem Hackathon-Video – KEINE echten Prüfdaten.
  app.get('/api/demo/betragsvergleich', async (req) => {
    staff(req);
    const r = compareMoney('2.140,50', '2.104,50');
    return { demonstration: true, hinweis: 'Demonstration des deterministischen Betragsvergleichs mit Beispielwerten. Kein Ergebnis einer echten Prüfung.', feld: 'Entgeltersatzleistung (Beispiel)', soll: r.soll, ist: r.ist, differenz: r.diff, gleich: r.equal, ergebnis: r.equal ? 'ok' : 'abweichung', verfahren: 'Vergleich in ganzen Cent, ohne Gleitkommazahlen.' };
  });

  // ---- Berichte ----
  app.post('/api/campaigns/:id/reports', async (req) => { const a = staff(req); const b = z.object({ kind: z.enum(['fehlerbericht', 'pruefbericht']), title: z.string().optional() }).parse(req.body); return tx(db, (t) => createReport(t, a, (req.params as any).id, b.kind, b.title)); });
  app.post('/api/reports/:id/refresh', async (req) => { const a = staff(req); return tx(db, (t) => refreshReport(t, a, (req.params as any).id)); });
  app.post('/api/reports/:id/classification', async (req) => {
    const a = staff(req); const b = z.object({ classification: z.string() }).parse(req.body); validateClassification(b.classification);
    return tx(db, async (t) => { const cur = await currentVersion(t, 'report', (req.params as any).id); return reviseVersion(t, a, 'report', cur.id, { content: { ...cur.content, klassifikation: b.classification } }, `Einordnung: ${b.classification}`); });
  });
  app.post('/api/reports/:id/ai-draft', async (req) => { const a = staff(req); return draftReportAi(db, hai, a, orgOf(a), (req.params as any).id); });
  app.post('/api/reports/versions/:vid/provide', async (req) => { const a = staff(req); const b = z.object({ kind: z.enum(['bereitstellung', 'versand']), recipient: z.string().optional() }).parse(req.body); return tx(db, (t) => provideReport(t, a, (req.params as any).vid, b.kind, b.recipient)); });
  app.get('/api/reports/versions/:vid', async (req) => {
    const a = A(req); const v = (await db.query(`select v.*, r.code, r.kind, r.campaign_id from report_versions v join reports r on r.id = v.report_id where v.id = $1`, [(req.params as any).vid])).rows[0]; if (!v) throw notFound('Bericht');
    await assertCampaignAccess(db, a, v.campaign_id);
    if (a.role === 'kunde') {
      const d = await db.query(`select 1 from report_dispatches where report_version_id = $1 and kind = 'bereitstellung'`, [v.id]);
      if (!d.rowCount) throw notFound('Bericht');
    }
    return v;
  });

  // ---- Zertifizierung ----
  app.get('/api/campaigns/:id/certification', async (req) => { const a = staff(req); await assertCampaignAccess(db, a, (req.params as any).id); return readiness(db, (req.params as any).id); });
  app.post('/api/campaigns/:id/certification', async (req) => {
    const a = staff(req); const b = z.object({ decision: z.enum(['certified', 'withheld']), reason: z.string(), validFrom: z.string().optional(), validTo: z.string().nullish() }).parse(req.body);
    return tx(db, (t) => decideCertification(t, a, (req.params as any).id, b));
  });

  // ---- Audit ----
  app.get('/api/audit', async (req) => {
    const a = staff(req); const q = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return { eintraege: (await db.query(`select at, actor_kind, actor_label, action, object_type, object_id, object_version, reason, ai_model, prompt_version from audit_events where org_id = $1 order by id desc limit $2`, [orgOf(a), q.limit])).rows };
  });

  // ---- Frontend ----
  if (cfg.webDist && fs.existsSync(cfg.webDist)) {
    await app.register(fstatic, { root: path.resolve(cfg.webDist), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Unbekannte Adresse.' } });
      return reply.sendFile('index.html');
    });
  }
  void formatDe; void storeFile; void forbidden;
  return app;
}
