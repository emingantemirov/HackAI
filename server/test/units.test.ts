import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { decideDbvo41, type DbvoInput } from '../src/domain/dbvo.js';
import { compareMoney, parseMoneyToCents } from '../src/util/money.js';
import { addMonths, inclusiveDays } from '../src/util/dates.js';
import { parseEel, buildEelFile } from '../src/eel.js';
import { findQuote } from '../src/extract.js';

const base: DbvoInput = {
  today: '2026-03-11', insurance: 'GKV', marginalEmployment: false, employment: { start: '2020-01-01', end: null },
  current: { start: '2026-03-11', end: '2026-03-20', certificate: true },
  prior: [{ start: '2026-02-10', end: '2026-03-01', certified: true, evidence: 'eAU' }], policy: { sixMonth: null },
};

describe('DBVO-Engine (Abgabegrund 41)', () => {
  it('30 Tage erzeugen, 29 nicht (Grenzfall)', () => {
    expect(decideDbvo41(base).outcome).toBe('erzeugen');
    expect(decideDbvo41(base).cumulativeDays).toBe(30);
    expect(decideDbvo41({ ...base, prior: [{ start: '2026-02-11', end: '2026-03-01', certified: true }] }).outcome).toBe('nicht_erzeugen');
    expect(decideDbvo41({ ...base, prior: [{ start: '2026-02-09', end: '2026-03-01', certified: true }] }).cumulativeDays).toBe(31);
  });
  it('Gleichheit bei genau 6 Monaten wird NICHT still entschieden', () => {
    const eq = { ...base, prior: [{ start: '2025-08-12', end: '2025-09-11', certified: true }] };
    expect(decideDbvo41(eq).outcome).toBe('klaerung_erforderlich');
    expect(decideDbvo41({ ...eq, policy: { sixMonth: 'inklusive' } }).outcome).toBe('erzeugen');
    expect(decideDbvo41({ ...eq, policy: { sixMonth: 'exklusive' } }).outcome).toBe('nicht_erzeugen');
  });
  it('kalendarische Monate (Monatsende klemmt)', () => {
    expect(addMonths('2025-08-31', 6)).toBe('2026-02-28');
    expect(addMonths('2024-08-31', 6)).toBe('2025-02-28');
  });
  it('offenes AU-Ende: Tagesdatum + 7 Tage', () => {
    const d = decideDbvo41({ ...base, current: { start: '2026-03-11', end: null, certificate: true }, prior: [{ start: '2026-02-08', end: '2026-03-01', certified: true }] });
    expect(d.currentDays).toBe(8);
    expect(d.outcome).toBe('erzeugen');
    expect(decideDbvo41({ ...base, current: { start: '2026-03-11', end: null, certificate: true }, prior: [{ start: '2026-02-09', end: '2026-03-01', certified: true }] }).outcome).toBe('nicht_erzeugen');
  });
  it('unbescheinigte Kurz-AU wird nicht übernommen, Kette über 12 Monate hinaus schon', () => {
    const d = decideDbvo41({ ...base, prior: [{ start: '2026-01-20', end: '2026-02-15', certified: true }, { start: '2026-02-20', end: '2026-02-22', certified: false }] });
    expect(d.chain).toHaveLength(1);
    const long = decideDbvo41({ ...base, prior: [{ start: '2026-02-01', end: '2026-02-28', certified: true }, { start: '2025-08-01', end: '2025-08-15', certified: true }, { start: '2025-01-15', end: '2025-02-20', certified: true }] });
    expect(long.chain).toHaveLength(3);
    expect(long.chainDaysInWindow).toBe(28 + 15);
  });
  it('PKV, geringfügig, ohne Beschäftigung, ohne Attest: keine 41', () => {
    expect(decideDbvo41({ ...base, insurance: 'PKV' }).outcome).toBe('nicht_erzeugen');
    expect(decideDbvo41({ ...base, marginalEmployment: true }).outcome).toBe('nicht_erzeugen');
    expect(decideDbvo41({ ...base, employment: { start: '2020-01-01', end: '2026-03-05' } }).outcome).toBe('nicht_erzeugen');
    expect(decideDbvo41({ ...base, current: { ...base.current, certificate: false } }).outcome).toBe('nicht_erzeugen');
  });
  it('Szenario der Hinweise: vier verkettete AU-Zeiten, 35 Tage', () => {
    const d = decideDbvo41({ ...base, employment: { start: '2020-01-01', end: '2026-03-31' }, prior: [
      { start: '2025-07-14', end: '2025-07-15', certified: true }, { start: '2025-10-01', end: '2025-10-17', certified: true },
      { start: '2025-12-01', end: '2025-12-03', certified: true }, { start: '2026-03-01', end: '2026-03-03', certified: true, evidence: 'papier' }] });
    expect(d.outcome).toBe('erzeugen');
    expect(d.chain.map((c) => c.start)).toEqual(['2026-03-01', '2025-12-01', '2025-10-01', '2025-07-14']);
    expect(d.cumulativeDays).toBe(2 + 17 + 3 + 3 + 10);
  });
  it('inclusiveDays', () => expect(inclusiveDays('2026-03-11', '2026-03-20')).toBe(10));
});

