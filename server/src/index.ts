import { loadConfig } from './config.js';
import { createPool, migrate } from './db.js';
import { HaiClient } from './ai/hai.js';
import { buildApp } from './app.js';
import { recoverJobs } from './domain/jobs.js';
import { seedBase, seedDemo } from './seed.js';

const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);
await migrate(db, (m) => console.log(m));
await recoverJobs(db);
// AUTO_DEMO=true: bei leerer Datenbank einmalig Demo-Konten und Demo-Daten anlegen (nur Entwicklung/Demo).
if ((process.env.AUTO_DEMO ?? '').toLowerCase() === 'true' && !(await db.query('select 1 from users limit 1')).rowCount) {
  const pw = process.env.SEED_PASSWORD ?? 'Demo-Passwort-2026!';
  await seedBase(db, pw); await seedDemo(db, cfg);
  console.log(`Demo-Daten angelegt. Anmeldung z. B. fachbearbeitung@demo.example / ${pw}`);
}
const hai = new HaiClient(cfg, db);
const app = await buildApp({ db, cfg, hai });
await app.listen({ port: cfg.port, host: process.env.HOST ?? '0.0.0.0' });
console.log(`EEL Prüfportal läuft auf Port ${cfg.port}. KI-Verbindung: ${hai.configured ? 'Schlüssel gesetzt' : 'nicht konfiguriert'}${cfg.demoAiMode ? ' · DEMO-KI-MODUS aktiv' : ''}`);
