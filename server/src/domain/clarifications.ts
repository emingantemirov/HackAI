// Klärungsvorgänge: Stellen, an denen die Quellen offen, widersprüchlich oder fehlerhaft sind.
// Die Anwendung entscheidet solche Punkte nie still. Betroffene Soll-Ergebnisse bleiben blockiert,
// bis eine berechtigte Person entschieden hat – die Originaltexte bleiben unverändert erhalten.

import type { Q } from '../db.js';
import { nextCode } from '../db.js';
import { audit } from '../audit.js';
import { type Actor, badRequest, conflict, notFound, require as requirePerm } from '../auth.js';
import { findQuote } from '../extract.js';
import type { SixMonthPolicy } from './dbvo.js';

export interface ClarificationDef {
  key: string;                       // stabiler Schlüssel (kind)
  title: string;
  description: string;
  options: { key: string; label: string; consequence: string }[];
  /** Belege: Quelle wird über den Titel-Teilstring gesucht, das Zitat gegen den Originaltext geprüft. */
  anchors: { sourceTitleIncludes: string; quote: string }[];
}

export const DBVO_CLARIFICATIONS: ClarificationDef[] = [
  {
    key: 'sechsmonatsgrenze-gleichheit',
    title: 'Sechsmonatsgrenze: Gilt „genau 6 Monate“ als verkettet?',
    description:
      'Die Quellen formulieren die Grenze unterschiedlich: Die ergänzenden Kriterien sprechen von „nicht mehr als 6 Monate“ (ein Abstand von genau 6 Monaten wäre noch verkettet), ' +
      'der Erläuterungstext von „nicht mindestens 6 Monate vergangen“ (ein Abstand von genau 6 Monaten würde die Kette unterbrechen). ' +
      'Die Anwendung entscheidet das nicht still. Alle Soll-Ergebnisse, die genau auf dieser Grenze liegen, bleiben „Klärung erforderlich“.',
    options: [
      { key: 'inklusive', label: 'Genau 6 Monate sind noch verkettet („nicht mehr als 6 Monate“)', consequence: 'Ein Abstand, bei dem der Folgebeginn auf den Tag genau Ende + 6 Monate fällt, wird verkettet.' },
      { key: 'exklusive', label: 'Genau 6 Monate unterbrechen die Kette („nicht mindestens 6 Monate vergangen“)', consequence: 'Ein Abstand, bei dem der Folgebeginn auf den Tag genau Ende + 6 Monate fällt, wird nicht verkettet.' },
    ],
    anchors: [
      { sourceTitleIncludes: 'Vorerkrankung', quote: 'zwischen dem Beginn der aktuellen Arbeitsunfähigkeit und dem Ende der letzten attestierten Arbeitsunfähigkeit nicht mehr als 6 Monate liegen' },
      { sourceTitleIncludes: 'Vorerkrankung', quote: 'zwischen dem Ende der vorhergehenden Erkrankung und dem Beginn der nachgehenden Erkrankung nicht mindestens 6 Monate vergangen sind' },
    ],
  },
  {
    key: 'papier-au-jahr',
    title: 'Hinweistext nennt bei der Papier-AU das Jahr 2025 statt 2026',
    description:
      'Im Hinweistext steht „die AU vom 01.03.2025 bis 03.03.2026 liegt beim AG in Papierform vor“, die Aufzählung davor nennt dagegen 01.03.2026 bis 03.03.2026. ' +
      'Der Originaltext bleibt unverändert gespeichert. Es ist zu bestätigen, welche Angabe gilt.',
    options: [
      { key: 'tippfehler-2026', label: 'Tippfehler: gemeint ist 01.03.2026 bis 03.03.2026', consequence: 'Das Szenario verwendet die Papier-AU 01.03.2026–03.03.2026 (dreitägig).' },
      { key: 'beibehalten-2025', label: 'Angabe 01.03.2025 gilt tatsächlich', consequence: 'Die Papier-AU würde mehr als ein Jahr dauern; das Szenario müsste fachlich neu bewertet werden.' },
    ],
    anchors: [
      { sourceTitleIncludes: 'Testkonstellation', quote: 'die AU vom 01.03.2025 bis 03.03.2026 liegt beim AG in Papierform vor' },
      { sourceTitleIncludes: 'Testkonstellation', quote: '01.03.2026 bis 03.03.2026 (liegt dem AG als Papiernachweis vor, keine eAU)' },
    ],
  },
  {
    key: 'rueckmeldung-vs-storno',
    title: 'Rückmeldung löst grundsätzlich keine Stornierung aus – das Beispiel storniert aber',
    description:
      'Die Gemeinsamen Grundsätze (Abschn. 2.5) beschreiben, dass aufgrund der Rückmeldung eines Sozialversicherungsträgers grundsätzlich keine Stornierung und Neumeldung durch den Arbeitgeber abzugeben ist. ' +
      'Die Beispielsequenz storniert die erste Entgeltbescheinigung nach der korrigierten Rückmeldung mit Abgabegrund 88 und meldet neu (EFZ-Ende verschiebt sich). ' +
      'Das Verhältnis ist fachlich zu klären, bevor die Sequenz als allgemeine Regel verwendet wird.',
    options: [
      { key: 'sonderfall', label: 'Die Beispielsequenz ist ein dokumentierter Sonderfall (verändertes EFZ-Ende)', consequence: 'Das Szenario bleibt als Einzelfall gültig; es wird keine allgemeine Stornoregel daraus abgeleitet.' },
      { key: 'regel-praezisieren', label: 'Die Regel ist zu präzisieren; das Szenario bleibt bis dahin vorläufig', consequence: 'Das Szenario bleibt als vorläufig gekennzeichnet und wird nach der Präzisierung neu bewertet.' },
    ],
    anchors: [
      { sourceTitleIncludes: 'Grundsätze', quote: 'ist grundsätzlich keine Stornierung und Neumeldung durch den Arbeitgeber abzugeben' },
      { sourceTitleIncludes: 'Testkonstellation', quote: 'storniert der AG seine erste Entgeltbescheinigung mit dem neuen Abgabegrund 88' },
    ],
  },
  {
    key: 'zeitstempel-februar',
    title: 'Beispieldatei: Erstellungszeitpunkt 14.02.2026, aber AU-Daten aus März 2026',
    description:
      'In der Beispieldatei tragen VOSZ, DSKO, DSLW und NCSZ den Zeitstempel 14.02.2026, die AU-Zeiten liegen im März 2026 (aktuelle AU ab 11.03.2026). ' +
      'Laut Formatspezifikation ist DSLW „DATUM-ERSTELLUNG“ der Zeitpunkt der Erstellung des Datensatzes. Eine Datei kann nicht vor dem Beginn der AU erstellt worden sein. ' +
      'Die Werte werden nicht automatisch korrigiert. Zu klären ist, ob die Beispieldatei ein bewusst unrealistisches Muster ist und der Zeitstempel im Vergleich ignoriert werden darf.',
    options: [
      { key: 'zeitstempel-nicht-pruefen', label: 'Erstellungszeitpunkt wird im Soll-Ist-Vergleich nicht bewertet', consequence: 'DATUM-ERSTELLUNG wird nur auf Format geprüft, nicht gegen den Testkontext.' },
      { key: 'zeitstempel-gegen-testdatum', label: 'Erstellungszeitpunkt muss zum Tagesdatum des Testkontexts passen', consequence: 'Der Vergleich meldet Abweichungen, wenn DATUM-ERSTELLUNG nicht am Tagesdatum liegt.' },
    ],
    anchors: [
      { sourceTitleIncludes: 'DBVO', quote: 'VOSZAGEEL99302811       00000000       20260214000001ITSG GmbH' },
      { sourceTitleIncludes: 'Testkonstellation', quote: 'die aktuelle AU beginnt am 11.03.2026' },
    ],
  },
  {
    key: 'efz-berechnung',
    title: 'EFZ-Enddaten sind Beispielwerte – eine allgemeine Berechnungslogik fehlt',
    description:
      'Das Beispiel nennt EFZ-Ende 30.03.2026 (vor der korrigierten Rückmeldung) und 27.03.2026 (danach). Eine allgemeine Berechnungsregel steht nicht in den Quellen. ' +
      'Plausibilitätsrechnung (KEINE freigegebene Regel): 42 Tage Anspruch − 22 angerechnete Vorerkrankungstage (2 + 17 + 3) = 20 Tage ab 11.03. ⇒ 30.03.; ' +
      'nach Anrechnung der Papier-AU (+3) = 17 Tage ⇒ 27.03. Das passt zu beiden Werten, setzt aber Annahmen voraus (6-Wochen-Anspruch, Anrechnung aller vier Zeiten, kalendertägliche Zählung, Beschäftigungsende 31.03.). ' +
      'Bis zur Entscheidung werden die EFZ-Enddaten ausschließlich als quellengestützte Erwartungswerte des Beispielszenarios geführt.',
    options: [
      { key: 'nur-beispielwerte', label: 'EFZ-Enddaten nur als Beispielwerte des Szenarios führen', consequence: 'Keine allgemeine Berechnung; nur das dokumentierte Szenario prüft die Werte 30.03.2026 und 27.03.2026.' },
      { key: 'rechenregel-ableiten', label: 'Allgemeine Berechnungsregel fachlich ableiten und freigeben', consequence: 'Eine neue Klärung/Kriterienableitung ist erforderlich; vorher werden keine weiteren EFZ-Soll-Werte erzeugt.' },
    ],
    anchors: [
      { sourceTitleIncludes: 'Testkonstellation', quote: 'Somit endet die EFZ zunächst am 30.03.2026' },
      { sourceTitleIncludes: 'Testkonstellation', quote: 'da die EFZ nunmehr bereits am 27.03.2026 geendet hat' },
    ],
  },
  {
    key: 'zeichenkodierung',
    title: 'Zeichenkodierung der EEL-Dateien ist nicht festgelegt',
    description:
      'Die Beispieldatei enthält Nicht-ASCII-Zeichen, die in der vorliegenden Kopie bereits als Ersatzzeichen (U+FFFD, UTF-8-kodiert) vorliegen – das ursprüngliche „ß“/„ä“ ist verloren. ' +
      'Die Satzlängen stimmen nur, wenn jedes Ersatzzeichen als EIN Zeichen zählt; das deutet auf eine ursprüngliche Ein-Byte-Kodierung hin. ' +
      'Die maßgebliche Kodierung steht in den „Gemeinsamen Grundsätzen Technik“ bzw. der Anlage 1, die nicht bereitgestellt wurden. Die Anwendung rät sie nicht anhand des Dateinamens.',
    options: [
      { key: 'iso-8859-1', label: 'ISO-8859-1 (Latin-1) verwenden', consequence: 'Import und Export lesen/schreiben Einzelbytes; Annahme wird im Importprotokoll vermerkt.' },
      { key: 'utf-8', label: 'UTF-8 verwenden', consequence: 'Import und Export nutzen UTF-8; Annahme wird im Importprotokoll vermerkt.' },
      { key: 'spezifikation-beschaffen', label: 'Erst die maßgebliche Spezifikation beschaffen', consequence: 'Bis dahin bleibt jede Kodierung eine dokumentierte Annahme mit Warnung.' },
    ],
    anchors: [
      { sourceTitleIncludes: 'Grundsätze', quote: 'sowie die Gemeinsamen Grundsätze Technik gemäß § 95 SGB IV in der jeweils geltenden Fassung zu beachten' },
    ],
  },
  {
    key: 'beschaeftigungsende-feld',
    title: 'Beschäftigungsende 31.03.2026: Feld „am“ oder „zum“?',
    description:
      'Die Hinweise nennen das Ende der Beschäftigung am 31.03.2026. Der Baustein DBAL kennt zwei Felder („Beendigung Beschäftigungsverhältnis am“ und „… zum“). ' +
      'Welches Feld das Testszenario erwartet, ist in den Quellen nicht festgelegt. Bis zur Entscheidung wird das Feld im Vergleich nicht bewertet.',
    options: [
      { key: 'am', label: 'Feld ENDE-BV-AM erwarten', consequence: 'Der Vergleich prüft DBAL.ENDE-BV-AM = 31.03.2026.' },
      { key: 'zum', label: 'Feld ENDE-BV-ZUM erwarten', consequence: 'Der Vergleich prüft DBAL.ENDE-BV-ZUM = 31.03.2026.' },
    ],
    anchors: [{ sourceTitleIncludes: 'Testkonstellation', quote: 'Ende der Beschäftigung ist der 31.03.2026' }],
  },
];

