// SIMULATOR – Demonstration, keine echte Software.
// Setzt die Abgabegrund-41-Regeln mit derselben Engine um wie das Portal und erzeugt EEL-Dateien.
// Wählbare Fehlerbilder zeigen, dass der Vergleich Abweichungen wirklich findet.

import crypto from 'node:crypto';
import { buildEelFile, type BuildMessage, type ParsedMessage } from '../eel.js';
import { decideDbvo41 } from '../domain/dbvo.js';
import { isoToEel, addDays } from '../util/dates.js';
import { AZVU_DEFAULT, type Scenario } from '../domain/testcases.js';
import type { SixMonthPolicy } from '../domain/dbvo.js';

export type SimFault = 'keine' | 'falsche-efz' | 'ohne-meldung' | 'doppelte-id' | 'zusaetzliche-au' | 'falscher-au-beginn' | 'verwirft-korrektur';
export const SIM_FAULTS: { key: SimFault; label: string }[] = [
  { key: 'keine', label: 'Fehlerfrei (Referenzverhalten)' },
  { key: 'falsche-efz', label: 'Falsches EFZ-Ende (um einen Tag verschoben)' },
  { key: 'ohne-meldung', label: 'Erzeugt die erwartete Meldung nicht' },
  { key: 'doppelte-id', label: 'Vergibt eine DATENSATZ-ID doppelt' },
  { key: 'zusaetzliche-au', label: 'Übermittelt eine zusätzliche, nicht verkettete AU-Zeit' },
  { key: 'falscher-au-beginn', label: 'Falscher Beginn der aktuellen AU' },
  { key: 'verwirft-korrektur', label: 'Verwirft die korrigierte Krankenkassen-Antwort als Dublette' },
];

export const uuid = () => crypto.randomUUID().toUpperCase();
const stamp = (testDate: string) => `${isoToEel(testDate)}093000000000`;

export interface SimRun { azvu: string; scenario: Scenario; multistep: boolean }

export function simulateStage(run: SimRun, stage: number, policy: { sixMonth: SixMonthPolicy; beschaeftigungsende: 'am' | 'zum' | null }, prev: ParsedMessage[], fault: SimFault): { messages: BuildMessage[]; note: string } {
  const s = run.scenario;
  const base = { azvu: run.azvu, erstellung: stamp(s.today) };
  if (fault === 'ohne-meldung') return { messages: [], note: 'Fehlerbild: keine Meldung erzeugt.' };
  if (stage === 0) {
    const d = decideDbvo41({ ...s, policy: { sixMonth: policy.sixMonth } });
    if (d.outcome === 'klaerung_erforderlich') throw new Error('Der Simulator kann einen Fall auf der ungeklärten Sechsmonatsgrenze nicht verarbeiten (Klärung erforderlich).');
    if (d.outcome !== 'erzeugen') return { messages: [], note: 'Regelverhalten: keine 41 erzeugt.' };
    const chain = d.chain.map((c) => ({ beginn: isoToEel(c.start), ende: isoToEel(c.end) }));
    if (fault === 'zusaetzliche-au') chain.push({ beginn: isoToEel('2024-01-02'), ende: isoToEel('2024-01-20') });
    const au = fault === 'falscher-au-beginn' ? addDays(s.current.start, 1) : s.current.start;
    return { messages: [{ ...base, abgabegrund: '41', dsid: uuid(), dbvo: { auAbAg: isoToEel(au), entries: chain } }], note: 'Eine 41 erzeugt.' };
  }
  if (!run.multistep) return { messages: [], note: 'Keine weitere Stufe.' };
  const am = policy.beschaeftigungsende !== 'zum';
  const endeBv = isoToEel(s.employment.end ?? '0000-00-00');
  if (stage === 1) {
    const efz = fault === 'falsche-efz' ? '20260331' : '20260330';
    return { messages: [{ ...base, abgabegrund: '01', dsid: uuid(), dbal: { datumAb: isoToEel('2026-03-11'), efzEnde: efz, ...(am ? { endeBvAm: endeBv } : {}) } }], note: 'Entgeltbescheinigung (01), EFZ-Ende 30.03.2026.' };
  }
  if (stage === 2) {
    const first01 = prev.find((m) => m.abgabegrund === '01');
    if (!first01) throw new Error('Simulator: Die erste Entgeltbescheinigung (01) liegt nicht vor.');
    if (fault === 'verwirft-korrektur') return { messages: [], note: 'Fehlerbild: korrigierte Antwort als Dublette verworfen.' };
    const m88: BuildMessage = { ...base, abgabegrund: '88', dsid: uuid(), dbsd: { dsidUr: first01.dsid, vorname: 'Peter', familienname: 'Mustermann' } };
    const dsid = fault === 'doppelte-id' ? m88.dsid : uuid();
    return { messages: [m88, { ...base, abgabegrund: '01', dsid, dbal: { datumAb: isoToEel('2026-03-11'), efzEnde: '20260327', ...(am ? { endeBvAm: endeBv } : {}) } }], note: 'Storno (88) und neue Entgeltbescheinigung (01), EFZ-Ende 27.03.2026.' };
  }
  return { messages: [], note: 'Nach Ende der EEL-Meldung (62) sind keine weiteren Meldungen vorgesehen.' };
}

export const buildFile = (msgs: BuildMessage[]) => buildEelFile(msgs);
export { AZVU_DEFAULT };
