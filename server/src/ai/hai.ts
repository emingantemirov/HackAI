// Serverseitiger Client für die Hessian-AI-Schnittstelle (OpenAI-kompatibel).
// POST {HAI_BASE_URL}/chat/completions, Header Authorization: Bearer ${HAI_API_KEY}.
//
// Eigenschaften:
//  * Der API-Schlüssel verlässt den Server nie (kein Log, keine Antwort an den Browser, nicht im Repository).
//  * Zeitlimit je Anfrage, begrenzte Wiederholungen mit Backoff, Rate-Limit (429, Retry-After) wird beachtet.
//  * Strukturierte Antworten werden NUR per Prompt angefordert und serverseitig gegen ein Zod-Schema validiert.
//    Erweiterte API-Funktionen (response_format/tool calls) sind bewusst nicht aktiviert, solange ihre
//    Unterstützung durch das Gateway nicht geprüft ist.
//  * Fällt die KI aus, entsteht nichts: Aufrufer erhalten einen typisierten Fehler, keine erfundenen Ergebnisse.

import type { ZodTypeAny, z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Db } from '../db.js';

export type AiConnectionState =
  | 'nicht_konfiguriert' | 'wird_geprueft' | 'verbunden'
  | 'auth_fehlgeschlagen' | 'zeitueberschreitung' | 'dienst_nicht_erreichbar' | 'ungueltige_antwort';

export class AiError extends Error {
  constructor(public state: Exclude<AiConnectionState, 'verbunden' | 'wird_geprueft'>, message: string, public retryable = false) {
    super(message);
  }
}

export interface AiUsage { inputTokens: number | null; outputTokens: number | null }
export interface AiCompletion { text: string; usage: AiUsage; durationMs: number; model: string }

export const CONNECTION_TEST_PROMPT = 'Antworte kurz auf Deutsch: Funktioniert die Verbindung?';

