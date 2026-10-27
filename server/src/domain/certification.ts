// Zertifizierung (Demo-Prüfumfang). „Prüfung bestanden“ ist NICHT „zertifiziert“: Zertifiziert ist die Software erst
// nach einer dokumentierten, ausdrücklichen Entscheidung einer berechtigten Person. Es wird keine amtliche ITSG-Zertifizierung behauptet.

import type { Q } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, assertCampaignAccess, badRequest, conflict, require as requirePerm } from '../auth.js';

export const CERT_LABEL = 'Zertifiziert im Demo-Prüfumfang';
export const CERT_DISCLAIMER = 'Dies ist eine Entscheidung im Rahmen des Prototyps (Demo-Prüfumfang). Sie ist keine amtliche Zertifizierung der ITSG oder einer anderen Stelle.';

export interface ReadinessCheck { key: string; label: string; ok: boolean; detail: string }

export async function readiness(q: Q, campaignId: string) {
  const c = (await q.query('select * from campaigns where id = $1', [campaignId])).rows[0];
  const runs = (await q.query(
    `select r.*, t.code, tv.status as tv_status, tv.version as tv_version,
            (select max(v.version) from testcase_versions v where v.testcase_id = r.testcase_id and v.status = 'approved') as eff_version
       from test_runs r join testcases t on t.id = r.testcase_id join testcase_versions tv on tv.id = r.testcase_version_id where r.campaign_id = $1 and r.superseded_by is null`, [campaignId])).rows;
  const checks: ReadinessCheck[] = [];
  const all = (await q.query(
    `select distinct on (t.id) t.id, t.code, v.status, v.version from testcases t join testcase_versions v on v.testcase_id = t.id where t.org_id = $1 order by t.id, v.version desc`, [c.org_id])).rows;
  const inCampaign = new Set(runs.map((r) => r.testcase_id));
  const notReady = all.filter((t) => t.status !== 'approved').map((t) => `${t.code} (${t.status})`);
  const notIn = all.filter((t) => t.status === 'approved' && !inCampaign.has(t.id)).map((t) => t.code);
  checks.push({ key: 'umfang', label: 'Prüfumfang vollständig', ok: all.length > 0 && !notReady.length && !notIn.length,
    detail: all.length === 0 ? 'Es gibt keine Testfälle.' : !notReady.length && !notIn.length ? `Alle ${all.length} Testfälle sind freigegeben und Teil der Prüfung.` : `${notReady.length ? 'Nicht freigegeben: ' + notReady.join(', ') + '. ' : ''}${notIn.length ? 'Nicht in der Prüfung: ' + notIn.join(', ') + '.' : ''}` });
  const notExec = runs.filter((r) => !['passed', 'failed'].includes(r.status));
  checks.push({ key: 'ausgefuehrt', label: 'Alle Testfälle ausgeführt', ok: runs.length > 0 && !notExec.length, detail: !runs.length ? 'Es gibt keine Testläufe.' : notExec.length ? `Offen: ${notExec.map((r) => `${r.code} (${r.status})`).join(', ')}.` : `Alle ${runs.length} Läufe sind abgeschlossen.` });
  const imp = (await q.query(`select count(*)::int as n from import_files where campaign_id = $1 and status in ('assignment_required','import_error')`, [campaignId])).rows[0].n;
  const missing = runs.filter((r) => ['awaiting_return', 'assignment_required', 'import_error', 'exported', 'blocked'].includes(r.status));
  checks.push({ key: 'rueckgaben', label: 'Keine fehlenden Rückmeldungen oder ungeklärten Importe', ok: !missing.length && imp === 0, detail: missing.length || imp ? `${missing.length} Lauf/Läufe ohne vollständige Rückgabe, ${imp} Importdatei(en) mit offener Zuordnung oder Fehler.` : 'Keine offenen Rückgaben.' });
  const failed = runs.filter((r) => r.status === 'failed');
  checks.push({ key: 'abweichungen', label: 'Keine ungeklärten Abweichungen', ok: !failed.length, detail: failed.length ? `Nicht bestanden: ${failed.map((r) => r.code).join(', ')}.` : 'Keine Abweichungen.' });
  const stale = runs.filter((r) => r.basis_outdated || (r.eff_version && r.eff_version !== r.tv_version));
  checks.push({ key: 'grundlage', label: 'Freigaben und Grundlagen gültig', ok: !stale.length, detail: stale.length ? `Grundlage überholt: ${stale.map((r) => r.code).join(', ')}.` : 'Alle Läufe beruhen auf den gültigen, freigegebenen Versionen.' });
  const rep = (await q.query(
    `select r.code, v.version, v.status from reports r join report_versions v on v.report_id = r.id
      where r.campaign_id = $1 and r.kind = 'pruefbericht' and v.version = (select max(version) from report_versions where report_id = r.id)`, [campaignId])).rows;
  const approvedRep = rep.find((x) => x.status === 'approved');
  checks.push({ key: 'bericht', label: 'Freigegebener Prüfbericht liegt vor', ok: !!approvedRep, detail: approvedRep ? `${approvedRep.code} v${approvedRep.version} ist freigegeben.` : rep.length ? `Prüfbericht ${rep[0].code} ist im Status „${rep[0].status}“.` : 'Es gibt noch keinen Prüfbericht.' });
  const openCl = (await q.query(`select count(*)::int as n from clarifications where org_id = $1 and status = 'open'`, [c.org_id])).rows[0].n;
  checks.push({ key: 'klaerungen', label: 'Keine offenen Klärungsvorgänge', ok: openCl === 0, detail: openCl ? `${openCl} Klärungsvorgang/-vorgänge offen.` : 'Keine offenen Klärungen.' });
  const ready = checks.every((x) => x.ok);
  const last = (await q.query('select cd.*, u.name as by from certification_decisions cd join users u on u.id = cd.decided_by where cd.campaign_id = $1 order by cd.decided_at desc, cd.id desc limit 1', [campaignId])).rows[0] ?? null;
  const anyRun = runs.some((r) => r.status !== 'not_run');
  let state: string; let label: string;
  if (last?.decision === 'certified' && ready) { state = 'zertifiziert'; label = CERT_LABEL; }
  else if (last?.decision === 'certified') { state = 'grundlage_geaendert'; label = 'Zertifizierung: Grundlage inzwischen geändert – erneute Prüfung erforderlich'; }
  else if (last?.decision === 'withheld') { state = 'versagt'; label = 'Zertifizierung versagt'; }
  else if (failed.length) { state = 'nicht_bestanden'; label = 'Prüfung nicht bestanden'; }
  else if (ready) { state = 'bestanden'; label = 'Prüfung bestanden – Bestätigung ausstehend'; }
  else if (anyRun) { state = 'in_pruefung'; label = 'In Prüfung'; }
  else { state = 'geplant'; label = 'Noch nicht gestartet'; }
  return { campaignId, state, label, ready, checks, lastDecision: last, disclaimer: CERT_DISCLAIMER };
}

