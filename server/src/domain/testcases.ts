// Testfälle für die Vorerkrankungsanfrage (Abgabegrund 41).
//
// Grundsätze:
//  * Testfälle entstehen NUR aus freigegebenen Kriterienversionen. Fehlt eine Freigabe, wird nichts erzeugt (mit Begründung).
//  * Das Soll-Ergebnis berechnet die deterministische Engine (dbvo.ts); die KI liefert höchstens Szenario-Eingaben.
//  * Neue Testfälle starten als Entwurf und brauchen eine eigene Freigabe (Soll-Ergebnisse eingeschlossen).
//  * Liegt ein Fall auf einer ungeklärten Quellengrenze, bleibt das Soll leer: Status „Klärung erforderlich“.

import crypto from 'node:crypto';
import type { Q } from '../db.js';
import { nextCode } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, badRequest, conflict, notFound, require as requirePerm } from '../auth.js';
import { addDays, addMonths, formatDe } from '../util/dates.js';
import { type DbvoInput, decideDbvo41, type DbvoDecision } from './dbvo.js';
import { type DecidedPolicy, DBVO_CLARIFICATIONS, ensureClarification, getPolicy } from './clarifications.js';
import { effectiveApproved, reviseVersion, currentVersion } from './versions.js';

export type Scenario = Omit<DbvoInput, 'policy'>;

export const AZVU_DEFAULT = '1234-5678-007';
export const DEFAULT_TODAY = '2026-03-11';

export interface ExpectedMessage {
  id: string;
  stage: number;
  abgabegrund: string;
  storno: 'N' | 'J';
  /** dynamische ID: „var“ bindet die tatsächlich erzeugte ID; Format/Eindeutigkeit/Bezüge werden geprüft */
  dsid: { var: string };
  dsidUr?: { var: string };
  refId?: { var: string };
  azvu: string;
  dbvo?: { auAbAg: string; anzahl: number; entries: { beginn: string; ende: string }[] };
  dbal?: { efzEnde: string; endeBv?: string };
  dbsd?: { dsidUr: { var: string } };
  criteria: string[];
}

export interface TestEvent {
  stage: number;
  actor: 'AG' | 'KK' | 'AN' | 'System';
  /** 'eingangsdaten' = Portal liefert Eingangsdaten; 'folgeantwort' = Portal erzeugt Datei der Krankenkasse; 'erwartet' = Software muss erzeugen */
  kind: 'eingangsdaten' | 'folgeantwort' | 'erwartet' | 'hinweis';
  text: string;
  reply?: {
    abgabegrund: '61' | '62';
    refVar: string;
    frist12?: string;
    nachweis?: { beginn: string; ende: string; kz: '1' | '2' | '4' }[];
    eelEnde?: string; eelEndeGrund?: string;
  };
}

export interface CaseDef {
  key: string;
  title: string;
  purpose: string;
  test_type: 'positiv' | 'negativ' | 'grenzfall' | 'sonderfall' | 'mehrstufig';
  criteria: string[];                 // slugs
  scenario: Scenario;
  /** Mehrschritt-Szenario: feste Ereignisfolge und erwartete Meldungen */
  multistep?: boolean;
  note?: string;
}

const sc = (o: Partial<Scenario> & Pick<Scenario, 'current' | 'prior'>): Scenario => ({
  today: DEFAULT_TODAY, insurance: 'GKV', marginalEmployment: false,
  employment: { start: '2020-01-01', end: null }, ...o,
});
const au = (start: string, end: string, evidence: 'eAU' | 'papier' | 'keine' = 'eAU') => ({ start, end, certified: evidence !== 'keine', evidence });
const cur = (start: string, end: string | null, certificate = true) => ({ start, end, certificate });

export const CRITERIA_41 = ['gkv-teilnahme', 'beschaeftigungsverhaeltnis', 'au-nachweis-aktuell', 'f41c7278', '0cefe80e', 'aade0289', '9c8c9b58'];

