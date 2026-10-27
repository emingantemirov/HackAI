// Änderungsmanagement: Wird ein Kriterium in einer neuen Version freigegeben, werden betroffene Testfälle ermittelt,
// die Auswirkung wird festgehalten, neue Testfall-ENTWÜRFE werden erzeugt und laufende Prüfungen als „Grundlage überholt“ markiert.
// Freigegebene Testfälle und abgeschlossene Ergebnisse werden NIE überschrieben.

import type { Q } from '../db.js';
import { audit } from '../audit.js';
import { type Actor } from '../auth.js';
import { currentVersion, reviseVersion } from './versions.js';
import { libraryDefs, upsertTestcase } from './testcases.js';

const FIELDS: [string, string][] = [
  ['title', 'Titel'], ['description', 'Beschreibung'], ['preconditions', 'Voraussetzungen'], ['rule', 'Prüfbare Regel'], ['exceptions', 'Ausnahmen'],
  ['expected_behavior', 'Erwartetes Verhalten'], ['valid_from', 'Gültig ab'], ['valid_to', 'Gültig bis'], ['data_fields', 'Datenfelder'], ['message_types', 'Meldungsarten'],
];

export function diffVersions(a: any, b: any): { field: string; label: string; before: unknown; after: unknown }[] {
  return FIELDS.filter(([f]) => JSON.stringify(a?.[f] ?? null) !== JSON.stringify(b?.[f] ?? null)).map(([f, label]) => ({ field: f, label, before: a?.[f] ?? null, after: b?.[f] ?? null }));
}

export async function onCriterionApproved(q: Q, actor: Actor, orgId: string, newV: any) {
  const prev = await q.query(
    `select * from criteria_versions where criterion_id = $1 and version < $2 and status in ('superseded','approved') order by version desc limit 1`, [newV.criterion_id, newV.version]);
  if (!prev.rowCount) return { affected: 0 };
  const old = prev.rows[0];
  const crit = (await q.query('select code, slug from criteria where id = $1', [newV.criterion_id])).rows[0];
  const diff = diffVersions(old, newV);
  if (!diff.length) return { affected: 0 };
  const tcs = await q.query(
    `select distinct t.id, t.code from testcases t join testcase_versions tv on tv.testcase_id = t.id join testcase_criteria tc on tc.testcase_version_id = tv.id
      where t.org_id = $1 and tc.criterion_id = $2 and tc.criterion_version_id <> $3`, [orgId, newV.criterion_id, newV.id]);
  const defs = libraryDefs();
  let affected = 0;
  for (const t of tcs.rows) {
    const cur = await currentVersion(q, 'testcase', t.id);
    const linked = await q.query('select 1 from testcase_criteria where testcase_version_id = $1 and criterion_id = $2 and criterion_version_id <> $3', [cur.id, newV.criterion_id, newV.id]);
    if (!linked.rowCount) continue;
    const effective = (await q.query(`select id from testcase_versions where testcase_id = $1 and status = 'approved' order by version desc limit 1`, [t.id])).rows[0];
    let draftId: string | null = null; let note = '';
    try {
      const def = defs.find((d) => d.key === cur.profile_requirements?.generatorKey);
      if (def) {
        const r = await upsertTestcase(q, actor, orgId, { ...def, generated_by: 'engine' });
        if (r.kind === 'neue_version' || r.kind === 'neu') draftId = (await currentVersion(q, 'testcase', t.id)).id;
        else if (r.kind === 'nicht_erzeugt') note = r.grund ?? '';
      } else {
        const res = await reviseVersion(q, actor, 'testcase', cur.id, {}, `Kriterium ${crit.code} wurde in v${newV.version} geändert – bitte prüfen und neu erzeugen`, async (_o, nv) => {
          const links = await q.query('select criterion_id, criterion_version_id from testcase_criteria where testcase_version_id = $1', [cur.id]);
          for (const l of links.rows) await q.query('insert into testcase_criteria(testcase_version_id, criterion_id, criterion_version_id) values ($1,$2,$3)', [nv.id, l.criterion_id, l.criterion_id === newV.criterion_id ? newV.id : l.criterion_version_id]);
        });
        if (res.created) draftId = res.version.id;
      }
    } catch (e: any) {
      note = e?.message ?? String(e);
    }
    const running = await q.query(
      `update test_runs r set basis_outdated = true, outdated_note = $2
         from campaigns c where c.id = r.campaign_id and c.status in ('planned','running','evaluated') and r.testcase_id = $1 and r.superseded_by is null
          and r.testcase_version_id in (select id from testcase_versions where testcase_id = $1)
        returning r.id`,
      [t.id, `Kriterium ${crit.code} „${crit.slug}“ wurde in Version ${newV.version} geändert. Ergebnisse gelten für den historischen Stand (v${old.version}).`]);
    const explanation = `Das Kriterium ${crit.code} (${crit.slug}) wurde von v${old.version} auf v${newV.version} geändert (${diff.map((d) => d.label).join(', ')}). ` +
      `Testfall ${t.code} beruht auf der alten Fassung.` + (draftId ? ' Ein neuer Entwurf wurde erzeugt und braucht erneute Freigabe.' : ' Es konnte kein neuer Entwurf erzeugt werden.') + (note ? ` Hinweis: ${note}` : '');
    await q.query(
      `insert into change_impacts(org_id, criterion_id, from_version_id, to_version_id, testcase_id, affected_version_id, draft_version_id, explanation, diff, running_runs)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (to_version_id, testcase_id) do nothing`,
      [orgId, newV.criterion_id, old.id, newV.id, t.id, effective?.id ?? cur.id, draftId, explanation, JSON.stringify({ criterion: diff }), running.rowCount ?? 0]);
    await audit(q, { actor, orgId, action: 'aenderung.auswirkung_ermittelt', objectType: 'testcase', objectId: t.id, details: { kriterium: crit.code, neueVersion: newV.version, laufendePruefungen: running.rowCount ?? 0 } });
    affected++;
  }
  return { affected };
}

export async function listImpacts(q: Q, orgId: string, status?: string) {
  const r = await q.query(
    `select i.*, c.code as criterion_code, c.slug, t.code as testcase_code, fv.version as from_version, tv.version as to_version,
            av.version as affected_testcase_version, dv.version as draft_testcase_version
       from change_impacts i join criteria c on c.id = i.criterion_id join testcases t on t.id = i.testcase_id
       left join criteria_versions fv on fv.id = i.from_version_id join criteria_versions tv on tv.id = i.to_version_id
       join testcase_versions av on av.id = i.affected_version_id left join testcase_versions dv on dv.id = i.draft_version_id
      where i.org_id = $1 ${status ? 'and i.status = $2' : ''} order by i.created_at desc`, status ? [orgId, status] : [orgId]);
  return r.rows;
}

/** Eine Auswirkung gilt als erledigt, sobald der neue Testfall-Entwurf freigegeben (oder ersetzt) ist. */
export async function refreshImpactStatus(q: Q, orgId: string) {
  await q.query(
    `update change_impacts i set status = 'erledigt' where i.org_id = $1 and i.status = 'offen' and i.draft_version_id is not null
       and exists (select 1 from testcase_versions v where v.testcase_id = i.testcase_id and v.status = 'approved' and v.version >= (select version from testcase_versions where id = i.draft_version_id))`, [orgId]);
}
