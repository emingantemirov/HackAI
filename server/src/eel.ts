// EEL-Festbreitendateien: Parser, Validierung und (für den Simulator) Builder.
//
// Grundlage ist der aus der Verfahrensbeschreibung DTA EEL V13.4 extrahierte Feldkatalog
// (server/data/eel-field-catalog.json). Was dort nicht kommentiert ist (DBNA, DBAN, DBAP, DSLW 206–224,
// Satzkopf/-ende VOSZ, DSKO, NCSZ), wird NICHT interpretiert, sondern roh bewahrt.
// Die Zeichenkodierung ist in den bereitgestellten Quellen nicht festgelegt: der Parser verlangt sie
// entweder ausdrücklich oder meldet, welche Annahme er getroffen hat.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eelToIso } from './util/dates.js';

interface CatalogField {
  block: string; start: number; length: number; end: number; type: 'an' | 'n' | 'opaque'; kind: 'M' | 'm';
  name: string; repeating: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const catalog: { blocks: Record<string, CatalogField[]> } = JSON.parse(
  fs.readFileSync(path.join(here, '..', 'data', 'eel-field-catalog.json'), 'utf8'),
);

export const KNOWN_BLOCKS = ['DBNA', 'DBAN', 'DBAL', 'DBAE', 'DBZA', 'DBEE', 'DBAW', 'DBFR', 'DBUN', 'DBMU', 'DBVO', 'DBHE', 'DBBE', 'DBLT', 'DBSF', 'DBTK', 'DBAP', 'DBID', 'DBSD', 'DBFE'] as const;
export const UNSPECIFIED_BLOCKS = new Set(['DBNA', 'DBAN', 'DBAP', 'DBFE']);
export const HEADER_LEN = 224; // DSLW Stellen 001–224
export const VALID_ABGABEGRUENDE = ['01', '02', '03', '04', '11', '12', '21', '22', '23', '31', '41', '42', '51', '61', '62', '66', '67', '71', '72', '73', '88', '99'];
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const DATE_FIELDS = new Set([
  'DSLW.GEBURTSDAT', 'DBVO.AU-AB-AG', 'DBVO.AU-AB-SV', 'DBVO.12-MONATSFRIST-AB', 'DBAL.DATUM-AB', 'DBAL.DATUM-EGZBIS',
  'DBAL.ENDE-BV-AM', 'DBAL.ENDE-BV-ZUM', 'DBEE.EEL-ABAG', 'DBEE.EEL-ABSV', 'DBEE.EEL-ENDE',
]);
const DBVO_ENTRY_DATE_FIELDS = new Set(['BEGINN-AU', 'ENDE-AU', 'TEIL-NACHWEIS-AU-BEGINN', 'TEIL-NACHWEIS-AU-ENDE', 'TEIL-ANR-AU-BEGINN', 'TEIL-ANR-AU-ENDE']);

const fieldsOf = (block: string) => (catalog.blocks[block] ?? []).filter((f) => !f.repeating);
export function blockFixedLength(block: string): number | null {
  const f = catalog.blocks[block];
  if (!f || !f.length || block === 'DBVO') return null;
  return Math.max(...f.map((x) => x.end));
}

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface FieldSpan { line: number; start: number; length: number }
export interface ParsedMessage {
  index: number;
  line: number;
  abgabegrund: string;
  dsid: string;
  refId: string | null;
  dsidUr: string | null;
  azvu: string | null;
  version: string;
  verfahren: string;
  absender: string;
  empfaenger: string;
  produktId: string;
  header: Record<string, string>;
  dbvo?: {
    grundav: string; auAbAg: string | null; auAbSv: string | null; kzAkAu: string; frist12: string | null; anzahl: number;
    entries: { beginn: string | null; ende: string | null; kzNachweis: string; teilNachweisBeginn: string | null; teilNachweisEnde: string | null; kzAu: string; teilAnrBeginn: string | null; teilAnrEnde: string | null }[];
  };
  dbal?: { datumAb: string | null; efzEnde: string | null; endeBvAm: string | null; endeBvZum: string | null };
  dbee?: { eelEnde: string | null; eelEndeGrund: string };
  dbsd?: { dsidUr: string; vorname: string; familienname: string; azvu: string };
  blocks: { tag: string; start: number; length: number; lengthDerived: boolean; specified: boolean }[];
  spans: Record<string, FieldSpan>;
}

export interface ParsedFile {
  encoding: string;
  encodingBasis: 'nutzerangabe' | 'automatisch-utf8' | 'automatisch-latin1';
  lineEnding: 'CRLF' | 'LF' | 'gemischt' | 'keine';
  sizeBytes: number;
  records: { line: number; tag: string; chars: number }[];
  messages: ParsedMessage[];
  warnings: string[];
  errors: string[];
}

export class EelParseError extends Error {}

// ---------------------------------------------------------------------------
// Dekodierung
// ---------------------------------------------------------------------------

export function decodeEel(buf: Buffer, requested?: string): { text: string; encoding: string; basis: ParsedFile['encodingBasis']; warnings: string[] } {
  const warnings: string[] = [];
  let text: string; let encoding: string; let basis: ParsedFile['encodingBasis'];
  if (requested) {
    const enc = requested.toLowerCase();
    if (!['utf-8', 'utf8', 'latin1', 'iso-8859-1', 'windows-1252', 'cp1252'].includes(enc)) throw new EelParseError(`Unbekannte Zeichenkodierung „${requested}“.`);
    encoding = enc === 'utf8' ? 'utf-8' : enc;
    text = new TextDecoder(encoding === 'latin1' ? 'iso-8859-1' : encoding, { fatal: false }).decode(buf);
    basis = 'nutzerangabe';
  } else {
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      encoding = 'utf-8'; basis = 'automatisch-utf8';
    } catch {
      text = new TextDecoder('iso-8859-1').decode(buf);
      encoding = 'iso-8859-1'; basis = 'automatisch-latin1';
      warnings.push('Die Datei ist kein gültiges UTF-8; als Rückfall wurde ISO-8859-1 verwendet.');
    }
  }
  warnings.push('Die maßgebliche Zeichenkodierung ist in den bereitgestellten Quellen nicht festgelegt (Gemeinsame Grundsätze Technik fehlen). Die verwendete Kodierung ist eine dokumentierte Annahme, keine Spezifikation.');
  const bad = (text.match(/�/g) ?? []).length;
  if (bad) warnings.push(`Die Datei enthält ${bad} Ersatzzeichen (U+FFFD). Die ursprünglichen Zeichen (z. B. Umlaute/ß) sind in dieser Datei bereits verloren; bitte das Original aus der Quelle beschaffen. Feldlängen werden in Zeichen gerechnet.`);
  return { text, encoding, basis, warnings };
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const slice = (s: string, start: number, len: number) => s.substr(start - 1, len);

function readFields(rec: string, block: string, blockStart: number, line: number, spans: Record<string, FieldSpan>, errors: string[], ctx: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fieldsOf(block)) {
    if (f.type === 'opaque') continue;
    const abs = blockStart + f.start - 1; // 1-basierte Stelle im Satz
    const raw = slice(rec, abs, f.length);
    if (raw.length < f.length) { errors.push(`${ctx}: Feld ${block}.${f.name} (Stelle ${f.start}–${f.end}) ist abgeschnitten.`); continue; }
    out[f.name] = raw;
    spans[`${block}.${f.name}`] = { line, start: abs, length: f.length };
    if (f.type === 'n' && !/^\d+$/.test(raw)) errors.push(`${ctx}: Feld ${block}.${f.name} muss numerisch sein, enthält „${raw}“.`);
    if (DATE_FIELDS.has(`${block}.${f.name}`) && /^\d{8}$/.test(raw) && raw !== '00000000' && !eelToIso(raw)) errors.push(`${ctx}: Feld ${block}.${f.name} enthält ungültiges Datum „${raw}“.`);
  }
  return out;
}