describe('Beträge in ganzen Cent', () => {
  it('Demonstrationsfall 2.140,50 / 2.104,50 / −36,00 €', () => {
    const r = compareMoney('2.140,50', '2.104,50');
    expect(r.equal).toBe(false); expect(r.diffCents).toBe(-3600n); expect(r.diff).toBe('−36,00 €');
  });
  it('kein Gleitkomma-Fehler', () => { expect(parseMoneyToCents('0,10') + parseMoneyToCents('0,20')).toBe(parseMoneyToCents('0,30')); expect(compareMoney('0,30', '0.30').equal).toBe(true); });
  it('ungültige Beträge werden abgelehnt', () => { expect(() => parseMoneyToCents('12,345')).toThrow(); expect(() => parseMoneyToCents('abc')).toThrow(); });
});

describe('EEL-Parser', () => {
  it('Builder → Parser Round-Trip, feste Positionen', () => {
    const text = buildEelFile([{ abgabegrund: '41', dsid: '11111111-2222-AAAA-EEEE-111111111111', azvu: '1234-5678-007', dbvo: { auAbAg: '20260311', entries: [{ beginn: '20260301', ende: '20260303' }, { beginn: '20251201', ende: '20251203' }] } }]);
    const p = parseEel(Buffer.from(text, 'utf8'));
    expect(p.errors).toEqual([]);
    expect(p.messages[0].abgabegrund).toBe('41');
    expect(p.messages[0].dbvo?.anzahl).toBe(2);
    expect(p.messages[0].dbvo?.entries[1]).toMatchObject({ beginn: '2025-12-01', ende: '2025-12-03' });
    expect(p.messages[0].azvu).toBe('1234-5678-007');
    expect(p.lineEnding).toBe('CRLF');
  });
  it('Beispieldatei aus dem Auftrag wird ohne Fehler gelesen (4 AU-Zeiten)', () => {
    const f = path.resolve(__dirname, '../../sources/TEEL0-Test1-DBVO.eel');
    const p = parseEel(fs.readFileSync(f));
    expect(p.errors).toEqual([]);
    expect(p.messages[0].dbvo?.entries).toHaveLength(4);
  });
  it('kaputte Dateien erzeugen Fehler statt stiller Annahmen', () => {
    expect(() => parseEel(Buffer.alloc(0))).toThrow();
    expect(() => parseEel(Buffer.from([0, 1, 2]))).toThrow();
    expect(parseEel(Buffer.from('XXXXkaputt\r\n')).errors.length).toBeGreaterThan(0);
  });
});

describe('Beleg-Prüfung', () => {
  it('findet Zitate trotz Silbentrennung und Leerraum, erfindet nichts', () => {
    const text = 'Es ist daher nicht erforderlich, dass die über-\nmittelten Zeiten\n zusammen mit der AU 30 Tage umfassen.';
    expect(findQuote(text, [], 'dass die übermittelten Zeiten zusammen mit der AU 30 Tage umfassen').found).toBe(true);
    expect(findQuote(text, [], 'dass die Zeiten 31 Tage umfassen').found).toBe(false);
  });
});
