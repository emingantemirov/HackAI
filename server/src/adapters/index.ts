// Adapter-Architektur für Softwareprofile.
//
// Ein Adapter kann (je nach Implementierungsstand): Eingangsdaten exportieren, EEL-Ausgaben importieren,
// Folgeantworten der Krankenkasse bereitstellen und Formate prüfen. Das Portal behauptet nur, was ein Adapter wirklich kann.
// Es gibt KEINE echte Schnittstelle zu einer Herstellersoftware (z. B. Lexware): sie ist „Noch nicht konfiguriert“.
// Der Simulator ist eine Referenzumsetzung zu Demozwecken und ausdrücklich keine echte Software.

import crypto from 'node:crypto';
import type { Scenario } from '../domain/testcases.js';

export type AdapterStatus = 'implementiert' | 'simulator' | 'nicht_konfiguriert';
export interface AdapterInfo {
  key: string; label: string; status: AdapterStatus; statusLabel: string;
  capabilities: { eingangsdatenExport: boolean; ausgabeImport: boolean; folgeantworten: boolean; formatpruefung: boolean; automatischerLauf: boolean };
  description: string; limitations: string[];
}

export const ADAPTERS: AdapterInfo[] = [
  {
    key: 'manual', label: 'Manueller, dokumentierter Ablauf', status: 'implementiert', statusLabel: 'Implementiert',
    capabilities: { eingangsdatenExport: true, ausgabeImport: true, folgeantworten: true, formatpruefung: true, automatischerLauf: false },
    description: 'Das Portal stellt ein Prüfpaket mit synthetischen Eingangsdaten bereit (JSON, lesbar). Die Prüfperson oder der Hersteller erfasst die Daten in der Software, lässt die EEL-Datei erzeugen und lädt sie hoch. Folgeantworten der Krankenkasse stellt das Portal als EEL-Datei bereit.',
    limitations: ['Die Dateneingabe in die Software erfolgt von Hand.', 'Zeichenkodierung ist in den bereitgestellten Quellen nicht festgelegt (dokumentierte Annahme).', 'Satzkopf, Kommunikationssatz und Nachlaufsatz sind nur als Rohsätze bekannt.'],
  },
  {
    key: 'simulator', label: 'Simulator (Demonstration)', status: 'simulator', statusLabel: 'Simulator – keine echte Software',
    capabilities: { eingangsdatenExport: true, ausgabeImport: true, folgeantworten: true, formatpruefung: true, automatischerLauf: true },
    description: 'Referenzumsetzung der Abgabegrund-41-Regeln mit wählbaren Fehlerbildern. Der Simulator erzeugt EEL-Ausgabedateien, die dieselbe Importstrecke durchlaufen wie echte Rückgaben. Er dient nur der Demonstration.',
    limitations: ['Keine Aussage über echte Herstellersoftware.', 'Deckt nur Abgabegrund 41 und das dokumentierte Mehrschritt-Szenario ab.', 'Füllbausteine (DBNA, DBAP, VOSZ, DSKO, NCSZ) sind synthetisch aus der Beispieldatei übernommen; ihr Layout ist nicht spezifiziert.'],
  },
  {
    key: 'lexware', label: 'Lexware (Beispielprofil)', status: 'nicht_konfiguriert', statusLabel: 'Noch nicht konfiguriert',
    capabilities: { eingangsdatenExport: false, ausgabeImport: false, folgeantworten: false, formatpruefung: false, automatischerLauf: false },
    description: 'Für dieses Softwareprofil gibt es keine implementierte Schnittstelle. Es wird keine Kompatibilität behauptet.',
    limitations: ['Es sind keine Herstellerschnittstellen dokumentiert oder implementiert. Bitte den manuellen Ablauf nutzen.'],
  },
];

export const getAdapter = (key: string) => ADAPTERS.find((a) => a.key === key);

export interface PackageRun {
  runId: string; azvu: string; testcaseCode: string; testcaseVersion: number; title: string; testDate: string;
  scenario: Scenario; multistep: boolean; stages: { stage: number; actor: string; kind: string; text: string }[];
}

export interface PackageMeta {
  campaign: { id: string; name: string }; packageNo: number; software: { vendor: string; product: string; version: string };
  ruleset: { label: string; documentVersion: string; recordVersion: string }; adapterKey: string; createdAt: string;
}

