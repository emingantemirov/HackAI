// Ableitung prüfbarer Kriterien aus Quellen.
//
// Drei Wege, alle mit demselben Ergebnis: Kriterien-ENTWÜRFE (Status „Entwurf“), niemals freigegeben.
//  1. Übernahme eingebetteter Kriterien mit Original-ID (Word-Dokument „Beispiel Vorerkrankung“).
//  2. KI-Ableitung über Hessian AI (Teilschritte mit Fortschritt, schemavalidiert).
//  3. Regelbasierter DEMO-Modus (ohne KI), überall als solcher gekennzeichnet.
// Jedes Zitat wird gegen den Originaltext der Quelle geprüft. Nicht überprüfbare Belege werden verworfen;
// Kriterien ohne überprüfbaren Beleg werden nicht angelegt.

import crypto from 'node:crypto';
import { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';
import { tx } from '../db.js';
import type { HaiClient } from '../ai/hai.js';
import { AiError } from '../ai/hai.js';
import { PROMPTS, deriveCriteriaSystem, deriveCriteriaUser } from '../ai/prompts.js';
import { type Actor, aiActor, badRequest, conflict, notFound, require as requirePerm } from '../auth.js';
import { findQuote, normalizeWithMap } from '../extract.js';
import { audit } from '../audit.js';
import { type CriterionDraft, createCriterion } from './criteria.js';
import type { JobCtx } from './jobs.js';
import { reviseVersion, currentVersion } from './versions.js';

type Evidence = CriterionDraft['evidence'][number];

// ---------------------------------------------------------------------------
// 1. Eingebettete Kriterien mit Original-ID
// ---------------------------------------------------------------------------

const UUID_AT_START = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b\s*(?:=\s*(.+))?$/i;

const EMBEDDED_KNOWLEDGE: Record<string, Partial<CriterionDraft>> = {
  'f41c7278-b5a5-4ec3-b321-39bca5c3aeeb': {
    title: 'Aktuelle AU und mindestens eine vorherige AU müssen attestiert sein',
    preconditions: 'Gesetzlich krankenversicherter Arbeitnehmer; AU-Zeiten sind im Entgeltabrechnungssystem hinterlegt.',
    rule: 'Eine Meldung mit Abgabegrund „41“ wird nur erzeugt, wenn sowohl für die aktuelle AU als auch für mindestens eine vorherige AU eine Attestierung (AU-Nachweis, auch eAU) vorliegt.',
    exceptions: 'In der Quelle keine genannt.',
    expected_behavior: 'Fehlt die Attestierung der aktuellen oder jeder vorherigen AU, wird keine 41 erzeugt. Sind beide Voraussetzungen und alle weiteren Kriterien erfüllt, wird die 41 erzeugt.',
    data_fields: ['DBVO.AU-AB-AG', 'DBVO.ANZAHL-AU', 'DBVO.BEGINN-AU-nn', 'DBVO.ENDE-AU-nn'], message_types: ['41'],
  },
  '0cefe80e-4fd9-41e1-be4f-3ae1ecbde646': {
    title: 'Zeitlicher Zusammenhang zwischen aktueller AU und letzter attestierter AU (Sechsmonatsregel)',
    preconditions: 'Aktuelle AU und mindestens eine vorherige attestierte AU liegen vor.',
    rule: 'Eine Meldung mit Abgabegrund „41“ wird nur erzeugt, wenn zwischen dem Beginn der aktuellen AU und dem Ende der letzten attestierten AU nicht mehr als 6 Kalendermonate liegen.',
    exceptions: 'In der Quelle keine genannt.',
    expected_behavior: 'Liegt die letzte attestierte AU mehr als 6 Monate zurück, wird keine 41 erzeugt. An der Grenze „genau 6 Monate“ ist das Verhalten ungeklärt (siehe Klärungsvorgang).',
    data_fields: ['DBVO.AU-AB-AG', 'DBVO.ENDE-AU-nn'], message_types: ['41'],
    open_questions: [{ text: 'Gleichheitsgrenze bei genau 6 Monaten ist in den Quellen unterschiedlich formuliert („nicht mehr als“ vs. „nicht mindestens“).' }],
  },
  'aade0289-e8f9-4e12-9c49-464cf6cd0789': {
    title: 'Verkettung potentieller Vorerkrankungen über die Abstände der AU-Zeiten („Daumenkriterium“)',
    preconditions: 'Mehrere vorherige attestierte AU-Zeiten liegen vor.',
    rule: 'AU-Zeiten vor der aktuellen AU werden nur dann in die 41 aufgenommen, wenn zwischen dem Beginn einer AU-Zeit und dem Ende der vorhergehenden AU-Zeit jeweils nicht mehr als 6 Kalendermonate liegen. Die Kette wird rückwärts bis zur ersten Unterbrechung gebildet.',
    exceptions: 'Unbescheinigte Kurz-AU-Zeiten sind nicht als potentielle Vorerkrankung zu übermitteln.',
    expected_behavior: 'Die 41 enthält alle verketteten AU-Zeiten, aktuellste zuerst; nicht verkettete Zeiten fehlen.',
    data_fields: ['DBVO.ANZAHL-AU', 'DBVO.BEGINN-AU-nn', 'DBVO.ENDE-AU-nn'], message_types: ['41'],
    open_questions: [{ text: 'Gleichheitsgrenze bei genau 6 Monaten ist in den Quellen unterschiedlich formuliert.' }, { text: 'Die Verkettung kann über 12 Monate hinausreichen (Arbeitgeberseite keine zeitliche Begrenzung); Krankenkassenseite maximal 12 Monate zurück.' }],
  },
  '9c8c9b58-4d0f-4066-98ac-973095418d63': {
    title: 'Vorerkrankungszeiten zusammen mit der aktuellen AU erreichen mindestens 30 Tage',
    preconditions: 'Verkettete Vorerkrankungszeiten liegen systemseitig vor.',
    rule: 'Eine Meldung mit Abgabegrund „41“ wird nur erzeugt, wenn die systemseitig vorliegenden Vorerkrankungszeiten (letzte 12 Monate, kalendarisch) zusammen mit der aktuellen AU mindestens 30 Kalendertage umfassen. Ist das AU-Ende offen, zählt die aktuelle AU eine Woche ab Tagesdatum.',
    exceptions: 'In der Quelle keine genannt.',
    expected_behavior: 'Bei 29 Tagen wird keine 41 erzeugt, bei 30 und 31 Tagen (und erfüllten weiteren Kriterien) wird sie erzeugt.',
    data_fields: ['DBVO.ANZAHL-AU', 'DBVO.BEGINN-AU-nn', 'DBVO.ENDE-AU-nn'], message_types: ['41'],
    open_questions: [{ text: 'Zählweise der aktuellen AU bei bekanntem Ende (bescheinigtes Ende) und Beschneidung der Vorerkrankungen auf das 12-Monats-Fenster sind Produktentscheidungen der Anwendung und müssen fachlich bestätigt werden.' }],
  },
};

export interface EmbeddedCandidate { id: string; text: string; note: string | null }

export function parseEmbeddedCriteria(text: string): EmbeddedCandidate[] {
  // Nur Abschnitte nach „Ergänzende Kriterien“ enthalten Kriterien mit Original-ID; andere UUIDs (z. B. Beispiel-IDs in Tabellen) sind keine Kriterien.
  const marker = text.search(/Ergänzende Kriterien/i);
  if (marker < 0) return [];
  const paras = text.slice(marker).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: EmbeddedCandidate[] = [];
  for (let i = 0; i < paras.length; i++) {
    const m = UUID_AT_START.exec(paras[i]);
    if (!m) continue;
    const body: string[] = [];
    for (let j = i + 1; j < paras.length && !UUID_AT_START.test(paras[j]) && !/^Ergebnis:/i.test(paras[j]); j++) body.push(paras[j]);
    if (body.join(' ').length >= 40) out.push({ id: m[1].toLowerCase(), text: body.join(' '), note: m[2]?.trim() ?? null });
  }
  return out;
}

function embeddedToDraft(c: EmbeddedCandidate, sv: { id: string; extracted_text: string; locators: any[]; valid_from: string | null }): CriterionDraft | null {
  const m = findQuote(sv.extracted_text, sv.locators, c.text);
  const k = EMBEDDED_KNOWLEDGE[c.id] ?? {};
  const evidence: Evidence[] = [{ source_version_id: sv.id, quote: c.text, locator: m.locator ?? null, verified: m.found }];
  if (!m.found) return null;
  return {
    id: c.id, slug: c.id.slice(0, 8), title: k.title ?? c.text.slice(0, 90), description: c.text + (c.note ? `\n(${c.note})` : ''),
    preconditions: k.preconditions ?? '', rule: k.rule ?? '', exceptions: k.exceptions ?? '', expected_behavior: k.expected_behavior ?? '',
    valid_from: sv.valid_from, data_fields: k.data_fields ?? [], message_types: k.message_types ?? ['41'], open_questions: k.open_questions ?? [],
    evidence, origin: 'quelle-uebernommen',
    change_note: 'Beschreibung und Original-ID stammen wörtlich aus der Quelle. Die Felder „Voraussetzungen“, „Prüfbare Regel“, „Ausnahmen“ und „Erwartetes Verhalten“ sind eine fachliche Ableitung und müssen bei der Freigabe mitgeprüft werden.',
  };
}

// ---------------------------------------------------------------------------
// 3. Regelbasierter Demo-Modus
// ---------------------------------------------------------------------------

interface DemoDef extends Omit<CriterionDraft, 'evidence' | 'origin'> { anchors: string[] }

export const DEMO_DEFS: DemoDef[] = [
  {
    slug: 'gkv-teilnahme', title: 'Nur gesetzlich Krankenversicherte, nicht geringfügig Beschäftigte, können eine Vorerkrankungsanfrage stellen',
    description: 'Ist der Arbeitnehmer privat krankenversichert oder geringfügig beschäftigt, ist eine Vorerkrankungsanfrage im Rahmen des DTA EEL nicht möglich.',
    preconditions: 'Versicherungsart und Beschäftigungsart des Arbeitnehmers sind im Entgeltabrechnungssystem bekannt.',
    rule: 'Abgabegrund „41“ wird nur für gesetzlich krankenversicherte, nicht geringfügig beschäftigte Arbeitnehmer erzeugt.',
    exceptions: 'Vorerkrankungsanfragen bei Berufskrankheit/Arbeitsunfall für privat Versicherte erfolgen außerhalb des DTA EEL an die Berufsgenossenschaft.',
    expected_behavior: 'Für PKV-Versicherte und geringfügig Beschäftigte wird keine 41 erzeugt.', data_fields: [], message_types: ['41'],
    anchors: ['Sofern der Arbeitnehmer privat krankenversichert oder geringfügig beschäftigt ist, ist eine Vorerkrankungsanfrage im Rahmen des DTA EEL nicht möglich'],
  },
  {
    slug: 'beschaeftigungsverhaeltnis', title: 'Beschäftigungsverhältnis besteht oder bestand für die angefragten Zeiträume',
    description: 'Die Vorerkrankungsanfrage darf nur gestellt werden, wenn für die angefragten Zeiträume ein Beschäftigungsverhältnis beim anfragenden Arbeitgeber besteht oder bestand.',
    preconditions: 'Beschäftigungsbeginn und -ende sind hinterlegt.', rule: 'Das Beschäftigungsverhältnis deckt den Beginn der aktuellen AU ab.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Ohne Beschäftigungsverhältnis zum AU-Beginn wird keine 41 erzeugt.', data_fields: [], message_types: ['41'],
    anchors: ['für die angefragten Zeiträume ein Beschäftigungsverhältnis des Arbeitnehmers bei dem anfragenden Arbeitgeber besteht oder bestand'],
    open_questions: [{ text: 'Die Quelle spricht von „angefragten Zeiträumen“ (Plural). Die Anwendung prüft zunächst den Beginn der aktuellen AU; die Ausdehnung auf die Vorerkrankungszeiten ist zu bestätigen.' }],
  },
  {
    slug: 'au-nachweis-aktuell', title: 'Für die aktuelle AU liegt dem Arbeitgeber ein Arbeitsunfähigkeitsnachweis vor',
    description: 'Dem Arbeitgeber muss für die aktuelle Arbeitsunfähigkeit ein Arbeitsunfähigkeitsnachweis vorliegen.',
    preconditions: 'Aktuelle AU ist erfasst.', rule: 'Ohne AU-Nachweis (Papier oder eAU) für die aktuelle AU wird keine 41 erzeugt.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Fehlender Nachweis ⇒ keine 41.', data_fields: [], message_types: ['41'],
    anchors: ['dem Arbeitgeber für die aktuelle Arbeitsunfähigkeit ein Arbeitsunfähigkeitsnachweis vorliegt'],
  },
  {
    slug: 'potentielle-vorerkrankung-6m', title: 'Mindestens eine bescheinigte potentielle Vorerkrankung in den letzten 6 Monaten vor AU-Beginn',
    description: 'In den letzten 6 Monaten vor Beginn der aktuellen AU muss mindestens eine bescheinigte potentielle Vorerkrankung im Datenbestand vorliegen.',
    preconditions: 'AU-Historie liegt im Datenbestand vor.', rule: 'Mindestens eine bescheinigte AU liegt höchstens 6 Kalendermonate vor dem Beginn der aktuellen AU.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Ohne solche Vorerkrankung wird keine 41 erzeugt.', data_fields: ['DBVO.ANZAHL-AU'], message_types: ['41'],
    anchors: ['in den letzten 6 Monaten vor Beginn der aktuellen Arbeitsunfähigkeit mindestens eine bescheinigte potentielle Vorerkrankung in Bezug auf die aktuelle Arbeitsunfähigkeit im Datenbestand vorliegt'],
    open_questions: [{ text: 'Gleichheitsgrenze bei genau 6 Monaten ist in den Quellen unterschiedlich formuliert.' }],
  },
  {
    slug: 'kumulierung-12m', title: 'Kumulierte Zeiten der letzten 12 Monate erreichen zusammen mit der aktuellen AU mindestens 30 Tage',
    description: 'Die kumulierten Zeiten aller potentiellen Vorerkrankungen in den letzten 12 Monaten müssen zusammen mit der aktuellen AU zum Zeitpunkt der Meldung mindestens 30 Tage umfassen.',
    preconditions: 'Vorerkrankungszeiten und aktuelle AU sind erfasst.', rule: 'Σ Kalendertage (Vorerkrankungen im 12-Monats-Fenster + aktuelle AU) ≥ 30.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Unter 30 Tagen wird keine 41 erzeugt.', data_fields: ['DBVO.BEGINN-AU-nn', 'DBVO.ENDE-AU-nn'], message_types: ['41'],
    anchors: ['die kumulierten Zeiten aller potentiellen Vorerkrankungen in den letzten 12 Monaten zusammen mit der aktuellen Arbeitsunfähigkeit zum Zeitpunkt der Meldung mindestens 30 Tage umfassen'],
    open_questions: [{ text: 'Produktentscheidung: bescheinigtes AU-Ende zählt voll; Vorerkrankungen werden auf das 12-Monats-Fenster beschnitten. Fachliche Bestätigung nötig.' }],
  },
  {
    slug: 'offenes-au-ende', title: 'Bei offenem AU-Ende wird eine Woche ab Tagesdatum angesetzt',
    description: 'Werden die Fehlzeiten mit offenem Ende verwaltet, ist zur Prüfung des Erreichens der 30 Tage die AU mit einer Dauer von einer Woche ab dem Tagesdatum zu beurteilen.',
    preconditions: 'Aktuelle AU hat kein erfasstes Ende.', rule: 'Aktuelle AU endet für die 30-Tage-Prüfung am Tagesdatum + 7 Tage.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Die 30-Tage-Prüfung verwendet Tagesdatum + 7 als AU-Ende. Das Tagesdatum ist im Testkontext fixiert.', data_fields: [], message_types: ['41'],
    anchors: ['ist zur Prüfung des Erreichens der 30 Tage die AU mit einer Dauer von einer Woche in die Zukunft ab dem Tagesdatum zu beurteilen'],
  },
  {
    slug: 'eau-gilt-als-bescheinigt', title: 'eAU zählt als bescheinigte Arbeitsunfähigkeit',
    description: 'Als „bescheinigte“ Arbeitsunfähigkeitszeiten gelten auch die im elektronischen Arbeitsunfähigkeitsverfahren übermittelten Datensätze.',
    preconditions: 'eAU-Datensatz liegt vor.', rule: 'Ein eAU-Datensatz gilt wie eine Papierbescheinigung als Attestierung.', exceptions: 'In der Quelle keine genannt.',
    expected_behavior: 'Zeiten mit eAU werden wie bescheinigte Zeiten behandelt.', data_fields: [], message_types: ['41'],
    anchors: ['Als „bescheinigte“ Arbeitsunfähigkeitszeiten gelten auch die im elektronischen Arbeitsunfähigkeitsverfahren übermittelten Datensätze'],
  },
  {
    slug: 'papiernachweis-vs-kasse', title: 'Papiernachweis beim Arbeitgeber ist vom Nachweisbestand der Krankenkasse zu unterscheiden',
    description: 'Eine AU kann dem Arbeitgeber als Papiernachweis vorliegen, ohne dass sie der Krankenkasse vorliegt. Der Arbeitgeber nimmt sie in den DBVO auf.',
    preconditions: 'Papier-AU liegt dem Arbeitgeber vor, der Krankenkasse noch nicht.', rule: 'Die Papier-AU wird in die 41 aufgenommen; die Krankenkasse meldet dafür zunächst Kennzeichen „4 – AU liegt nicht vor“.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Die 41 enthält die Papier-AU. Die Rückmeldung 61 mit Kennzeichen 4 ist eine Zwischennachricht.', data_fields: ['DBVO.KZ-NACHWEIS-nn'], message_types: ['41', '61'],
    anchors: ['liegt dem AG als Papiernachweis vor, keine eAU'],
  },
  {
    slug: 'systemseitig-30-vs-uebermittelt', title: 'Systemseitige 30-Tage-Prüfung und Umfang der übermittelten Vorerkrankungen sind verschiedene Sachverhalte',
    description: 'Es ist nicht erforderlich, dass die übermittelten kumulierten Zeiten zusammen mit der aktuellen AU mindestens 30 Tage umfassen; systemseitig müssen jedoch weiterhin mindestens 30 Tage vorliegen.',
    preconditions: 'Vorerkrankungen liegen systemseitig vor.', rule: 'Die 30-Tage-Prüfung bezieht sich auf den Systembestand, nicht auf die tatsächlich übermittelten Einträge.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Die Meldung enthält möglichst alle verketteten Vorerkrankungen, auch wenn bereits ein Teil die 30 Tage erreicht.', data_fields: ['DBVO.ANZAHL-AU'], message_types: ['41'],
    anchors: ['nicht erforderlich, dass die übermittelten kumulierten Zeiten aller potentiellen Vorerkrankungen zusammen mit der aktuellen Arbeitsunfähigkeit mindestens 30 Tage umfassen, systemseitig müssen jedoch weiterhin'],
  },
  {
    slug: 'mindestens-eine-vorerkrankung', title: 'Mindestens eine Vorerkrankung muss übermittelt werden',
    description: 'Bei der Anfrage muss mindestens eine Vorerkrankung angegeben sein.', preconditions: '–', rule: 'DBVO.ANZAHL-AU ≥ 1 bei Abgabegrund 41.',
    exceptions: 'In der Quelle keine genannt.', expected_behavior: 'Eine 41 ohne Vorerkrankung ist unzulässig.', data_fields: ['DBVO.ANZAHL-AU'], message_types: ['41'],
    anchors: ['es muss mindestens eine Vorerkrankung angegeben sein'],
  },
  {
    slug: 'verkettung-ueber-12-monate', title: 'Die Verkettung kann über zwölf Monate hinausreichen',
    description: 'Es ist bis zur erstmalig bescheinigten Erkrankung zurückzugehen, welche keine Vorerkrankung innerhalb von 6 Monaten aufweist; hierfür gilt keine zeitliche Begrenzung.',
    preconditions: 'Lange Kette von AU-Zeiten.', rule: 'Die Kette wird bis zur ersten Unterbrechung (> 6 Monate) rückwärts gebildet, ohne Begrenzung auf 12 Monate.',
    exceptions: 'Die Krankenkasse betrachtet maximal die letzten 12 Monate.', expected_behavior: 'Auch AU-Zeiten älter als 12 Monate werden in die 41 aufgenommen, wenn sie verkettet sind.', data_fields: ['DBVO.BEGINN-AU-nn'], message_types: ['41'],
    anchors: ['Hierbei ist bis zur erstmalig bescheinigten Erkrankung zurückzugehen (hierfür gilt keine zeitliche Begrenzung)'],
  },
  {
    slug: 'unbescheinigte-kurz-au', title: 'Unbescheinigte Kurz-AU-Zeiten werden nicht als Vorerkrankung übermittelt',
    description: 'Schließt sich keine bescheinigte AU nahtlos an diese Zeiten an (Kurz-Arbeitsunfähigkeit), sind diese Zeiten nicht als potentielle Vorerkrankung zu übermitteln.',
    preconditions: 'Der Arbeitnehmer hat sich ohne AU-Bescheinigung krankgemeldet.', rule: 'AU-Zeiten ohne Bescheinigung gehören nicht in den DBVO.',
    exceptions: 'Schließt sich eine bescheinigte AU nahtlos an, ist die Anschlusskonstellation zu beachten (in der Quelle nicht weiter beschrieben).',
    expected_behavior: 'Unbescheinigte Kurz-AU erscheint nicht in der 41.', data_fields: ['DBVO.ANZAHL-AU'], message_types: ['41'],
    anchors: ['Schließt sich keine bescheinigte Arbeitsunfähigkeit nahtlos an diese Zeiten an (Kurz-Arbeitsunfähigkeit), sind diese Zeiten nicht als potentielle Vorerkrankung zu übermitteln'],
    open_questions: [{ text: 'Die „nahtlose Anschlusskonstellation“ ist in den Quellen nicht näher beschrieben.' }],
  },
  {
    slug: 'sinnhaftigkeit-pruefung', title: 'Die Anfrage wird vor dem Versand individuell auf Sinnhaftigkeit geprüft',
    description: 'Die Anfrage ist vor dem Versand jeweils individuell durch den Arbeitgeber auf Sinnhaftigkeit zu prüfen.', preconditions: '–',
    rule: 'Manueller Prüfschritt des Arbeitgebers vor Versand.', exceptions: 'Nicht maschinell prüfbar.', expected_behavior: 'Kein maschinelles Soll-Ergebnis; die Software soll die Prüfung ermöglichen.', data_fields: [], message_types: ['41'],
    anchors: ['Die Anfrage ist vor dem Versand jeweils individuell durch den Arbeitgeber auf Sinnhaftigkeit zu prüfen'],
  },
];

function demoCandidates(sv: { id: string; extracted_text: string; locators: any[]; valid_from: string | null }): CriterionDraft[] {
  const out: CriterionDraft[] = [];
  for (const d of DEMO_DEFS) {
    const evidence: Evidence[] = [];
    for (const a of d.anchors) {
      const m = findQuote(sv.extracted_text, sv.locators, a);
      if (m.found) evidence.push({ source_version_id: sv.id, quote: a, locator: m.locator ?? null, verified: true });
    }
    if (!evidence.length) continue;
    const { anchors: _a, ...rest } = d;
    out.push({ ...rest, valid_from: sv.valid_from, evidence, origin: 'demo-ableitung', change_note: 'DEMO-MODUS: regelbasierte Ableitung ohne KI. Beschreibung stammt aus dem Quelltext, Regel und erwartetes Verhalten sind fachliche Ableitung.' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. KI-Ableitung
// ---------------------------------------------------------------------------

const aiCriterion = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{2,60}$/),
  title: z.string().min(5).max(250),
  description: z.string().min(10),
  preconditions: z.string().default(''),
  rule: z.string().min(5),
  exceptions: z.string().default(''),
  expected_behavior: z.string().min(5),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  valid_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  data_fields: z.array(z.string()).default([]),
  message_types: z.array(z.string()).default([]),
  open_questions: z.array(z.string()).default([]),
  evidence: z.array(z.object({ quote: z.string().min(12).max(1500) })).min(1),
});
export const aiDeriveSchema = z.object({
  criteria: z.array(aiCriterion).default([]),
  contradictions: z.array(z.object({ title: z.string(), description: z.string(), quotes: z.array(z.string()).default([]) })).default([]),
  missing_information: z.array(z.string()).default([]),
});

function chunkText(text: string, locators: { start: number; end: number }[], max = 6500): string[] {
  const parts = locators.length ? locators.map((l) => text.slice(l.start, l.end)) : text.split(/\n\s*\n/);
  const chunks: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur && cur.length + p.length > max) { chunks.push(cur); cur = ''; }
    cur += (cur ? '\n\n' : '') + p;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

// ---------------------------------------------------------------------------
// Klassifikation und Anlage
// ---------------------------------------------------------------------------

const contentHash = (d: Pick<CriterionDraft, 'title' | 'description' | 'preconditions' | 'rule' | 'exceptions' | 'expected_behavior' | 'valid_from' | 'valid_to' | 'data_fields' | 'message_types'>, withDates = false) =>
  crypto.createHash('sha256').update(JSON.stringify([d.title, d.description, d.preconditions, d.rule, d.exceptions, d.expected_behavior, withDates ? d.valid_from ?? null : null, withDates ? d.valid_to ?? null : null, d.data_fields ?? [], d.message_types ?? []].map((x) => (typeof x === 'string' ? normalizeWithMap(x).norm : x)))).digest('hex');

const tokens = (s: string) => new Set(normalizeWithMap(s).norm.split(/[^a-zäöüß0-9]+/).filter((t) => t.length > 3));
const jaccard = (a: Set<string>, b: Set<string>) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };

export type DeriveMode = 'uebernahme' | 'ki' | 'demo';

export interface DeriveResult {
  mode: DeriveMode;
  neu: { code: string; slug: string; title: string; id: string }[];
  geaendert: { code: string; slug: string; version: number }[];
  unveraendert: string[];
  duplikate: { slug: string; aehnlichZu: string }[];
  entfallen: { code: string; slug: string; grund: string }[];
  verworfen: { slug: string; grund: string }[];
  widersprueche: { title: string; description: string; quotes: string[] }[];
  fehlendeInformationen: string[];
  hinweis: string;
}

export interface DeriveOpts {
  db: Db; cfg: AppConfig; hai: HaiClient; actor: Actor; orgId: string; sourceVersionId: string; mode: DeriveMode; progress?: JobCtx['progress'];
}

export async function deriveFromSource(o: DeriveOpts): Promise<DeriveResult> {
  requirePerm(o.actor, 'ai:run');
  const sr = await o.db.query('select * from source_versions where id = $1 and org_id = $2', [o.sourceVersionId, o.orgId]);
  if (!sr.rowCount) throw notFound('Quelle');
  const sv = sr.rows[0];
  if (sv.extraction_status !== 'ok') throw conflict('SOURCE_NOT_READABLE', 'Der Text dieser Quelle ist nicht zuverlässig lesbar (OCR-Prüfschritt offen). Daraus werden keine Kriterien abgeleitet.');
  const doc = await o.db.query('select title from source_documents where id = $1', [sv.document_id]);
  const title = doc.rows[0].title;

  const candidates: { draft: CriterionDraft; aiModel?: string }[] = [];
  const verworfen: DeriveResult['verworfen'] = [];
  const widersprueche: DeriveResult['widersprueche'] = [];
  const fehlend: string[] = [];
  const total = o.mode === 'ki' ? 1 : 1;
  await o.progress?.(0, total, 'Eingebettete Kriterien werden gelesen …');

  // 1) eingebettete Kriterien mit Original-ID – deterministisch, in jedem Modus
  for (const e of parseEmbeddedCriteria(sv.extracted_text)) {
    const d = embeddedToDraft(e, sv);
    if (d) candidates.push({ draft: d }); else verworfen.push({ slug: e.id.slice(0, 8), grund: 'Beleg konnte nicht gegen den Originaltext geprüft werden.' });
  }

  if (o.mode === 'demo') {
    for (const d of demoCandidates(sv)) candidates.push({ draft: d });
  } else if (o.mode === 'ki') {
    if (!o.hai.configured) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert. Manuelle Bearbeitung oder der gekennzeichnete Demo-Modus bleiben möglich.');
    const existing = (await o.db.query('select slug from criteria where org_id = $1', [o.orgId])).rows.map((r) => r.slug as string);
    // Wenige, große Abschnitte statt vieler kleiner; nur die thematisch ergiebigsten (Reihenfolge des Dokuments bleibt). Mehrere Anfragen laufen parallel.
    const score = (c: string) => (c.match(/Vorerkrank/gi)?.length ?? 0) * 3 + (c.match(/Abgabegrund|DBVO/gi)?.length ?? 0) * 2 + (c.match(/Arbeitsunfähig/gi)?.length ?? 0);
    const all = chunkText(sv.extracted_text, sv.locators, 12000).map((c, idx) => ({ c, idx, sc: score(c) })).filter((x) => x.sc > 0);
    const chunks = all.sort((x, y) => y.sc - x.sc).slice(0, 8).sort((x, y) => x.idx - y.idx).map((x) => x.c);
    const baseSlugs = [...existing, ...candidates.map((c) => c.draft.slug)];
    let doneN = 0; let lastErr: unknown = null; let failed = 0;
    const results: { i: number; rawData: any; completion: any }[] = [];
    let next = 0;
    const worker = async () => {
      while (next < chunks.length) {
        const i = next++;
        try {
          const { data: rawData, completion } = await o.hai.completeJson('kriterien-ableitung', PROMPTS.deriveCriteria, aiDeriveSchema, [
            { role: 'system', content: deriveCriteriaSystem('Vorerkrankungsanfrage (Abgabegrund 41, Datenbaustein DBVO)') },
            { role: 'user', content: deriveCriteriaUser(title, sv.version_label, chunks[i], baseSlugs) },
          ], 6000, o.orgId);
          results.push({ i, rawData, completion });
        } catch (e) {
          if (e instanceof AiError && e.state === 'nicht_konfiguriert') throw e;
          lastErr = e; failed++;
        }
        doneN++;
        await o.progress?.(doneN, chunks.length, `KI analysiert Abschnitt ${Math.min(doneN + 1, chunks.length)} von ${chunks.length} …`);
      }
    };
    await o.progress?.(0, chunks.length, `KI analysiert ${chunks.length} Abschnitte …`);
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, worker));
    if (chunks.length && failed === chunks.length) throw lastErr;
    if (failed) fehlend.push(`${failed} von ${chunks.length} Abschnitten konnten von der KI nicht ausgewertet werden (${lastErr instanceof Error ? lastErr.message : 'Fehler'}). Bitte die Ableitung später erneut starten.`);
    results.sort((x, y) => x.i - y.i);
    for (const { rawData, completion } of results) {
      const data = rawData as z.output<typeof aiDeriveSchema>;
      const meta = { model: completion.model, promptVersion: PROMPTS.deriveCriteria, derivedAt: new Date().toISOString(), sourceVersionId: sv.id, inputTokens: completion.usage.inputTokens, outputTokens: completion.usage.outputTokens };
      for (const c of data.criteria) {
        const ev: Evidence[] = [];
        for (const q of c.evidence) {
          const m = findQuote(sv.extracted_text, sv.locators, q.quote);
          if (m.found) ev.push({ source_version_id: sv.id, quote: q.quote, locator: m.locator ?? null, verified: true });
        }
        if (!ev.length) { verworfen.push({ slug: c.slug, grund: 'Kein Beleg stimmt wörtlich mit der Quelle überein (möglicherweise von der KI erfunden).' }); continue; }
        candidates.push({
          aiModel: completion.model,
          draft: {
            slug: c.slug, title: c.title, description: c.description, preconditions: c.preconditions, rule: c.rule, exceptions: c.exceptions, expected_behavior: c.expected_behavior,
            valid_from: c.valid_from ?? sv.valid_from, valid_to: c.valid_to ?? null, data_fields: c.data_fields, message_types: c.message_types,
            open_questions: c.open_questions.map((t) => ({ text: t })), evidence: ev, origin: 'ki-ableitung', ai_meta: meta,
            change_note: `KI-Ableitung (${completion.model}, Prompt ${PROMPTS.deriveCriteria}). Entwurf: Freigabe durch Menschen erforderlich.`,
          },
        });
      }
      for (const x of data.contradictions) {
        const verified = x.quotes.filter((q) => findQuote(sv.extracted_text, sv.locators, q).found);
        widersprueche.push({ title: x.title, description: x.description, quotes: verified });
      }
      fehlend.push(...data.missing_information);
    }
    if (!chunks.length) fehlend.push('Die Quelle enthält keine Abschnitte zum Geltungsbereich Vorerkrankungsanfrage (41).');
  }

  // Klassifikation gegen den Bestand
  const res: DeriveResult = { mode: o.mode, neu: [], geaendert: [], unveraendert: [], duplikate: [], entfallen: [], verworfen, widersprueche, fehlendeInformationen: fehlend,
    hinweis: o.mode === 'demo' ? 'DEMO-MODUS: regelbasierte Ableitung ohne KI.' : o.mode === 'ki' ? 'KI-Ableitung: alle Ergebnisse sind Entwürfe.' : 'Eingebettete Kriterien wurden übernommen.' };
  const existing = await o.db.query(
    `select distinct on (c.id) c.id, c.code, c.slug, v.id as vid, v.version, v.status, v.title, v.description, v.preconditions, v.rule, v.exceptions, v.expected_behavior, v.valid_from, v.valid_to, v.data_fields, v.message_types, v.evidence
       from criteria c join criteria_versions v on v.criterion_id = c.id where c.org_id = $1 order by c.id, v.version desc`, [o.orgId]);
  const seen = new Set<string>();
  const done = o.progress;
  for (const { draft, aiModel } of candidates) {
    if (seen.has(draft.slug)) continue;
    seen.add(draft.slug);
    const ex = existing.rows.find((r) => r.slug === draft.slug);
    if (!ex) {
      const sim = existing.rows.find((r) => jaccard(tokens(r.title), tokens(draft.title)) >= 0.8);
      if (sim) { res.duplikate.push({ slug: draft.slug, aehnlichZu: `${sim.code} ${sim.title}` }); continue; }
      const actor = draft.origin === 'ki-ableitung' ? aiActor(aiModel ?? o.hai.model) : o.actor;
      const created = await tx(o.db, async (c) => {
        const r = await createCriterion(c, actor.kind === 'ki' ? { ...actor, orgId: o.orgId } : actor, o.orgId, draft);
        if (actor.kind === 'ki') await c.query('update criteria_versions set created_by = $2 where id = $1', [r.versionId, o.actor.id]);
        return r;
      });
      res.neu.push({ code: created.code, slug: draft.slug, title: draft.title, id: created.criterionId });
      continue;
    }
    const exEv = (ex.evidence as Evidence[]) ?? [];
    const addEv = draft.evidence.filter((e) => !exEv.some((x) => x.source_version_id === e.source_version_id && x.quote === e.quote));
    if (contentHash(ex as any, draft.origin === 'ki-ableitung') === contentHash(draft, draft.origin === 'ki-ableitung')) {
      // Inhalt gleich: weitere Belege aus dieser Quelle werden nur an Entwürfen ergänzt (freigegebene Versionen bleiben unangetastet)
      if (addEv.length && (ex.status === 'draft' || ex.status === 'clarification')) {
        await tx(o.db, async (c) => { const cur = await currentVersion(c, 'criterion', ex.id); await reviseVersion(c, o.actor, 'criterion', cur.id, { evidence: [...exEv, ...addEv] }, `Weitere Belege aus ${title} ${sv.version_label}`); });
      }
      res.unveraendert.push(ex.code); continue;
    }
    // geändert: neue Version (Entwurf), bestehende Freigaben bleiben unangetastet
    const patch = { title: draft.title, description: draft.description, preconditions: draft.preconditions, rule: draft.rule, exceptions: draft.exceptions, expected_behavior: draft.expected_behavior,
      valid_from: draft.valid_from ?? null, valid_to: draft.valid_to ?? null, data_fields: draft.data_fields ?? [], message_types: draft.message_types ?? [], evidence: [...exEv, ...addEv], origin: draft.origin, ai_meta: draft.ai_meta ?? null };
    const out = await tx(o.db, async (c) => {
      const cur = await currentVersion(c, 'criterion', ex.id);
      if (cur.status === 'submitted') return null;
      return reviseVersion(c, o.actor, 'criterion', cur.id, patch, `Neue Quellenversion ${sv.version_label}: ${draft.change_note ?? ''}`);
    });
    if (out) res.geaendert.push({ code: ex.code, slug: ex.slug, version: out.version.version });
    else verworfen.push({ slug: draft.slug, grund: 'Aktuelle Version liegt zur Freigabe vor; Änderungsvorschlag wurde nicht angelegt.' });
  }
  // entfallen: Belege, die nur aus der VORHERIGEN Version desselben Dokuments stammen und im neuen Text nicht mehr vorkommen
  const prev = await o.db.query(`select id, extracted_text, locators from source_versions where document_id = $1 and id <> $2 and org_id = $3`, [sv.document_id, sv.id, o.orgId]);
  for (const row of existing.rows) {
    if (res.neu.some((n) => n.slug === row.slug) || seen.has(row.slug)) continue;
    const ev = (row.evidence as Evidence[]) ?? [];
    const fromPrev = ev.filter((e) => prev.rows.some((p) => p.id === e.source_version_id));
    if (fromPrev.length && fromPrev.every((e) => !findQuote(sv.extracted_text, sv.locators, e.quote).found)) {
      res.entfallen.push({ code: row.code, slug: row.slug, grund: 'Der Beleg aus der Vorgängerversion kommt in der neuen Quellenversion nicht mehr vor.' });
    }
  }
  await done?.(1, 1, 'Fertig');
  await audit(o.db, { actor: o.actor, orgId: o.orgId, action: 'quelle.kriterien_abgeleitet', objectType: 'source', objectId: sv.id, details: { modus: o.mode, neu: res.neu.length, geaendert: res.geaendert.length, unveraendert: res.unveraendert.length, duplikate: res.duplikate.length, verworfen: res.verworfen.length }, aiModel: o.mode === 'ki' ? o.hai.model : undefined, promptVersion: o.mode === 'ki' ? PROMPTS.deriveCriteria : undefined });
  if (!res.neu.length && !res.geaendert.length && !res.unveraendert.length && !res.duplikate.length && o.mode === 'uebernahme') throw badRequest('In dieser Quelle wurden keine eingebetteten Kriterien mit Original-ID gefunden.');
  return res;
}
