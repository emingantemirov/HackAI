// Gemeinsamer Freigabe-Workflow für versionierte Objekte (Kriterium, Testfall, Bericht).
//
// Regeln (alle serverseitig, transaktional):
//  * Freigaben gelten ausschließlich für die geprüfte Version.
//  * Eine Entscheidung wird nur angenommen, wenn die Version noch die AKTUELLE ist und tatsächlich zur Prüfung vorliegt
//    (veraltete Browseransichten können keine neue, ungelesene Version freigeben).
//  * Ablehnung verlangt eine Begründung; Verbesserungshinweise sind optional.
//  * Der Einreicher darf nicht selbst freigeben (Vier-Augen-Prinzip).
//  * Inhaltliche Änderung nach Einreichung/Freigabe/Ablehnung erzeugt eine neue Version; die alte bleibt samt Begründung erhalten.

import type { Q } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, HttpError, badRequest, conflict, notFound, require as requirePerm } from '../auth.js';

export type ObjType = 'criterion' | 'testcase' | 'report';
export type VersionStatus = 'draft' | 'clarification' | 'submitted' | 'approved' | 'rejected' | 'superseded';

interface TableInfo { obj: string; ver: string; fk: string; label: string; content: string[] }

export const TABLES: Record<ObjType, TableInfo> = {
  criterion: {
    obj: 'criteria', ver: 'criteria_versions', fk: 'criterion_id', label: 'Kriterium',
    content: ['title', 'description', 'preconditions', 'rule', 'exceptions', 'expected_behavior', 'valid_from', 'valid_to', 'data_fields', 'message_types', 'open_questions', 'evidence', 'origin', 'ai_meta', 'change_note'],
  },
  testcase: {
    obj: 'testcases', ver: 'testcase_versions', fk: 'testcase_id', label: 'Testfall',
    content: ['title', 'purpose', 'test_type', 'initial_state', 'events', 'expected', 'expects_no_message', 'observation_note', 'derivation', 'profile_requirements', 'test_date', 'blocked_by', 'generated_by', 'ai_meta', 'change_note'],
  },
  report: {
    obj: 'reports', ver: 'report_versions', fk: 'report_id', label: 'Bericht',
    content: ['title', 'content', 'ai_meta', 'change_note'],
  },
};

const JSON_COLS = new Set(['data_fields', 'message_types', 'open_questions', 'evidence', 'ai_meta', 'initial_state', 'events', 'expected', 'profile_requirements', 'blocked_by', 'content']);
const ser = (col: string, v: unknown) => (JSON_COLS.has(col) && v !== null && v !== undefined ? JSON.stringify(v) : v ?? null);

export async function getVersion(q: Q, type: ObjType, versionId: string): Promise<any> {
  const t = TABLES[type];
  const r = await q.query(`select v.*, o.org_id from ${t.ver} v join ${t.obj} o on o.id = v.${t.fk} where v.id = $1`, [versionId]);
  if (!r.rowCount) throw notFound(t.label);
  return r.rows[0];
}

export async function currentVersion(q: Q, type: ObjType, objectId: string): Promise<any> {
  const t = TABLES[type];
  const r = await q.query(`select v.*, o.org_id from ${t.ver} v join ${t.obj} o on o.id = v.${t.fk} where v.${t.fk} = $1 order by v.version desc limit 1`, [objectId]);
  if (!r.rowCount) throw notFound(t.label);
  return r.rows[0];
}

/** Zuletzt freigegebene, noch gültige Version (Grundlage für Testfall-Erzeugung und Prüfläufe). */
export async function effectiveApproved(q: Q, type: ObjType, objectId: string): Promise<any | null> {
  const t = TABLES[type];
  const r = await q.query(`select v.* from ${t.ver} v where v.${t.fk} = $1 and v.status = 'approved' order by v.version desc limit 1`, [objectId]);
  return r.rows[0] ?? null;
}

async function history(q: Q, type: ObjType, objectId: string) {
  const r = await q.query(
    `select d.decision, d.version_number, d.reason, d.hints, d.decided_at, u.name as by
       from approval_decisions d join users u on u.id = d.decided_by
      where d.object_type = $1 and d.object_id = $2 order by d.decided_at, d.id`,
    [type, objectId],
  );
  return r.rows.map((x) => ({ decision: x.decision, version: x.version_number, reason: x.reason, hints: x.hints, at: x.decided_at, by: x.by }));
}