/** Testfall-Bibliothek. Alle Daten sind synthetisch; Tagesdatum ist im Testkontext fixiert. */
export function libraryDefs(): CaseDef[] {
  const C = CRITERIA_41;
  return [
    { key: 'basis-30-tage', title: 'Vorerkrankungsanfrage bei genau 30 Kalendertagen kumuliert', test_type: 'grenzfall', criteria: C,
      purpose: 'Genau 30 Tage (20 Tage Vorerkrankung + 10 Tage aktuelle AU) erfüllen die 30-Tage-Voraussetzung.',
      scenario: sc({ prior: [au('2026-02-10', '2026-03-01')], current: cur('2026-03-11', '2026-03-20') }) },
    { key: 'basis-29-tage', title: 'Keine Vorerkrankungsanfrage bei 29 Kalendertagen kumuliert', test_type: 'grenzfall', criteria: C,
      purpose: 'Ein Tag weniger als die 30-Tage-Grenze: die 41 darf nicht erzeugt werden.',
      scenario: sc({ prior: [au('2026-02-11', '2026-03-01')], current: cur('2026-03-11', '2026-03-20') }) },
    { key: 'basis-31-tage', title: 'Vorerkrankungsanfrage bei 31 Kalendertagen kumuliert', test_type: 'grenzfall', criteria: C,
      purpose: 'Ein Tag mehr als die 30-Tage-Grenze: die 41 wird erzeugt.',
      scenario: sc({ prior: [au('2026-02-09', '2026-03-01')], current: cur('2026-03-11', '2026-03-20') }) },
    { key: 'standard-positiv', title: 'Standardfall: attestierte Vorerkrankung, 41 wird erzeugt', test_type: 'positiv', criteria: C,
      purpose: 'Alle Voraussetzungen sind eindeutig erfüllt.',
      scenario: sc({ prior: [au('2026-01-12', '2026-02-13')], current: cur('2026-03-11', '2026-03-25') }) },
    { key: 'aktuelle-au-ohne-attest', title: 'Aktuelle AU ohne Nachweis: keine 41', test_type: 'negativ', criteria: C,
      purpose: 'Für die aktuelle AU liegt dem Arbeitgeber kein Nachweis vor.',
      scenario: sc({ prior: [au('2026-01-12', '2026-02-13')], current: cur('2026-03-11', '2026-03-25', false) }) },
    { key: 'vorherige-au-ohne-attest', title: 'Keine attestierte vorherige AU: keine 41', test_type: 'negativ', criteria: C,
      purpose: 'Die vorherige AU-Zeit ist nicht attestiert; damit fehlt mindestens eine attestierte Vorerkrankung.',
      scenario: sc({ prior: [au('2026-01-12', '2026-02-13', 'keine')], current: cur('2026-03-11', '2026-03-25') }) },
    { key: 'pkv', title: 'Privat Krankenversicherter: keine 41', test_type: 'negativ', criteria: C,
      purpose: 'Für privat Krankenversicherte ist die Vorerkrankungsanfrage im DTA EEL nicht möglich.',
      scenario: sc({ insurance: 'PKV', prior: [au('2026-01-12', '2026-02-13')], current: cur('2026-03-11', '2026-03-25') }) },
    { key: 'geringfuegig', title: 'Geringfügig Beschäftigter: keine 41', test_type: 'negativ', criteria: C,
      purpose: 'Für geringfügig Beschäftigte ist die Vorerkrankungsanfrage im DTA EEL nicht möglich.',
      scenario: sc({ marginalEmployment: true, prior: [au('2026-01-12', '2026-02-13')], current: cur('2026-03-11', '2026-03-25') }) },
    { key: 'kein-beschaeftigungsverhaeltnis', title: 'Beschäftigung endete vor AU-Beginn: keine 41', test_type: 'negativ', criteria: C,
      purpose: 'Zum Beginn der aktuellen AU besteht kein Beschäftigungsverhältnis mehr.',
      scenario: sc({ employment: { start: '2020-01-01', end: '2026-03-05' }, prior: [au('2026-01-12', '2026-02-13')], current: cur('2026-03-11', '2026-03-25') }) },
    { key: 'sechs-monate-genau', title: 'Abstand genau 6 Kalendermonate (Gleichheitsgrenze)', test_type: 'grenzfall', criteria: C,
      purpose: 'Der Folgebeginn liegt auf den Tag genau 6 Kalendermonate nach dem Ende der vorherigen AU. Die Quellen formulieren das unterschiedlich; ohne Entscheidung bleibt das Soll blockiert.',
      scenario: sc({ prior: [au('2025-08-12', '2025-09-11')], current: cur('2026-03-11', '2026-03-25') },) },
    { key: 'sechs-monate-ein-tag-davor', title: 'Abstand einen Tag unter 6 Kalendermonaten: verkettet', test_type: 'grenzfall', criteria: C,
      purpose: 'Der Folgebeginn liegt einen Tag vor „Ende + 6 Kalendermonate“: eindeutig verkettet.',
      scenario: sc({ prior: [au('2025-08-13', '2025-09-12')], current: cur('2026-03-11', '2026-03-25') }) },
    { key: 'sechs-monate-ein-tag-danach', title: 'Abstand einen Tag über 6 Kalendermonaten: nicht verkettet', test_type: 'grenzfall', criteria: C,
      purpose: 'Der Folgebeginn liegt einen Tag nach „Ende + 6 Kalendermonate“: nicht verkettet, keine 41.',
      scenario: sc({ prior: [au('2025-08-11', '2025-09-10')], current: cur('2026-03-11', '2026-03-25') }) },
    { key: 'monatsende-kalender', title: 'Monatsende: 31.08. + 6 Kalendermonate (kalendarische Monate)', test_type: 'grenzfall', criteria: C,
      purpose: 'Ende der vorherigen AU am 31.08.2025; „6 Monate danach“ gibt es im Februar 2026 nur bis 28.02. Prüft die kalendarische Monatsrechnung, nicht 30-Tage-Monate.',
      scenario: sc({ today: '2026-03-02', prior: [au('2025-08-01', '2025-08-31')], current: cur('2026-03-01', '2026-03-20') }) },
    { key: 'offenes-au-ende-30', title: 'Offenes AU-Ende: Tagesdatum + 7 Tage erreicht die 30 Tage', test_type: 'sonderfall', criteria: [...C, 'offenes-au-ende'],
      purpose: 'Die aktuelle AU ist ohne Ende erfasst; für die 30-Tage-Prüfung zählt eine Woche ab Tagesdatum (11.03.2026 bis 18.03.2026 = 8 Tage). 22 Tage Vorerkrankung ergeben 30.',
      scenario: sc({ prior: [au('2026-02-08', '2026-03-01')], current: cur('2026-03-11', null) }) },
    { key: 'offenes-au-ende-29', title: 'Offenes AU-Ende: nur 29 Tage, keine 41', test_type: 'sonderfall', criteria: [...C, 'offenes-au-ende'],
      purpose: 'Wie zuvor, aber ein Tag weniger Vorerkrankung: 29 Tage, keine 41.',
      scenario: sc({ prior: [au('2026-02-09', '2026-03-01')], current: cur('2026-03-11', null) }) },
    { key: 'papiernachweis', title: 'Vorerkrankung nur als Papiernachweis: wird aufgenommen', test_type: 'sonderfall', criteria: [...C, 'papiernachweis-vs-kasse', 'eau-gilt-als-bescheinigt'],
      purpose: 'Die vorherige AU liegt dem Arbeitgeber als Papiernachweis vor (keine eAU); sie zählt als bescheinigt und wird in den DBVO aufgenommen.',
      scenario: sc({ prior: [au('2026-02-02', '2026-03-03', 'papier')], current: cur('2026-03-11', '2026-03-20') }) },
    { key: 'unbescheinigte-kurz-au', title: 'Unbescheinigte Kurz-AU wird nicht übermittelt', test_type: 'sonderfall', criteria: [...C, 'unbescheinigte-kurz-au'],
      purpose: 'Zwischen zwei bescheinigten Zeiten liegt eine unbescheinigte Kurz-AU. Sie erscheint nicht im DBVO.',
      scenario: sc({ prior: [au('2026-01-20', '2026-02-15'), au('2026-02-20', '2026-02-22', 'keine')], current: cur('2026-03-11', '2026-03-20') }) },
    { key: 'kette-ueber-12-monate', title: 'Verkettung reicht über 12 Monate hinaus', test_type: 'sonderfall', criteria: [...C, 'verkettung-ueber-12-monate'],
      purpose: 'Drei verkettete AU-Zeiten; die älteste beginnt vor dem 12-Monats-Fenster. Sie wird dennoch übermittelt, zählt aber nicht in die 30 Tage.',
      scenario: sc({ prior: [au('2026-02-01', '2026-02-28'), au('2025-08-01', '2025-08-15'), au('2025-01-15', '2025-02-20')], current: cur('2026-03-11', '2026-03-20') }) },
    { key: 'dbvo-szenario-mehrstufig', title: 'Mehrstufiges DBVO-Szenario mit Rückmeldung, Korrektur und Storno', test_type: 'mehrstufig',
      criteria: [...C, 'papiernachweis-vs-kasse', 'systemseitig-30-vs-uebermittelt'], multistep: true,
      purpose: 'Dokumentiertes Szenario (Hinweise zur Testkonstellation): 41 → KK 61 (Kennzeichen 4) → 01 (EFZ-Ende 30.03.2026) → KK 61 (korrigiert) → 88 Storno → 01 (EFZ-Ende 27.03.2026) → KK 62. Gilt als dokumentiertes Einzelszenario, nicht als allgemeine Regel.',
      scenario: sc({ prior: [au('2025-07-14', '2025-07-15'), au('2025-10-01', '2025-10-17'), au('2025-12-01', '2025-12-03'), au('2026-03-01', '2026-03-03', 'papier')], current: cur('2026-03-11', '2026-03-20'), employment: { start: '2020-01-01', end: '2026-03-31' } }),
      note: 'Aktuelle AU: zunächst bis 20.03.2026, tatsächlich bis 10.04.2026. Beschäftigung endet am 31.03.2026.' },
  ];
}

