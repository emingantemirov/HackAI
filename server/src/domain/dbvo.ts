// Deterministische Soll-Berechnung für Vorerkrankungsanfragen (Abgabegrund 41).
//
// WICHTIG zur Einordnung (siehe docs/FACHLICHE-GRUNDLAGEN.md):
//  * Die Regeln stammen aus Gemeinsamen Grundsätzen V13.1 Abschn. 2.1.2 und dem Beispieldokument „Vorerkrankung“.
//  * Konkrete Rechenvorschriften (Kalendergrenzen, Zählweise) sind FACHLICHE ABLEITUNGEN und gelten erst nach Freigabe.
//  * An der Sechsmonatsgrenze widersprechen sich die Quellen („nicht mehr als 6 Monate“ vs. „nicht mindestens 6 Monate
//    vergangen“). Ohne Entscheidung liefert die Engine ausdrücklich „klaerung_erforderlich“ – sie entscheidet nicht still.

import { addDays, addMonths, compareDates, formatDe, inclusiveDays } from '../util/dates.js';

export type SixMonthPolicy = 'inklusive' | 'exklusive' | null;

export interface AuPeriod {
  start: string;
  end: string;
  /** Dem Arbeitgeber liegt eine AU-Bescheinigung vor (eAU oder Papier). Unbescheinigte Kurz-AU-Zeiten: false. */
  certified: boolean;
  evidence?: 'eAU' | 'papier' | 'keine';
}

export interface DbvoInput {
  today: string;
  insurance: 'GKV' | 'PKV';
  marginalEmployment: boolean;
  employment: { start: string; end: string | null };
  current: { start: string; end: string | null; certificate: boolean };
  prior: AuPeriod[];
  policy: { sixMonth: SixMonthPolicy };
}

export interface CheckResult {
  id: string;
  /** Verweis auf das Kriterium (slug) */
  criterion: string;
  ok: boolean | null; // null = nicht maschinell prüfbar / ungeklärt
  text: string;
}

export interface DbvoDecision {
  outcome: 'erzeugen' | 'nicht_erzeugen' | 'klaerung_erforderlich';
  checks: CheckResult[];
  chain: { start: string; end: string }[]; // aktuellste zuerst – so sind sie im DBVO anzugeben
  currentDays: number;
  chainDaysInWindow: number;
  cumulativeDays: number;
  windowStart: string;
  blockedBy: string[]; // Klärungs-Schlüssel
  derivation: string;
}

export const CLARIFY_SIX_MONTH = 'sechsmonatsgrenze-gleichheit';

export function currentAuDays(input: Pick<DbvoInput, 'today' | 'current'>): { days: number; end: string; note: string } {
  if (input.current.end) {
    return { days: inclusiveDays(input.current.start, input.current.end), end: input.current.end, note: `bescheinigtes AU-Ende ${formatDe(input.current.end)}` };
  }
  // Offenes Ende: Dauer einer Woche in die Zukunft ab dem Tagesdatum (Grundsätze 2.1.2 / Verfahrensbeschreibung 3.12)
  const end = addDays(input.today, 7);
  return { days: inclusiveDays(input.current.start, end), end, note: `offenes AU-Ende: Tagesdatum ${formatDe(input.today)} + 7 Tage = ${formatDe(end)}` };
}

