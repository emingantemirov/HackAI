import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');

/** Dateiablage: Originaldatei unter ihrem Inhalts-Hash (nicht über Benutzereingaben adressierbar). */
export function storeFile(storageDir: string, area: string, buf: Buffer): { storagePath: string; sha: string } {
  const sha = sha256(buf);
  const rel = path.join(area, sha.slice(0, 2), sha);
  const abs = path.join(storageDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  if (!fs.existsSync(abs)) fs.writeFileSync(abs, buf, { mode: 0o600 });
  return { storagePath: rel, sha };
}

export function readStored(storageDir: string, rel: string): Buffer {
  const abs = path.resolve(storageDir, rel);
  if (!abs.startsWith(path.resolve(storageDir) + path.sep)) throw new Error('Ungültiger Speicherpfad');
  return fs.readFileSync(abs);
}

export interface Locator { kind: 'seite' | 'absatz'; n: number; start: number; end: number }
export interface Extraction {
  status: 'ok' | 'ocr_pruefung_erforderlich' | 'fehlgeschlagen';
  note: string | null;
  text: string;
  locators: Locator[];
}

function paragraphLocators(text: string): Locator[] {
  const out: Locator[] = [];
  const re = /\S[\s\S]*?(?=\n\s*\n|$)/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    n += 1;
    out.push({ kind: 'absatz', n, start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex += 1;
  }
  return out;
}

export async function extractPdf(buf: Buffer): Promise<Extraction> {
  try {
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0,
    }).promise;
    let text = '';
    const locators: Locator[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const start = text.length;
      let lastY: number | null = null;
      for (const it of content.items as any[]) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) text += '\n';
        else if (lastY !== null && text.length && !text.endsWith(' ') && it.str && !it.str.startsWith(' ')) text += ' ';
        text += it.str;
        if (y !== undefined) lastY = y;
        if (it.hasEOL) { text += '\n'; lastY = null; }
      }
      locators.push({ kind: 'seite', n: p, start, end: text.length });
      text += '\n\n';
    }
    const chars = text.replace(/\s/g, '').length;
    if (chars < doc.numPages * 40) {
      return {
        status: 'ocr_pruefung_erforderlich',
        note: 'Das Dokument enthält kaum auswählbaren Text (vermutlich Scan). Ein OCR-Prüfschritt ist erforderlich; es wurde nichts erraten.',
        text, locators,
      };
    }
    return { status: 'ok', note: null, text, locators };
  } catch (e: any) {
    return { status: 'fehlgeschlagen', note: `PDF konnte nicht gelesen werden: ${e?.message ?? e}`, text: '', locators: [] };
  }
}

export async function extractDocx(buf: Buffer): Promise<Extraction> {
  try {
    const mammoth: any = await import('mammoth');
    const r = await (mammoth.default ?? mammoth).extractRawText({ buffer: buf });
    const text: string = r.value ?? '';
    if (text.replace(/\s/g, '').length < 20) {
      return { status: 'fehlgeschlagen', note: 'Das Word-Dokument enthält keinen lesbaren Text.', text, locators: [] };
    }
    return { status: 'ok', note: null, text, locators: paragraphLocators(text) };
  } catch (e: any) {
    return { status: 'fehlgeschlagen', note: `Word-Dokument konnte nicht gelesen werden: ${e?.message ?? e}`, text: '', locators: [] };
  }
}

export function extractPlain(text: string): Extraction {
  const t = text.replace(/\r\n/g, '\n');
  if (t.replace(/\s/g, '').length < 20) return { status: 'fehlgeschlagen', note: 'Der eingefügte Text ist zu kurz.', text: t, locators: [] };
  return { status: 'ok', note: null, text: t, locators: paragraphLocators(t) };
}

export function detectKind(fileName: string, buf: Buffer): 'pdf' | 'docx' | 'text' | 'datei' {
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  // DOCX = ZIP mit word/document.xml
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf.includes(Buffer.from('word/'))) return 'docx';
  if (/\.(txt|md)$/i.test(fileName)) return 'text';
  return 'datei';
}

// ---------------------------------------------------------------------------
// Zitatprüfung: Belege müssen im Originaltext vorkommen (Silbentrennung/Zeilenumbrüche toleriert)
// ---------------------------------------------------------------------------

function normalizeChar(ch: string): string {
  if (/[‐-―−]/.test(ch)) return '-';
  if (/[“”„‟«»"]/.test(ch)) return '"';
  if (/[‘’‚‛`']/.test(ch)) return "'";
  return ch.toLowerCase();
}

export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // Silbentrennung am Zeilenende: "Arbeitsunfähig-\nkeit" -> "Arbeitsunfähigkeit"
    if (ch === '-' && /\n/.test(text.slice(i + 1, i + 3)) && /[a-zäöüß]/i.test(text[i - 1] ?? '') && /[a-zäöüß]/i.test(text.slice(i + 1).replace(/^\s+/, '')[0] ?? '')) {
      while (i + 1 < text.length && /\s/.test(text[i + 1])) i++;
      continue;
    }
    if (/\s/.test(ch)) {
      if (!prevSpace) { norm += ' '; map.push(i); prevSpace = true; }
      continue;
    }
    norm += normalizeChar(ch);
    map.push(i);
    prevSpace = false;
  }
  return { norm: norm.trim(), map };
}

export interface QuoteMatch { found: boolean; start?: number; end?: number; locator?: { kind: 'seite' | 'absatz'; n: number } }

export function findQuote(text: string, locators: Locator[], quote: string): QuoteMatch {
  const q = normalizeWithMap(quote).norm;
  if (q.length < 12) return { found: false };
  const { norm, map } = normalizeWithMap(text);
  const idx = norm.indexOf(q);
  if (idx < 0) return { found: false };
  const start = map[idx];
  const end = map[Math.min(idx + q.length - 1, map.length - 1)] + 1;
  const loc = locators.find((l) => start >= l.start && start < l.end + 1);
  return { found: true, start, end, locator: loc ? { kind: loc.kind, n: loc.n } : undefined };
}

/** Absatzweise Hashes für den Quellenvergleich (neu / geändert / unverändert / entfallen). */
export function paragraphFingerprints(text: string): { key: string; hash: string; text: string }[] {
  return paragraphLocators(text).map((l) => {
    const t = normalizeWithMap(text.slice(l.start, l.end)).norm;
    return { key: t.slice(0, 60), hash: sha256(t), text: t };
  });
}