function parseDslw(rec: string, line: number, index: number, errors: string[], warnings: string[]): ParsedMessage | null {
  const ctx = `Zeile ${line}`;
  if (rec.length < HEADER_LEN) { errors.push(`${ctx}: DSLW ist kürzer als der Satzkopf (${rec.length} < ${HEADER_LEN} Zeichen).`); return null; }
  const spans: Record<string, FieldSpan> = {};
  const h = readFields(rec, 'DSLW', 1, line, spans, errors, ctx);
  if (h['VERFAHREN'] !== undefined && h['VERFAHREN'] !== 'LEIST') errors.push(`${ctx}: VERFAHREN muss „LEIST“ sein, ist „${h['VERFAHREN']}“.`);
  if (h['ABGABEGRUND'] !== undefined && !VALID_ABGABEGRUENDE.includes(h['ABGABEGRUND'])) errors.push(`${ctx}: ABGABEGRUND „${h['ABGABEGRUND']}“ ist keine bekannte Schlüsselzahl.`);
  if (h['DATENSATZ-ID'] !== undefined && !UUID_RE.test(h['DATENSATZ-ID'])) errors.push(`${ctx}: DATENSATZ-ID „${h['DATENSATZ-ID']}“ ist keine gültige UUID.`);
  if (h['FEHLER-KENNZ'] !== undefined && !['0', '1'].includes(h['FEHLER-KENNZ'])) errors.push(`${ctx}: FEHLER-KENNZ muss 0 oder 1 sein.`);

  const msg: ParsedMessage = {
    index, line,
    abgabegrund: h['ABGABEGRUND'] ?? '', dsid: h['DATENSATZ-ID'] ?? '', refId: null, dsidUr: null, azvu: null,
    version: h['VERSION-NR'] ?? '', verfahren: h['VERFAHREN'] ?? '', absender: (h['ABSENDERNUMMER'] ?? '').trim(),
    empfaenger: (h['EMPFAENGERNUMMER'] ?? '').trim(), produktId: (h['PRODUKT-IDENTIFIER'] ?? '').trim(),
    header: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.trimEnd()])), blocks: [], spans,
  };

  // Datenbausteine ab Stelle 225
  let pos = HEADER_LEN + 1;
  while (pos <= rec.length) {
    const tag = slice(rec, pos, 4);
    if (!(KNOWN_BLOCKS as readonly string[]).includes(tag)) {
      if (rec.slice(pos - 1).trim() === '') break;
      errors.push(`${ctx}: An Stelle ${pos} wird ein Datenbaustein erwartet, gefunden „${tag}“.`);
      break;
    }
    let len = blockFixedLength(tag);
    let derived = false;
    if (tag === 'DBVO') {
      const n = slice(rec, pos + 30, 2);
      if (!/^\d{2}$/.test(n)) { errors.push(`${ctx}: DBVO.ANZAHL-AU „${n}“ ist nicht numerisch.`); break; }
      len = 4 + 28 + 50 * Number(n);
    } else if (len === null || UNSPECIFIED_BLOCKS.has(tag)) {
      // Layout nicht in den Quellen: Länge bis zum nächsten bekannten Baustein ableiten
      derived = true;
      const rest = rec.slice(pos + 3);
      let next = -1;
      for (const t of KNOWN_BLOCKS) {
        const i = rest.indexOf(t);
        if (i >= 0 && (next < 0 || i < next)) next = i;
      }
      len = next < 0 ? rec.length - pos + 1 : next + 4;
    }
    if (pos + len! - 1 > rec.length) { errors.push(`${ctx}: Baustein ${tag} ab Stelle ${pos} überschreitet das Satzende.`); break; }
    msg.blocks.push({ tag, start: pos, length: len!, lengthDerived: derived, specified: !UNSPECIFIED_BLOCKS.has(tag) });

    if (tag === 'DBVO') {
      const v = readFields(rec, 'DBVO', pos, line, spans, errors, ctx);
      const n = Number(v['ANZAHL-AU']);
      const entries: NonNullable<ParsedMessage['dbvo']>['entries'] = [];
      for (let i = 0; i < n; i++) {
        const b = pos + 32 + i * 50; // Stelle 033 + i*50
        const g = (off: number, l: number, nm: string, date = false) => {
          const raw = slice(rec, b + off, l);
          spans[`DBVO.${nm}#${i + 1}`] = { line, start: b + off, length: l };
          if (date && raw !== '00000000' && !eelToIso(raw)) errors.push(`${ctx}: DBVO.${nm} (AU ${i + 1}) enthält ungültiges Datum „${raw}“.`);
          if (!date && !/^\d+$/.test(raw)) errors.push(`${ctx}: DBVO.${nm} (AU ${i + 1}) muss numerisch sein.`);
          return raw;
        };
        const beginn = g(0, 8, 'BEGINN-AU', true), ende = g(8, 8, 'ENDE-AU', true), kzN = g(16, 1, 'KZ-NACHWEIS');
        const tnb = g(17, 8, 'TEIL-NACHWEIS-AU-BEGINN', true), tne = g(25, 8, 'TEIL-NACHWEIS-AU-ENDE', true), kzA = g(33, 1, 'KZ-AU');
        const tab = g(34, 8, 'TEIL-ANR-AU-BEGINN', true), tae = g(42, 8, 'TEIL-ANR-AU-ENDE', true);
        if (!['0', '1', '2', '4'].includes(kzN)) errors.push(`${ctx}: DBVO.KZ-NACHWEIS (AU ${i + 1}) „${kzN}“ ist nicht zulässig (0, 1, 2, 4).`);
        if (!['0', '1', '2', '3', '5'].includes(kzA)) errors.push(`${ctx}: DBVO.KZ-AU (AU ${i + 1}) „${kzA}“ ist nicht zulässig (0, 1, 2, 3, 5).`);
        if (beginn !== '00000000' && ende !== '00000000' && eelToIso(beginn) && eelToIso(ende) && eelToIso(beginn)! > eelToIso(ende)!) errors.push(`${ctx}: DBVO AU ${i + 1}: Beginn liegt nach dem Ende.`);
        entries.push({ beginn: eelToIso(beginn), ende: eelToIso(ende), kzNachweis: kzN, teilNachweisBeginn: eelToIso(tnb), teilNachweisEnde: eelToIso(tne), kzAu: kzA, teilAnrBeginn: eelToIso(tab), teilAnrEnde: eelToIso(tae) });
      }
      if (!['1', '2', '3'].includes(v['GRUNDAV'] ?? '')) errors.push(`${ctx}: DBVO.GRUNDAV „${v['GRUNDAV']}“ ist nicht zulässig (1, 2, 3).`);
      if (!['0', '4'].includes(v['KZ-AK-AU'] ?? '')) errors.push(`${ctx}: DBVO.KZ-AK-AU „${v['KZ-AK-AU']}“ ist nicht zulässig (0, 4).`);
      if (msg.abgabegrund === '41' && n < 1) errors.push(`${ctx}: Eine Vorerkrankungsanfrage (41) muss mindestens eine Vorerkrankung enthalten.`);
      msg.dbvo = { grundav: v['GRUNDAV'], auAbAg: eelToIso(v['AU-AB-AG']), auAbSv: eelToIso(v['AU-AB-SV']), kzAkAu: v['KZ-AK-AU'], frist12: eelToIso(v['12-MONATSFRIST-AB']), anzahl: n, entries };
    } else if (tag === 'DBID') {
      const v = readFields(rec, 'DBID', pos, line, spans, errors, ctx);
      msg.azvu = (v['AKTENZEICHEN-VERURSACHER'] ?? '').trim();
      const ref = (v['REFERENZ-ID'] ?? '').trim();
      msg.refId = ref || null;
      if (ref && !UUID_RE.test(ref)) errors.push(`${ctx}: DBID.REFERENZ-ID „${ref}“ ist keine gültige UUID.`);
    } else if (tag === 'DBSD') {
      const v = readFields(rec, 'DBSD', pos, line, spans, errors, ctx);
      const ur = (v['DATENSATZ-ID-URSPRUNGSMELDUNG'] ?? '').trim();
      if (ur && !UUID_RE.test(ur)) errors.push(`${ctx}: DBSD.DATENSATZ-ID-URSPRUNGSMELDUNG „${ur}“ ist keine gültige UUID.`);
      msg.dsidUr = ur || null;
      msg.dbsd = { dsidUr: ur, vorname: (v['VORNAME'] ?? '').trim(), familienname: (v['FAMILIENNAME'] ?? '').trim(), azvu: (v['AKTENZEICHEN-VERURSACHER'] ?? '').trim() };
    } else if (tag === 'DBAL') {
      const v = readFields(rec, 'DBAL', pos, line, spans, errors, ctx);
      msg.dbal = { datumAb: eelToIso(v['DATUM-AB'] ?? ''), efzEnde: eelToIso(v['DATUM-EGZBIS'] ?? ''), endeBvAm: eelToIso(v['ENDE-BV-AM'] ?? ''), endeBvZum: eelToIso(v['ENDE-BV-ZUM'] ?? '') };
    } else if (tag === 'DBEE') {
      const v = readFields(rec, 'DBEE', pos, line, spans, errors, ctx);
      msg.dbee = { eelEnde: eelToIso(v['EEL-ENDE'] ?? ''), eelEndeGrund: v['EEL-ENDE-GRUND'] ?? '' };
    } else if (!UNSPECIFIED_BLOCKS.has(tag) && (catalog.blocks[tag] ?? []).length) {
      readFields(rec, tag, pos, line, spans, errors, ctx);
    }
    pos += len!;
  }
  if (msg.abgabegrund === '88' && !msg.blocks.some((b) => b.tag === 'DBSD')) errors.push(`${ctx}: Eine Stornierung (88) benötigt den Datenbaustein DBSD (Stornierungsdaten).`);
  if (msg.abgabegrund === '41' && !msg.blocks.some((b) => b.tag === 'DBVO')) errors.push(`${ctx}: Eine Vorerkrankungsanfrage (41) benötigt den Datenbaustein DBVO.`);
  if (msg.blocks.some((b) => b.lengthDerived)) warnings.push(`${ctx}: Die Länge nicht spezifizierter Bausteine (${msg.blocks.filter((b) => b.lengthDerived).map((b) => b.tag).join(', ')}) wurde aus dem Folge-Baustein abgeleitet; ihr Layout steht nicht in den bereitgestellten Quellen (Anlage 1 fehlt).`);
  return msg;
}

