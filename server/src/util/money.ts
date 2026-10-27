// Geldbeträge werden ausschließlich als ganze Cent (BigInt) verglichen – nie als Gleitkommazahl.

export function parseMoneyToCents(input: string): bigint {
  const s = input.trim().replace(/\s|€|EUR/gi, '');
  if (!s) throw new Error('Leerer Betrag');
  let neg = false; let t = s;
  if (t.startsWith('-') || t.startsWith('−')) { neg = true; t = t.slice(1); }
  // deutsches Format 2.140,50 oder englisches 2140.50
  let intPart: string; let frac = '';
  if (t.includes(',')) {
    const [i, f = ''] = t.split(',');
    intPart = i.replace(/\./g, ''); frac = f;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    intPart = t.replace(/\./g, '');
  } else {
    const [i, f = ''] = t.split('.');
    intPart = i; frac = f;
  }
  if (!/^\d+$/.test(intPart) || (frac && !/^\d+$/.test(frac)) || frac.length > 2) throw new Error(`Ungültiger Betrag „${input}“`);
  const cents = BigInt(intPart) * 100n + BigInt((frac + '00').slice(0, 2));
  return neg ? -cents : cents;
}

export function formatCents(c: bigint): string {
  const neg = c < 0n; const a = neg ? -c : c;
  const i = (a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '−' : ''}${i},${(a % 100n).toString().padStart(2, '0')} €`;
}

export function compareMoney(soll: string, ist: string) {
  const s = parseMoneyToCents(soll), i = parseMoneyToCents(ist);
  const diff = i - s;
  return { sollCents: s, istCents: i, diffCents: diff, equal: diff === 0n, soll: formatCents(s), ist: formatCents(i), diff: (diff > 0n ? '+' : '') + formatCents(diff) };
}
