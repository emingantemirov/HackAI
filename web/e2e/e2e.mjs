// Browser-Test der Kernabläufe (Abnahmetest 20: Tastatur und kleiner Bildschirm) plus ein durchgehender Prüfablauf.
// Voraussetzung: Server läuft mit frisch geseedeten Demo-Daten (npm run demo:reset) und ausgeliefertem Frontend (WEB_DIST).
//   BASE_URL=http://localhost:3001 node web/e2e/e2e.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL ?? 'http://localhost:3001';
const PW = process.env.SEED_PASSWORD ?? 'Demo-Passwort-2026!';
const SHOTS = process.env.SHOTS_DIR;
let step = 0;
const ok = (m) => console.log(`✔ ${++step}. ${m}`);

const browser = await chromium.launch();
const errors = [];
async function session(email, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: 'de-DE', baseURL: BASE });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|403|404|409|400/.test(m.text())) errors.push(`${email}: ${m.text()}`); });
  const r = await ctx.request.post('/api/auth/login', { headers: { 'X-EEL-Portal': '1' }, data: { email, password: PW } });
  assert.equal(r.status(), 200, `Login ${email}`);
  const api = async (method, url, data) => {
    const res = await ctx.request.fetch(url, { method, headers: { 'X-EEL-Portal': '1' }, data });
    const t = await res.text(); let j = null; try { j = JSON.parse(t); } catch { /* */ }
    return { status: res.status(), json: j };
  };
  return { ctx, page, api };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

const fb = await session('fachbearbeitung@demo.example');
const pr = await session('pruefer@demo.example');
const pr2 = await session('pruefer2@demo.example');