export function parseEel(buf: Buffer, opts: { encoding?: string; maxBytes?: number } = {}): ParsedFile {
  const maxBytes = opts.maxBytes ?? 10 * 1024 * 1024;
  if (buf.length === 0) throw new EelParseError('Die Datei ist leer.');
  if (buf.length > maxBytes) throw new EelParseError(`Die Datei ist zu groß (${buf.length} Bytes, erlaubt ${maxBytes}).`);
  if (buf.includes(0)) throw new EelParseError('Die Datei enthält Binärdaten (NUL-Bytes) und ist keine EEL-Textdatei.');
  const dec = decodeEel(buf, opts.encoding);
  const crlf = (dec.text.match(/\r\n/g) ?? []).length;
  const lf = (dec.text.match(/\n/g) ?? []).length - crlf;
  const lineEnding: ParsedFile['lineEnding'] = crlf && lf ? 'gemischt' : crlf ? 'CRLF' : lf ? 'LF' : 'keine';
  const lines = dec.text.split(/\r\n|\n/);
  const records: ParsedFile['records'] = [];
  const messages: ParsedMessage[] = [];
  const errors: string[] = [];
  const warnings = [...dec.warnings];
  if (lineEnding === 'gemischt') warnings.push('Die Datei enthält gemischte Zeilenenden (CRLF und LF).');
  lines.forEach((rec, i) => {
    if (rec === '') return;
    const tag = rec.slice(0, 4);
    records.push({ line: i + 1, tag, chars: rec.length });
    if (tag === 'DSLW') {
      const m = parseDslw(rec, i + 1, messages.length + 1, errors, warnings);
      if (m) messages.push(m);
    } else if (!['VOSZ', 'DSKO', 'NCSZ'].includes(tag)) {
      errors.push(`Zeile ${i + 1}: Unbekannte Satzart „${tag}“.`);
    }
  });
  const tags = records.map((r) => r.tag);
  if (tags[0] !== 'VOSZ') errors.push('Die Datei beginnt nicht mit einem Vorlaufsatz (VOSZ).');
  if (tags.at(-1) !== 'NCSZ') errors.push('Die Datei endet nicht mit einem Nachlaufsatz (NCSZ).');
  if (!messages.length) errors.push('Die Datei enthält keinen Datensatz Leistungswesen (DSLW).');
  warnings.push('Satzkopf (VOSZ), Kommunikationssatz (DSKO) und Nachlaufsatz (NCSZ) sind in den bereitgestellten Quellen nicht beschrieben und werden nur als Rohsätze geführt.');
  return { encoding: dec.encoding, encodingBasis: dec.basis, lineEnding, sizeBytes: buf.length, records, messages, warnings, errors };
}

