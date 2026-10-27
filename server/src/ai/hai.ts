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
  /** Schlüssel aus der Umgebung/.env hat Vorrang; sonst der im Portal serverseitig hinterlegte (wird nie an den Browser ausgeliefert). */
  private storedKey: string | null = null;
  constructor(private cfg: AppConfig, private db: Db, private fetchImpl: typeof fetch = fetch) {}

  private get apiKey(): string | null { return this.cfg.hai.apiKey ?? this.storedKey; }
  get keySource(): 'umgebung' | 'portal' | null { return this.cfg.hai.apiKey ? 'umgebung' : this.storedKey ? 'portal' : null; }
  async loadKey(): Promise<void> {
    const r = await this.db.query(`select value from app_settings where key = 'hai_api_key'`).catch(() => ({ rows: [] as any[] }));
    this.storedKey = typeof r.rows[0]?.value === 'string' && r.rows[0].value ? r.rows[0].value : null;
  }
  async setKey(key: string | null): Promise<void> {
    if (key) await this.db.query(`insert into app_settings(key, value) values ('hai_api_key', $1) on conflict (key) do update set value = $1, updated_at = now()`, [JSON.stringify(key.trim())]);
    else await this.db.query(`delete from app_settings where key = 'hai_api_key'`);
    this.storedKey = key ? key.trim() : null;
  }
  get configured(): boolean { return !!this.apiKey; }
  /** Schlüssel, die mit „sk-ant-“ beginnen, gehören zu Claude (Anthropic); alle anderen zur OpenAI-kompatiblen Hessian-AI-Schnittstelle. */
  get provider(): 'claude' | 'hessian' { return (this.apiKey ?? '').startsWith('sk-ant-') ? 'claude' : 'hessian'; }
  get model(): string { return this.provider === 'claude' ? (process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5') : this.cfg.hai.model; }
  get baseUrl(): string { return this.provider === 'claude' ? (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com') : this.cfg.hai.baseUrl; }

  private async request(messages: { role: string; content: string }[], maxTokens: number, signal?: AbortSignal): Promise<AiCompletion> {
    if (!this.apiKey) throw new AiError('nicht_konfiguriert', 'Die KI-Verbindung ist nicht konfiguriert. Bitte den API-Schlüssel unter Einstellungen → KI eintragen.');
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.hai.timeoutMs);
    signal?.addEventListener('abort', () => ctrl.abort());
    let res: Response;
    try {
      const claude = this.provider === 'claude';
      const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      res = await this.fetchImpl(claude ? `${this.baseUrl}/v1/messages` : `${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: claude ? { 'x-api-key': this.apiKey!, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' } : { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(claude
          ? { model: this.model, max_tokens: Math.min(maxTokens, 16000), temperature: 0.1, ...(sys ? { system: sys } : {}), messages: messages.filter((m) => m.role !== 'system') }
          : { model: this.model, messages, max_tokens: maxTokens, temperature: 0.1 }),
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
    const raw = await res.text().catch(() => '');
    const excerpt = raw.replace(/\s+/g, ' ').slice(0, 240);
    if (res.status >= 500) throw new AiError('dienst_nicht_erreichbar', `Die KI meldet einen Serverfehler (${res.status}): ${excerpt}`, true);
    if (!res.ok) throw new AiError('ungueltige_antwort', `Unerwartete Antwort der KI (HTTP ${res.status}): ${excerpt}`);
    let body: any;
    try { body = JSON.parse(raw); } catch { throw new AiError('ungueltige_antwort', `Die KI-Antwort ist kein gültiges JSON: ${excerpt}`); }
    const claude = this.provider === 'claude';
    const choice = claude ? { message: { content: (body?.content ?? []).filter((c: any) => c?.type === 'text').map((c: any) => c.text).join('') }, finish_reason: body?.stop_reason === 'max_tokens' ? 'length' : body?.stop_reason } : body?.choices?.[0];
    // Denkende Modelle (z. B. GLM) verbrauchen Ausgabetokens für interne Überlegungen. Ist die Antwort dann leer und wurde das Limit erreicht, mit mehr Budget erneut anfragen.
    let text = choice?.message?.content;
    if (typeof text === 'string') text = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^[\s\S]*<\/think>/i, '').trim();
    if ((typeof text !== 'string' || !text) && choice?.finish_reason === 'length' && maxTokens < 16000) return this.request(messages, Math.min(maxTokens * 4, 16000), signal);
    if (typeof text !== 'string' || !text) throw new AiError('ungueltige_antwort', `Die KI-Antwort enthält keinen Text (finish_reason: ${choice?.finish_reason ?? 'unbekannt'}): ${excerpt}`);
    return {
      text, durationMs: Date.now() - t0, model: body.model ?? this.model,
      usage: { inputTokens: body.usage?.prompt_tokens ?? body.usage?.input_tokens ?? null, outputTokens: body.usage?.completion_tokens ?? body.usage?.output_tokens ?? null },
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
      [orgId, purpose, this.model, promptVersion, status, u.inputTokens, u.outputTokens, ms, error?.slice(0, 500) ?? null],
    ).catch(() => undefined);
  }

  /** Verbindungstest (500 Ausgabetokens wie vorgegeben). Ergebnis wird als sichtbarer Zustand gespeichert. */
  async testConnection(): Promise<ConnectionStatus> {
    const checkedAt = new Date().toISOString();
    const base = { model: this.model, baseUrl: this.baseUrl, checkedAt };
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
    return { state: this.configured ? 'wird_geprueft' : 'nicht_konfiguriert', model: this.model, baseUrl: this.baseUrl, checkedAt: null,
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