export interface DecidedPolicy {
  sixMonth: SixMonthPolicy;
  encoding: string | null;
  beschaeftigungsende: 'am' | 'zum' | null;
  zeitstempel: 'zeitstempel-nicht-pruefen' | 'zeitstempel-gegen-testdatum' | null;
  szenarioFreigabe: { papierJahr: string | null; storno: string | null; efz: string | null };
}

export async function getPolicy(q: Q, orgId: string): Promise<DecidedPolicy> {
  const r = await q.query(`select code, kind, decision_key from clarifications where org_id = $1 and status = 'resolved'`, [orgId]);
  const by = Object.fromEntries(r.rows.map((x) => [x.kind, x.decision_key as string]));
  const sm = by['sechsmonatsgrenze-gleichheit'];
  return {
    sixMonth: sm === 'inklusive' || sm === 'exklusive' ? sm : null,
    encoding: by['zeichenkodierung'] && by['zeichenkodierung'] !== 'spezifikation-beschaffen' ? by['zeichenkodierung'] : null,
    beschaeftigungsende: (by['beschaeftigungsende-feld'] as 'am' | 'zum') ?? null,
    zeitstempel: (by['zeitstempel-februar'] as DecidedPolicy['zeitstempel']) ?? null,
    szenarioFreigabe: { papierJahr: by['papier-au-jahr'] ?? null, storno: by['rueckmeldung-vs-storno'] ?? null, efz: by['efz-berechnung'] ?? null },
  };
}