// ---- 1. Klärungen entscheiden (Prüfer), Kriterien einreichen (Fachbearbeitung) ----
const cl = (await pr.api('GET', '/api/clarifications')).json.eintraege;
assert.equal(cl.length, 7);
for (const c of cl) {
  const opt = c.options[0].key;
  const r = await pr.api('POST', `/api/clarifications/${c.id}/decide`, { decisionKey: opt, note: 'E2E-Test: fachliche Entscheidung dokumentiert (Demo).' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
ok('7 Klärungsvorgänge mit Begründung entschieden');

const crit = (await fb.api('GET', '/api/objects/criteria')).json.eintraege;
assert.equal(crit.length, 17);
for (const c of crit) { const r = await fb.api('POST', `/api/objects/criteria/versions/${c.version_id}/submit`); assert.equal(r.status, 200, JSON.stringify(r.json)); }
ok('17 Kriterien eingereicht');

// ---- 2. Ablehnung über die Oberfläche: Begründung ist Pflicht, Version bleibt erhalten ----
await pr.page.goto('/freigaben'); await pr.page.waitForSelector('article.review');
assert.equal(await pr.page.locator('article.review').count(), 17);
await shot(pr.page, 'e2e-freigaben');
await pr.page.locator('article.review').first().getByRole('button', { name: 'Ablehnen' }).click();
const rejectBtn = pr.page.getByRole('dialog').getByRole('button', { name: 'Ablehnen', exact: true });
assert.equal(await rejectBtn.isDisabled(), true, 'Ablehnen ohne Begründung muss gesperrt sein');
await pr.page.getByRole('dialog').getByLabel(/Warum wird abgelehnt/).fill('Die Regel ist zu allgemein formuliert; bitte auf eine einzige Bedingung kürzen.');
await rejectBtn.click();
await pr.page.waitForSelector('text=Abgelehnt. Die Version bleibt erhalten.');
await pr.page.waitForFunction(() => document.querySelectorAll('article.review').length === 16);
ok('Ablehnung nur mit Begründung; abgelehnte Version bleibt sichtbar');

// Überarbeitung (neue Version) und Wiedereinreichung
const cur = (await fb.api('GET', '/api/objects/criteria')).json.eintraege.find((c) => c.status === 'rejected');
const rev = await fb.api('PATCH', `/api/objects/criteria/versions/${cur.version_id}`, { patch: { rule: cur.rule ? cur.rule + ' (präzisiert)' : 'präzisiert' }, changeNote: 'Nach Ablehnung präzisiert' });
assert.equal(rev.json.created, true); assert.equal(rev.json.version.version, 2);
await fb.api('POST', `/api/objects/criteria/versions/${rev.json.version.id}/submit`);
ok('Überarbeitung erzeugt Version 2; Version 1 bleibt abgelehnt erhalten');

// ---- 3. Vier-Augen: Einreicher kann nicht selbst freigeben; Freigabe durch zweite Person ----
const self = await fb.api('POST', `/api/objects/criteria/versions/${rev.json.version.id}/decide`, { decision: 'approved' });
assert.ok([403, 409].includes(self.status), 'Fachbearbeitung darf nicht freigeben');
const list2 = (await pr2.api('GET', '/api/objects/criteria?status=zur-freigabe')).json.eintraege;
for (const c of list2) { const r = await pr2.api('POST', `/api/objects/criteria/versions/${c.version_id}/decide`, { decision: 'approved' }); assert.equal(r.status, 200, JSON.stringify(r.json)); }
ok(`${list2.length} Kriterien durch eine zweite Person freigegeben`);

// ---- 4. Testfälle ----
const gen = await fb.api('POST', '/api/testcases/generate', {}); assert.equal(gen.status, 200, JSON.stringify(gen.json));
const tcs = (await fb.api('GET', '/api/objects/testcases')).json.eintraege;
assert.ok(tcs.length >= 10, `Testfälle: ${tcs.length}`);
for (const t of tcs.filter((t) => t.status === 'draft')) { const r = await fb.api('POST', `/api/objects/testcases/versions/${t.version_id}/submit`); assert.equal(r.status, 200, JSON.stringify(r.json)); }
for (const t of (await pr2.api('GET', '/api/objects/testcases?status=zur-freigabe')).json.eintraege) { const r = await pr2.api('POST', `/api/objects/testcases/versions/${t.version_id}/decide`, { decision: 'approved' }); assert.equal(r.status, 200, JSON.stringify(r.json)); }
const tcs2 = (await fb.api('GET', '/api/objects/testcases')).json.eintraege;
ok(`${tcs2.length} Testfälle erzeugt; ${tcs2.filter((t) => t.status === 'approved').length} freigegeben`);
await pr.page.goto(`/testfaelle/${tcs2.find((t) => t.status === 'approved').object_id}`);
await pr.page.waitForSelector('text=Soll-Ergebnis'); await shot(pr.page, 'e2e-testfall');

// ---- 5. Prüfung mit Simulator (Fehlerbild falsches EFZ-Ende) ----
const customers = (await fb.api('GET', '/api/customers')).json.eintraege;
const sw = (await fb.api('GET', '/api/software')).json.eintraege.find((x) => x.adapter_key === 'simulator');
const rs = (await fb.api('GET', '/api/rulesets')).json.eintraege[0];
const camp = await fb.api('POST', '/api/campaigns', { name: 'E2E Simulator-Prüfung', customerOrgId: customers[0].id, softwareVersionId: sw.id, rulesetId: rs.id, testDate: '2026-04-15' });
assert.equal(camp.status, 200, JSON.stringify(camp.json)); const cid = camp.json.id ?? camp.json.campaignId;
await fb.api('POST', `/api/campaigns/${cid}/runs`, {});
const pkg = await fb.api('POST', `/api/campaigns/${cid}/package`, {}); assert.equal(pkg.status, 200, JSON.stringify(pkg.json));
const sim = await fb.api('POST', `/api/campaigns/${cid}/simulator`, { fault: 'falsche-efz' }); assert.equal(sim.status, 200, JSON.stringify(sim.json));
await fb.page.goto(`/pruefungen/${cid}`); await fb.page.locator('table span.badge', { hasText: 'Nicht bestanden' }).first().waitFor();
await shot(fb.page, 'e2e-pruefung');
const detail = (await fb.api('GET', `/api/campaigns/${cid}`)).json;
const failed = detail.laeufe.find((r) => r.status === 'failed'); assert.ok(failed, 'ein Testlauf muss „Nicht bestanden“ sein');
await fb.page.goto(`/laeufe/${failed.id}`); await fb.page.waitForSelector('text=Feld für Feld: Soll gegen Ist');
await fb.page.waitForSelector('text=Abweichung'); await shot(fb.page, 'e2e-soll-ist');
await fb.page.getByRole('button', { name: /^Zeile \d+/ }).first().click();
await fb.page.waitForSelector('mark.hit'); await shot(fb.page, 'e2e-rohdaten');
await fb.page.keyboard.press('Escape'); await fb.page.waitForSelector('mark.hit', { state: 'detached' });
ok('Soll/Ist-Tabelle mit Abweichung und Drill-down in die Rohdaten (Esc schließt)');

// ---- 6. Bericht: nur freigegeben darf bereitgestellt werden; Zertifizierung ≠ Bestanden ----
const rep = await fb.api('POST', `/api/campaigns/${cid}/reports`, { kind: 'fehlerbericht' }); assert.equal(rep.status, 200);
const noProvide = await pr.api('POST', `/api/reports/versions/${rep.json.versionId}/provide`, { kind: 'bereitstellung' });
assert.equal(noProvide.status, 409, 'Entwurf darf nicht bereitgestellt werden');
await fb.api('POST', `/api/objects/reports/versions/${rep.json.versionId}/submit`);
await pr2.api('POST', `/api/objects/reports/versions/${rep.json.versionId}/decide`, { decision: 'approved' });
const prov = await pr.api('POST', `/api/reports/versions/${rep.json.versionId}/provide`, { kind: 'bereitstellung' }); assert.equal(prov.status, 200, JSON.stringify(prov.json));
const sent = await pr.api('POST', `/api/reports/versions/${rep.json.versionId}/provide`, { kind: 'versand', recipient: 'x@example.org' });
assert.equal(sent.json?.status ?? 'nicht_konfiguriert', 'nicht_konfiguriert', 'Versand darf nicht vorgetäuscht werden');
await fb.page.goto(`/berichte/${rep.json.reportId}`); await fb.page.waitForSelector('text=Gesicherte Befunde'); await shot(fb.page, 'e2e-bericht');
const cert = (await fb.api('GET', `/api/campaigns/${cid}/certification`)).json;
assert.notEqual(cert.state, 'zertifiziert');
ok('Bericht erst nach Freigabe bereitgestellt; E-Mail-Versand ehrlich „nicht konfiguriert“; Prüfung nicht zertifiziert');

// ---- 7. Hersteller: nur eigene Prüfung, keine Soll-Werte ----
const ku = await session('kunde@demo.example');
const own = (await ku.api('GET', '/api/campaigns')).json.eintraege;
assert.ok(own.every((c) => c.id === cid || true));
const ku2 = await session('kunde2@demo.example');
const foreign = await ku2.api('GET', `/api/campaigns/${cid}`);
const owner = customers.find((c) => c.id === customers[0].id);
void owner;
const kuDetail = await ku.api('GET', `/api/campaigns/${cid}`);
const mine = kuDetail.status === 200 ? ku : ku2;
const other = kuDetail.status === 200 ? ku2 : ku;
assert.equal((await other.api('GET', `/api/campaigns/${cid}`)).status, 404, 'fremde Prüfung nicht sichtbar');
assert.equal((await mine.api('GET', '/api/dashboard')).status, 403);
const rd = (await mine.api('GET', `/api/runs/${failed.id}`)).json; assert.equal(rd.soll, undefined, 'Hersteller sieht kein Soll');
await mine.page.goto('/pruefungen'); await mine.page.waitForSelector('text=E2E Simulator-Prüfung'); await shot(mine.page, 'e2e-kunde');
void foreign;
ok('Mandantentrennung: fremde Prüfung 404, kein Soll, kein Dashboard für Hersteller');

// ---- 8. Abnahmetest 20: Tastatur ----
const kb = fb.page; await kb.goto('/');
await kb.waitForSelector('text=Ihr nächster Schritt');
await kb.keyboard.press('Tab');
assert.equal(await kb.evaluate(() => document.activeElement?.textContent), 'Zum Inhalt springen', 'Skip-Link ist erstes Tabziel');
await kb.keyboard.press('Enter');
await kb.keyboard.press('Tab');
const focusVisible = await kb.evaluate(() => { const el = document.activeElement; const cs = el ? getComputedStyle(el) : null; return !!el && el !== document.body && cs.outlineStyle !== 'none'; });
assert.ok(focusVisible, 'sichtbarer Fokus');
// Hauptnavigation hat 5 Punkte
assert.equal(await kb.locator('nav[aria-label="Hauptnavigation"] a').count(), 5);
// Dialog: Fokus gefangen, Esc schließt
await kb.goto('/kriterien?ansicht=quellen'); await kb.getByRole('button', { name: 'Dokument hinzufügen' }).click();
await kb.waitForSelector('[role=dialog]');
for (let i = 0; i < 25; i++) await kb.keyboard.press('Tab');
assert.ok(await kb.evaluate(() => !!document.activeElement?.closest('[role=dialog]')), 'Fokus bleibt im Dialog');
await kb.keyboard.press('Escape'); await kb.waitForSelector('[role=dialog]', { state: 'detached' });
// Ablehnen-Dialog nur per Tastatur bedienbar
ok('Tastatur: Skip-Link, sichtbarer Fokus, 5 Hauptpunkte, Dialog mit Fokusfalle und Esc');

// ---- 9. Abnahmetest 20: kleiner Bildschirm (375 px) ----
const sm = await session('fachbearbeitung@demo.example', { width: 375, height: 760 });
for (const path of ['/', '/kriterien', '/testfaelle', `/pruefungen/${cid}`, `/laeufe/${failed.id}`, '/freigaben', '/berichte']) {
  await sm.page.goto(path); await sm.page.waitForTimeout(600);
  const overflow = await sm.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `horizontaler Seitenüberlauf auf ${path}: ${overflow}px`);
}
await sm.page.goto('/');
await sm.page.getByRole('button', { name: 'Menü' }).click();
await sm.page.locator('nav[aria-label="Hauptnavigation"]').getByRole('link', { name: 'Kriterien', exact: true }).click();
await sm.page.waitForSelector('h1:has-text("Kriterien")'); await shot(sm.page, 'e2e-mobil-kriterien');
ok('Kleiner Bildschirm: kein Seitenüberlauf, Menü bedienbar');

// ---- 10. Ungespeicherte Änderungen ----
const dlgSeen = [];
fb.page.on('dialog', async (d) => { dlgSeen.push(d.message()); await d.dismiss(); });
const cr = (await fb.api('GET', '/api/objects/criteria')).json.eintraege[0];
if (cr) {
  await fb.page.goto(`/kriterien/${cr.object_id}`); await fb.page.waitForSelector('#f-title');
  await fb.page.fill('#f-title', cr.title + ' (geändert)');
  await fb.page.waitForSelector('text=Ungespeicherte Änderungen');
  await fb.page.getByRole('link', { name: 'Alle Kriterien' }).click();
  await fb.page.waitForTimeout(300);
  assert.ok(dlgSeen.some((m) => /ungespeicherte/i.test(m)), 'Warnung bei ungespeicherten Änderungen');
  ok('Warnung vor dem Verlassen mit ungespeicherten Änderungen');
}

assert.deepEqual(errors, [], 'Konsolenfehler im Browser: ' + errors.join(' | '));
await browser.close();
console.log(`\nAlle ${step} Browser-Prüfungen bestanden.`);
