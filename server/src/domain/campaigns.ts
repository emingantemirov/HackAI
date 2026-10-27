// Prüfkampagnen: Testläufe, Prüfpakete (Export), Rückgabedaten (Import), Folgeantworten, Vergleich.
//
// Getrennt geführt: Eingangsdaten (Prüfpaket) · Software-Ausgaben (importierte EEL-Dateien) · Folgeantworten der Krankenkasse ·
// Soll-Werte (verbleiben im Portal, nie im Prüfpaket) · Vergleichsergebnisse.

import crypto from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Q } from '../db.js';
import { nextCode } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, assertCampaignAccess, badRequest, conflict, forbidden, notFound, require as requirePerm } from '../auth.js';
import { parseEel, buildEelFile, type BuildMessage, type ParsedFile, type ParsedMessage } from '../eel.js';
import { readStored, sha256, storeFile } from '../extract.js';
import { isoToEel } from '../util/dates.js';
import { ADAPTERS, buildInputPackage, getAdapter, type PackageRun } from '../adapters/index.js';
import { SIM_FAULTS, type SimFault, simulateStage } from '../adapters/simulator.js';
import { AZVU_DEFAULT, basisProblems, type ExpectedMessage, type Scenario, type TestEvent } from './testcases.js';
import { type DecidedPolicy, getPolicy } from './clarifications.js';
import { compareRun, type ActualMessage } from './compare.js';

export { ADAPTERS, SIM_FAULTS };

const KK_ABSENDER = '10000008'; // synthetisch, ausdrücklich keine echte Betriebsnummer

// ---------------------------------------------------------------------------
// Stammdaten: Softwareprofile, Regelwerksstände
// ---------------------------------------------------------------------------

export async function createSoftwareVersion(q: Q, actor: Actor, p: { vendor: string; product: string; version: string; adapterKey: string; configuration?: Record<string, unknown> }) {
  requirePerm(actor, 'settings:write');
  if (!getAdapter(p.adapterKey)) throw badRequest('Unbekannter Adapter.');
  if (!p.vendor?.trim() || !p.product?.trim() || !p.version?.trim()) throw badRequest('Hersteller, Produkt und Version sind Pflichtangaben.');
  const prod = await q.query(
    `insert into software_products(owner_org_id, vendor, name) values ($1,$2,$3) on conflict (owner_org_id, vendor, name) do update set vendor = excluded.vendor returning id`,
    [actor.orgId, p.vendor.trim(), p.product.trim()]);
  const v = await q.query(`insert into software_versions(product_id, version, configuration, adapter_key) values ($1,$2,$3,$4) on conflict (product_id, version) do nothing returning id`,
    [prod.rows[0].id, p.version.trim(), JSON.stringify(p.configuration ?? {}), p.adapterKey]);
  if (!v.rowCount) throw conflict('DUPLICATE', 'Diese Softwareversion existiert bereits.');
  await audit(q, { actor, action: 'software.angelegt', objectType: 'software', objectId: v.rows[0].id, details: { ...p } });
  return v.rows[0].id as string;
}