export async function ensureClarification(q: Q, actor: Actor, orgId: string, def: ClarificationDef, affected: Record<string, unknown> = {}): Promise<{ id: string; created: boolean }> {
  const ex = await q.query(`select id from clarifications where org_id = $1 and kind = $2`, [orgId, def.key]);
  if (ex.rowCount) return { id: ex.rows[0].id, created: false };
  const src = await q.query(`select sv.id, sv.extracted_text, sv.locators, d.title from source_versions sv join source_documents d on d.id = sv.document_id where sv.org_id = $1`, [orgId]);
  const refs = def.anchors.map((a) => {
    for (const s of src.rows.filter((x) => x.title.toLowerCase().includes(a.sourceTitleIncludes.toLowerCase()))) {
      const m = findQuote(s.extracted_text ?? '', s.locators ?? [], a.quote);
      if (m.found) return { source_version_id: s.id, source_title: s.title, quote: a.quote, locator: m.locator ?? null, verified: true };
    }
    return { source_version_id: null, source_title: a.sourceTitleIncludes, quote: a.quote, locator: null, verified: false };
  });
  const code = await nextCode(q, orgId, 'clarification', 'KL');
  const r = await q.query(
    `insert into clarifications(org_id, code, title, description, kind, options, affected, source_refs, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [orgId, code, def.title, def.description, def.key, JSON.stringify(def.options.map((o) => ({ key: o.key, label: o.label, consequence: o.consequence }))), JSON.stringify(affected), JSON.stringify(refs), actor.kind === 'user' ? actor.id : null],
  );
  await audit(q, { actor, orgId, action: 'klaerung.angelegt', objectType: 'clarification', objectId: r.rows[0].id, details: { code, kind: def.key } });
  return { id: r.rows[0].id, created: true };
}

export async function decideClarification(q: Q, actor: Actor, id: string, decisionKey: string, note: string, afterResolved?: (c: any) => Promise<void>): Promise<any> {
  requirePerm(actor, 'clarification:decide');
  const r = await q.query('select * from clarifications where id = $1 and org_id = $2 for update', [id, actor.orgId]);
  if (!r.rowCount) throw notFound('Klärungsvorgang');
  const c = r.rows[0];
  if (c.status === 'resolved') throw conflict('ALREADY_RESOLVED', 'Dieser Klärungsvorgang wurde bereits entschieden. Eine geänderte Entscheidung wird als neuer Vorgang geführt.');
  if (!c.options.some((o: any) => o.key === decisionKey)) throw badRequest('Unbekannte Entscheidungsoption.');
  if ((note ?? '').trim().length < 10) throw badRequest('Bitte die fachliche Begründung der Entscheidung angeben (mindestens 10 Zeichen).');
  const u = await q.query(`update clarifications set status = 'resolved', decision_key = $2, decision_note = $3, decided_by = $4, decided_at = now() where id = $1 returning *`, [id, decisionKey, note.trim(), actor.id]);
  await audit(q, { actor, orgId: actor.orgId, action: 'klaerung.entschieden', objectType: 'clarification', objectId: id, reason: note, details: { code: c.code, entscheidung: decisionKey } });
  if (afterResolved) await afterResolved(u.rows[0]);
  return u.rows[0];
}
