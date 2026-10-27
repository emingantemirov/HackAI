// Konfiguration ausschließlich über Umgebungsvariablen. Geheimnisse werden nie geloggt oder an den Browser gegeben.
import fs from 'node:fs';
import path from 'node:path';

/** Einfache .env-Unterstützung (KEY=Wert) – sucht im Arbeitsverzeichnis und darüber. Bereits gesetzte Umgebungsvariablen haben Vorrang. */
export function loadDotEnv(): void {
  for (const dir of [process.cwd(), path.resolve(process.cwd(), '..')]) {
    const f = path.join(dir, '.env');
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
    return;
  }
}

export interface AppConfig {
  databaseUrl: string;
  port: number;
  storageDir: string;
  sessionSecret: string;
  hai: { apiKey: string | null; baseUrl: string; model: string; timeoutMs: number; maxRetries: number };
  demoAiMode: boolean;
  maxUploadBytes: number;
  webDist: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    // Ohne DATABASE_URL läuft das eingebettete PostgreSQL (PGlite) im Ordner STORAGE_DIR/pglite – keine Installation nötig.
    databaseUrl: env.DATABASE_URL ?? `pglite://${path.resolve(env.STORAGE_DIR ?? './storage', 'pglite')}`,
    port: Number(env.PORT ?? 3001),
    storageDir: path.resolve(env.STORAGE_DIR ?? './storage'),
    sessionSecret: env.SESSION_SECRET ?? 'dev-only-change-me',
    hai: {
      apiKey: env.HAI_API_KEY && env.HAI_API_KEY.trim() ? env.HAI_API_KEY.trim() : null,
      baseUrl: (env.HAI_BASE_URL ?? 'https://hip-gw.hessian.ai/v1').replace(/\/+$/, ''),
      model: env.HAI_MODEL ?? 'vllm/GLM-Flash:Latest',
      timeoutMs: Number(env.HAI_TIMEOUT_MS ?? 120000),
      maxRetries: Number(env.HAI_MAX_RETRIES ?? 2),
    },
    // Demo-Modus: regelbasierte Ableitung statt KI. Immer sichtbar gekennzeichnet.
    demoAiMode: (env.DEMO_AI_MODE ?? 'false').toLowerCase() === 'true',
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 25 * 1024 * 1024),
    webDist: env.WEB_DIST ?? null,
  };
}
