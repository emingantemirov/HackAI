// Weitere KI-Aufgaben. Die KI liefert Vorschläge (Entwürfe) – Soll-Werte, Gleichheit und Freigaben entscheidet sie nie.
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { HaiClient } from '../ai/hai.js';
import { AiError } from '../ai/hai.js';
import { PROMPTS, draftReportSystem, explainImpactSystem, proposeTestcasesSystem, reviseRejectedSystem } from '../ai/prompts.js';
import { type Actor, aiActor, badRequest, notFound, require as requirePerm } from '../auth.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { parseDate } from '../util/dates.js';
import { CRITERIA_41, type Scenario, upsertTestcase } from './testcases.js';
import { currentVersion, reviseVersion } from './versions.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => { try { parseDate(s); return true; } catch { return false; } }, 'ungültiges Datum');
const periodSchema = z.object({ start: dateStr, end: dateStr, certified: z.boolean(), evidence: z.enum(['eAU', 'papier', 'keine']).optional() }).refine((p) => p.start <= p.end, 'Beginn nach Ende');
export const aiCaseSchema = z.object({
  cases: z.array(z.object({
    title: z.string().min(5).max(200), purpose: z.string().min(5), test_type: z.enum(['positiv', 'negativ', 'grenzfall', 'sonderfall']),
    criterion_slugs: z.array(z.string()).default([]),
    scenario: z.object({
      today: dateStr, insurance: z.enum(['GKV', 'PKV']), marginalEmployment: z.boolean(),
      employment: z.object({ start: dateStr, end: dateStr.nullable() }),
      current: z.object({ start: dateStr, end: dateStr.nullable(), certificate: z.boolean() }),
      prior: z.array(periodSchema).max(12),
    }),
  })).max(12),
});

export async function proposeTestcasesAi(db: Db, hai: HaiClient, actor: Actor, orgId: string) {
  requirePerm(actor, 'ai:run');
  if (!hai.configured) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert. Testfälle können weiterhin aus der Bibliothek erzeugt oder manuell angelegt werden.');
  const crit = (await db.query(
    `select c.slug, v.title, v.rule, v.expected_behavior from criteria c join criteria_versions v on v.criterion_id = c.id and v.status = 'approved'
      where c.org_id = $1 and c.archived_at is null and v.version = (select max(version) from criteria_versions where criterion_id = c.id and status = 'approved') order by c.slug`, [orgId])).rows;
  if (!crit.length) throw badRequest('Es gibt keine freigegebenen Kriterien. Testfälle entstehen nur aus freigegebenen Kriterien.');
  const text = crit.map((c) => `- ${c.slug}: ${c.title}. Regel: ${c.rule}. Erwartet: ${c.expected_behavior}`).join('\n');
  const { data, completion } = await hai.completeJson('testfall-vorschlag', PROMPTS.proposeTestcases, aiCaseSchema, [
    { role: 'system', content: proposeTestcasesSystem },
    { role: 'user', content: `Freigegebene Kriterien:\n<<<QUELLE\n${text}\nQUELLE>>>\nSchlage bis zu 6 zusätzliche, voneinander verschiedene Testfälle vor.` },
  ], 3000, orgId);
  const meta = { model: completion.model, promptVersion: PROMPTS.proposeTestcases, derivedAt: new Date().toISOString() };
  const ai = aiActor(completion.model);
  const out: { title: string; ergebnis: string }[] = [];
  for (const c of data.cases) {
    const scenario: Scenario = { ...c.scenario, prior: c.scenario.prior.map((p) => ({ ...p, evidence: p.evidence ?? (p.certified ? 'eAU' : 'keine') })) };
    const key = 'ki-' + crypto.createHash('sha256').update(JSON.stringify(scenario)).digest('hex').slice(0, 12);
    const slugs = (c.criterion_slugs.length ? c.criterion_slugs : CRITERIA_41).filter((s) => crit.some((x) => x.slug === s));
    try {
      const r = await tx(db, (t) => upsertTestcase(t, { ...actor, kind: 'user' }, orgId, { key, title: c.title, purpose: c.purpose, test_type: c.test_type, scenario, criteria: slugs.length ? slugs : CRITERIA_41, generated_by: 'ki', ai_meta: meta }));
      out.push({ title: c.title, ergebnis: r.kind === 'nicht_erzeugt' ? `nicht erzeugt: ${r.grund}` : r.kind === 'unveraendert' ? 'bereits vorhanden' : `angelegt als ${r.code} (Entwurf)` });
    } catch (e: any) { out.push({ title: c.title, ergebnis: `verworfen: ${e?.message}` }); }
  }
  await audit(db, { actor: ai, orgId, action: 'testfaelle.ki_vorschlag', details: { vorschlaege: data.cases.length, ausgefuehrtVon: actor.label }, aiModel: completion.model, promptVersion: PROMPTS.proposeTestcases });
  return { ergebnisse: out, hinweis: 'Die KI liefert nur Eingaben. Soll-Ergebnisse berechnet das Portal deterministisch; alle Testfälle sind Entwürfe.' };
}

const impactSchema = z.object({ summary: z.string(), points: z.array(z.string()).default([]) });
export async function explainImpactAi(db: Db, hai: HaiClient, actor: Actor, orgId: string, impactId: string) {
  requirePerm(actor, 'ai:run');
  if (!hai.configured) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert. Die deterministisch ermittelte Auswirkung bleibt sichtbar.');
  const i = (await db.query('select * from change_impacts where id = $1 and org_id = $2', [impactId, orgId])).rows[0];
  if (!i) throw notFound('Auswirkung');
  const { data, completion } = await hai.completeJson('auswirkung-erklaeren', PROMPTS.explainImpact, impactSchema, [
    { role: 'system', content: explainImpactSystem },
    { role: 'user', content: `<<<QUELLE\n${i.explanation}\nÄnderungen: ${JSON.stringify(i.diff)}\nQUELLE>>>` },
  ], 1200, orgId);
  await db.query(`update change_impacts set diff = jsonb_set(diff, '{aiSummary}', $2::jsonb) where id = $1`, [impactId, JSON.stringify({ ...data, model: completion.model, promptVersion: PROMPTS.explainImpact })]);
  await audit(db, { actor: aiActor(completion.model), orgId, action: 'aenderung.ki_erklaerung', objectType: 'testcase', objectId: i.testcase_id, aiModel: completion.model, promptVersion: PROMPTS.explainImpact });
  return data;
}