export async function createRuleset(q: Q, actor: Actor, p: { label: string; documentVersion: string; recordVersion: string; validFrom: string; validTo?: string | null; transitionNote?: string }) {
  requirePerm(actor, 'settings:write');
  if (!p.label?.trim() || !p.documentVersion?.trim() || !p.recordVersion?.trim()) throw badRequest('Bezeichnung, Dokumentversion und Datensatzversion sind Pflichtangaben.');
  const r = await q.query(`insert into rulesets(org_id, label, document_version, record_version, valid_from, valid_to, transition_note) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [actor.orgId, p.label.trim(), p.documentVersion.trim(), p.recordVersion.trim(), p.validFrom, p.validTo ?? null, p.transitionNote ?? null]);
  await audit(q, { actor, action: 'regelwerk.angelegt', objectType: 'ruleset', objectId: r.rows[0].id, details: { ...p } });
  return r.rows[0].id as string;
}

// ---------------------------------------------------------------------------
// Kampagne und Läufe
// ---------------------------------------------------------------------------

export async function createCampaign(q: Q, actor: Actor, p: { name: string; customerOrgId: string; softwareVersionId: string; rulesetId: string; testDate: string; scopeNote?: string; testcaseIds?: string[] }) {
  requirePerm(actor, 'campaign:manage');
  if (!p.name?.trim()) throw badRequest('Bitte einen Namen angeben.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.testDate)) throw badRequest('Das Tagesdatum des Testkontexts muss ein Datum sein (JJJJ-MM-TT).');
  const cust = await q.query(`select id from organizations where id = $1 and kind = 'hersteller'`, [p.customerOrgId]);
  if (!cust.rowCount) throw badRequest('Kunde/Hersteller unbekannt.');
  const sw = await q.query('select sv.id from software_versions sv join software_products sp on sp.id = sv.product_id where sv.id = $1 and sp.owner_org_id = $2', [p.softwareVersionId, actor.orgId]);
  if (!sw.rowCount) throw notFound('Softwareversion');
  const rs = await q.query('select id from rulesets where id = $1 and org_id = $2', [p.rulesetId, actor.orgId]);
  if (!rs.rowCount) throw notFound('Regelwerksstand');
  const c = await q.query(`insert into campaigns(org_id, customer_org_id, name, software_version_id, ruleset_id, test_date, scope_note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [actor.orgId, p.customerOrgId, p.name.trim(), p.softwareVersionId, p.rulesetId, p.testDate, p.scopeNote ?? null, actor.id]);
  const campaignId = c.rows[0].id as string;
  const added = await addRuns(q, actor, campaignId, p.testcaseIds);
  await audit(q, { actor, action: 'pruefung.angelegt', objectType: 'campaign', objectId: campaignId, details: { name: p.name, laeufe: added.runs.length, uebersprungen: added.skipped.length } });
  return { campaignId, ...added };
}

/** Nimmt ausschließlich FREIGEGEBENE Testfallversionen auf. Alles andere wird mit Begründung übersprungen. */
export async function addRuns(q: Q, actor: Actor, campaignId: string, testcaseIds?: string[]) {
  requirePerm(actor, 'campaign:manage');
  const camp = await q.query('select * from campaigns where id = $1 and org_id = $2', [campaignId, actor.orgId]);
  if (!camp.rowCount) throw notFound('Prüfung');
  const c = camp.rows[0];
  const tcs = await q.query(`select t.id, t.code from testcases t where t.org_id = $1 and t.archived_at is null ${testcaseIds?.length ? 'and t.id = any($2::uuid[])' : ''} order by t.code`, testcaseIds?.length ? [actor.orgId, testcaseIds] : [actor.orgId]);
  const runs: { runId: string; code: string; azvu: string }[] = [];
  const skipped: { code: string; grund: string }[] = [];
  const campNo = (await q.query('select count(*)::int as n from campaigns where org_id = $1 and created_at <= $2', [actor.orgId, c.created_at])).rows[0].n;
  for (const t of tcs.rows) {
    const ex = await q.query('select 1 from test_runs where campaign_id = $1 and testcase_id = $2 and superseded_by is null', [campaignId, t.id]);
    if (ex.rowCount) { skipped.push({ code: t.code, grund: 'ist bereits Teil der Prüfung' }); continue; }
    const v = await q.query(`select * from testcase_versions where testcase_id = $1 and status = 'approved' order by version desc limit 1`, [t.id]);
    if (!v.rowCount) { skipped.push({ code: t.code, grund: 'keine freigegebene Version (Testfälle brauchen eine eigene Freigabe)' }); continue; }
    const tv = v.rows[0];
    const prob = await basisProblems(q, tv.id);
    if (prob.length) { skipped.push({ code: t.code, grund: prob.join(' ') }); continue; }
    const seq = (await q.query('select count(*)::int as n from test_runs where campaign_id = $1', [campaignId])).rows[0].n + 1;
    const multistep = !!tv.initial_state?.multistep;
    const azvu = multistep ? AZVU_DEFAULT : `${String(campNo).padStart(4, '0')}-${String(seq).padStart(4, '0')}-${t.code.replace(/\D/g, '').padStart(3, '0')}`;
    const r = await q.query(`insert into test_runs(campaign_id, testcase_id, testcase_version_id, ruleset_id, azvu) values ($1,$2,$3,$4,$5) returning id`, [campaignId, t.id, tv.id, c.ruleset_id, azvu]);
    runs.push({ runId: r.rows[0].id, code: t.code, azvu });
  }
  return { runs, skipped };
}

async function loadRun(q: Q, runId: string) {
  const r = await q.query(
    `select r.*, tv.version as tc_version, tv.title as tc_title, tv.initial_state, tv.expected, tv.events, tv.expects_no_message, tv.observation_note, tv.test_date as tc_test_date, tv.derivation,
            t.code as tc_code, c.org_id, c.customer_org_id, c.test_date as campaign_test_date, c.software_version_id, c.name as campaign_name
       from test_runs r join testcase_versions tv on tv.id = r.testcase_version_id join testcases t on t.id = r.testcase_id join campaigns c on c.id = r.campaign_id where r.id = $1`, [runId]);
  if (!r.rowCount) throw notFound('Testlauf');
  return r.rows[0];
}

export async function getRunForActor(q: Q, actor: Actor, runId: string) {
  const run = await loadRun(q, runId);
  await assertCampaignAccess(q, actor, run.campaign_id);
  return run;
}

// ---------------------------------------------------------------------------
// Prüfpaket (Export)
// ---------------------------------------------------------------------------

async function packageRuns(q: Q, campaignId: string, runIds?: string[]): Promise<{ runs: any[]; excluded: { code: string; grund: string }[] }> {
  const rs = await q.query(`select r.id from test_runs r where r.campaign_id = $1 and r.superseded_by is null ${runIds?.length ? 'and r.id = any($2::uuid[])' : ''} order by r.created_at, r.id`, runIds?.length ? [campaignId, runIds] : [campaignId]);
  const runs: any[] = []; const excluded: { code: string; grund: string }[] = [];
  for (const x of rs.rows) {
    const r = await loadRun(q, x.id);
    if (r.status !== 'not_run') { excluded.push({ code: r.tc_code, grund: `Status „${r.status}“ – bereits bereitgestellt oder abgeschlossen` }); continue; }
    if (r.basis_outdated) { excluded.push({ code: r.tc_code, grund: 'Grundlage veraltet – bitte Testfall neu freigeben' }); continue; }
    runs.push(r);
  }
  return { runs, excluded };
}

function toPackageRun(r: any): PackageRun {
  const sc = r.initial_state.scenario as Scenario;
  return { runId: r.id, azvu: r.azvu, testcaseCode: r.tc_code, testcaseVersion: r.tc_version, title: r.tc_title, testDate: r.campaign_test_date, scenario: sc, multistep: !!r.initial_state.multistep, stages: (r.events as TestEvent[]) };
}

async function packageMeta(q: Q, campaignId: string, packageNo: number) {
  const c = await q.query(
    `select c.id, c.name, rs.label, rs.document_version, rs.record_version, sp.vendor, sp.name as product, sv.version, sv.adapter_key
       from campaigns c join rulesets rs on rs.id = c.ruleset_id join software_versions sv on sv.id = c.software_version_id join software_products sp on sp.id = sv.product_id where c.id = $1`, [campaignId]);
  const x = c.rows[0];
  return { campaign: { id: x.id, name: x.name }, packageNo, software: { vendor: x.vendor, product: x.product, version: x.version }, ruleset: { label: x.label, documentVersion: x.document_version, recordVersion: x.record_version }, adapterKey: x.adapter_key as string, createdAt: new Date().toISOString() };
}

export async function previewPackage(q: Q, actor: Actor, campaignId: string, runIds?: string[]) {
  requirePerm(actor, 'campaign:manage');
  const camp = await assertCampaignAccess(q, actor, campaignId);
  void camp;
  const no = (await q.query('select coalesce(max(package_no),0)+1 as n from export_packages where campaign_id = $1', [campaignId])).rows[0].n;
  const meta = await packageMeta(q, campaignId, no);
  const ad = getAdapter(meta.adapterKey)!;
  const { runs, excluded } = await packageRuns(q, campaignId, runIds);
  if (!ad.capabilities.eingangsdatenExport) {
    return { adapter: ad, preview: { ok: false, errors: [`Für das Softwareprofil ist keine Exportschnittstelle konfiguriert (${ad.statusLabel}). Bitte den manuellen Ablauf verwenden.`], warnings: [], manifest: null }, runs: [], excluded };
  }
  const pk = buildInputPackage(meta, runs.map(toPackageRun));
  return { adapter: ad, preview: pk.preview, runs: runs.map((r) => ({ runId: r.id, code: r.tc_code, version: r.tc_version, title: r.tc_title, azvu: r.azvu })), excluded };
}

export async function createPackage(q: Q, actor: Actor, cfg: AppConfig, campaignId: string, runIds?: string[]) {
  requirePerm(actor, 'campaign:manage');
  await assertCampaignAccess(q, actor, campaignId);
  const no = (await q.query('select coalesce(max(package_no),0)+1 as n from export_packages where campaign_id = $1', [campaignId])).rows[0].n;
  const meta = await packageMeta(q, campaignId, no);
  const ad = getAdapter(meta.adapterKey)!;
  if (!ad.capabilities.eingangsdatenExport) throw conflict('ADAPTER_NOT_CONFIGURED', `Für das Softwareprofil ist keine Exportschnittstelle konfiguriert (${ad.statusLabel}). Bitte den manuellen Ablauf verwenden.`);
  const { runs } = await packageRuns(q, campaignId, runIds);
  const pk = buildInputPackage(meta, runs.map(toPackageRun));
  if (!pk.preview.ok) throw badRequest(`Das Prüfpaket ist nicht gültig: ${pk.preview.errors.join(' ')}`, pk.preview);
  const st = storeFile(cfg.storageDir, 'packages', pk.content);
  const p = await q.query(
    `insert into export_packages(campaign_id, package_no, adapter_key, manifest, file_name, storage_path, sha256, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [campaignId, no, meta.adapterKey, JSON.stringify({ ...pk.preview.manifest, runs: runs.map((r) => ({ runId: r.id, azvu: r.azvu, testcase: r.tc_code, version: r.tc_version })) }), pk.fileName, st.storagePath, st.sha, actor.id]);
  for (const r of runs) await q.query(`update test_runs set status = 'awaiting_return', package_id = $2 where id = $1`, [r.id, p.rows[0].id]);
  await q.query(`update campaigns set status = 'running' where id = $1 and status = 'planned'`, [campaignId]);
  await audit(q, { actor, action: 'pruefpaket.bereitgestellt', objectType: 'campaign', objectId: campaignId, details: { paket: no, laeufe: runs.length, sha256: st.sha, adapter: meta.adapterKey } });
  return { packageId: p.rows[0].id as string, packageNo: no, fileName: pk.fileName, runs: runs.length, sha256: st.sha };
}

// ---------------------------------------------------------------------------
// Import von Software-Ausgaben
// ---------------------------------------------------------------------------

export interface ImportOutcome { importId: string; status: 'imported' | 'assignment_required' | 'import_error' | 'duplicate'; message: string; warnings: string[]; errors: string[]; runs: string[] }

async function actualFor(q: Q, campaignId: string, run: { id: string; azvu: string }): Promise<{ actual: ActualMessage[]; fileIds: string[] }> {
  const files = await q.query(`select id, file_name, test_run_id, parsed from import_files where campaign_id = $1 and status = 'imported' and kind = 'software_ausgabe' order by uploaded_at, id`, [campaignId]);
  const actual: ActualMessage[] = []; const fileIds: string[] = [];
  for (const f of files.rows) {
    const msgs: ParsedMessage[] = f.parsed?.messages ?? [];
    const mine = msgs.filter((m) => (f.test_run_id ? f.test_run_id === run.id : (m.azvu ?? '') === run.azvu));
    if (mine.length) fileIds.push(f.id);
    for (const m of mine) actual.push({ msg: m, fileId: f.id, fileName: f.file_name });
  }
  return { actual, fileIds };
}

export async function importOutput(q: Q, actor: Actor, cfg: AppConfig, campaignId: string, p: { fileName: string; buf: Buffer; encoding?: string; runId?: string; origin?: 'upload' | 'simulator' }): Promise<ImportOutcome> {
  requirePerm(actor, 'import:upload');
  const camp = await assertCampaignAccess(q, actor, campaignId);
  void camp;
  const origin = p.origin ?? 'upload';
  if (!p.buf.length) throw badRequest('Die Datei ist leer.');
  if (p.buf.length > cfg.maxUploadBytes) throw badRequest(`Die Datei ist zu groß (maximal ${Math.round(cfg.maxUploadBytes / 1048576)} MB).`);
  const sha = sha256(p.buf);
  const dup = await q.query(`select id, file_name from import_files where campaign_id = $1 and sha256 = $2 and status <> 'duplicate' limit 1`, [campaignId, sha]);
  const stored = storeFile(cfg.storageDir, 'imports', p.buf);
  if (dup.rowCount) {
    const r = await q.query(`insert into import_files(campaign_id, file_name, sha256, size_bytes, storage_path, status, error, uploaded_by) values ($1,$2,$3,$4,$5,'duplicate',$6,$7) returning id`,
      [campaignId, p.fileName, sha, p.buf.length, stored.storagePath, `Inhaltsgleich mit bereits importierter Datei „${dup.rows[0].file_name}“.`, actor.id]);
    await audit(q, { actor, action: 'import.duplikat', objectType: 'campaign', objectId: campaignId, details: { datei: p.fileName, sha256: sha } });
    return { importId: r.rows[0].id, status: 'duplicate', message: `Diese Datei wurde bereits importiert („${dup.rows[0].file_name}“). Es wurde nichts doppelt verarbeitet.`, warnings: [], errors: [], runs: [] };
  }
  const policy = await getPolicy(q, actor.orgId ? (await q.query('select org_id from campaigns where id = $1', [campaignId])).rows[0].org_id : '');
  let parsed: ParsedFile | null = null; let fatal: string | null = null;
  try { parsed = parseEel(p.buf, { encoding: p.encoding ?? policy.encoding ?? undefined }); } catch (e: any) { fatal = e?.message ?? String(e); }
  const hintRun = p.runId ? await q.query('select id from test_runs where id = $1 and campaign_id = $2', [p.runId, campaignId]) : null;
  if (fatal || (parsed && parsed.errors.length)) {
    const errors = fatal ? [fatal] : parsed!.errors;
    const r = await q.query(`insert into import_files(campaign_id, test_run_id, file_name, sha256, size_bytes, storage_path, encoding, status, error, warnings, uploaded_by) values ($1,null,$2,$3,$4,$5,$6,'import_error',$7,$8,$9) returning id`,
      [campaignId, p.fileName, sha, p.buf.length, stored.storagePath, parsed?.encoding ?? null, errors.slice(0, 20).join(' | '), JSON.stringify(parsed?.warnings ?? []), actor.id]);
    if (hintRun?.rowCount) await q.query(`update test_runs set status = 'import_error', blocked_reason = $2 where id = $1 and status in ('awaiting_return','import_error','assignment_required')`, [p.runId, 'Die zuletzt hochgeladene Datei war nicht lesbar: ' + errors[0]]);
    await audit(q, { actor, action: 'import.fehler', objectType: 'campaign', objectId: campaignId, details: { datei: p.fileName, fehler: errors.slice(0, 5) } });
    return { importId: r.rows[0].id, status: 'import_error', message: 'Die Datei konnte nicht importiert werden. Es wurde nichts als bestanden gewertet.', warnings: parsed?.warnings ?? [], errors, runs: [] };
  }
  const runs = await q.query(`select id, azvu from test_runs where campaign_id = $1 and superseded_by is null`, [campaignId]);
  const byAzvu = new Map(runs.rows.map((r) => [r.azvu, r.id as string]));
  const matched = parsed!.messages.filter((m) => m.azvu && byAzvu.has(m.azvu));
  const unmatched = parsed!.messages.filter((m) => !(m.azvu && byAzvu.has(m.azvu)));
  const warnings = [...parsed!.warnings];
  const status: ImportOutcome['status'] = matched.length ? 'imported' : 'assignment_required';
  if (matched.length && unmatched.length) warnings.push(`${unmatched.length} Meldung(en) ließen sich keiner Prüfung zuordnen (AZVU ${[...new Set(unmatched.map((m) => m.azvu || '–'))].join(', ')}) und wurden nicht gewertet.`);
  const f = await q.query(
    `insert into import_files(campaign_id, file_name, sha256, size_bytes, storage_path, encoding, status, error, warnings, parsed, kind, uploaded_by, uploaded_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'software_ausgabe',$11, clock_timestamp()) returning id`,
    [campaignId, origin === 'simulator' ? `[SIMULATOR] ${p.fileName}` : p.fileName, sha, p.buf.length, stored.storagePath, parsed!.encoding, status,
      status === 'assignment_required' ? `Keine Meldung enthält ein AZVU dieser Prüfung (gefunden: ${[...new Set(parsed!.messages.map((m) => m.azvu || '–'))].join(', ')}). Zuordnung erforderlich.` : null,
      JSON.stringify(warnings), JSON.stringify(parsed), actor.id]);
  await audit(q, { actor, action: origin === 'simulator' ? 'import.simulator' : 'import.hochgeladen', objectType: 'campaign', objectId: campaignId, details: { datei: p.fileName, sha256: sha, status, meldungen: parsed!.messages.length, zugeordnet: matched.length } });
  const affected = [...new Set(matched.map((m) => byAzvu.get(m.azvu!)!))];
  if (status === 'assignment_required' && hintRun?.rowCount) await q.query(`update test_runs set status = 'assignment_required', blocked_reason = 'Zuordnung erforderlich: die hochgeladene Datei enthält kein passendes AZVU.' where id = $1 and status in ('awaiting_return','import_error')`, [p.runId]);
  for (const id of affected) await evaluateRun(q, actor, id);
  return { importId: f.rows[0].id, status, message: status === 'imported' ? `Importiert und ${affected.length} Testlauf/-läufen zugeordnet.` : 'Zuordnung erforderlich: Die Datei enthält kein AZVU dieser Prüfung. Es wurde nichts bewertet.', warnings, errors: [], runs: affected };
}

export async function assignImport(q: Q, actor: Actor, importId: string, runId: string) {
  requirePerm(actor, 'campaign:manage');
  const f = await q.query('select * from import_files where id = $1', [importId]);
  if (!f.rowCount) throw notFound('Importdatei');
  await assertCampaignAccess(q, actor, f.rows[0].campaign_id);
  if (f.rows[0].status !== 'assignment_required') throw conflict('NOT_ASSIGNABLE', 'Nur Dateien mit „Zuordnung erforderlich“ können manuell zugeordnet werden.');
  const run = await q.query('select id from test_runs where id = $1 and campaign_id = $2', [runId, f.rows[0].campaign_id]);
  if (!run.rowCount) throw notFound('Testlauf');
  await q.query(`update import_files set test_run_id = $2, status = 'imported', error = null where id = $1`, [importId, runId]);
  await audit(q, { actor, action: 'import.manuell_zugeordnet', objectType: 'campaign', objectId: f.rows[0].campaign_id, details: { importId, runId } });
  return evaluateRun(q, actor, runId);
}

// ---------------------------------------------------------------------------
// Auswertung
// ---------------------------------------------------------------------------

export async function evaluateRun(q: Q, actor: Actor, runId: string) {
  const run = await loadRun(q, runId);
  const policy = await getPolicy(q, run.org_id);
  const { actual, fileIds } = await actualFor(q, run.campaign_id, run);
  const exp = run.expected as { messages: ExpectedMessage[] };
  const out = compareRun({ expected: { messages: exp.messages ?? [] }, expectsNoMessage: run.expects_no_message, testDate: run.campaign_test_date, policy, actual, attested: !!run.completion_at, finalized: run.finalized, azvu: run.azvu });
  const cr = await q.query(
    `insert into comparison_results(test_run_id, import_file_ids, expected_version_id, outcome, rows, summary, normalization, created_by, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8, clock_timestamp()) returning id`,
    [runId, JSON.stringify(fileIds), run.testcase_version_id, out.outcome, JSON.stringify(out.rows), JSON.stringify(out.summary), JSON.stringify(out.normalization), actor.kind === 'user' ? actor.id : null]);
  const maxStage = out.summary.maxStage;
  const nextStage = out.summary.stageComplete < 0 ? 0 : Math.min(out.summary.stageComplete + 1, maxStage);
  let status: string; let reason: string | null = null;
  // Mehrstufige Szenarien sind erst vollständig, wenn auch die letzten Folgeantworten der Krankenkasse bereitgestellt wurden
  let pendingReplyStage: number | null = null;
  if (out.outcome === 'pass') {
    const delivered = new Set((await q.query('select stage from followup_replies where test_run_id = $1', [runId])).rows.map((x) => x.stage as number));
    const pend = (run.events as TestEvent[]).filter((e) => e.kind === 'folgeantwort' && !delivered.has(e.stage)).map((e) => e.stage).sort((a, b) => a - b);
    pendingReplyStage = pend.length ? pend[0] : null;
  }
  if (pendingReplyStage !== null) { status = 'awaiting_return'; reason = `Alle bisher erwarteten Meldungen stimmen überein. Als Nächstes die Folgeantwort der Krankenkasse (Stufe ${pendingReplyStage}) bereitstellen.`; }
  else if (out.outcome === 'pass') status = 'passed';
  else if (out.outcome === 'fail') status = 'failed';
  else { status = run.status === 'not_run' ? 'not_run' : 'awaiting_return'; reason = out.summary.reason; }
  if (out.outcome === 'incomplete' && nextStage > 0 && out.summary.stageComplete >= 0 && nextStage > out.summary.stageComplete) reason = `Stufe ${out.summary.stageComplete} ist abgeschlossen. Als Nächstes die Folgeantwort der Krankenkasse (Stufe ${nextStage}) bereitstellen und die Ausgabe der Software erneut hochladen.`;
  await q.query(`update test_runs set status = $2, blocked_reason = $3, stage = $4, last_comparison_id = $5, finished_at = $6 where id = $1`,
    [runId, status, reason, pendingReplyStage ?? nextStage, cr.rows[0].id, status === 'passed' || status === 'failed' ? new Date().toISOString() : null]);
  await audit(q, { actor, orgId: run.org_id, action: 'vergleich.ausgefuehrt', objectType: 'test_run', objectId: runId, details: { ergebnis: out.outcome, abweichungen: out.summary.abweichung + out.summary.unerwartet, fehlend: out.summary.fehlt } });
  await refreshCampaignStatus(q, run.campaign_id);
  return { comparisonId: cr.rows[0].id as string, outcome: out.outcome, status, summary: out.summary };
}

export async function refreshCampaignStatus(q: Q, campaignId: string) {
  const r = await q.query(`select status, count(*)::int as n from test_runs where campaign_id = $1 and superseded_by is null group by status`, [campaignId]);
  const total = r.rows.reduce((a, x) => a + x.n, 0);
  const done = r.rows.filter((x) => x.status === 'passed' || x.status === 'failed').reduce((a, x) => a + x.n, 0);
  const cur = (await q.query('select status from campaigns where id = $1', [campaignId])).rows[0]?.status;
  if (cur === 'closed') return;
  const next = total > 0 && done === total ? 'evaluated' : r.rows.some((x) => x.status !== 'not_run') ? 'running' : 'planned';
  if (next !== cur) await q.query('update campaigns set status = $2 where id = $1', [campaignId, next]);
}

export async function attestCompletion(q: Q, actor: Actor, runId: string, note: string) {
  requirePerm(actor, 'campaign:manage');
  const run = await getRunForActor(q, actor, runId);
  if (!run.expects_no_message) throw conflict('NOT_APPLICABLE', 'Ein dokumentierter Abschluss ist nur für Testfälle nötig, bei denen ausdrücklich keine Meldung erwartet wird.');
  if (run.status === 'not_run') throw conflict('NOT_EXPORTED', 'Das Prüfpaket wurde noch nicht bereitgestellt.');
  if ((note ?? '').trim().length < 20) throw badRequest('Bitte den Abschluss dokumentieren (mindestens 20 Zeichen): welche Eingaben wurden verarbeitet, wie lange wurde beobachtet, was wurde festgestellt.');
  await q.query('update test_runs set completion_note = $2, completion_by = $3, completion_at = now() where id = $1', [runId, note.trim(), actor.id]);
  await audit(q, { actor, orgId: run.org_id, action: 'testlauf.abschluss_dokumentiert', objectType: 'test_run', objectId: runId, reason: note });
  return evaluateRun(q, actor, runId);
}

export async function finalizeRun(q: Q, actor: Actor, runId: string, note: string) {
  requirePerm(actor, 'campaign:manage');
  const run = await getRunForActor(q, actor, runId);
  if (run.status === 'not_run') throw conflict('NOT_EXPORTED', 'Das Prüfpaket wurde noch nicht bereitgestellt.');
  if ((note ?? '').trim().length < 10) throw badRequest('Bitte begründen, warum der Lauf ohne weitere Rückgaben abgeschlossen wird.');
  await q.query('update test_runs set finalized = true where id = $1', [runId]);
  await audit(q, { actor, orgId: run.org_id, action: 'testlauf.ohne_rueckgabe_abgeschlossen', objectType: 'test_run', objectId: runId, reason: note });
  return evaluateRun(q, actor, runId);
}

// ---------------------------------------------------------------------------
// Folgeantworten der Krankenkasse
// ---------------------------------------------------------------------------

const detUuid = (seed: string) => {
  const h = crypto.createHash('sha256').update(seed).digest('hex').toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

export async function createFollowUp(q: Q, actor: Actor, cfg: AppConfig, runId: string) {
  requirePerm(actor, 'campaign:manage');
  const run = await getRunForActor(q, actor, runId);
  const stage = run.stage as number;
  const existing = await q.query('select * from followup_replies where test_run_id = $1 and stage = $2', [runId, stage]);
  if (existing.rowCount) return { ...existing.rows[0], reused: true };
  if (stage < 1) throw conflict('NO_FOLLOWUP', 'Für diese Stufe ist keine Folgeantwort der Krankenkasse vorgesehen.');
  const ev = (run.events as TestEvent[]).find((e) => e.kind === 'folgeantwort' && e.stage === stage);
  if (!ev?.reply) throw conflict('NO_FOLLOWUP', 'Für diese Stufe ist keine Folgeantwort der Krankenkasse vorgesehen.');
  const last = run.last_comparison_id ? (await q.query('select summary from comparison_results where id = $1', [run.last_comparison_id])).rows[0] : null;
  const bound: Record<string, string> = last?.summary?.boundIds ?? {};
  const ref = bound[ev.reply.refVar];
  if (!ref) throw conflict('BINDING_MISSING', `Die Folgeantwort bezieht sich auf die DATENSATZ-ID einer früheren Meldung der Software (${ev.reply.refVar}), die noch nicht importiert wurde.`);
  const policy = await getPolicy(q, run.org_id);
  const sc = run.initial_state.scenario as Scenario;
  const first = (run.expected as { messages: ExpectedMessage[] }).messages.find((m) => m.dbvo);
  const entries = first?.dbvo?.entries ?? [];
  const msg: BuildMessage = {
    abgabegrund: ev.reply.abgabegrund, dsid: detUuid(`${run.id}:${stage}`), refId: ref.toUpperCase(), azvu: run.azvu, absender: KK_ABSENDER, empfaenger: '99302811',
    erstellung: `${isoToEel(run.campaign_test_date)}120000000000`,
  };
  if (ev.reply.abgabegrund === '61') {
    msg.dbvo = {
      auAbAg: isoToEel(sc.current.start), frist12: isoToEel(ev.reply.frist12 ?? ''), entries: entries.map((e) => ({ beginn: isoToEel(e.beginn), ende: isoToEel(e.ende) })),
      entryOverrides: entries.map((e) => ({ kzNachweis: ev.reply!.nachweis?.find((n) => n.beginn === e.beginn && n.ende === e.ende)?.kz ?? '1' })),
    };
  } else {
    msg.dbee = { eelAbag: isoToEel(sc.current.start), eelEnde: isoToEel(ev.reply.eelEnde ?? ''), eelEndeGrund: ev.reply.eelEndeGrund ?? '99' };
  }
  const text = buildEelFile([msg]);
  const enc = (policy.encoding ?? 'utf-8').toLowerCase();
  const buf = enc.includes('8859') || enc === 'latin1' ? Buffer.from(text, 'latin1') : Buffer.from(text, 'utf8');
  const st = storeFile(cfg.storageDir, 'followups', buf);
  const fileName = `KK-Antwort-${ev.reply.abgabegrund}-${run.tc_code}-Stufe${stage}.eel`;
  const note = `Synthetische Antwort der Krankenkasse (Abgabegrund ${ev.reply.abgabegrund}) mit Bezug auf DATENSATZ-ID ${ref}. Absender ${KK_ABSENDER} ist synthetisch. Kodierung: ${enc}${policy.encoding ? '' : ' (dokumentierte Annahme, nicht spezifiziert)'}.`;
  const r = await q.query(`insert into followup_replies(test_run_id, stage, file_name, storage_path, sha256, bindings, note, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
    [runId, stage, fileName, st.storagePath, st.sha, JSON.stringify({ [ev.reply.refVar]: ref }), note, actor.id]);
  await audit(q, { actor, orgId: run.org_id, action: 'folgeantwort.bereitgestellt', objectType: 'test_run', objectId: runId, details: { stufe: stage, abgabegrund: ev.reply.abgabegrund, sha256: st.sha } });
  await evaluateRun(q, actor, runId);
  return { ...r.rows[0], reused: false };
}

export function readFollowUpFile(cfg: AppConfig, row: { storage_path: string }): Buffer { return readStored(cfg.storageDir, row.storage_path); }

// ---------------------------------------------------------------------------
// Simulator (Demonstration)
// ---------------------------------------------------------------------------

export async function runSimulator(q: Q, actor: Actor, cfg: AppConfig, campaignId: string, fault: SimFault = 'keine', runIds?: string[]) {
  requirePerm(actor, 'campaign:manage');
  await assertCampaignAccess(q, actor, campaignId);
  const sw = await q.query(`select sv.adapter_key from campaigns c join software_versions sv on sv.id = c.software_version_id where c.id = $1`, [campaignId]);
  if (sw.rows[0].adapter_key !== 'simulator') throw conflict('NOT_SIMULATOR', 'Das Softwareprofil dieser Prüfung ist nicht der Simulator. Der Simulator läuft nur für das ausdrücklich gekennzeichnete Simulator-Profil.');
  if (!SIM_FAULTS.some((f) => f.key === fault)) throw badRequest('Unbekanntes Fehlerbild.');
  const rs = await q.query(`select id from test_runs where campaign_id = $1 and superseded_by is null and status = 'awaiting_return' ${runIds?.length ? 'and id = any($2::uuid[])' : ''} order by created_at`, runIds?.length ? [campaignId, runIds] : [campaignId]);
  const log: { run: string; stage: number; note: string; file?: string }[] = [];
  for (const x of rs.rows) {
    for (let guard = 0; guard < 6; guard++) {
      const run = await loadRun(q, x.id);
      if (run.status !== 'awaiting_return') break;
      const stage = run.stage as number;
      if (stage > 0) {
        const fu = await createFollowUp(q, actor, cfg, run.id);
        const parsed = parseEel(readStored(cfg.storageDir, fu.storage_path));
        if (parsed.errors.length) throw new Error('Simulator: Folgeantwort ist nicht lesbar: ' + parsed.errors[0]);
      }
      const policy = await getPolicy(q, run.org_id);
      const { actual } = await actualFor(q, campaignId, run);
      const sim = simulateStage({ azvu: run.azvu, scenario: run.initial_state.scenario, multistep: !!run.initial_state.multistep }, stage, { sixMonth: policy.sixMonth, beschaeftigungsende: policy.beschaeftigungsende }, actual.map((a) => a.msg), stage === 0 || fault !== 'verwirft-korrektur' ? fault : fault);
      if (!sim.messages.length) { log.push({ run: run.tc_code, stage, note: sim.note }); break; }
      const text = buildEelFile(sim.messages);
      const enc = (policy.encoding ?? 'utf-8').toLowerCase();
      const buf = enc.includes('8859') || enc === 'latin1' ? Buffer.from(text, 'latin1') : Buffer.from(text, 'utf8');
      const fileName = `${run.tc_code}-stufe${stage}.eel`;
      const res = await importOutput(q, actor, cfg, campaignId, { fileName, buf, origin: 'simulator' });
      log.push({ run: run.tc_code, stage, note: sim.note, file: fileName });
      if (res.status !== 'imported') break;
      const after = await loadRun(q, x.id);
      if (after.status !== 'awaiting_return' || after.stage === stage) break;
    }
  }
  return { fault, log };
}

export { loadRun, actualFor, forbidden };