// ---------------------------------------------------------------------------
// Builder (nur Simulator): erzeugt strukturell gültige, ausdrücklich synthetische Dateien
// ---------------------------------------------------------------------------

/** Synthetische Füllbausteine, übernommen aus der bereitgestellten Beispieldatei (Layout nicht spezifiziert). */
export const SYNTHETIC_TEMPLATE = {
  vosz: 'VOSZAGEEL99302811       00000000       20260214000001ITSG GmbH                                         01',
  dsko: 'DSKOLEIST99302811       00000000       04202602141313030000000012587964       765432166666XXXSynthetisch (Simulator)                                                                  63067     Offenbach                         Beispielstrasse                           WTestfrau                      069/8700                                simulator@example.invalid                                      ',
  ncsz: 'NCSZAGEEL99302811       00000000       202602140000010000000201',
  dbna: 'DBNA' + 'Mustermann'.padEnd(30) + 'Peter'.padEnd(91),
  dbap: 'DBAP' + 'Mia Testfrau'.padEnd(30) + '069-8700'.padEnd(30) + 'simulator@example.invalid'.padEnd(70) + 'Testfirma Qualitaetskontrolle'.padEnd(30) + 'Einzugsstellen-SVT'.padEnd(30) + 'ITSG GmbH'.padEnd(30) + '63067'.padEnd(10) + 'Offenbach'.padEnd(34) + 'Kaiserleistrasse'.padEnd(33) + '10-16'.padEnd(9) + ''.padEnd(5),
  flags: 'JNNNNNNNNNJNNNNNJJN',
};