export interface ExpectationResult {
  decision: DbvoDecision;
  status: 'draft' | 'clarification';
  expected: { messages: ExpectedMessage[]; decision: Pick<DbvoDecision, 'outcome' | 'chain' | 'currentDays' | 'chainDaysInWindow' | 'cumulativeDays' | 'windowStart'> };
  expectsNoMessage: boolean;
  observationNote: string | null;
  derivation: string;
  events: TestEvent[];
  blockedKinds: string[];
}

function multistepExpected(s: Scenario, d: DbvoDecision, policy: DecidedPolicy): { messages: ExpectedMessage[]; events: TestEvent[]; blockedKinds: string[]; extraDerivation: string } {
  const blocked: string[] = [];
  const pj = policy.szenarioFreigabe;
  if (pj.papierJahr !== 'tippfehler-2026') blocked.push('papier-au-jahr');
  if (pj.storno === null) blocked.push('rueckmeldung-vs-storno');
  if (pj.efz !== 'nur-beispielwerte') blocked.push('efz-berechnung');
  if (policy.beschaeftigungsende === null) blocked.push('beschaeftigungsende-feld');
  const entries = d.chain.map((c) => ({ beginn: c.start, ende: c.end }));
  const A = 'A', B = 'B', Cc = 'C', D = 'D';
  const messages: ExpectedMessage[] = [
    { id: 'm1', stage: 0, abgabegrund: '41', storno: 'N', dsid: { var: A }, azvu: AZVU_DEFAULT, dbvo: { auAbAg: s.current.start, anzahl: entries.length, entries }, criteria: ['f41c7278', '0cefe80e', 'aade0289', '9c8c9b58'] },
    { id: 'm2', stage: 1, abgabegrund: '01', storno: 'N', dsid: { var: B }, azvu: AZVU_DEFAULT, dbal: { efzEnde: '2026-03-30', endeBv: policy.beschaeftigungsende ? '2026-03-31' : undefined }, criteria: ['papiernachweis-vs-kasse'] },
    { id: 'm3', stage: 2, abgabegrund: '88', storno: 'J', dsid: { var: Cc }, dsidUr: { var: B }, azvu: AZVU_DEFAULT, dbsd: { dsidUr: { var: B } }, criteria: [] },
    { id: 'm4', stage: 2, abgabegrund: '01', storno: 'N', dsid: { var: D }, azvu: AZVU_DEFAULT, dbal: { efzEnde: '2026-03-27', endeBv: policy.beschaeftigungsende ? '2026-03-31' : undefined }, criteria: [] },
  ];
  const events: TestEvent[] = [
    { stage: 0, actor: 'System', kind: 'eingangsdaten', text: 'Portal stellt die Eingangsdaten bereit: AU-Zeiten 14.07.–15.07.2025, 01.10.–17.10.2025, 01.12.–03.12.2025, 01.03.–03.03.2026 (Papiernachweis), aktuelle AU ab 11.03.2026, Beschäftigungsende 31.03.2026, Tagesdatum 11.03.2026.' },
    { stage: 0, actor: 'AG', kind: 'erwartet', text: 'Die Software erzeugt die Vorerkrankungsanfrage (Abgabegrund 41) mit vier AU-Zeiten, aktuellste zuerst.' },
    { stage: 1, actor: 'KK', kind: 'folgeantwort', text: 'Krankenkasse antwortet mit Abgabegrund 61 und Kennzeichen „4 – AU liegt nicht vor“ für 01.03.–03.03.2026; 12-Monatsfrist ab 14.07.2025.',
      reply: { abgabegrund: '61', refVar: A, frist12: '2025-07-14', nachweis: [{ beginn: '2026-03-01', ende: '2026-03-03', kz: '4' }] } },
    { stage: 1, actor: 'AG', kind: 'erwartet', text: 'Die Software erzeugt die Entgeltbescheinigung (Abgabegrund 01); die EFZ endet am 30.03.2026 (Erwartungswert des Szenarios).' },
    { stage: 2, actor: 'KK', kind: 'folgeantwort', text: 'Der Arbeitnehmer legt der Krankenkasse die AU vor; die Krankenkasse übermittelt proaktiv einen zweiten DBVO (Abgabegrund 61) mit Kennzeichen „1 – liegt vollständig vor“.',
      reply: { abgabegrund: '61', refVar: A, frist12: '2025-07-14', nachweis: [{ beginn: '2026-03-01', ende: '2026-03-03', kz: '1' }] } },
    { stage: 2, actor: 'AG', kind: 'erwartet', text: 'Die Software storniert die erste Entgeltbescheinigung (Abgabegrund 88, DSID-UR = DSID der ersten 01) und erzeugt eine neue Entgeltbescheinigung (01) mit EFZ-Ende 27.03.2026 (Erwartungswert des Szenarios).' },
    { stage: 3, actor: 'KK', kind: 'folgeantwort', text: 'Die Krankenkasse meldet Ende der Entgeltersatzleistung (Abgabegrund 62) zum 31.03.2026, Grund 99, mit Bezug auf die letzte 01.',
      reply: { abgabegrund: '62', refVar: D, eelEnde: '2026-03-31', eelEndeGrund: '99' } },
    { stage: 3, actor: 'AG', kind: 'hinweis', text: 'Keine weitere Meldung des Arbeitgebers erwartet. Hinweis: Die Software darf die Entgeltbescheinigung 01 nicht fälschlich als Dublette verwerfen (korrigierte Antworten dürfen nicht verloren gehen).' },
  ];
  return { messages, events, blockedKinds: blocked, extraDerivation: `Szenario nach Hinweisen zur Testkonstellation: EFZ-Ende (30.03.2026 bzw. 27.03.2026) sind Erwartungswerte des dokumentierten Szenarios, keine allgemeine Berechnungsregel.` + (blocked.length ? ` Offene Klärung: ${blocked.join(', ')}.` : '') };
}

