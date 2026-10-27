import { loadConfig } from './config.js';
import { createPool, migrate, resetSchema } from './db.js';
import { seedBase, seedDemo } from './seed.js';

const cmd = process.argv[2];
const cfg = loadConfig();
const db = createPool(cfg.databaseUrl);
try {
  if (cmd === 'migrate') { await migrate(db, console.log); console.log('Datenbank ist auf dem aktuellen Stand.'); }
  else if (cmd === 'seed') {
    await migrate(db, console.log);
    const pw = process.env.SEED_PASSWORD ?? 'Demo-Passwort-2026!';
    const r = await seedBase(db, pw);
    console.log('skipped' in r ? 'Basisdaten sind bereits vorhanden.' : `Basisdaten angelegt (Demo-Passwort: ${pw}).`);
    if (process.argv.includes('--demo')) await seedDemo(db, cfg);
  } else if (cmd === 'reset') {
    if (process.env.ALLOW_RESET !== 'true') throw new Error('Zurücksetzen löscht alle Daten. Zur Bestätigung ALLOW_RESET=true setzen.');
    await resetSchema(db); await migrate(db, console.log); console.log('Datenbank zurückgesetzt.');
  } else { console.log('Verwendung: cli.ts migrate | seed [--demo] | reset'); process.exitCode = 1; }
} finally { await db.end(); }