function writeBlock(tag: string, values: Record<string, string>): string {
  const fields = fieldsOf(tag).filter((f) => f.type !== 'opaque');
  const len = Math.max(...(catalog.blocks[tag] ?? []).map((f) => f.end));
  const buf = Array.from({ length: len }, () => ' ');
  for (let i = 0; i < 4; i++) buf[i] = tag[i];
  for (const f of fields) {
    const v = values[f.name];
    let s: string;
    if (v !== undefined) s = f.type === 'n' ? v.padStart(f.length, '0') : v.padEnd(f.length, ' ');
    else s = f.type === 'n' ? '0'.repeat(f.length) : ' '.repeat(f.length);
    if (s.length > f.length) throw new Error(`Wert „${s}“ für ${tag}.${f.name} ist länger als ${f.length}.`);
    for (let i = 0; i < f.length; i++) buf[f.start - 1 + i] = s[i];
  }
  return buf.join('');
}

export interface BuildMessage {
  abgabegrund: string;
  dsid: string;
  refId?: string | null;
  azvu: string;
  absender?: string;
  empfaenger?: string;
  produktId?: string;
  version?: string;
  erstellung?: string; // jhjjmmtthhmmss + 6 Stellen
  dbvo?: { auAbAg: string; entries: { beginn: string; ende: string }[]; grundav?: string; kzAkAu?: string; auAbSv?: string; frist12?: string; entryOverrides?: { kzNachweis?: string; kzAu?: string }[] };
  dbal?: { datumAb: string; efzEnde: string; endeBvAm?: string };
  dbee?: { eelAbag: string; eelEnde: string; eelEndeGrund: string };
  dbsd?: { dsidUr: string; vorname: string; familienname: string };
}