export function computeExpectation(def: CaseDef, policy: DecidedPolicy): ExpectationResult {
  const d = decideDbvo41({ ...def.scenario, policy: { sixMonth: policy.sixMonth } });
  const base = { decision: { outcome: d.outcome, chain: d.chain, currentDays: d.currentDays, chainDaysInWindow: d.chainDaysInWindow, cumulativeDays: d.cumulativeDays, windowStart: d.windowStart } };
  let events: TestEvent[] = [{ stage: 0, actor: 'System', kind: 'eingangsdaten', text: 'Portal stellt die synthetischen Eingangsdaten bereit (AU-Zeiten, Beschäftigung, Tagesdatum).' }];
  let blockedKinds = [...d.blockedBy];
  let messages: ExpectedMessage[] = [];
  let derivation = d.derivation;
  if (def.multistep) {
    if (d.outcome !== 'erzeugen') throw new Error('Mehrschritt-Szenario: Ausgangslage muss eine 41 ergeben.');
    const m = multistepExpected(def.scenario, d, policy);
    messages = m.messages; events = m.events; blockedKinds = [...blockedKinds, ...m.blockedKinds]; derivation += '\n' + m.extraDerivation;
  } else if (d.outcome === 'erzeugen') {
    const entries = d.chain.map((c) => ({ beginn: c.start, ende: c.end }));
    messages = [{ id: 'm1', stage: 0, abgabegrund: '41', storno: 'N', dsid: { var: 'A' }, azvu: AZVU_DEFAULT, dbvo: { auAbAg: def.scenario.current.start, anzahl: entries.length, entries }, criteria: def.criteria }];
    events.push({ stage: 0, actor: 'AG', kind: 'erwartet', text: 'Die Software erzeugt eine Vorerkrankungsanfrage (Abgabegrund 41).' });
  } else if (d.outcome === 'nicht_erzeugen') {
    events.push({ stage: 0, actor: 'AG', kind: 'erwartet', text: 'Die Software erzeugt KEINE Vorerkrankungsanfrage (Abgabegrund 41).' });
  } else {
    events.push({ stage: 0, actor: 'AG', kind: 'hinweis', text: 'Soll-Ergebnis blockiert: Klärung erforderlich.' });
  }
  const blocked = blockedKinds.length > 0;
  const nonGen = !def.multistep && d.outcome === 'nicht_erzeugen';
  return {
    decision: d, status: blocked ? 'clarification' : 'draft',
    expected: blocked ? { messages: [], ...base } : { messages, ...base },
    expectsNoMessage: !blocked && nonGen,
    observationNote: !blocked && nonGen
      ? 'Nicht-Erzeugung ist nur nach dokumentiertem Abschluss der Verarbeitung belegbar: Die prüfende Person bestätigt beim Import, dass alle Eingangsdaten verarbeitet wurden und der vereinbarte Beobachtungszeitraum (Ende des Verarbeitungslaufs der Software) abgelaufen ist.'
      : null,
    derivation, events, blockedKinds,
  };
}