export async function decideCertification(q: Q, actor: Actor, campaignId: string, p: { decision: 'certified' | 'withheld'; reason: string; validFrom?: string; validTo?: string | null }) {
  requirePerm(actor, 'certification:decide');
  await assertCampaignAccess(q, actor, campaignId);
  if (!['certified', 'withheld'].includes(p.decision)) throw badRequest('Unbekannte Entscheidung.');
  if ((p.reason ?? '').trim().length < 10) throw badRequest('Bitte die Begründung der Entscheidung angeben (mindestens 10 Zeichen).');
  const rd = await readiness(q, campaignId);
  if (p.decision === 'certified' && !rd.ready) throw conflict('NOT_READY', `Die Voraussetzungen sind nicht erfüllt: ${rd.checks.filter((c) => !c.ok).map((c) => c.label).join('; ')}.`, rd.checks);
  const c = (await q.query(`select c.*, sp.vendor, sp.name as product, sv.version as sw_version, rs.label as rs_label, rs.document_version from campaigns c join software_versions sv on sv.id = c.software_version_id join software_products sp on sp.id = sv.product_id join rulesets rs on rs.id = c.ruleset_id where c.id = $1`, [campaignId])).rows[0];
  const runs = (await q.query(`select t.code, tv.version, r.status from test_runs r join testcases t on t.id = r.testcase_id join testcase_versions tv on tv.id = r.testcase_version_id where r.campaign_id = $1 and r.superseded_by is null order by t.code`, [campaignId])).rows;
  const rep = (await q.query(`select r.code, v.version from reports r join report_versions v on v.report_id = r.id where r.campaign_id = $1 and r.kind = 'pruefbericht' and v.status = 'approved' order by v.version desc limit 1`, [campaignId])).rows[0] ?? null;
  const scope = { bereich: c.scope_area, software: `${c.vendor} ${c.product} ${c.sw_version}`, regelwerk: `${c.rs_label} (Dokumentversion ${c.document_version})`, testdatum: c.test_date, hinweis: 'Demo-Prüfumfang: Abgabegrund 41 (Vorerkrankungsanfrage)' };
  const basis = { laeufe: runs.map((r) => `${r.code} v${r.version}: ${r.status}`), pruefbericht: rep ? `${rep.code} v${rep.version}` : null, hinweis: CERT_DISCLAIMER };
  const r = await q.query(
    `insert into certification_decisions(org_id, campaign_id, decision, label, scope, basis, valid_from, valid_to, reason, decided_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
    [actor.orgId, campaignId, p.decision, p.decision === 'certified' ? CERT_LABEL : 'Zertifizierung versagt', JSON.stringify(scope), JSON.stringify(basis), p.validFrom ?? new Date().toISOString().slice(0, 10), p.validTo ?? null, p.reason.trim(), actor.id]);
  await audit(q, { actor, action: p.decision === 'certified' ? 'zertifizierung.erteilt' : 'zertifizierung.versagt', objectType: 'campaign', objectId: campaignId, reason: p.reason, details: { scope, basis } });
  return r.rows[0];
}
