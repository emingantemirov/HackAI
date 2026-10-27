// Ein-Befehl-Start für die Demo: baut die Oberfläche, startet den Server mit eingebetteter Datenbank und lädt beim ersten Start Demo-Daten.
// Aufruf: npm run demo        (läuft auf Windows, macOS und Linux; keine Datenbank-Installation nötig)
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const env = { ...process.env, DEMO_AI_MODE: process.env.DEMO_AI_MODE ?? 'true', AUTO_DEMO: 'true', WEB_DIST: path.join(root, 'web', 'dist'), STORAGE_DIR: process.env.STORAGE_DIR ?? path.join(root, 'storage') };

console.log('Baue die Oberfläche …');
const b = spawnSync(npm, ['run', 'build', '-w', 'web'], { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
if (b.status !== 0) { console.error('Der Bau der Oberfläche ist fehlgeschlagen.'); process.exit(b.status ?? 1); }

const port = env.PORT ?? '3001';
console.log(`\nStarte den Server. Öffnen Sie gleich im Browser: http://localhost:${port}\nAnmeldung: fachbearbeitung@demo.example / Demo-Passwort-2026!\nBeenden mit Strg+C.\n`);
const s = spawn(npm, ['run', 'start', '-w', 'server'], { cwd: root, stdio: 'inherit', env, shell: process.platform === 'win32' });
s.on('exit', (c) => process.exit(c ?? 0));