// ---------------------------------------------------------------------------
// Anlegen / Regenerieren
// ---------------------------------------------------------------------------

export interface LibraryResult {
  angelegt: { code: string; title: string; status: string }[];
  neueVersion: { code: string; version: number }[];
  unveraendert: string[];
  nichtErzeugt: { key: string; title: string; grund: string }[];
}

const fingerprint = (o: unknown) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');

async function approvedCriteria(q: Q, orgId: string, slugs: string[]) {
  const found: { slug: string; criterionId: string; versionId: string; version: number }[] = [];
  const missing: string[] = [];
  for (const slug of slugs) {
    const c = await q.query('select id from criteria where org_id = $1 and slug = $2 and archived_at is null', [orgId, slug]);
    if (!c.rowCount) { missing.push(`${slug} (nicht vorhanden)`); continue; }
    const v = await effectiveApproved(q, 'criterion', c.rows[0].id);
    if (!v) { missing.push(`${slug} (keine freigegebene Version)`); continue; }
    found.push({ slug, criterionId: c.rows[0].id, versionId: v.id, version: v.version });
  }
  return { found, missing };
}

async function ensureClarificationsFor(q: Q, actor: Actor, orgId: string, kinds: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const k of kinds) {
    const def = DBVO_CLARIFICATIONS.find((d) => d.key === k);
    if (!def) continue;
    const r = await ensureClarification(q, actor, orgId, def);
    ids.push(r.id);
  }
  return ids;
}

