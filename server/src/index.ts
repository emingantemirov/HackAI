import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { HaiClient } from './ai/hai.js';
import { buildApp } from './app.js';
import { recoverJobs } from './domain/jobs.js';

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);
await migrate(db, (m) => console.log(m));
await recoverJobs(db);
const hai = new HaiClient(cfg, db);
const app = await buildApp({ db, cfg, hai });
await app.listen({ port: cfg.port, host: process.env.HOST ?? '0.0.0.0' });
console.log(`EEL Prüfportal läuft auf Port ${cfg.port}. KI-Verbindung: ${hai.configured ? 'Schlüssel gesetzt' : 'nicht konfiguriert'}${cfg.demoAiMode ? ' · DEMO-KI-MODUS aktiv' : ''}`);