export function decideDbvo41(input: DbvoInput): DbvoDecision {
  const checks: CheckResult[] = [];
  const blockedBy: string[] = [];
  const lines: string[] = [];
  const windowStart = addMonths(input.today, -12);
  const cur = currentAuDays(input);

  const finish = (outcome: DbvoDecision['outcome'], chain: DbvoDecision['chain'] = [], chainDays = 0): DbvoDecision => ({
    outcome, checks, chain, currentDays: cur.days, chainDaysInWindow: chainDays,
    cumulativeDays: chainDays + cur.days, windowStart, blockedBy, derivation: lines.join('\n'),
  });

  // 1) GKV, nicht geringfügig beschäftigt
  const gkvOk = input.insurance === 'GKV' && !input.marginalEmployment;
  checks.push({
    id: 'gkv', criterion: 'gkv-teilnahme', ok: gkvOk,
    text: gkvOk ? 'Arbeitnehmer ist gesetzlich krankenversichert und nicht geringfügig beschäftigt.'
      : input.insurance === 'PKV' ? 'Privat krankenversichert: Vorerkrankungsanfrage im DTA EEL nicht möglich.'
      : 'Geringfügig beschäftigt: Vorerkrankungsanfrage im DTA EEL nicht möglich.',
  });
  lines.push(`1. ${checks.at(-1)!.text}`);
  if (!gkvOk) return finish('nicht_erzeugen');

  // 2) Beschäftigungsverhältnis für den angefragten Zeitraum
  const empOk = compareDates(input.employment.start, input.current.start) <= 0 &&
    (input.employment.end === null || compareDates(input.employment.end, input.current.start) >= 0);
  checks.push({
    id: 'beschaeftigung', criterion: 'beschaeftigungsverhaeltnis', ok: empOk,
    text: empOk ? `Beschäftigungsverhältnis besteht zum AU-Beginn ${formatDe(input.current.start)}.`
      : `Kein Beschäftigungsverhältnis zum AU-Beginn ${formatDe(input.current.start)}.`,
  });
  lines.push(`2. ${checks.at(-1)!.text}`);
  if (!empOk) return finish('nicht_erzeugen');

  // 3) AU-Nachweis für aktuelle AU
  checks.push({
    id: 'au-nachweis', criterion: 'au-nachweis-aktuell', ok: input.current.certificate,
    text: input.current.certificate ? 'Für die aktuelle AU liegt dem Arbeitgeber ein AU-Nachweis vor.' : 'Für die aktuelle AU liegt kein AU-Nachweis vor.',
  });
  lines.push(`3. ${checks.at(-1)!.text}`);
  if (!input.current.certificate) return finish('nicht_erzeugen');

  // 4) mindestens eine vorherige AU attestiert (f41c7278)
  const priors = input.prior.filter((p) => p.certified && compareDates(p.start, input.current.start) < 0)
    .sort((a, b) => compareDates(b.start, a.start));
  checks.push({
    id: 'vorherige-au', criterion: 'f41c7278', ok: priors.length > 0,
    text: priors.length ? `${priors.length} bescheinigte vorherige AU-Zeit(en) liegen vor.` : 'Keine bescheinigte vorherige AU-Zeit vorhanden.',
  });
  lines.push(`4. ${checks.at(-1)!.text}`);
  if (!priors.length) return finish('nicht_erzeugen');

  // 5) Verkettung nach Sechsmonatsregel (0cefe80e / aade0289 „Daumenkriterium“), kalendarisch
  const chain: { start: string; end: string }[] = [];
  let anchor = input.current.start;
  let boundaryHit = false;
  const linkText: string[] = [];
  for (const p of priors) {
    const limit = addMonths(p.end, 6);
    const cmp = compareDates(anchor, limit); // <0: innerhalb, 0: genau 6 Monate, >0: darüber
    let linked: boolean | null;
    if (cmp < 0) linked = true;
    else if (cmp > 0) linked = false;
    else if (input.policy.sixMonth === 'inklusive') linked = true;
    else if (input.policy.sixMonth === 'exklusive') linked = false;
    else { linked = null; boundaryHit = true; }
    linkText.push(`${formatDe(p.start)}–${formatDe(p.end)} → Folgebeginn ${formatDe(anchor)}: Ende+6 Monate = ${formatDe(limit)} ⇒ ` +
      (linked === true ? 'verkettet' : linked === false ? 'nicht verkettet (Kette endet)' : 'GENAU 6 MONATE – Gleichheitsgrenze ungeklärt'));
    if (linked === null) break;
    if (!linked) break;
    chain.push({ start: p.start, end: p.end });
    anchor = p.start;
  }
  lines.push(`5. Verkettung (kalendarische Monate): ${linkText.join('; ')}`);
  if (boundaryHit) {
    blockedBy.push(CLARIFY_SIX_MONTH);
    checks.push({
      id: 'verkettung', criterion: 'aade0289', ok: null,
      text: 'Die Verkettung liegt genau auf der Sechsmonatsgrenze. Die Quellen formulieren die Gleichheit unterschiedlich; Soll-Ergebnis blockiert bis zur fachlichen Entscheidung.',
    });
    return finish('klaerung_erforderlich', chain);
  }
  checks.push({
    id: 'verkettung', criterion: 'aade0289', ok: chain.length > 0,
    text: chain.length ? `${chain.length} AU-Zeit(en) verkettet (aktuellste zuerst).` : 'Die letzte attestierte AU liegt mehr als 6 Monate vor der aktuellen AU – keine potentielle Vorerkrankung.',
  });
  checks.push({
    id: 'sechs-monate', criterion: '0cefe80e', ok: chain.length > 0,
    text: chain.length ? 'Zwischen aktueller AU und letzter attestierter AU liegen nicht mehr als 6 Monate.' : 'Zwischen aktueller AU und letzter attestierter AU liegen mehr als 6 Monate.',
  });
  if (!chain.length) return finish('nicht_erzeugen');

  // 6) 30 Tage kumuliert in den letzten 12 Monaten inkl. aktueller AU (9c8c9b58)
  let chainDays = 0;
  for (const p of chain) {
    const s = compareDates(p.start, windowStart) < 0 ? windowStart : p.start;
    const e = compareDates(p.end, input.today) > 0 ? input.today : p.end;
    if (compareDates(s, e) <= 0) chainDays += inclusiveDays(s, e);
  }
  const total = chainDays + cur.days;
  const ok30 = total >= 30;
  checks.push({
    id: '30-tage', criterion: '9c8c9b58', ok: ok30,
    text: `Kumuliert ${chainDays} Tage Vorerkrankung (Fenster ab ${formatDe(windowStart)}) + ${cur.days} Tage aktuelle AU (${cur.note}) = ${total} Tage ${ok30 ? '≥' : '<'} 30.`,
  });
  lines.push(`6. ${checks.at(-1)!.text}`);
  checks.push({
    id: 'sinnhaftigkeit', criterion: 'sinnhaftigkeit-pruefung', ok: null,
    text: 'Die Anfrage ist vor dem Versand individuell durch den Arbeitgeber auf Sinnhaftigkeit zu prüfen (nicht maschinell prüfbar).',
  });
  if (!ok30) return finish('nicht_erzeugen', chain, chainDays);
  return finish('erzeugen', chain, chainDays);
}