export interface CaseInput {
  key: string; title: string; purpose: string; test_type: CaseDef['test_type'];
  scenario: Scenario; criteria: string[]; multistep?: boolean; generated_by: 'engine' | 'ki' | 'manuell'; ai_meta?: Record<string, unknown> | null;
}

/** Legt einen Testfall an oder – bei geänderter Grundlage – eine neue Version. Immer Entwurf; nie freigegeben. */
export async function upsertTestcase(q: Q, actor: Actor, orgId: string, def: CaseInput): Promise<{ kind: 'neu' | 'neue_version' | 'unveraendert' | 'nicht_erzeugt'; code?: string; version?: number; grund?: string; status?: string; title: string }> {
  requirePerm(actor, 'content:write');
  const { found, missing } = await approvedCriteria(q, orgId, def.criteria);
  if (missing.length) return { kind: 'nicht_erzeugt', title: def.title, grund: `Grundlage nicht freigegeben: ${missing.join(', ')}. Testfälle entstehen nur aus freigegebenen Kriterien.` };
  const policy = await getPolicy(q, orgId);
  const exp = computeExpectation(def, policy);
  const clarificationIds = await ensureClarificationsFor(q, actor, orgId, exp.blockedKinds);
  const openIds = clarificationIds.length ? (await q.query(`select id from clarifications where id = any($1::uuid[]) and status = 'open'`, [clarificationIds])).rows.map((r) => r.id) : [];
  const status = openIds.length ? 'clarification' : 'draft';
  const content = {
    title: def.title, purpose: def.purpose, test_type: def.test_type, initial_state: { scenario: def.scenario, multistep: !!def.multistep },
    events: exp.events, expected: openIds.length ? { messages: [], decision: exp.expected.decision } : exp.expected,
    expects_no_message: openIds.length ? false : exp.expectsNoMessage, observation_note: openIds.length ? null : exp.observationNote,
    derivation: exp.derivation + (openIds.length ? `\nSoll-Ergebnis blockiert bis zur Entscheidung offener Klärungen (${exp.blockedKinds.join(', ')}).` : ''),
    profile_requirements: { generatorKey: def.key, generator: 'dbvo-41', requires: ['dbvo-41-erzeugung', ...(def.multistep ? ['folgeantworten', 'storno-88'] : [])], criteriaVersions: Object.fromEntries(found.map((f) => [f.slug, f.version])) },
    test_date: def.scenario.today, blocked_by: openIds, generated_by: def.generated_by, ai_meta: def.ai_meta ?? null,
  };
  const fp = fingerprint({ s: content.initial_state, e: content.expected, ev: content.events, n: content.expects_no_message, c: content.profile_requirements.criteriaVersions, t: content.title, b: openIds });
  const ex = await q.query(
    `select t.id, t.code from testcases t join testcase_versions v on v.testcase_id = t.id
      where t.org_id = $1 and v.profile_requirements->>'generatorKey' = $2 limit 1`, [orgId, def.key]);
  if (!ex.rowCount) {
    const code = await nextCode(q, orgId, 'testcase', 'T');
    const t = await q.query('insert into testcases(org_id, code) values ($1,$2) returning id', [orgId, code]);
    const pr = { ...content.profile_requirements, fingerprint: fp };
    const v = await q.query(
      `insert into testcase_versions(testcase_id, version, title, purpose, test_type, initial_state, events, expected, expects_no_message, observation_note, derivation, profile_requirements, test_date, blocked_by, generated_by, ai_meta, status, change_note, created_by)
       values ($1,1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) returning id`,
      [t.rows[0].id, content.title, content.purpose, content.test_type, JSON.stringify(content.initial_state), JSON.stringify(content.events), JSON.stringify(content.expected), content.expects_no_message, content.observation_note, content.derivation, JSON.stringify(pr), content.test_date, JSON.stringify(content.blocked_by), content.generated_by, content.ai_meta ? JSON.stringify(content.ai_meta) : null, status, 'Erzeugt aus freigegebenen Kriterienversionen', actor.kind === 'user' ? actor.id : null]);
    for (const f of found) await q.query('insert into testcase_criteria(testcase_version_id, criterion_id, criterion_version_id) values ($1,$2,$3)', [v.rows[0].id, f.criterionId, f.versionId]);
    await audit(q, { actor, orgId, action: 'testfall.angelegt', objectType: 'testcase', objectId: t.rows[0].id, objectVersion: 1, details: { code, key: def.key, quelle: def.generated_by }, aiModel: (def.ai_meta as any)?.model, promptVersion: (def.ai_meta as any)?.promptVersion });
    return { kind: 'neu', code, version: 1, status, title: def.title };
  }
  const cur = await currentVersion(q, 'testcase', ex.rows[0].id);
  if (cur.profile_requirements?.fingerprint === fp) return { kind: 'unveraendert', code: ex.rows[0].code, version: cur.version, title: def.title };
  const patch = { ...content, profile_requirements: { ...content.profile_requirements, fingerprint: fp } };
  const res = await reviseVersion(q, actor, 'testcase', cur.id, patch, 'Neu erzeugt: Kriterien, Klärungen oder Berechnung haben sich geändert', async (_old, nv) => {
    for (const f of found) await q.query('insert into testcase_criteria(testcase_version_id, criterion_id, criterion_version_id) values ($1,$2,$3) on conflict do nothing', [nv.id, f.criterionId, f.versionId]);
    await q.query('update testcase_versions set status = $2 where id = $1', [nv.id, status]);
  });
  if (!res.created) {
    // Entwurf wurde direkt aktualisiert: Verknüpfungen nachziehen
    await q.query('delete from testcase_criteria where testcase_version_id = $1', [cur.id]);
    for (const f of found) await q.query('insert into testcase_criteria(testcase_version_id, criterion_id, criterion_version_id) values ($1,$2,$3)', [cur.id, f.criterionId, f.versionId]);
    await q.query('update testcase_versions set status = $2 where id = $1', [cur.id, status]);
  }
  return { kind: 'neue_version', code: ex.rows[0].code, version: res.version.version, status, title: def.title };
}