const PII_PATTERNS: [RegExp, string][] = [
  [/\b\d{2}\s?\d{6}\s?[A-Z]\s?\d{2}\s?\d\b/g, '[VSNR]'],          // Versicherungsnummer bbttmmjjassp
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[E-MAIL]'],
];
/** Datensparsamkeit: unnötige Personendaten werden vor dem Versand an die KI entfernt. */
export function redact(text: string): string {
  return PII_PATTERNS.reduce((t, [re, rep]) => t.replace(re, rep), text);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HaiClient {
  constructor(private cfg: AppConfig, private db: Db, private fetchImpl: typeof fetch = fetch) {}

  get configured(): boolean { return !!this.cfg.hai.apiKey; }
  get model(): string { return this.cfg.hai.model; }

  private async request(messages: { role: string; content: string }[], maxTokens: number, signal?: AbortSignal): Promise<AiCompletion> {
    if (!this.cfg.hai.apiKey) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert (HAI_API_KEY fehlt).');
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.hai.timeoutMs);
    signal?.addEventListener('abort', () => ctrl.abort());
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.hai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.hai.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.cfg.hai.model, messages, max_tokens: maxTokens, temperature: 0.1 }),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') throw new AiError('zeitueberschreitung', `Die KI hat nicht innerhalb von ${Math.round(this.cfg.hai.timeoutMs / 1000)} s geantwortet.`, true);
      throw new AiError('dienst_nicht_erreichbar', `Die KI ist nicht erreichbar (${e?.cause?.code ?? e?.message ?? 'Netzwerkfehler'}).`, true);
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401 || res.status === 403) throw new AiError('auth_fehlgeschlagen', 'Die Authentifizierung bei der KI ist fehlgeschlagen (Schlüssel ungültig oder ohne Berechtigung).');
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'));
      const err = new AiError('dienst_nicht_erreichbar', 'Die KI-Schnittstelle begrenzt die Anfragerate (429).', true);
      (err as any).retryAfterMs = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30000) : undefined;
      throw err;
    }
    if (res.status >= 500) throw new AiError('dienst_nicht_erreichbar', `Die KI meldet einen Serverfehler (${res.status}).`, true);
    if (!res.ok) throw new AiError('ungueltige_antwort', `Unerwartete Antwort der KI (HTTP ${res.status}).`);
    let body: any;
    try { body = await res.json(); } catch { throw new AiError('ungueltige_antwort', 'Die KI-Antwort ist kein gültiges JSON.'); }
    const text = body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new AiError('ungueltige_antwort', 'Die KI-Antwort enthält keinen Text.');
    return {
      text, durationMs: Date.now() - t0, model: body.model ?? this.cfg.hai.model,
      usage: { inputTokens: body.usage?.prompt_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? null },
    };
  }

  /** Anfrage mit begrenzten Wiederholungen (nur bei vorübergehenden Fehlern). */
  async complete(purpose: string, promptVersion: string, messages: { role: 'system' | 'user' | 'assistant'; content: string }[], maxTokens: number, orgId: string | null): Promise<AiCompletion> {
    const safe = messages.map((m) => ({ ...m, content: redact(m.content) }));
    let attempt = 0;
    for (;;) {
      try {
        const r = await this.request(safe, maxTokens);
        await this.log(orgId, purpose, promptVersion, 'ok', r.usage, r.durationMs, null);
        return r;
      } catch (e) {
        if (!(e instanceof AiError)) throw e;
        if (!e.retryable || attempt >= this.cfg.hai.maxRetries) {
          await this.log(orgId, purpose, promptVersion, e.state, { inputTokens: null, outputTokens: null }, null, e.message);
          throw e;
        }
        attempt += 1;
        await sleep((e as any).retryAfterMs ?? Math.min(500 * 2 ** attempt, 4000));
      }
    }
  }

  /**
   * Strukturierte Antwort: Prompt verlangt reines JSON, Server validiert gegen Schema.
   * Bei Schemaverletzung genau ein Reparaturversuch; danach „ungültige Antwort“ – ohne Ersatzergebnis.
   */
  async completeJson<S extends ZodTypeAny>(purpose: string, promptVersion: string, schema: S, messages: { role: 'system' | 'user'; content: string }[], maxTokens: number, orgId: string | null): Promise<{ data: z.output<S>; completion: AiCompletion }> {
    let msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = [...messages];
    let lastErr = '';
    for (let round = 0; round < 2; round++) {
      const c = await this.complete(purpose, promptVersion, msgs, maxTokens, orgId);
      const parsed = extractJson(c.text);
      if (parsed.ok) {
        const v = schema.safeParse(parsed.value);
        if (v.success) return { data: v.data, completion: c };
        lastErr = v.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      } else lastErr = parsed.error;
      msgs = [...msgs, { role: 'assistant', content: c.text.slice(0, 4000) },
        { role: 'user', content: `Deine letzte Antwort war nicht gültig (${lastErr}). Antworte erneut ausschließlich mit einem JSON-Objekt gemäß dem geforderten Schema, ohne Erläuterung.` }];
    }
    await this.log(orgId, purpose, promptVersion, 'ungueltige_antwort', { inputTokens: null, outputTokens: null }, null, lastErr);
    throw new AiError('ungueltige_antwort', `Die KI hat keine schemakonforme Antwort geliefert (${lastErr}). Es wurden keine Ergebnisse übernommen.`);
  }

  private async log(orgId: string | null, purpose: string, promptVersion: string, status: string, u: AiUsage, ms: number | null, error: string | null) {
    await this.db.query(
      `insert into ai_calls(org_id, purpose, model, prompt_version, status, input_tokens, output_tokens, duration_ms, error) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, purpose, this.cfg.hai.model, promptVersion, status, u.inputTokens, u.outputTokens, ms, error?.slice(0, 500) ?? null],
    ).catch(() => undefined);
  }

  /** Verbindungstest (500 Ausgabetokens wie vorgegeben). Ergebnis wird als sichtbarer Zustand gespeichert. */
  async testConnection(): Promise<ConnectionStatus> {
    const checkedAt = new Date().toISOString();
    const base = { model: this.cfg.hai.model, baseUrl: this.cfg.hai.baseUrl, checkedAt };
    let status: ConnectionStatus;
    if (!this.configured) {
      status = { ...base, state: 'nicht_konfiguriert', message: 'HAI_API_KEY ist nicht gesetzt. Manuelle Bearbeitung bleibt möglich.' };
    } else {
      await this.db.query(`insert into app_settings(key, value) values ('ai_connection', $1) on conflict (key) do update set value = $1, updated_at = now()`, [JSON.stringify({ ...base, state: 'wird_geprueft', message: 'Verbindung wird geprüft …' })]);
      try {
        const r = await this.request([{ role: 'user', content: CONNECTION_TEST_PROMPT }], 500);
        status = { ...base, state: 'verbunden', message: 'Verbindung funktioniert.', latencyMs: r.durationMs, sample: r.text.slice(0, 300) };
      } catch (e) {
        status = e instanceof AiError ? { ...base, state: e.state, message: e.message } : { ...base, state: 'dienst_nicht_erreichbar', message: 'Unbekannter Fehler beim Verbindungstest.' };
      }
    }
    await this.db.query(`insert into app_settings(key, value) values ('ai_connection', $1) on conflict (key) do update set value = $1, updated_at = now()`, [JSON.stringify(status)]);
    return status;
  }

  async lastStatus(): Promise<ConnectionStatus> {
    const r = await this.db.query(`select value from app_settings where key = 'ai_connection'`);
    if (r.rowCount) {
      const v = r.rows[0].value as ConnectionStatus;
      if (!this.configured) return { ...v, state: 'nicht_konfiguriert', message: 'HAI_API_KEY ist nicht gesetzt. Manuelle Bearbeitung bleibt möglich.' };
      return v;
    }
    return { state: this.configured ? 'wird_geprueft' : 'nicht_konfiguriert', model: this.cfg.hai.model, baseUrl: this.cfg.hai.baseUrl, checkedAt: null,
      message: this.configured ? 'Noch nicht geprüft. Bitte Verbindungstest ausführen.' : 'HAI_API_KEY ist nicht gesetzt. Manuelle Bearbeitung bleibt möglich.' };
  }
}

export interface ConnectionStatus {
  state: AiConnectionState; message: string; model: string; baseUrl: string; checkedAt: string | null; latencyMs?: number; sample?: string;
}

export function extractJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  let t = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  if (fence) t = fence[1].trim();
  try { return { ok: true, value: JSON.parse(t) }; } catch { /* weiter */ }
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s >= 0 && e > s) {
    try { return { ok: true, value: JSON.parse(t.slice(s, e + 1)) }; } catch (err: any) { return { ok: false, error: `JSON ungültig: ${err.message}` }; }
  }
  return { ok: false, error: 'Kein JSON-Objekt gefunden' };
}
