import type { Q } from '../db.js';
import { nextCode } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, conflict } from '../auth.js';

export interface CriterionDraft {
  id?: string;                 // Original-ID aus der Quelle (stabil) – sonst wird eine UUID vergeben
  slug: string;
  area?: string;
  title: string;
  description?: string;
  preconditions?: string;
  rule?: string;
  exceptions?: string;
  expected_behavior?: string;
  valid_from?: string | null;
  valid_to?: string | null;
  data_fields?: string[];
  message_types?: string[];
  open_questions?: { text: string; clarification_id?: string }[];
  evidence: { source_version_id: string; quote: string; locator?: { kind: string; n: number } | null; verified: boolean }[];
  origin: 'quelle-uebernommen' | 'ki-ableitung' | 'demo-ableitung' | 'manuell';
  ai_meta?: Record<string, unknown> | null;
  status?: 'draft' | 'clarification';
  change_note?: string;
}

/** Legt ein Kriterium (logisches Objekt + Version 1) an. Neue Kriterien starten NIE freigegeben. */
export async function createCriterion(q: Q, actor: Actor, orgId: string, d: CriterionDraft): Promise<{ criterionId: string; versionId: string; code: string }> {
  const dup = await q.query('select id, code from criteria where org_id = $1 and slug = $2', [orgId, d.slug]);
  if (dup.rowCount) throw conflict('DUPLICATE_CRITERION', `Ein Kriterium mit dem Schlüssel „${d.slug}“ existiert bereits (${dup.rows[0].code}).`, { criterionId: dup.rows[0].id });
  const code = await nextCode(q, orgId, 'criterion', 'K');
  const c = d.id
    ? await q.query('insert into criteria(id, org_id, code, slug, area) values ($1,$2,$3,$4,$5) returning id', [d.id, orgId, code, d.slug, d.area ?? 'DBVO'])
    : await q.query('insert into criteria(org_id, code, slug, area) values ($1,$2,$3,$4) returning id', [orgId, code, d.slug, d.area ?? 'DBVO']);
  const criterionId = c.rows[0].id as string;
  const v = await q.query(
    `insert into criteria_versions(criterion_id, version, title, description, preconditions, rule, exceptions, expected_behavior, valid_from, valid_to,
       data_fields, message_types, open_questions, evidence, origin, ai_meta, status, change_note, created_by)
     values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
    [criterionId, d.title, d.description ?? '', d.preconditions ?? '', d.rule ?? '', d.exceptions ?? '', d.expected_behavior ?? '', d.valid_from ?? null, d.valid_to ?? null,
      JSON.stringify(d.data_fields ?? []), JSON.stringify(d.message_types ?? []), JSON.stringify(d.open_questions ?? []), JSON.stringify(d.evidence),
      d.origin, d.ai_meta ? JSON.stringify(d.ai_meta) : null, d.status ?? 'draft', d.change_note ?? null, actor.kind === 'user' ? actor.id : null],
  );
  await audit(q, {
    actor, orgId, action: 'kriterium.angelegt', objectType: 'criterion', objectId: criterionId, objectVersion: 1,
    details: { code, slug: d.slug, origin: d.origin }, aiModel: (d.ai_meta as any)?.model, promptVersion: (d.ai_meta as any)?.promptVersion,
  });
  return { criterionId, versionId: v.rows[0].id, code };
}

/** Aktuelle Version = höchste Versionsnummer je logischem Objekt (Zählregel für Bestandszahlen). */
export const CURRENT_CRITERIA_SQL = `
  select distinct on (v.criterion_id) v.*, c.code, c.slug, c.area, c.org_id
    from criteria_versions v join criteria c on c.id = v.criterion_id
   where c.org_id = $1 and c.archived_at is null
   order by v.criterion_id, v.version desc`;