export async function generateLibrary(q: Q, actor: Actor, orgId: string, keys?: string[]): Promise<LibraryResult> {
  requirePerm(actor, 'content:write');
  const res: LibraryResult = { angelegt: [], neueVersion: [], unveraendert: [], nichtErzeugt: [] };
  for (const def of libraryDefs()) {
    if (keys && !keys.includes(def.key)) continue;
    const r = await upsertTestcase(q, actor, orgId, { ...def, generated_by: 'engine' });
    if (r.kind === 'neu') res.angelegt.push({ code: r.code!, title: def.title, status: r.status! });
    else if (r.kind === 'neue_version') res.neueVersion.push({ code: r.code!, version: r.version! });
    else if (r.kind === 'unveraendert') res.unveraendert.push(r.code!);
    else res.nichtErzeugt.push({ key: def.key, title: def.title, grund: r.grund! });
  }
  await audit(q, { actor, orgId, action: 'testfaelle.bibliothek_erzeugt', details: { angelegt: res.angelegt.length, neueVersion: res.neueVersion.length, nichtErzeugt: res.nichtErzeugt.length } });
  return res;
}

/** Gründe, warum die Grundlage einer Testfallversion nicht (mehr) gültig ist. Leere Liste = gültig. */
export async function basisProblems(q: Q, testcaseVersionId: string): Promise<string[]> {
  const out: string[] = [];
  const r = await q.query(
    `select c.slug, cv.version as linked,
            (select max(v2.version) from criteria_versions v2 where v2.criterion_id = c.id and v2.status = 'approved') as eff
       from testcase_criteria tc join criteria c on c.id = tc.criterion_id join criteria_versions cv on cv.id = tc.criterion_version_id
      where tc.testcase_version_id = $1`, [testcaseVersionId]);
  const stale = r.rows.filter((x) => x.eff === null || x.eff !== x.linked);
  if (stale.length) out.push(`Die Kriterien-Grundlage ist veraltet: ${stale.map((s) => `${s.slug} (verknüpft v${s.linked}, gültig ${s.eff ? 'v' + s.eff : 'keine'})`).join(', ')}.`);
  const tv = await q.query('select blocked_by from testcase_versions where id = $1', [testcaseVersionId]);
  const ids: string[] = tv.rows[0]?.blocked_by ?? [];
  if (ids.length) {
    const open = await q.query(`select code from clarifications where id = any($1::uuid[]) and status = 'open'`, [ids]);
    if (open.rowCount) out.push(`Offene Klärung(en): ${open.rows.map((x) => x.code).join(', ')}.`);
  }
  return out;
}

