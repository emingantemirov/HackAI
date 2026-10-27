// Berichte: Entwurf → zur Freigabe → freigegeben/abgelehnt → Überarbeitung (neue Version) → erneut zur Freigabe.
// Nur die freigegebene, aktuelle Version darf bereitgestellt werden. Freigabe ≠ Versand: beides wird getrennt protokolliert,
// und es wird nichts als „versendet“ ausgewiesen, was nicht tatsächlich versendet wurde.

import type { Q } from '../db.js';
import { nextCode } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, assertCampaignAccess, badRequest, conflict, notFound, require as requirePerm } from '../auth.js';
import { currentVersion, reviseVersion } from './versions.js';
import { formatDe } from '../util/dates.js';

export const CLASSIFICATIONS = [
  { key: 'offen', label: 'Noch nicht eingeordnet' },
  { key: 'softwarefehler', label: 'Möglicher Softwarefehler' },
  { key: 'falsche_einrichtung', label: 'Fehlerhafte Einrichtung der Testumgebung' },
  { key: 'adapterfehler', label: 'Adapter-/Importfehler' },
  { key: 'unvollstaendige_quelle', label: 'Unvollständige oder widersprüchliche Quelle' },
  { key: 'strittiges_soll', label: 'Strittiges Soll-Ergebnis' },
] as const;