export async function submitForApproval(q: Q, actor: Actor, type: ObjType, versionId: string, extraChecks?: (v: any) => Promise<void>, opts?: { systemDraft?: boolean }): Promise<any> {
  if (!opts?.systemDraft) requirePerm(actor, 'content:submit');
  const t = TABLES[type];
  const v = await getVersion(q, type, versionId);
  if (v.org_id !== actor.orgId) throw notFound(t.label);
  const cur = await currentVersion(q, type, v[t.fk]);
  if (cur.id !== v.id) throw conflict('STALE_VERSION', `Es gibt inzwischen eine neuere Version (v${cur.version}). Bitte die aktuelle Version einreichen.`, { currentVersionId: cur.id, currentVersion: cur.version });
  if (v.status === 'clarification') throw conflict('CLARIFICATION_REQUIRED', 'Diese Version hat den Status „Klärung erforderlich“. Erst nach Entscheidung der offenen Klärung kann sie eingereicht werden.');
  if (v.status !== 'draft') throw conflict('NOT_SUBMITTABLE', `Eine Version im Status „${v.status}“ kann nicht eingereicht werden. Bei Ablehnung bitte eine neue Version erstellen.`);
  if (Array.isArray(v.blocked_by) && v.blocked_by.length) {
    const open = await q.query(`select code from clarifications where id = any($1::uuid[]) and status = 'open'`, [v.blocked_by]);
    if (open.rowCount) throw conflict('CLARIFICATION_REQUIRED', `Offene Klärung(en) blockieren die Einreichung: ${open.rows.map((r) => r.code).join(', ')}.`);
  }
  if (extraChecks) await extraChecks(v);
  const upd = await q.query(`update ${t.ver} set status = 'submitted', submitted_by = $2, submitted_at = now() where id = $1 and status = 'draft' returning *`, [versionId, opts?.systemDraft ? null : actor.id]);
  if (!upd.rowCount) throw conflict('CONCURRENT_CHANGE', 'Die Version wurde parallel geändert. Bitte neu laden.');
  await q.query(
    `insert into approval_decisions(org_id, object_type, object_id, version_id, version_number, decision, decided_by, history) values ($1,$2,$3,$4,$5,'submitted',$6,$7)`,
    [v.org_id, type, v[t.fk], versionId, v.version, actor.id, JSON.stringify(await history(q, type, v[t.fk]))],
  );
  await audit(q, { actor, orgId: v.org_id, action: `${type}.eingereicht`, objectType: type, objectId: v[t.fk], objectVersion: v.version });
  return upd.rows[0];
}

export async function withdrawSubmission(q: Q, actor: Actor, type: ObjType, versionId: string): Promise<void> {
  const t = TABLES[type];
  const v = await getVersion(q, type, versionId);
  if (v.org_id !== actor.orgId) throw notFound(t.label);
  if (v.status !== 'submitted') throw conflict('NOT_SUBMITTED', 'Nur eingereichte Versionen können zurückgezogen werden.');
  if (v.submitted_by !== actor.id) throw new HttpError(403, 'FORBIDDEN', 'Nur die einreichende Person kann die Einreichung zurückziehen.');
  await q.query(`update ${t.ver} set status = 'draft', submitted_by = null, submitted_at = null where id = $1`, [versionId]);
  await q.query(
    `insert into approval_decisions(org_id, object_type, object_id, version_id, version_number, decision, decided_by, history) values ($1,$2,$3,$4,$5,'withdrawn',$6,$7)`,
    [v.org_id, type, v[t.fk], versionId, v.version, actor.id, JSON.stringify(await history(q, type, v[t.fk]))],
  );
  await audit(q, { actor, orgId: v.org_id, action: `${type}.zurueckgezogen`, objectType: type, objectId: v[t.fk], objectVersion: v.version });
}

export interface DecisionInput { versionId: string; decision: 'approved' | 'rejected'; reason?: string; hints?: string }