const reportSchema = z.object({ secured_findings: z.array(z.string()).default([]), cause_hypotheses: z.array(z.object({ class: z.string(), text: z.string() })).default([]), next_steps: z.array(z.string()).default([]) });
const CLASS_OK = new Set(['moeglicher_softwarefehler', 'fehlerhafte_testeinrichtung', 'adapterfehler', 'unvollstaendige_quelle', 'strittiges_soll']);
export async function draftReportAi(db: Db, hai: HaiClient, actor: Actor, orgId: string, reportId: string) {
  requirePerm(actor, 'ai:run');
  if (!hai.configured) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert. Der Bericht kann manuell ergänzt werden.');
  const rep = (await db.query('select * from reports where id = $1 and org_id = $2', [reportId, orgId])).rows[0];
  if (!rep) throw notFound('Bericht');
  const cur = await currentVersion(db, 'report', reportId);
  const c = cur.content;
  const facts = JSON.stringify({ abweichungen: c.abweichungen.slice(0, 40), zaehlung: c.umfang.zaehlung, regelwerk: c.regelwerk });
  const { data, completion } = await hai.completeJson('bericht-entwurf', PROMPTS.draftReport, reportSchema, [
    { role: 'system', content: draftReportSystem }, { role: 'user', content: `<<<QUELLE\n${facts}\nQUELLE>>>` },
  ], 2000, orgId);
  const meta = { model: completion.model, promptVersion: PROMPTS.draftReport, draftedAt: new Date().toISOString() };
  const hyp = [...(c.hypothesen ?? []).filter((h: any) => h.herkunft !== 'KI'), ...data.cause_hypotheses.filter((h) => CLASS_OK.has(h.class)).map((h) => ({ klasse: h.class, text: h.text, herkunft: 'KI' }))];
  const patch = { content: { ...c, hypothesen: hyp, naechsteSchritte: [...new Set([...(c.naechsteSchritte ?? []), ...data.next_steps])] }, ai_meta: meta };
  const res = await tx(db, (t) => reviseVersion(t, actor, 'report', cur.id, patch, 'KI-Entwurf: Ursachenhypothesen und nächste Schritte ergänzt'));
  await audit(db, { actor: aiActor(completion.model), orgId, action: 'bericht.ki_entwurf', objectType: 'report', objectId: reportId, objectVersion: res.version.version, aiModel: completion.model, promptVersion: PROMPTS.draftReport, details: { ausgeloestVon: actor.label } });
  return res.version;
}

const reviseSchema = z.object({ changes: z.object({ title: z.string().optional(), description: z.string().optional(), preconditions: z.string().optional(), rule: z.string().optional(), exceptions: z.string().optional(), expected_behavior: z.string().optional() }).default({}), explanation: z.string().default('') });
/** Überarbeitet ein abgelehntes Kriterium anhand der Ablehnungsbegründung – als NEUE Version (Entwurf). Die abgelehnte Version bleibt erhalten. */
export async function reviseRejectedAi(db: Db, hai: HaiClient, actor: Actor, orgId: string, versionId: string) {
  requirePerm(actor, 'ai:run');
  if (!hai.configured) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert. Bitte die Überarbeitung manuell vornehmen.');
  const v = (await db.query(`select v.*, c.org_id from criteria_versions v join criteria c on c.id = v.criterion_id where v.id = $1`, [versionId])).rows[0];
  if (!v || v.org_id !== orgId) throw notFound('Kriterium');
  if (v.status !== 'rejected') throw badRequest('Nur abgelehnte Versionen werden überarbeitet.');
  const d = (await db.query(`select reason, hints from approval_decisions where version_id = $1 and decision = 'rejected' order by decided_at desc limit 1`, [versionId])).rows[0];
  const { data, completion } = await hai.completeJson('ablehnung-ueberarbeiten', PROMPTS.reviseRejected, reviseSchema, [
    { role: 'system', content: reviseRejectedSystem },
    { role: 'user', content: `<<<QUELLE\nKriterium: ${JSON.stringify({ title: v.title, description: v.description, preconditions: v.preconditions, rule: v.rule, exceptions: v.exceptions, expected_behavior: v.expected_behavior })}\nBegründung der Ablehnung: ${d?.reason}\nHinweise: ${d?.hints ?? '–'}\nQUELLE>>>` },
  ], 2000, orgId);
  const meta = { model: completion.model, promptVersion: PROMPTS.reviseRejected, derivedAt: new Date().toISOString(), basis: `v${v.version} abgelehnt` };
  const res = await tx(db, (t) => reviseVersion(t, actor, 'criterion', versionId, { ...data.changes, ai_meta: meta }, `KI-Überarbeitung nach Ablehnung: ${data.explanation}`.slice(0, 500)));
  await audit(db, { actor: aiActor(completion.model), orgId, action: 'kriterium.ki_ueberarbeitung', objectType: 'criterion', objectId: v.criterion_id, objectVersion: res.version.version, aiModel: completion.model, promptVersion: PROMPTS.reviseRejected, details: { ausgeloestVon: actor.label } });
  return res.version;
}
