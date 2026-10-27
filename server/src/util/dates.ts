// Kalenderlogik ohne Zeitzonenfallen: Datumswerte sind reine 'YYYY-MM-DD'-Strings.
// Monate werden kalendarisch gerechnet (nicht pauschal 180 Tage).

export function parseDate(s: string): { y: number; m: number; d: number } {
  const mt = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!mt) throw new Error(`Ungültiges Datum: ${s}`);
  const y = +mt[1], m = +mt[2], d = +mt[3];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) throw new Error(`Ungültiges Datum: ${s}`);
  return { y, m, d };
}

export function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toEpochDay(s: string): number {
  const { y, m, d } = parseDate(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

export function fromEpochDay(n: number): string {
  const dt = new Date(n * 86400000);
  return fmt(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(s: string, n: number): string {
  return fromEpochDay(toEpochDay(s) + n);
}

/** Kalendarische Monatsaddition; fehlt der Tag im Zielmonat, gilt der letzte Tag des Zielmonats. */
export function addMonths(s: string, n: number): string {
  const { y, m, d } = parseDate(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return fmt(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Anzahl Kalendertage von a bis b einschließlich beider Endtage (a<=b). */
export function inclusiveDays(a: string, b: string): number {
  return toEpochDay(b) - toEpochDay(a) + 1;
}

export function compareDates(a: string, b: string): number {
  return toEpochDay(a) - toEpochDay(b);
}

/** EEL-Datumsformat jhjjmmtt <-> ISO */
export function eelToIso(v: string): string | null {
  if (!/^\d{8}$/.test(v) || v === '00000000') return null;
  const iso = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  try { parseDate(iso); return iso; } catch { return null; }
}
export function isoToEel(iso: string | null | undefined): string {
  return iso ? iso.replaceAll('-', '') : '00000000';
}

export function formatDe(iso: string | null | undefined): string {
  if (!iso) return '–';
  const { y, m, d } = parseDate(iso);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}
