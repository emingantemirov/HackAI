// Deterministischer Soll-Ist-Vergleich. Die KI darf erklären, aber nie über Gleichheit entscheiden.
//
// Ausdrücklich definierte Normalisierungen (werden mit jedem Ergebnis gespeichert):
//  * Datumswerte werden als Kalenderdatum (JJJJ-MM-TT) verglichen, nicht als Text.
//  * Codes und Kennzeichen werden exakt verglichen.
//  * Nachlaufende Leerzeichen fester Felder werden ignoriert; Rohdaten bleiben unverändert in der Importdatei.
//  * UUIDs werden ohne Beachtung der Groß-/Kleinschreibung verglichen.
//  * Dynamische IDs (DATENSATZ-ID): Format (UUID), Eindeutigkeit und Bezüge (z. B. DSID-UR der Stornierung = DSID der Ursprungsmeldung) – nicht der Wert.
//  * Geldbeträge: ganze Cent (util/money.ts).

import { UUID_RE, type ParsedMessage } from '../eel.js';
import type { ExpectedMessage } from './testcases.js';
import type { DecidedPolicy } from './clarifications.js';

export interface ActualMessage { msg: ParsedMessage; fileId: string; fileName: string }
export interface CompareRow {
  messageId: string; stage: number; field: string; label: string;
  expected: string; actual: string;
  result: 'ok' | 'abweichung' | 'fehlt' | 'unerwartet' | 'nicht_bewertet';
  criterion: string | null; explanation: string;
  source: { fileId: string; fileName: string; line: number; start: number; length: number } | null;
}
export interface CompareInput {
  expected: { messages: ExpectedMessage[] };
  expectsNoMessage: boolean;
  testDate: string;
  policy: DecidedPolicy;
  actual: ActualMessage[];
  attested: boolean;
  finalized: boolean;
  /** AZVU des Testlaufs (je Lauf verschieden); überschreibt das AZVU in der Soll-Meldung */
  azvu?: string;
}
export interface CompareOutput {
  outcome: 'pass' | 'fail' | 'incomplete';
  rows: CompareRow[];
  summary: { total: number; ok: number; abweichung: number; fehlt: number; unerwartet: number; nichtBewertet: number; stageComplete: number; maxStage: number; boundIds: Record<string, string>; reason: string };
  normalization: string[];
}

export const NORMALIZATION = [
  'Datumswerte: Kalenderdatum JJJJ-MM-TT, kein Textvergleich.',
  'Codes und Kennzeichen: exakter Vergleich.',
  'Feste Felder: nachlaufende Leerzeichen werden ignoriert, Rohdaten bleiben unverändert in der Importdatei.',
  'UUIDs: ohne Beachtung der Groß-/Kleinschreibung.',
  'Dynamische IDs (DATENSATZ-ID): Format, Eindeutigkeit und Bezüge werden geprüft, nicht der konkrete Wert.',
  'Geldbeträge: ganze Cent, keine Gleitkommazahlen.',
  'Erstellungszeitpunkt (DATUM-ERSTELLUNG): nur nach ausdrücklicher fachlicher Entscheidung bewertet.',
];

const d = (iso: string | null | undefined) => (iso ? iso : '–');

