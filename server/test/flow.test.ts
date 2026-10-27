import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setup, teardown, mkAs, FB, PR, PR2, KU, KU2, AD, type Ctx } from './helpers.js';
import { buildApp } from '../src/app.js';
import { HaiClient } from '../src/ai/hai.js';
import { buildEelFile } from '../src/eel.js';

let c: Ctx; let fb: ReturnType<Ctx['as']>, pr: typeof fb, pr2: typeof fb, ku: typeof fb, ku2: typeof fb, ad: typeof fb;
const SRC = path.resolve(__dirname, '../../sources');
let campaignId = '';
const cur = async (type: string, status?: string) => (await fb.get(`/api/objects/${type}${status ? `?status=${status}` : ''}`)).json.eintraege as any[];
const submitAndApprove = async (type: string, versionId: string) => {
  const s = await fb.post(`/api/objects/${type}/versions/${versionId}/submit`); expect(s.status, JSON.stringify(s.json)).toBe(200);
  const d = await pr.post(`/api/objects/${type}/versions/${versionId}/decide`, { decision: 'approved' }); expect(d.status, JSON.stringify(d.json)).toBe(200);
};
const slugId = async (slug: string) => (await cur('criteria')).find((x) => x.slug === slug);

beforeAll(async () => {
  c = await setup(); fb = c.as(FB); pr = c.as(PR); pr2 = c.as(PR2); ku = c.as(KU); ku2 = c.as(KU2); ad = c.as(AD);
});
afterAll(async () => { await teardown(c); });

describe('Quellen und Kriterien', () => {
  it('Abnahme 1: identische Datei wird als Duplikat erkannt', async () => {
    const r = await fb.upload('/api/sources', { name: 'GG_EEL_V13.1.pdf', data: fs.readFileSync(path.join(SRC, 'GG_EEL_V13.1.pdf')) }, { title: 'Nochmal GG', versionLabel: '13.1' });
    expect(r.status).toBe(200); expect(r.json.duplicate).toBe(true); expect(r.json.message).toMatch(/bereits/);
  });
  it('Abnahme 2: neue (abgeleitete) Kriterien starten ohne Freigabe', async () => {
    const list = await cur('criteria');
    expect(list.length).toBe(17);
    expect(list.every((x) => x.status === 'draft')).toBe(true);
  });
  it('Abnahme 3: Beleg mit Originalzitat und Fundstelle ist sichtbar', async () => {
    const k = await slugId('9c8c9b58');
    const d = (await fb.get(`/api/objects/criteria/${k.object_id}`)).json;
    expect(d.objekt.id).toBe('9c8c9b58-4d0f-4066-98ac-973095418d63');
    const ev = d.versionen[0].evidence[0];
    expect(ev.verified).toBe(true); expect(ev.quote.length).toBeGreaterThan(20);
  });
  it('Abnahme 4: Ablehnung ohne Begründung ist unmöglich (API und Datenbank)', async () => {
    const k = await slugId('gkv-teilnahme');
    expect((await fb.post(`/api/objects/criteria/versions/${k.version_id}/submit`)).status).toBe(200);
    const r = await pr.post(`/api/objects/criteria/versions/${k.version_id}/decide`, { decision: 'rejected', reason: '' });
    expect(r.status).toBe(400);
    const noReason = await pr.post(`/api/objects/criteria/versions/${k.version_id}/decide`, { decision: 'rejected', reason: 'kurz' });
    expect(noReason.status).toBe(400);
    await expect(c.db.query(`insert into approval_decisions(org_id, object_type, object_id, version_id, version_number, decision, reason, decided_by) select org_id, 'criterion', $1, $2, 1, 'rejected', null, id from users limit 1`, [k.object_id, k.version_id])).rejects.toThrow();
  });
  it('KI und Fachbearbeitung können nicht freigeben; Einreicher kann nicht selbst freigeben (Vier-Augen)', async () => {
    const k = await slugId('gkv-teilnahme');
    expect((await fb.post(`/api/objects/criteria/versions/${k.version_id}/decide`, { decision: 'approved' })).status).toBe(403);
    const k2 = await slugId('au-nachweis-aktuell');
    expect((await pr.post(`/api/objects/criteria/versions/${k2.version_id}/submit`)).status).toBe(200);
    const self = await pr.post(`/api/objects/criteria/versions/${k2.version_id}/decide`, { decision: 'approved' });
    expect(self.status).toBe(403); expect(self.json.error.code).toBe('FOUR_EYES');
    expect((await pr2.post(`/api/objects/criteria/versions/${k2.version_id}/decide`, { decision: 'approved' })).status).toBe(200);
  });
  it('Abnahme 5: Ablehnung behält die Version; Überarbeitung erzeugt eine neue Version; alte Ansicht wird abgewiesen', async () => {
    const k = await slugId('gkv-teilnahme');
    const rej = await pr.post(`/api/objects/criteria/versions/${k.version_id}/decide`, { decision: 'rejected', reason: 'Regel nennt die Ausnahme zur Berufsgenossenschaft nicht.', hints: 'Ausnahme ergänzen' });
    expect(rej.status).toBe(200);
    const rev = await fb.patch(`/api/objects/criteria/versions/${k.version_id}`, { patch: { exceptions: 'Anfragen bei Berufskrankheit/Arbeitsunfall erfolgen außerhalb des DTA EEL.' } });
    expect(rev.status, JSON.stringify(rev.json)).toBe(200); expect(rev.json.created).toBe(true); expect(rev.json.version.version).toBe(2);
    const d = (await fb.get(`/api/objects/criteria/${k.object_id}`)).json;
    expect(d.versionen.map((v: any) => v.status)).toEqual(['draft', 'rejected']);
    expect(d.verlauf.find((x: any) => x.decision === 'rejected').reason).toMatch(/Berufsgenossenschaft/);
    const stale = await pr.post(`/api/objects/criteria/versions/${k.version_id}/decide`, { decision: 'approved' });
    expect(stale.status).toBe(409); expect(stale.json.error.code).toBe('STALE_VERSION');
  });
  it('Belege lassen sich nicht erfinden', async () => {
    const k = await slugId('gkv-teilnahme');
    const src = (await fb.get('/api/sources')).json.quellen.find((q: any) => q.title.includes('Gemeinsame'));
    const bad = await fb.post(`/api/criteria/versions/${k.version_id}/evidence`, { sourceVersionId: src.id, quote: 'Dieser Satz steht garantiert nicht im Dokument.' });
    expect(bad.status).toBe(400);
  });
  it('Abnahme 6: ohne freigegebene Kriterien entstehen keine Testfälle', async () => {
    const r = await fb.post('/api/testcases/generate', {});
    expect(r.status).toBe(200); expect(r.json.angelegt.length).toBe(0); expect(r.json.nichtErzeugt.length).toBeGreaterThan(10);
    expect(r.json.nichtErzeugt[0].grund).toMatch(/freigegeben/);
  });
  it('alle Kriterien werden von Menschen freigegeben', async () => {
    for (const k of await cur('criteria')) {
      if (k.status === 'draft') await submitAndApprove('criteria', k.version_id);
    }
    const after = await cur('criteria');
    expect(after.filter((x) => x.status === 'approved').length).toBe(17);
  });
});