export function buildDslw(m: BuildMessage): string {
  const hv: Record<string, string> = {
    VERFAHREN: 'LEIST', ABSENDERNUMMER: m.absender ?? '99302811', EMPFAENGERNUMMER: m.empfaenger ?? '00000000',
    'VERSION-NR': m.version ?? '13', 'DATUM-ERSTELLUNG': m.erstellung ?? '20260311093000000000', 'FEHLER-KENNZ': '0', 'FEHLER-ANZAHL': '0',
    VSNR: '17241280Q497', GEBURTSDAT: '19801224', 'BBNR-VU': '99302811', 'DATENSATZ-ID': m.dsid, 'PRODUKT-IDENTIFIER': m.produktId ?? '7654321',
    'MODIFIKATIONS-IDENTIFIER': 'SIM00001', 'DATUM-VERARBEITUNG': '0'.repeat(20), 'BBNR-KK': '00000000', 'BBNR-ABRECHNUNGSSTELLE': '',
    'RUECKMELDUNG-ENTGELTERSATZLEISTUNG': 'N', ABGABEGRUND: m.abgabegrund, 'KORR-ABGABEGRUND': '00', ABRECHNUNGSPROGRAMM: '1',
  };
  const header = writeBlock('DSLW', hv).slice(0, 205) + SYNTHETIC_TEMPLATE.flags;
  const parts = [header, SYNTHETIC_TEMPLATE.dbna];
  if (m.dbal) parts.push(writeBlock('DBAL', { 'DATUM-AB': m.dbal.datumAb, 'AE-ERSTTAG': '0', 'DATUM-EGZBIS': m.dbal.efzEnde, 'ENDE-BV-AM': m.dbal.endeBvAm ?? '00000000', PFLZUSCHLAG: 'N', ARBZEITMOD: 'N' }));
  if (m.dbvo) {
    const n = m.dbvo.entries.length;
    let v = writeBlock('DBVO', { GRUNDAV: m.dbvo.grundav ?? '1', 'AU-AB-AG': m.dbvo.auAbAg, 'AU-AB-SV': m.dbvo.auAbSv ?? '00000000', 'KZ-AK-AU': m.dbvo.kzAkAu ?? '0', '12-MONATSFRIST-AB': m.dbvo.frist12 ?? '00000000', 'ANZAHL-AU': String(n).padStart(2, '0') }).slice(0, 32);
    m.dbvo.entries.forEach((e, i) => {
      const o = m.dbvo!.entryOverrides?.[i] ?? {};
      v += e.beginn + e.ende + (o.kzNachweis ?? '0') + '00000000' + '00000000' + (o.kzAu ?? '0') + '00000000' + '00000000';
    });
    parts.push(v);
  }
  if (m.dbee) parts.push(writeBlock('DBEE', { 'EEL-ABAG': m.dbee.eelAbag, 'EEL-ABSV': '00000000', 'EEL-ENDE': m.dbee.eelEnde, 'EEL-ENDE-GRUND': m.dbee.eelEndeGrund }));
  parts.push(SYNTHETIC_TEMPLATE.dbap);
  parts.push(writeBlock('DBID', { 'AKTENZEICHEN-SV': '', 'AKTENZEICHEN-VERURSACHER': m.azvu, 'REFERENZ-ID': m.refId ?? '' }));
  if (m.dbsd) parts.push(writeBlock('DBSD', { 'DATENSATZ-ID-URSPRUNGSMELDUNG': m.dbsd.dsidUr, VORNAME: m.dbsd.vorname, FAMILIENNAME: m.dbsd.familienname, 'AKTENZEICHEN-VERURSACHER': m.azvu }));
  return parts.join('');
}

export function buildEelFile(messages: BuildMessage[]): string {
  return [SYNTHETIC_TEMPLATE.vosz, SYNTHETIC_TEMPLATE.dsko, ...messages.map(buildDslw), SYNTHETIC_TEMPLATE.ncsz].join('\r\n') + '\r\n';
}