export function compareRun(inp: CompareInput): CompareOutput {
  const rows: CompareRow[] = [];
  const bound: Record<string, string> = {};
  const used = new Set<number>();
  const exp = inp.expected.messages;
  const maxStage = exp.reduce((m, e) => Math.max(m, e.stage), 0);
  const src = (a: ActualMessage | null, key: string) => {
    const sp = a?.msg.spans[key];
    return a && sp ? { fileId: a.fileId, fileName: a.fileName, line: sp.line, start: sp.start, length: sp.length } : null;
  };
  const push = (e: ExpectedMessage, a: ActualMessage | null, field: string, label: string, ex: string, ac: string, ok: boolean, criterion: string | null, explanation: string, spanKey: string) => {
    rows.push({ messageId: e.id, stage: e.stage, field, label, expected: ex, actual: ac, result: ok ? 'ok' : (a ? 'abweichung' : 'fehlt'), criterion, explanation, source: src(a, spanKey) });
  };

  const allIds = inp.actual.map((a) => a.msg.dsid.toLowerCase());
  const missingStage = new Set<number>();

  for (const e of exp) {
    const idx = inp.actual.findIndex((a, i) => !used.has(i) && a.msg.abgabegrund === e.abgabegrund);
    const a = idx >= 0 ? inp.actual[idx] : null;
    if (idx >= 0) used.add(idx);
    const lbl = `Meldung ${e.id} (Abgabegrund ${e.abgabegrund})`;
    if (!a) {
      rows.push({ messageId: e.id, stage: e.stage, field: 'DSLW.ABGABEGRUND', label: `${lbl}: Meldung`, expected: `Meldung mit Abgabegrund ${e.abgabegrund}`, actual: 'nicht vorhanden', result: 'fehlt', criterion: e.criteria[0] ?? null, explanation: 'Die erwartete Meldung wurde in den importierten Rückgabedaten nicht gefunden.', source: null });
      missingStage.add(e.stage);
      continue;
    }
    const m = a.msg;
    push(e, a, 'DSLW.ABGABEGRUND', `${lbl}: Abgabegrund`, e.abgabegrund, m.abgabegrund, m.abgabegrund === e.abgabegrund, e.criteria[0] ?? null, 'Abgabegrund der erzeugten Meldung', 'DSLW.ABGABEGRUND');
    // dynamische ID: Format und Eindeutigkeit
    const fmtOk = UUID_RE.test(m.dsid);
    const uniq = allIds.filter((x) => x === m.dsid.toLowerCase()).length === 1;
    push(e, a, 'DSLW.DATENSATZ-ID', `${lbl}: DATENSATZ-ID (dynamisch)`, 'gültige, eindeutige UUID', m.dsid, fmtOk && uniq, null,
      !fmtOk ? 'Die DATENSATZ-ID ist keine gültige UUID.' : !uniq ? 'Die DATENSATZ-ID kommt mehrfach vor (Eindeutigkeit verletzt).' : 'Format und Eindeutigkeit geprüft; der konkrete Wert ist dynamisch.', 'DSLW.DATENSATZ-ID');
    bound[e.dsid.var] = m.dsid.toLowerCase();
    if (e.dsidUr) {
      const want = bound[e.dsidUr.var];
      const got = (m.dsidUr ?? '').toLowerCase();
      push(e, a, 'DBSD.DATENSATZ-ID-URSPRUNGSMELDUNG', `${lbl}: DSID-Ursprungsmeldung`, want ? `= DATENSATZ-ID der Bezugsmeldung (${want})` : 'Bezugsmeldung nicht vorhanden', m.dsidUr ?? '–', !!want && got === want, null, 'Die Stornierung muss auf die DATENSATZ-ID der stornierten Meldung verweisen.', 'DBSD.DATENSATZ-ID-URSPRUNGSMELDUNG');
    }
    push(e, a, 'DBID.AKTENZEICHEN-VERURSACHER', `${lbl}: AZVU`, inp.azvu ?? e.azvu, m.azvu ?? '–', (m.azvu ?? '') === (inp.azvu ?? e.azvu), null, 'Aktenzeichen des Verursachers (Zuordnung)', 'DBID.AKTENZEICHEN-VERURSACHER');
    if (e.dbvo) {
      const v = m.dbvo;
      push(e, a, 'DBVO.AU-AB-AG', `${lbl}: Beginn der aktuellen AU beim AG`, d(e.dbvo.auAbAg), d(v?.auAbAg), v?.auAbAg === e.dbvo.auAbAg, e.criteria[0] ?? null, 'Beginn der aktuellen Arbeitsunfähigkeit', 'DBVO.AU-AB-AG');
      push(e, a, 'DBVO.ANZAHL-AU', `${lbl}: Anzahl übermittelter AU-Zeiten`, String(e.dbvo.anzahl), String(v?.anzahl ?? '–'), v?.anzahl === e.dbvo.anzahl, 'aade0289', 'Verkettung nach Sechsmonatsregel bestimmt die Zahl der Einträge', 'DBVO.ANZAHL-AU');
      const n = Math.max(e.dbvo.entries.length, v?.entries.length ?? 0);
      for (let i = 0; i < n; i++) {
        const ee = e.dbvo.entries[i], ae = v?.entries[i];
        if (ee && !ae) { rows.push({ messageId: e.id, stage: e.stage, field: `DBVO.BEGINN-AU#${i + 1}`, label: `${lbl}: AU-Zeit ${i + 1}`, expected: `${ee.beginn} – ${ee.ende}`, actual: 'fehlt', result: 'fehlt', criterion: 'aade0289', explanation: 'Erwartete AU-Zeit fehlt in der Meldung.', source: src(a, 'DBVO.ANZAHL-AU') }); continue; }
        if (!ee && ae) { rows.push({ messageId: e.id, stage: e.stage, field: `DBVO.BEGINN-AU#${i + 1}`, label: `${lbl}: AU-Zeit ${i + 1}`, expected: 'nicht erwartet', actual: `${d(ae.beginn)} – ${d(ae.ende)}`, result: 'unerwartet', criterion: 'aade0289', explanation: 'Die Meldung enthält eine AU-Zeit, die nicht übermittelt werden darf (z. B. nicht verkettet oder unbescheinigt).', source: src(a, `DBVO.BEGINN-AU#${i + 1}`) }); continue; }
        push(e, a, `DBVO.BEGINN-AU#${i + 1}`, `${lbl}: AU ${i + 1} Beginn`, ee.beginn, d(ae!.beginn), ae!.beginn === ee.beginn, 'aade0289', 'Beginn der Vorerkrankung (aktuellste zuerst)', `DBVO.BEGINN-AU#${i + 1}`);
        push(e, a, `DBVO.ENDE-AU#${i + 1}`, `${lbl}: AU ${i + 1} Ende`, ee.ende, d(ae!.ende), ae!.ende === ee.ende, 'aade0289', 'Ende der Vorerkrankung', `DBVO.ENDE-AU#${i + 1}`);
      }
    }
    if (e.dbal) {
      push(e, a, 'DBAL.DATUM-EGZBIS', `${lbl}: Ende Entgeltfortzahlung (EFZ)`, e.dbal.efzEnde, d(m.dbal?.efzEnde), m.dbal?.efzEnde === e.dbal.efzEnde, e.criteria[0] ?? null, 'Erwartungswert des dokumentierten Szenarios (keine allgemeine Berechnungsregel)', 'DBAL.DATUM-EGZBIS');
      if (e.dbal.endeBv) {
        const field = inp.policy.beschaeftigungsende === 'zum' ? 'ENDE-BV-ZUM' : 'ENDE-BV-AM';
        const got = inp.policy.beschaeftigungsende === 'zum' ? m.dbal?.endeBvZum : m.dbal?.endeBvAm;
        push(e, a, `DBAL.${field}`, `${lbl}: Ende der Beschäftigung`, e.dbal.endeBv, d(got), got === e.dbal.endeBv, null, `Feld ${field} gemäß fachlicher Entscheidung`, `DBAL.${field}`);
      }
    }
    if (inp.policy.zeitstempel === 'zeitstempel-gegen-testdatum') {
      const ts = m.header['DATUM-ERSTELLUNG'] ?? '';
      const iso = /^\d{8}/.test(ts) ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}` : '';
      push(e, a, 'DSLW.DATUM-ERSTELLUNG', `${lbl}: Erstellungsdatum`, inp.testDate, iso || ts, iso === inp.testDate, null, 'Erstellungszeitpunkt muss zum Tagesdatum des Testkontexts passen (fachliche Entscheidung)', 'DSLW.DATUM-ERSTELLUNG');
    } else {
      rows.push({ messageId: e.id, stage: e.stage, field: 'DSLW.DATUM-ERSTELLUNG', label: `${lbl}: Erstellungsdatum`, expected: '—', actual: m.header['DATUM-ERSTELLUNG'] ?? '–', result: 'nicht_bewertet', criterion: null, explanation: 'Der Erstellungszeitpunkt wird nicht bewertet, solange dazu keine fachliche Entscheidung vorliegt (Klärung „Zeitstempel“).', source: src(a, 'DSLW.DATUM-ERSTELLUNG') });
    }
  }
  // nicht zugeordnete Meldungen der Software
  inp.actual.forEach((a, i) => {
    if (used.has(i)) return;
    rows.push({ messageId: '–', stage: 0, field: 'DSLW.ABGABEGRUND', label: `Unerwartete Meldung (Abgabegrund ${a.msg.abgabegrund})`, expected: inp.expectsNoMessage ? 'keine Meldung' : 'nicht erwartet', actual: `Abgabegrund ${a.msg.abgabegrund}, DSID ${a.msg.dsid}`, result: 'unerwartet', criterion: inp.expectsNoMessage ? 'f41c7278' : null,
      explanation: inp.expectsNoMessage ? 'Das Soll-Ergebnis verlangt ausdrücklich, dass keine Meldung erzeugt wird.' : 'Diese Meldung ist im Soll nicht vorgesehen.', source: src(a, 'DSLW.ABGABEGRUND') });
  });

  const count = (r: CompareRow['result']) => rows.filter((x) => x.result === r).length;
  const stageComplete = (() => { if (!exp.length) return -1; let s = -1; for (let k = 0; k <= maxStage; k++) { if (missingStage.has(k)) break; s = k; } return s; })();
  const hardFail = count('abweichung') + count('unerwartet') > 0;
  let outcome: CompareOutput['outcome']; let reason: string;
  if (hardFail) { outcome = 'fail'; reason = 'Es gibt Abweichungen zwischen Soll und Ist.'; }
  else if (inp.expectsNoMessage) {
    if (inp.attested) { outcome = 'pass'; reason = 'Keine Meldung erzeugt; Abschluss der Verarbeitung ist dokumentiert.'; }
    else { outcome = 'incomplete'; reason = 'Es wurde keine Meldung gefunden. Die Nicht-Erzeugung gilt erst nach dokumentiertem Abschluss/Beobachtungszeitraum als belegt.'; }
  } else if (count('fehlt') > 0) {
    if (inp.finalized) { outcome = 'fail'; reason = 'Erwartete Meldungen fehlen; der Lauf wurde ohne weitere Rückgaben abgeschlossen.'; }
    else { outcome = 'incomplete'; reason = 'Erwartete Meldungen liegen noch nicht vor.'; }
  } else { outcome = 'pass'; reason = 'Alle erwarteten Felder stimmen überein.'; }
  return {
    outcome, rows, normalization: NORMALIZATION,
    summary: { total: rows.length, ok: count('ok'), abweichung: count('abweichung'), fehlt: count('fehlt'), unerwartet: count('unerwartet'), nichtBewertet: count('nicht_bewertet'), stageComplete, maxStage, boundIds: bound, reason },
  };
}