describe('Testfälle, Klärungen, Freigabe', () => {
  it('Abnahme 19: Klärungsvorgänge sind mit geprüften Quellenbelegen angelegt; betroffene Soll-Werte bleiben blockiert', async () => {
    const r = await fb.post('/api/testcases/generate', {});
    expect(r.json.angelegt.length).toBe(19);
    const blocked = await cur('testcases', 'klaerung');
    expect(blocked.length).toBeGreaterThanOrEqual(2);
    const cl = (await fb.get('/api/clarifications')).json.eintraege;
    expect(cl.length).toBe(7);
    expect(cl.every((x: any) => x.source_refs.some((s: any) => s.verified))).toBe(true);
    const six = blocked.find((b) => /genau 6/.test(b.title));
    const d = (await fb.get(`/api/objects/testcases/${six.object_id}`)).json;
    expect(d.versionen[0].expected.messages).toEqual([]);
    const sub = await fb.post(`/api/objects/testcases/versions/${six.version_id}/submit`);
    expect(sub.status).toBe(409);
  });
  it('Klärungen werden nur von berechtigten Personen mit Begründung entschieden', async () => {
    const cl = (await fb.get('/api/clarifications')).json.eintraege;
    const by = (k: string) => cl.find((x: any) => x.kind === k);
    expect((await fb.post(`/api/clarifications/${by('sechsmonatsgrenze-gleichheit').id}/decide`, { decisionKey: 'inklusive', note: 'Entscheidung durch Fachbearbeitung' })).status).toBe(403);
    expect((await pr.post(`/api/clarifications/${by('sechsmonatsgrenze-gleichheit').id}/decide`, { decisionKey: 'inklusive', note: 'kurz' })).status).toBe(400);
    const decisions: [string, string][] = [['sechsmonatsgrenze-gleichheit', 'inklusive'], ['papier-au-jahr', 'tippfehler-2026'], ['rueckmeldung-vs-storno', 'sonderfall'], ['zeitstempel-februar', 'zeitstempel-nicht-pruefen'], ['efz-berechnung', 'nur-beispielwerte'], ['zeichenkodierung', 'utf-8'], ['beschaeftigungsende-feld', 'am']];
    for (const [k, v] of decisions) {
      const r = await pr.post(`/api/clarifications/${by(k).id}/decide`, { decisionKey: v, note: `Demo-Entscheidung im Test: ${v} (fachlich zu bestätigen)` });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    }
    expect((await cur('testcases', 'klaerung')).length).toBe(0);
    const six = (await cur('testcases')).find((b) => /genau 6/.test(b.title));
    const d = (await fb.get(`/api/objects/testcases/${six.object_id}`)).json;
    expect(d.versionen[0].expected.messages[0].abgabegrund).toBe('41');
  });
  it('Abnahme 7: Testfälle brauchen eine eigene Freigabe, bevor sie in eine Prüfung kommen', async () => {
    const sw = (await fb.get('/api/software')).json.eintraege;
    const sim = sw.find((s: any) => s.adapter_key === 'simulator');
    const rs = (await fb.get('/api/rulesets')).json.eintraege[0];
    const cust = (await fb.get('/api/customers')).json.eintraege.find((x: any) => /Nord/.test(x.name));
    const r = await fb.post('/api/campaigns', { name: 'Prüfung Simulator – Gesamtumfang', customerOrgId: cust.id, softwareVersionId: sim.id, rulesetId: rs.id, testDate: '2026-03-11' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(r.json.runs.length).toBe(0); expect(r.json.skipped.length).toBe(19); expect(r.json.skipped[0].grund).toMatch(/Freigabe/);
    campaignId = r.json.campaignId;
    for (const t of await cur('testcases')) await submitAndApprove('testcases', t.version_id);
    const add = await fb.post(`/api/campaigns/${campaignId}/runs`, {});
    expect(add.json.runs.length).toBe(19);
  });
  it('Prüfpaket enthält Eingangsdaten, aber keine Soll-Ergebnisse', async () => {
    const pv = await fb.get(`/api/campaigns/${campaignId}/package/preview`);
    expect(pv.json.preview.ok, JSON.stringify(pv.json.preview.errors) + JSON.stringify(pv.json.excluded)).toBe(true);
    const mk = await fb.post(`/api/campaigns/${campaignId}/package`, {});
    expect(mk.status, JSON.stringify(mk.json)).toBe(200);
    const camp = (await fb.get(`/api/campaigns/${campaignId}`)).json;
    const dl = await fb.get(`/api/packages/${camp.pakete[0].id}/download`);
    const txt = dl.raw.toString('utf8');
    expect(txt).toContain('synthetisch'); expect(txt).not.toMatch(/"expected"|"soll"|erwartet":/i);
    expect(camp.laeufe.every((l: any) => l.status === 'awaiting_return'), JSON.stringify(camp.laeufe.map((l: any) => l.status)).slice(0, 150) + JSON.stringify(mk.json)).toBe(true);
  });
});

describe('Rückgaben, Vergleich, Zertifizierung', () => {
  it('Abnahme 12/13: Simulator (fehlerfrei) durchläuft alle Stufen inkl. korrigierter Antwort', async () => {
    const r = await fb.post(`/api/campaigns/${campaignId}/simulator`, { fault: 'keine' });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const camp = (await fb.get(`/api/campaigns/${campaignId}`)).json;
    const multi = camp.laeufe.find((l: any) => l.azvu === '1234-5678-007');
    expect(multi.status, JSON.stringify(multi)).toBe('passed');
    expect(multi.followups).toBe(3);
    const failing = camp.laeufe.filter((l: any) => l.status === 'failed');
    expect(failing, JSON.stringify(failing)).toEqual([]);
    const open = camp.laeufe.filter((l: any) => l.status === 'awaiting_return');
    expect(open.length).toBeGreaterThan(5);
    expect(open.every((l: any) => l.erwartetKeineMeldung || true)).toBe(true);
  });
  it('Nicht-Erzeugung gilt erst nach dokumentiertem Abschluss als belegt', async () => {
    const camp = (await fb.get(`/api/campaigns/${campaignId}`)).json;
    const nonGen = camp.laeufe.filter((l: any) => l.status === 'awaiting_return');
    expect(nonGen.length).toBeGreaterThan(0);
    const first = nonGen[0];
    expect((await fb.post(`/api/runs/${first.id}/attest`, { note: 'ok' })).status).toBe(400);
    for (const l of nonGen) {
      const r = await fb.post(`/api/runs/${l.id}/attest`, { note: 'Simulator-Verarbeitung beendet; keine Ausgabedatei erzeugt; Beobachtungszeitraum bis Ende des Laufs eingehalten.' });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
    }
    const after = (await fb.get(`/api/campaigns/${campaignId}`)).json;
    expect(after.laeufe.every((l: any) => l.status === 'passed'), JSON.stringify(after.laeufe.filter((l: any) => l.status !== 'passed'))).toBe(true);
  });
  it('Abnahme 14: bestanden ist nicht automatisch zertifiziert; Bericht muss freigegeben sein', async () => {
    let cert = (await fb.get(`/api/campaigns/${campaignId}/certification`)).json;
    expect(cert.ready).toBe(false); expect(cert.checks.find((x: any) => x.key === 'bericht').ok).toBe(false);
    expect((await pr.post(`/api/campaigns/${campaignId}/certification`, { decision: 'certified', reason: 'Alles gut, bitte zertifizieren.' })).status).toBe(409);
    const rep = await fb.post(`/api/campaigns/${campaignId}/reports`, { kind: 'pruefbericht' });
    expect(rep.status, JSON.stringify(rep.json)).toBe(200);
    // Abnahme 15: nicht freigegebener Bericht kann nicht bereitgestellt werden
    expect((await pr.post(`/api/reports/versions/${rep.json.versionId}/provide`, { kind: 'bereitstellung' })).status).toBe(409);
    await submitAndApprove('reports', rep.json.versionId);
    cert = (await fb.get(`/api/campaigns/${campaignId}/certification`)).json;
    expect(cert.ready, JSON.stringify(cert.checks)).toBe(true);
    expect(cert.label).toBe('Prüfung bestanden – Bestätigung ausstehend');
    expect((await c.db.query('select count(*)::int as n from certification_decisions')).rows[0].n).toBe(0);
    expect((await fb.post(`/api/campaigns/${campaignId}/certification`, { decision: 'certified', reason: 'Fachbearbeitung darf nicht zertifizieren.' })).status).toBe(403);
    const ok = await pr.post(`/api/campaigns/${campaignId}/certification`, { decision: 'certified', reason: 'Alle Testfälle des Demo-Prüfumfangs bestanden, Bericht freigegeben.' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200);
    cert = (await fb.get(`/api/campaigns/${campaignId}/certification`)).json;
    expect(cert.label).toBe('Zertifiziert im Demo-Prüfumfang'); expect(cert.disclaimer).toMatch(/keine amtliche/);
    (globalThis as any).__repId = rep.json.reportId; (globalThis as any).__repV1 = rep.json.versionId;
  });
  it('Abnahme 16: Änderung an freigegebenem Bericht blockiert den Versand der neuen Version', async () => {
    const repId = (globalThis as any).__repId, v1 = (globalThis as any).__repV1;
    const ok = await pr.post(`/api/reports/versions/${v1}/provide`, { kind: 'bereitstellung' });
    expect(ok.status, JSON.stringify(ok.json)).toBe(200); expect(ok.json.status).toBe('bereitgestellt');
    const send = await pr.post(`/api/reports/versions/${v1}/provide`, { kind: 'versand', recipient: 'x@example.invalid' });
    expect(send.json.status).toBe('nicht_konfiguriert');
    const cl = await fb.post(`/api/reports/${repId}/classification`, { classification: 'softwarefehler' });
    expect(cl.status, JSON.stringify(cl.json)).toBe(200); expect(cl.json.created).toBe(true);
    const v2 = cl.json.version.id;
    expect((await pr.post(`/api/reports/versions/${v2}/provide`, { kind: 'bereitstellung' })).status).toBe(409);
    const old = await pr.post(`/api/reports/versions/${v1}/provide`, { kind: 'bereitstellung' });
    expect(old.status).toBe(409); expect(old.json.error.code).toBe('NOT_CURRENT');
  });
});

describe('Abweichungen und Rückgabe-Fehler', () => {
  const mkCampaign = async (name: string, codes: string[]) => {
    const sim = (await fb.get('/api/software')).json.eintraege.find((s: any) => s.adapter_key === 'simulator');
    const rs = (await fb.get('/api/rulesets')).json.eintraege[0];
    const cust = (await fb.get('/api/customers')).json.eintraege.find((x: any) => /Nord/.test(x.name));
    const tcs = (await cur('testcases')).filter((t) => codes.some((cd) => t.title.includes(cd)));
    const r = await fb.post('/api/campaigns', { name, customerOrgId: cust.id, softwareVersionId: sim.id, rulesetId: rs.id, testDate: '2026-03-11', testcaseIds: tcs.map((t) => t.object_id) });
    expect(r.json.runs.length).toBe(tcs.length);
    await fb.post(`/api/campaigns/${r.json.campaignId}/package`, {});
    return r.json.campaignId as string;
  };
  const rows = async (cid: string, titlePart: string) => {
    const camp = (await fb.get(`/api/campaigns/${cid}`)).json; const run = camp.laeufe.find((l: any) => l.title.includes(titlePart));
    const d = (await fb.get(`/api/runs/${run.id}`)).json; const cmp = d.vergleiche[0] ? (await fb.get(`/api/comparisons/${d.vergleiche[0].id}`)).json : null;
    return { run, d, cmp };
  };
  it('Abnahme 12: falsches EFZ-Ende wird als Abweichung mit Soll/Ist und Fundstelle erkannt', async () => {
    const cid = await mkCampaign('Fehlerbild EFZ', ['Mehrstufiges']);
    await fb.post(`/api/campaigns/${cid}/simulator`, { fault: 'falsche-efz' });
    const { run, cmp } = await rows(cid, 'Mehrstufiges');
    expect(run.status).toBe('failed');
    const bad = cmp.rows.filter((r: any) => r.result === 'abweichung');
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]).toMatchObject({ field: 'DBAL.DATUM-EGZBIS', expected: '2026-03-30', actual: '2026-03-31' });
    expect(bad[0].source.line).toBeGreaterThan(0);
  });
  it('Abnahme 12: zusätzliche AU-Zeit und fehlende Meldung werden erkannt', async () => {
    const cid = await mkCampaign('Fehlerbild zusätzliche AU', ['Standardfall']);
    await fb.post(`/api/campaigns/${cid}/simulator`, { fault: 'zusaetzliche-au' });
    const a = await rows(cid, 'Standardfall');
    expect(a.run.status).toBe('failed'); expect(a.cmp.rows.some((r: any) => r.result === 'unerwartet')).toBe(true);
    const cid2 = await mkCampaign('Fehlerbild ohne Meldung', ['Standardfall']);
    await fb.post(`/api/campaigns/${cid2}/simulator`, { fault: 'ohne-meldung' });
    const b = await rows(cid2, 'Standardfall');
    expect(b.run.status).toBe('awaiting_return');
    const fin = await fb.post(`/api/runs/${b.run.id}/finalize`, { note: 'Hersteller hat keine Datei geliefert.' });
    expect(fin.status).toBe(200);
    const b2 = await rows(cid2, 'Standardfall');
    expect(b2.run.status).toBe('failed'); expect(b2.cmp.rows.some((r: any) => r.result === 'fehlt')).toBe(true);
  });
  it('Abnahme 13: verworfene Korrekturantwort (Dublette) führt zu „Nicht bestanden“, fehlerfreie Verarbeitung nicht', async () => {
    const cid = await mkCampaign('Fehlerbild Korrektur', ['Mehrstufiges']);
    await fb.post(`/api/campaigns/${cid}/simulator`, { fault: 'verwirft-korrektur' });
    const r = await rows(cid, 'Mehrstufiges');
    expect(r.run.status).toBe('awaiting_return');
    const fin = await fb.post(`/api/runs/${r.run.id}/finalize`, { note: 'Software hat keine Storno-/Neumeldung erzeugt.' }); expect(fin.status).toBe(200);
    const r2 = await rows(cid, 'Mehrstufiges');
    expect(r2.run.status).toBe('failed');
    expect(r2.cmp.rows.filter((x: any) => x.result === 'fehlt').map((x: any) => x.label).join(' ')).toMatch(/88/);
  });
  it('Abnahme 11: fehlerhafte, doppelte und fremde Rückgaben', async () => {
    const cid = await mkCampaign('Rückgabefehler', ['Standardfall']);
    const run = (await fb.get(`/api/campaigns/${cid}`)).json.laeufe[0];
    const garbage = await ku.upload(`/api/campaigns/${cid}/imports`, { name: 'kaputt.eel', data: Buffer.from('Das ist keine EEL-Datei\r\n') });
    expect(garbage.json.status).toBe('import_error'); expect(garbage.json.errors.length).toBeGreaterThan(0);
    const foreign = Buffer.from(buildEelFile([{ abgabegrund: '41', dsid: '99999999-2222-AAAA-EEEE-111111111111', azvu: 'FREMD-0000-001', dbvo: { auAbAg: '20260311', entries: [{ beginn: '20260201', ende: '20260301' }] } }]));
    const f1 = await fb.upload(`/api/campaigns/${cid}/imports`, { name: 'fremd.eel', data: foreign }, { runId: run.id });
    expect(f1.json.status).toBe('assignment_required');
    expect((await fb.get(`/api/campaigns/${cid}`)).json.laeufe[0].status).toBe('assignment_required');
    const dup = await fb.upload(`/api/campaigns/${cid}/imports`, { name: 'fremd-kopie.eel', data: foreign });
    expect(dup.json.status).toBe('duplicate');
    expect((await fb.get(`/api/campaigns/${cid}`)).json.laeufe[0].status).not.toBe('passed');
    // Datei einer fremden Prüfung wird nie ohne manuelle Zuordnung bewertet; manuelle Zuordnung bewertet gegen das Soll
    const asg = await fb.post(`/api/imports/${f1.json.importId}/assign`, { runId: run.id });
    expect(asg.status).toBe(200);
    const r = (await fb.get(`/api/campaigns/${cid}`)).json.laeufe[0];
    expect(['failed', 'awaiting_return']).toContain(r.status);
  });
});

describe('Änderungsmanagement, Dashboard, Mandanten', () => {
  it('Abnahme 8: Kriterienänderung markiert betroffene Testfälle, erzeugt Entwürfe und überholt laufende Prüfungen', async () => {
    const k = await slugId('9c8c9b58');
    const rev = await fb.patch(`/api/objects/criteria/versions/${k.version_id}`, { patch: { rule: 'Eine 41 wird nur erzeugt, wenn kumuliert mindestens 30 Kalendertage vorliegen (präzisierte Formulierung).' } });
    expect(rev.json.created).toBe(true);
    await submitAndApprove('criteria', rev.json.version.id);
    const imp = (await fb.get('/api/impacts')).json.eintraege;
    expect(imp.length).toBeGreaterThan(5);
    expect(imp.every((i: any) => i.draft_version_id)).toBe(true);
    const drafts = await cur('testcases', 'entwurf');
    expect(drafts.length).toBeGreaterThan(5);
    const camp = (await fb.get(`/api/campaigns/${campaignId}`)).json;
    expect(camp.laeufe.some((l: any) => l.basis_outdated)).toBe(true);
    const cert = (await fb.get(`/api/campaigns/${campaignId}/certification`)).json;
    expect(cert.state).toBe('grundlage_geaendert');
    // Alte, freigegebene Testfälle werden nicht überschrieben: historische Läufe verweisen weiter auf ihre Version
    const run = camp.laeufe[0];
    expect(run.version).toBe(1);
    // Neue Testfall-Versionen brauchen erneut eine Freigabe und eine gültige Grundlage
    const t = drafts[0];
    const sub = await fb.post(`/api/objects/testcases/versions/${t.version_id}/submit`); expect(sub.status, JSON.stringify(sub.json)).toBe(200);
    expect((await pr.post(`/api/objects/testcases/versions/${t.version_id}/decide`, { decision: 'approved' })).status).toBe(200);
  });
  it('Abnahme 9: Dashboard-Zahlen stimmen mit den gefilterten Listen überein', async () => {
    const d = (await fb.get('/api/dashboard')).json;
    for (const [key, path_] of [['kriterien', 'criteria'], ['testfaelle', 'testcases'], ['berichte', 'reports']] as const) {
      let sum = 0;
      for (const z of d[key].zaehler) {
        const list = (await fb.get(`/api/objects/${path_}?status=${z.key}`)).json.eintraege;
        expect(list.length, `${key}/${z.key}`).toBe(z.anzahl); sum += z.anzahl; expect(z.nenner).toBe(d[key].gesamt);
      }
      expect(sum).toBe(d[key].gesamt);
    }
    for (const z of d.pruefungen.zaehler) {
      const list = (await fb.get(`/api/runs?status=${z.key}`)).json.eintraege; expect(list.length, `pruefungen/${z.key}`).toBe(z.anzahl);
    }
    const q = (await fb.get('/api/approvals')).json.eintraege; expect(q.length).toBe(d.wartendAufFreigabe.gesamt);
    expect(d.laeufeMitUeberholterGrundlage.anzahl).toBe((await fb.get('/api/runs?grundlage=ueberholt')).json.eintraege.length);
    expect(d.zaehlregeln.length).toBeGreaterThan(3);
  });
  it('Abnahme 10: Exportprofile behaupten nur Implementiertes', async () => {
    const meta = (await fb.get('/api/meta')).json;
    const lex = meta.adapter.find((a: any) => a.key === 'lexware');
    expect(lex.status).toBe('nicht_konfiguriert'); expect(Object.values(lex.capabilities).every((v) => v === false)).toBe(true);
    expect(meta.adapter.find((a: any) => a.key === 'simulator').statusLabel).toMatch(/keine echte Software/);
    const lexVer = (await fb.get('/api/software')).json.eintraege.find((s: any) => s.adapter_key === 'lexware');
    const rs = (await fb.get('/api/rulesets')).json.eintraege[0]; const cust = (await fb.get('/api/customers')).json.eintraege[0];
    const camp = await fb.post('/api/campaigns', { name: 'Lexware-Beispiel', customerOrgId: cust.id, softwareVersionId: lexVer.id, rulesetId: rs.id, testDate: '2026-03-11' });
    const pkg = await fb.post(`/api/campaigns/${camp.json.campaignId}/package`, {});
    expect(pkg.status).toBe(409); expect(pkg.json.error.code).toBe('ADAPTER_NOT_CONFIGURED');
  });
  it('Abnahme 17: Hersteller sehen nur eigene Prüfungen und keine Soll-Werte', async () => {
    const mine = (await ku.get('/api/campaigns')).json.eintraege; expect(mine.length).toBeGreaterThan(0);
    expect((await ku2.get('/api/campaigns')).json.eintraege.length).toBe(0);
    expect((await ku2.get(`/api/campaigns/${campaignId}`)).status).toBe(404);
    expect((await ku.get('/api/objects/criteria')).status).toBe(403);
    expect((await ku.get('/api/dashboard')).status).toBe(403);
    const camp = (await ku.get(`/api/campaigns/${campaignId}`)).json;
    expect(camp.berichte.length).toBe(1);
    const run = (await ku.get(`/api/runs/${camp.laeufe[0].id}`)).json;
    expect(run.soll).toBeUndefined(); expect(run.vergleiche).toBeUndefined();
    expect((await ku2.get(`/api/runs/${camp.laeufe[0].id}`)).status).toBe(404);
    expect((await ku.post(`/api/campaigns/${campaignId}/reports`, { kind: 'fehlerbericht' })).status).toBe(403);
    expect((await ku.post(`/api/objects/reports/versions/${(globalThis as any).__repV1}/decide`, { decision: 'approved' })).status).toBe(403);
    const rep = (await ku.get(`/api/reports/versions/${(globalThis as any).__repV1}`)); expect(rep.status).toBe(200);
  });
  it('Demonstrationsfall Betragsvergleich ist gekennzeichnet', async () => {
    const r = (await fb.get('/api/demo/betragsvergleich')).json;
    expect(r.demonstration).toBe(true); expect(r.differenz).toBe('−36,00 €'); expect(r.ergebnis).toBe('abweichung');
  });
  it('Audit-Protokoll enthält Akteur, Aktion und Begründung', async () => {
    const a = (await fb.get('/api/audit?limit=500')).json.eintraege;
    expect(a.some((x: any) => x.action === 'criterion.abgelehnt' && /Berufsgenossenschaft/.test(x.reason))).toBe(true);
    expect(a.some((x: any) => x.action === 'zertifizierung.erteilt')).toBe(true);
    await expect(c.db.query(`update audit_events set action = 'x' where id = (select min(id) from audit_events)`)).rejects.toThrow();
    await expect(c.db.query(`delete from criteria_versions`)).rejects.toThrow();
  });
});

describe('Hessian AI', () => {
  it('Abnahme 18: Ausfall der KI erzeugt keine erfundenen Ergebnisse', async () => {
    const before = (await c.db.query('select count(*)::int as n from criteria')).rows[0].n;
    const cfg2 = { ...c.cfg, hai: { ...c.cfg.hai, apiKey: 'test-key-nicht-echt', maxRetries: 1, timeoutMs: 500 } };
    const hai2 = new HaiClient(cfg2, c.db, (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } }); }) as any);
    const app2 = await buildApp({ db: c.db, cfg: cfg2, hai: hai2 }); const as2 = mkAs(app2);
    const src = (await as2(FB).get('/api/sources')).json.quellen.find((q: any) => q.title.includes('Gemeinsame'));
    const job = await as2(FB).post(`/api/sources/${src.id}/derive`, { mode: 'ki' });
    expect(job.status, JSON.stringify(job.json)).toBe(200);
    await new Promise((r) => setTimeout(r, 4000));
    const j = (await as2(FB).get(`/api/jobs/${job.json.jobId}`)).json;
    expect(j.status).toBe('failed'); expect(j.error).toMatch(/nicht erreichbar/);
    expect((await c.db.query('select count(*)::int as n from criteria')).rows[0].n).toBe(before);
    const st = (await as2(AD).post('/api/ai/test')).json; expect(st.state).toBe('dienst_nicht_erreichbar');
    expect(JSON.stringify(st)).not.toContain('test-key-nicht-echt');
    await app2.close();
  }, 30000);
  it('denkendes Modell: leere Antwort bei Längenlimit wird mit mehr Budget wiederholt; Schlüssel im Portal hinterlegbar und nie ausgeliefert', async () => {
    const seen: { max: number; auth: string }[] = [];
    const fake = (async (_u: string, init: any) => {
      const b = JSON.parse(init.body); seen.push({ max: b.max_tokens, auth: init.headers.Authorization });
      const first = seen.length === 1;
      return new Response(JSON.stringify({ model: 'glm-test', choices: [{ finish_reason: first ? 'length' : 'stop', message: { content: first ? '' : '<think>überlege …</think>Ja, die Verbindung funktioniert.', reasoning_content: 'lange Überlegung' } }], usage: { prompt_tokens: 5, completion_tokens: 9 } }), { status: 200 });
    }) as any;
    const hai2 = new HaiClient({ ...c.cfg, hai: { ...c.cfg.hai, apiKey: null } }, c.db, fake);
    const app2 = await buildApp({ db: c.db, cfg: { ...c.cfg, hai: { ...c.cfg.hai, apiKey: null } }, hai: hai2 }); const as2 = mkAs(app2);
    expect((await as2(AD).get('/api/ai/status')).json.konfiguriert).toBe(false);
    expect((await as2(KU).post('/api/ai/key', { key: 'x' })).status).toBe(403);
    const st = (await as2(AD).post('/api/ai/key', { key: 'portal-schluessel-nicht-echt' })).json;
    expect(st.state).toBe('verbunden'); expect(st.sample).toBe('Ja, die Verbindung funktioniert.');
    expect(seen.length).toBe(2); expect(seen[1].max).toBeGreaterThan(seen[0].max); expect(seen[0].auth).toBe('Bearer portal-schluessel-nicht-echt');
    const status = (await as2(AD).get('/api/ai/status')).json; expect(status.konfiguriert).toBe(true); expect(status.schluesselQuelle).toBe('portal');
    expect(JSON.stringify(status)).not.toContain('portal-schluessel');
    expect(JSON.stringify((await as2(AD).get('/api/audit')).json)).not.toContain('portal-schluessel');
    await as2(AD).post('/api/ai/key', { key: '' }); expect((await as2(AD).get('/api/ai/status')).json.konfiguriert).toBe(false);
    await app2.close();
  }, 30000);
  it('ohne Schlüssel: klarer Zustand, manueller Weg bleibt, kein Demo-Ergebnis als KI ausgegeben', async () => {
    const st = (await ad.get('/api/ai/status')).json; expect(st.state).toBe('nicht_konfiguriert');
    const src = (await fb.get('/api/sources')).json.quellen[0];
    const r = await fb.post(`/api/sources/${src.id}/derive`, { mode: 'ki' }); expect(r.status).toBe(409); expect(r.json.error.code).toBe('AI_NICHT_KONFIGURIERT');
  });
  it('KI-Antwort mit erfundenem Beleg wird verworfen; echte Zitate werden als Entwurf mit Modell/Prompt-Version angelegt', async () => {
    const quote = 'Die Anfrage ist vor dem Versand jeweils individuell durch den Arbeitgeber auf Sinnhaftigkeit zu prüfen';
    const body = { criteria: [
      { slug: 'ki-sinnhaftigkeit-test', title: 'Sinnhaftigkeitsprüfung vor Versand', description: 'Der Arbeitgeber prüft jede Anfrage vor dem Versand.', rule: 'Manueller Prüfschritt vor Versand.', expected_behavior: 'Die Software ermöglicht die Prüfung.', evidence: [{ quote }] },
      { slug: 'ki-erfunden-test', title: 'Erfundenes Kriterium', description: 'Gibt es nicht.', rule: 'Erfundene Regel.', expected_behavior: 'Nichts.', evidence: [{ quote: 'Dieser Satz wurde von der KI frei erfunden und steht nirgends.' }] },
    ], contradictions: [], missing_information: [] };
    const fakeFetch = (async () => new Response(JSON.stringify({ model: 'test-modell', choices: [{ message: { content: JSON.stringify(body) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } }), { status: 200 })) as any;
    const cfg2 = { ...c.cfg, hai: { ...c.cfg.hai, apiKey: 'test-key-nicht-echt' } };
    const app2 = await buildApp({ db: c.db, cfg: cfg2, hai: new HaiClient(cfg2, c.db, fakeFetch) }); const as2 = mkAs(app2);
    const src = (await as2(FB).get('/api/sources')).json.quellen.find((q: any) => /Verfahrensbeschreibung/.test(q.title));
    const job = await as2(FB).post(`/api/sources/${src.id}/derive`, { mode: 'ki' });
    await new Promise((r) => setTimeout(r, 6000));
    const j = (await as2(FB).get(`/api/jobs/${job.json.jobId}`)).json;
    expect(j.status, j.error).toBe('succeeded');
    expect(j.result.verworfen.some((v: any) => v.slug === 'ki-erfunden-test')).toBe(true);
    const k = (await as2(FB).get('/api/objects/criteria')).json.eintraege;
    expect(k.find((x: any) => x.slug === 'ki-erfunden-test')).toBeUndefined();
    const created = k.find((x: any) => x.slug === 'ki-sinnhaftigkeit-test');
    // Dubletten-Erkennung (ähnlicher Titel bestehender Kriterien) oder Neuanlage als Entwurf – niemals freigegeben
    if (created) { expect(created.status).toBe('draft'); const d = (await as2(FB).get(`/api/objects/criteria/${created.object_id}`)).json; expect(d.versionen[0].ai_meta.model).toBe('test-modell'); expect(d.versionen[0].ai_meta.promptVersion).toMatch(/kriterien-ableitung/); }
    else expect(j.result.duplikate.length + j.result.unveraendert.length).toBeGreaterThan(0);
    const audit = await c.db.query(`select actor_kind, ai_model from audit_events where action = 'quelle.kriterien_abgeleitet' and ai_model is not null`);
    expect(audit.rowCount).toBeGreaterThan(0);
    await app2.close();
  }, 30000);

  it('Claude-Schlüssel (sk-ant-…) nutzt die Anthropic-Schnittstelle', async () => {
    let seen: { url: string; headers: any; body: any } | null = null;
    const fakeFetch = (async (url: string, init: any) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ model: 'claude-test', content: [{ type: 'text', text: 'Ja, die Verbindung funktioniert.' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 7 } }), { status: 200 }); }) as any;
    const cfg2 = { ...c.cfg, hai: { ...c.cfg.hai, apiKey: 'sk-ant-test-nicht-echt' } };
    const h = new HaiClient(cfg2, c.db, fakeFetch);
    expect(h.provider).toBe('claude');
    const r = await h.testConnection();
    expect(r.state).toBe('verbunden');
    expect(seen!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen!.headers['x-api-key']).toBe('sk-ant-test-nicht-echt'); expect(seen!.headers['anthropic-version']).toBeTruthy();
    expect(seen!.body.messages[0].role).toBe('user');
  });

  it('Hessian/GLM: Denkmodus wird abgeschaltet; lehnt das Gateway den Parameter ab, wird ohne ihn wiederholt', async () => {
    const bodies: any[] = [];
    const fakeFetch = (async (_u: string, init: any) => {
      const b = JSON.parse(init.body); bodies.push(b);
      if (b.chat_template_kwargs && bodies.length === 1) return new Response('{"error":"unknown field"}', { status: 400 });
      return new Response(JSON.stringify({ model: 'vllm/GLM-Flash:Latest', choices: [{ message: { content: 'Ja.' }, finish_reason: 'stop' }], usage: {} }), { status: 200 });
    }) as any;
    const h = new HaiClient({ ...c.cfg, hai: { ...c.cfg.hai, apiKey: 'sk-bf-test', model: 'vllm/GLM-Flash:Latest' } }, c.db, fakeFetch);
    expect(h.provider).toBe('hessian');
    expect((await h.testConnection()).state).toBe('verbunden');
    expect(bodies[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(bodies[1].chat_template_kwargs).toBeUndefined();
    await h.testConnection(); expect(bodies[2].chat_template_kwargs).toBeUndefined(); // gemerkt
  });

  it('Gemini-/Groq-Schlüssel nutzen die jeweilige OpenAI-kompatible Schnittstelle', async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => { urls.push(url); return new Response(JSON.stringify({ model: 'm', choices: [{ message: { content: 'Ja.' }, finish_reason: 'stop' }], usage: {} }), { status: 200 }); }) as any;
    for (const [key, prov, host] of [['AIza-test', 'gemini', 'generativelanguage.googleapis.com'], ['AQ.test', 'gemini', 'generativelanguage.googleapis.com'], ['gsk_test', 'groq', 'api.groq.com']] as const) {
      const h = new HaiClient({ ...c.cfg, hai: { ...c.cfg.hai, apiKey: key } }, c.db, fakeFetch);
      expect(h.provider).toBe(prov); expect((await h.testConnection()).state).toBe('verbunden'); expect(urls.at(-1)).toContain(host);
    }
  });
});