export async function buildReportContent(q: Q, campaignId: string, kind: 'fehlerbericht' | 'pruefbericht') {
  const c = (await q.query(
    `select c.*, rs.label as rs_label, rs.document_version, rs.record_version, rs.valid_from as rs_from, rs.valid_to as rs_to, rs.transition_note,
            sp.vendor, sp.name as product, sv.version as sw_version, sv.adapter_key, o.name as customer
       from campaigns c join rulesets rs on rs.id = c.ruleset_id join software_versions sv on sv.id = c.software_version_id join software_products sp on sp.id = sv.product_id join organizations o on o.id = c.customer_org_id where c.id = $1`, [campaignId])).rows[0];
  const runs = (await q.query(
    `select r.id, r.status, r.azvu, r.basis_outdated, r.last_comparison_id, t.code, tv.version, tv.title, tv.derivation, tv.events, tv.test_type, tv.id as tvid
       from test_runs r join testcases t on t.id = r.testcase_id join testcase_versions tv on tv.id = r.testcase_version_id where r.campaign_id = $1 and r.superseded_by is null order by t.code`, [campaignId])).rows;
  const deviations: any[] = []; const critIds = new Set<string>(); const laeufe: any[] = []; const repro: string[] = []; const findings: string[] = [];
  for (const r of runs) {
    laeufe.push({ runId: r.id, testfall: r.code, version: r.version, titel: r.title, status: r.status, comparisonId: r.last_comparison_id, grundlageUeberholt: r.basis_outdated });
    if (!r.last_comparison_id) continue;
    const cmp = (await q.query('select rows, outcome from comparison_results where id = $1', [r.last_comparison_id])).rows[0];
    const bad = (cmp.rows as any[]).filter((x) => x.result === 'abweichung' || x.result === 'fehlt' || x.result === 'unerwartet');
    for (const b of bad) {
      deviations.push({ testfall: r.code, testfallVersion: r.version, azvu: r.azvu, feld: b.field, bezeichnung: b.label, soll: b.expected, ist: b.actual, ergebnis: b.result, fachlicherBezug: b.criterion, begruendung: b.explanation, quelle: b.source });
      if (b.criterion) critIds.add(b.criterion);
    }
    if (bad.length) {
      findings.push(`${r.code} (v${r.version}) „${r.title}“: ${bad.length} Abweichung(en) zwischen Soll und Ist in den importierten Rückgabedaten.`);
      repro.push(`${r.code}: Eingangsdaten gemäß Prüfpaket erfassen (AZVU ${r.azvu}, Tagesdatum ${formatDe(c.test_date)}), EEL-Datei erzeugen und importieren; Ergebnis ${r.status === 'failed' ? 'Nicht bestanden' : r.status}.`);
    }
  }
  const criteria: any[] = [];
  for (const slug of critIds) {
    const cr = (await q.query(
      `select cr.code, cr.slug, v.version, v.title, v.rule, v.evidence from criteria cr join criteria_versions v on v.criterion_id = cr.id
        where cr.org_id = $1 and cr.slug = $2 and v.status = 'approved' order by v.version desc limit 1`, [c.org_id, slug])).rows[0];
    if (!cr) continue;
    const ev: any[] = [];
    for (const e of cr.evidence as any[]) {
      const s = (await q.query('select d.title, sv.version_label from source_versions sv join source_documents d on d.id = sv.document_id where sv.id = $1', [e.source_version_id])).rows[0];
      ev.push({ quelle: s ? `${s.title} (Version ${s.version_label})` : 'unbekannt', zitat: e.quote, fundstelle: e.locator ? `${e.locator.kind === 'seite' ? 'Seite' : 'Absatz'} ${e.locator.n}` : null });
    }
    criteria.push({ code: cr.code, schluessel: cr.slug, version: cr.version, titel: cr.title, regel: cr.rule, belege: ev });
  }
  const counts = { gesamt: runs.length, bestanden: runs.filter((r) => r.status === 'passed').length, nichtBestanden: runs.filter((r) => r.status === 'failed').length, offen: runs.filter((r) => !['passed', 'failed'].includes(r.status)).length };
  if (!findings.length) findings.push(counts.gesamt && counts.bestanden === counts.gesamt ? 'Alle Testfälle des Prüfumfangs wurden bestanden.' : 'Es liegen keine Abweichungen vor; nicht alle Testfälle sind abgeschlossen.');
  return {
    art: kind, stand: new Date().toISOString(),
    produkt: { hersteller: c.vendor, produkt: c.product, version: c.sw_version, adapter: c.adapter_key, kunde: c.customer },
    umfang: { pruefung: c.name, bereich: c.scope_area, testdatum: c.test_date, hinweis: c.scope_note, zaehlung: counts },
    regelwerk: { bezeichnung: c.rs_label, dokumentversion: c.document_version, datensatzversion: c.record_version, gueltigAb: c.rs_from, gueltigBis: c.rs_to, uebergang: c.transition_note },
    laeufe, abweichungen: deviations, kriterien: criteria, reproduktion: repro,
    gesicherteBefunde: findings, hypothesen: [] as { klasse: string; text: string; herkunft: string }[], klassifikation: 'offen',
    naechsteSchritte: deviations.length ? ['Abweichungen mit dem Hersteller klären.', 'Nach Korrektur Prüfung wiederholen (neuer Lauf, bisherige Ergebnisse bleiben erhalten).'] : [],
    hinweis: 'Gesicherte Befunde folgen unmittelbar aus den Vergleichszeilen. Ursachenvermutungen stehen getrennt als Hypothesen und sind keine Feststellungen.',
  };
}

export async function createReport(q: Q, actor: Actor, campaignId: string, kind: 'fehlerbericht' | 'pruefbericht', title?: string) {
  requirePerm(actor, 'content:write');
  await assertCampaignAccess(q, actor, campaignId);
  const content = await buildReportContent(q, campaignId, kind);
  const code = await nextCode(q, actor.orgId!, 'report', 'B');
  const r = await q.query('insert into reports(org_id, campaign_id, code, kind) values ($1,$2,$3,$4) returning id', [actor.orgId, campaignId, code, kind]);
  const t = title?.trim() || (kind === 'fehlerbericht' ? `Fehlerbericht ${content.produkt.produkt} ${content.produkt.version}` : `Prüfbericht ${content.produkt.produkt} ${content.produkt.version}`);
  const v = await q.query(`insert into report_versions(report_id, version, title, content, status, change_note, created_by) values ($1,1,$2,$3,'draft','Entwurf aus den aktuellen Vergleichsergebnissen',$4) returning id`, [r.rows[0].id, t, JSON.stringify(content), actor.id]);
  await audit(q, { actor, action: 'bericht.angelegt', objectType: 'report', objectId: r.rows[0].id, objectVersion: 1, details: { code, art: kind, abweichungen: content.abweichungen.length } });
  return { reportId: r.rows[0].id as string, versionId: v.rows[0].id as string, code };
}