export interface PackagePreview {
  ok: boolean; errors: string[]; warnings: string[];
  manifest: { format: string; runs: number; testDate: string[]; sha256: string; adapter: string; fileName: string };
}

/** Prüfpaket: ausschließlich Eingangsdaten und Ablaufanweisungen. Soll-Ergebnisse sind bewusst NICHT enthalten (Unabhängigkeit). */
export function buildInputPackage(meta: PackageMeta, runs: PackageRun[]): { fileName: string; content: Buffer; preview: PackagePreview } {
  const errors: string[] = [], warnings: string[] = [];
  const body = {
    format: 'eel-pruefportal/eingangsdaten/1',
    hinweis: 'Ausschließlich synthetische Testdaten. Dieses Paket enthält keine Soll-Ergebnisse.',
    paket: { nummer: meta.packageNo, erstellt: meta.createdAt, adapter: meta.adapterKey },
    pruefung: meta.campaign, software: meta.software, regelwerk: meta.ruleset,
    ablauf: [
      '1. Eingangsdaten je Testfall in der Software erfassen (Tagesdatum der Software auf das angegebene Testdatum stellen).',
      '2. Aktenzeichen des Verursachers (AZVU) je Testfall exakt wie angegeben verwenden – sie dient der Zuordnung der Rückgabe.',
      '3. Die von der Software erzeugte EEL-Datei unverändert im Portal hochladen (Bereich „Prüfungen“ → Rückgabedaten).',
      '4. Bei mehrstufigen Testfällen stellt das Portal nach jeder Rückgabe die Folgeantwort der Krankenkasse als EEL-Datei bereit; diese in der Software einlesen und die Ausgabe erneut hochladen.',
    ],
    testfaelle: runs.map((r) => ({
      lauf: r.runId, azvu: r.azvu, testfall: r.testcaseCode, version: r.testcaseVersion, titel: r.title, testdatum: r.testDate, mehrstufig: r.multistep,
      eingangsdaten: {
        krankenversicherung: r.scenario.insurance === 'GKV' ? 'gesetzlich (GKV)' : 'privat (PKV)', geringfuegigBeschaeftigt: r.scenario.marginalEmployment,
        beschaeftigung: { beginn: r.scenario.employment.start, ende: r.scenario.employment.end },
        aktuelleAU: { beginn: r.scenario.current.start, ende: r.scenario.current.end, auNachweisLiegtVor: r.scenario.current.certificate },
        fruehereAU: r.scenario.prior.map((p) => ({ beginn: p.start, ende: p.end, bescheinigt: p.certified, nachweisart: p.evidence === 'papier' ? 'Papiernachweis' : p.evidence === 'eAU' ? 'eAU' : 'kein Nachweis' })),
      },
      ereignisse: r.stages.filter((s) => s.kind !== 'erwartet').map((s) => ({ stufe: s.stage, akteur: s.actor, beschreibung: s.text })),
    })),
  };
  if (!runs.length) errors.push('Das Paket enthält keine Testläufe.');
  const dates = [...new Set(runs.map((r) => r.testDate))];
  for (const r of runs) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.testDate)) errors.push(`${r.testcaseCode}: Testdatum fehlt oder ist ungültig.`);
    if (!r.azvu) errors.push(`${r.testcaseCode}: AZVU fehlt.`);
    if (r.azvu.length > 20) errors.push(`${r.testcaseCode}: AZVU länger als 20 Zeichen (Feld DBID.AKTENZEICHEN-VERURSACHER).`);
  }
  if (new Set(runs.map((r) => r.azvu)).size !== runs.length) errors.push('AZVU sind nicht eindeutig; Rückgaben ließen sich nicht zuordnen.');
  if (dates.length > 1) warnings.push('Das Paket enthält mehrere Testdaten; die Software muss je Testfall entsprechend eingestellt werden.');
  const content = Buffer.from(JSON.stringify(body, null, 2) + '\n', 'utf8');
  const sha = crypto.createHash('sha256').update(content).digest('hex');
  const fileName = `pruefpaket-${meta.packageNo.toString().padStart(3, '0')}-${meta.campaign.name.replace(/[^A-Za-z0-9]+/g, '-').slice(0, 30)}.json`;
  return { fileName, content, preview: { ok: errors.length === 0, errors, warnings, manifest: { format: body.format, runs: runs.length, testDate: dates, sha256: sha, adapter: meta.adapterKey, fileName } } };
}