/** Zusätzliche Prüfung bei Einreichung/Freigabe: alle verknüpften Kriterienversionen müssen noch gültig freigegeben sein. */
export async function assertBasisCurrent(q: Q, testcaseVersionId: string): Promise<void> {
  const p = await basisProblems(q, testcaseVersionId);
  if (p.length) throw conflict('BASIS_OUTDATED', `${p.join(' ')} Bitte den Testfall neu erzeugen.`);
}

/** Nach Entscheidung einer Klärung: abhängige Testfälle in Entwurf/Klärung werden mit dem neuen Stand neu berechnet. */
export async function refreshAfterClarification(q: Q, actor: Actor, orgId: string): Promise<{ aktualisiert: string[] }> {
  const defs = libraryDefs();
  const out: string[] = [];
  const open = await q.query(
    `select distinct on (t.id) t.id, t.code, v.id as vid, v.status, v.profile_requirements->>'generatorKey' as k
       from testcases t join testcase_versions v on v.testcase_id = t.id where t.org_id = $1 and t.archived_at is null order by t.id, v.version desc`, [orgId]);
  for (const row of open.rows) {
    if (row.status !== 'clarification' && row.status !== 'draft') continue;
    const def = defs.find((d) => d.key === row.k);
    if (!def) continue;
    const r = await upsertTestcase(q, actor, orgId, { ...def, generated_by: 'engine' });
    if (r.kind !== 'unveraendert') out.push(row.code);
  }
  return { aktualisiert: out };
}

export function describeScenario(s: Scenario): string {
  const pr = s.prior.map((p) => `${formatDe(p.start)}–${formatDe(p.end)}${p.certified ? '' : ' (unbescheinigt)'}${p.evidence === 'papier' ? ' (Papier)' : ''}`).join('; ');
  return `Tagesdatum ${formatDe(s.today)}; ${s.insurance}${s.marginalEmployment ? ', geringfügig' : ''}; aktuelle AU ab ${formatDe(s.current.start)} bis ${s.current.end ? formatDe(s.current.end) : 'offen'}${s.current.certificate ? '' : ' (ohne Nachweis)'}; frühere AU: ${pr || '–'}`;
}

export { addDays, addMonths, notFound, badRequest };