/** Aktualisiert den Bericht mit den aktuellen Vergleichsdaten – bei freigegebenem Bericht als NEUE Version. */
export async function refreshReport(q: Q, actor: Actor, reportId: string) {
  const rep = (await q.query('select * from reports where id = $1 and org_id = $2', [reportId, actor.orgId])).rows[0];
  if (!rep) throw notFound('Bericht');
  const cur = await currentVersion(q, 'report', reportId);
  const fresh = await buildReportContent(q, rep.campaign_id, rep.kind);
  const keep = cur.content;
  const merged = { ...fresh, hypothesen: keep.hypothesen ?? [], klassifikation: keep.klassifikation ?? 'offen', naechsteSchritte: keep.naechsteSchritte?.length ? keep.naechsteSchritte : fresh.naechsteSchritte };
  return reviseVersion(q, actor, 'report', cur.id, { content: merged }, 'Berichtsdaten aus den aktuellen Vergleichsergebnissen aktualisiert');
}

export async function provideReport(q: Q, actor: Actor, versionId: string, kind: 'bereitstellung' | 'versand', recipient?: string, note?: string) {
  requirePerm(actor, 'report:release');
  const v = (await q.query(`select v.*, r.org_id, r.campaign_id, r.code from report_versions v join reports r on r.id = v.report_id where v.id = $1`, [versionId])).rows[0];
  if (!v || v.org_id !== actor.orgId) throw notFound('Bericht');
  const cur = await currentVersion(q, 'report', v.report_id);
  if (cur.id !== v.id) throw conflict('NOT_CURRENT', `Es gibt eine neuere Version (v${cur.version}). Nur die aktuelle, freigegebene Version darf bereitgestellt werden.`);
  if (v.status !== 'approved') throw conflict('NOT_APPROVED', `Die Version ist nicht freigegeben (Status: ${v.status}). Nicht freigegebene Berichte dürfen weder bereitgestellt noch versendet werden.`);
  const camp = (await q.query('select o.name from campaigns c join organizations o on o.id = c.customer_org_id where c.id = $1', [v.campaign_id])).rows[0];
  const files = (await q.query(`select file_name from import_files where campaign_id = $1 and status = 'imported' order by uploaded_at`, [v.campaign_id])).rows.map((x) => x.file_name);
  const attachments = files.map((f) => ({ name: f }));
  const to = recipient?.trim() || camp.name;
  const status = kind === 'bereitstellung' ? 'bereitgestellt' : 'nicht_konfiguriert';
  const msg = kind === 'versand' ? 'Es ist kein E-Mail-/Versandweg konfiguriert. Es wurde nichts versendet; der Bericht kann stattdessen im Portal bereitgestellt werden.' : (note ?? null);
  const d = await q.query(`insert into report_dispatches(report_version_id, kind, recipient, attachments, status, note, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`, [versionId, kind, to, JSON.stringify(attachments), status, msg, actor.id]);
  await audit(q, { actor, orgId: v.org_id, action: kind === 'bereitstellung' ? 'bericht.bereitgestellt' : 'bericht.versand_versucht', objectType: 'report', objectId: v.report_id, objectVersion: v.version, details: { empfaenger: to, status, anlagen: attachments.length } });
  return d.rows[0];
}

export function validateClassification(k: string) {
  if (!CLASSIFICATIONS.some((c) => c.key === k)) throw badRequest('Unbekannte Einordnung.');
}