export async function decide(q: Q, actor: Actor, type: ObjType, input: DecisionInput, onApproved?: (v: any) => Promise<void>, opts?: { skipPerm?: boolean }): Promise<any> {
  if (!opts?.skipPerm) requirePerm(actor, 'approval:decide');
  const t = TABLES[type];
  const v = await getVersion(q, type, input.versionId);
  if (v.org_id !== actor.orgId) throw notFound(t.label);
  if (input.decision === 'rejected' && (input.reason ?? '').trim().length < 10) {
    throw badRequest('Eine Ablehnung braucht eine verständliche Begründung (mindestens 10 Zeichen).');
  }
  // Sperre gegen veraltete Ansicht: nur die aktuelle, tatsächlich eingereichte Version
  const cur = await currentVersion(q, type, v[t.fk]);
  if (cur.id !== v.id) {
    throw conflict('STALE_VERSION', `Seit dem Laden der Seite gibt es eine neue Version (v${cur.version}). Die angezeigte Version v${v.version} kann nicht mehr entschieden werden.`, { currentVersionId: cur.id, currentVersion: cur.version });
  }
  if (v.status !== 'submitted') throw conflict('NOT_SUBMITTED', `Die Version liegt nicht zur Freigabe vor (Status: ${v.status}).`);
  if (v.submitted_by && v.submitted_by === actor.id) throw new HttpError(403, 'FOUR_EYES', 'Vier-Augen-Prinzip: Die einreichende Person kann ihre Version nicht selbst freigeben oder ablehnen.');

  const newStatus = input.decision;
  const upd = await q.query(`update ${t.ver} set status = $2 where id = $1 and status = 'submitted' returning *`, [v.id, newStatus]);
  if (!upd.rowCount) throw conflict('CONCURRENT_CHANGE', 'Die Version wurde parallel entschieden.');
  if (newStatus === 'approved') {
    // frühere freigegebene Versionen sind ersetzt, bleiben aber unverändert erhalten
    await q.query(`update ${t.ver} set status = 'superseded' where ${t.fk} = $1 and status = 'approved' and id <> $2`, [v[t.fk], v.id]);
  }
  await q.query(
    `insert into approval_decisions(org_id, object_type, object_id, version_id, version_number, decision, reason, hints, decided_by, history) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [v.org_id, type, v[t.fk], v.id, v.version, newStatus, input.reason?.trim() || null, input.hints?.trim() || null, actor.id, JSON.stringify(await history(q, type, v[t.fk]))],
  );
  await audit(q, { actor, orgId: v.org_id, action: `${type}.${newStatus === 'approved' ? 'freigegeben' : 'abgelehnt'}`, objectType: type, objectId: v[t.fk], objectVersion: v.version, reason: input.reason ?? null, details: { hints: input.hints ?? null } });
  if (newStatus === 'approved' && onApproved) await onApproved(upd.rows[0]);
  return upd.rows[0];
}

/**
 * Inhaltliche Änderung: Entwürfe werden direkt bearbeitet; alles andere (freigegeben, abgelehnt)
 * erzeugt eine NEUE Version (Entwurf). Eingereichte Versionen müssen zuerst zurückgezogen werden.
 */
export async function reviseVersion(
  q: Q, actor: Actor, type: ObjType, versionId: string, patch: Record<string, unknown>, changeNote?: string,
  afterNewVersion?: (oldV: any, newV: any) => Promise<void>,
): Promise<{ version: any; created: boolean }> {
  requirePerm(actor, 'content:write');
  const t = TABLES[type];
  const base = await getVersion(q, type, versionId);
  if (base.org_id !== actor.orgId) throw notFound(t.label);
  const cur = await currentVersion(q, type, base[t.fk]);
  if (cur.id !== base.id) throw conflict('STALE_VERSION', `Es gibt inzwischen eine neuere Version (v${cur.version}).`, { currentVersionId: cur.id, currentVersion: cur.version });
  const cols = Object.keys(patch).filter((k) => t.content.includes(k));
  if (base.status === 'submitted') throw conflict('SUBMITTED_LOCKED', 'Die Version liegt zur Freigabe vor. Bitte zuerst die Einreichung zurückziehen.');
  if (base.status === 'draft' || base.status === 'clarification') {
    if (!cols.length) return { version: base, created: false };
    const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
    const r = await q.query(`update ${t.ver} set ${sets} where id = $1 returning *`, [base.id, ...cols.map((c) => ser(c, patch[c]))]);
    await audit(q, { actor, orgId: base.org_id, action: `${type}.bearbeitet`, objectType: type, objectId: base[t.fk], objectVersion: base.version, details: { felder: cols } });
    return { version: r.rows[0], created: false };
  }
  // freigegeben / abgelehnt / ersetzt → neue Version
  const all = t.content;
  const merged: Record<string, unknown> = {};
  for (const c of all) merged[c] = cols.includes(c) ? patch[c] : base[c];
  merged.change_note = changeNote ?? (patch.change_note as string | undefined) ?? `Überarbeitung von v${base.version}`;
  const colList = all.join(', ');
  const ph = all.map((_, i) => `$${i + 4}`).join(', ');
  const r = await q.query(
    `insert into ${t.ver}(${t.fk}, version, created_by, ${colList}, status) values ($1, $2, $3, ${ph}, 'draft') returning *`,
    [base[t.fk], cur.version + 1, actor.id, ...all.map((c) => ser(c, merged[c]))],
  );
  const nv = r.rows[0];
  await audit(q, { actor, orgId: base.org_id, action: `${type}.neue_version`, objectType: type, objectId: base[t.fk], objectVersion: nv.version, details: { basis: base.version, felder: cols } });
  if (afterNewVersion) await afterNewVersion(base, nv);
  return { version: nv, created: true };
}

export async function decisionHistory(q: Q, type: ObjType, objectId: string) {
  return history(q, type, objectId);
}
