# EEL Prüfportal

KI-unterstützte Prüfung von Entgeltabrechnungssoftware für den Datenaustausch Entgeltersatzleistungen (DTA EEL) – Prototyp für den ITSG-Hackathon. **KI unterstützt. Menschen entscheiden.**

Das Portal führt durch den Ablauf: Quelle hinzufügen → Kriterien ableiten und **freigeben** → Testfälle mit Soll-Ergebnis erzeugen und **freigeben** → Prüfpaket bereitstellen → Software extern testen → Rückgabedaten importieren → Soll/Ist vergleichen → Bericht erstellen und **freigeben** → bereitstellen → getrennte Entscheidung über „Zertifiziert im Demo-Prüfumfang“.

Startumfang: Vorerkrankungsanfrage (Abgabegrund 41, Datenbaustein DBVO). Alle Daten sind synthetisch. Das Portal ist **keine amtliche Zertifizierung** der ITSG.

## Technik

TypeScript-Monorepo (npm workspaces): `server` (Fastify, PostgreSQL, zod) und `web` (React, Vite). Dateispeicher auf der Platte, Migrationen als SQL in `server/src/migrations`.

## Schnellstart (ohne Datenbank-Installation)

Voraussetzung: Node.js 20 oder neuer (https://nodejs.org, LTS). Mehr nicht.

```bash
git clone https://github.com/emingantemirov/HackAI.git
cd HackAI
npm install
npm run demo
```

Danach im Browser **http://localhost:3001** öffnen. Beim ersten Start werden Demo-Konten und Demo-Daten angelegt. Die Daten liegen im Ordner `storage/` und bleiben beim nächsten Start erhalten (zurücksetzen: Ordner `storage/` löschen).

**KI aktivieren:** Im Portal unter *Einstellungen → KI-Verbindung* den Hessian-AI-Schlüssel eintragen und „Speichern und testen“ wählen. Alternativ eine Datei `.env` (Vorlage: `.env.example`) mit `HAI_API_KEY=…` anlegen. Der Schlüssel liegt nur auf dem Server, wird nie im Browser angezeigt und nicht ins Repository eingecheckt. Ohne Schlüssel läuft die gekennzeichnete Demo-Ableitung.

**Typischer Ablauf (wenige Klicks):** Kriterien → Dokument hinzufügen (Kriterien werden automatisch abgeleitet, dann „Alle zur Freigabe einreichen“) → Freigaben → „Alle freigeben“ (zweite Person; Testfall-Entwürfe entstehen automatisch) → Testfälle einreichen und freigeben → Prüfungen → Neue Prüfung → Rückgabedateien hochladen. Das Dashboard zeigt immer den nächsten Schritt.

Windows/PowerShell: Falls `npm` meldet, die Ausführung von Skripten sei deaktiviert, einmalig `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` ausführen oder `npm.cmd` statt `npm` verwenden.

Eingebettetes PostgreSQL (PGlite) führt alle Zugriffe nacheinander aus und ist für Demo und lokale Entwicklung gedacht. Für den Betrieb mit mehreren Nutzern: echter PostgreSQL-Server.

## Mit eigenem PostgreSQL-Server

```bash
# Datenbank anlegen (einmalig)
sudo -u postgres psql -c "create user eel with password 'eel_dev_password'" \
  -c "create database eel_pruefportal owner eel" -c "create database eel_pruefportal_test owner eel"
export DATABASE_URL=postgres://eel:eel_dev_password@127.0.0.1:5432/eel_pruefportal
npm run db:migrate
npm run build -w web                 # baut die Oberfläche nach web/dist
npm run demo:reset                   # ACHTUNG: leert die Datenbank und lädt Demo-Daten (nur Entwicklung)
WEB_DIST=web/dist DEMO_AI_MODE=true npm start     # http://localhost:3001
```

Alternativ PostgreSQL per Docker: `docker run -d --name eel-db -p 5432:5432 -e POSTGRES_USER=eel -e POSTGRES_PASSWORD=eel_dev_password -e POSTGRES_DB=eel_pruefportal postgres:16`.

Entwicklung mit Hot-Reload: `npm run dev:server` und `npm run dev:web` (Vite auf :5173, Proxy auf :3001).

### Demo-Zugänge

Passwort für alle: `Demo-Passwort-2026!` (änderbar über `SEED_PASSWORD` beim Seeden).

| E-Mail | Rolle |
|---|---|
| admin@demo.example | Administrator (Benutzer, Einstellungen) |
| fachbearbeitung@demo.example | Fachbearbeitung (anlegen, einreichen) |
| pruefer@demo.example, pruefer2@demo.example | Prüfer/Freigeber (freigeben, Klärungen, Zertifizierung) |
| kunde@demo.example, kunde2@demo.example | Kunde/Hersteller (nur eigene Prüfungen, keine Soll-Werte) |

## Umgebungsvariablen

| Variable | Bedeutung | Standard |
|---|---|---|
| `DATABASE_URL` | PostgreSQL; ohne Angabe läuft das eingebettete PGlite in `STORAGE_DIR/pglite` (`pglite://memory` = nur im Speicher) | eingebettet |
| `AUTO_DEMO` | `true`: bei leerer Datenbank Demo-Daten anlegen (`npm run demo` setzt es) | – |
| `PORT` | HTTP-Port | 3001 |
| `STORAGE_DIR` | Ablage für Originaldateien, Pakete, Importe | `./storage` |
| `WEB_DIST` | Verzeichnis der gebauten Oberfläche | – (nur API) |
| `HAI_API_KEY` | Schlüssel für Hessian AI, **nur serverseitig** | leer = KI nicht konfiguriert |
| `HAI_BASE_URL`, `HAI_MODEL` | Endpunkt und Modell | `https://hip-gw.hessian.ai/v1`, `vllm/GLM-Flash:Latest` |
| `HAI_TIMEOUT_MS`, `HAI_MAX_RETRIES` | Zeitlimit und Wiederholungen | 60000, 2 |
| `DEMO_AI_MODE` | `true`: regelbasierte „Demo-Ableitung“ statt KI, überall gekennzeichnet | `false` |
| `MAX_UPLOAD_BYTES` | Größenlimit für Uploads | 25 MB |
| `COOKIE_SECURE` | `true` hinter HTTPS | `false` |
| `SEED_PASSWORD` | Passwort der Demo-Konten | s. o. |
| `ALLOW_RESET` | erlaubt `cli reset` (löscht alles) | nicht gesetzt |
| `TEST_DATABASE_URL` | Datenbank der Tests (wird geleert!) | `eel_pruefportal_test` |

Der API-Schlüssel wird weder im Repository noch im Browser noch im Log geführt. Ohne Schlüssel bleibt der manuelle Weg vollständig nutzbar.

## Tests

```bash
npm test                      # 45 Server-Tests (Datenbank, API, Fachregeln, Mandantentrennung)
TEST_DATABASE_URL=pglite://memory npm test   # dieselben Tests ohne PostgreSQL-Server
npm run test:e2e              # 12 Browser-Prüfungen; Server mit frischen Demo-Daten und WEB_DIST muss laufen
```

`test:e2e` braucht Playwright (`npm i -g playwright` bzw. bereits installiert; ggf. `NODE_PATH=$(npm root -g)`), Chromium und optional `BASE_URL`, `SHOTS_DIR`. Er deckt den durchgehenden Ablauf sowie Tastatur und 375-px-Ansicht ab (Abnahmetest 20).

## Wie die Pflichtfreigaben erzwungen werden

Alles im Backend, nicht in der Oberfläche:

- Kriterien, Testfälle (inkl. Soll) und Berichte sind **versionierte, unveränderliche Objekte** (Datenbank-Trigger sperren eingereichte/freigegebene/abgelehnte Versionen). Eine Änderung erzeugt eine neue Version.
- Freigabe nur durch berechtigte Rolle, **nicht durch die einreichende Person** (Vier-Augen); die KI hat keine Berechtigung. Eine Ablehnung braucht eine Begründung (API und CHECK-Constraint). Die Freigabe gilt nur für die angezeigte Version; eine neuere Version führt zu `409 STALE_VERSION`.
- Testfälle entstehen nur aus freigegebenen Kriterienversionen; Testläufe binden nur freigegebene Testfallversionen.
- Nur ein **freigegebener, aktueller** Bericht kann bereitgestellt werden. Freigabe ≠ Versand; E-Mail-Versand ist als „nicht konfiguriert“ protokolliert und wird nicht vorgetäuscht.
- „Zertifiziert im Demo-Prüfumfang“ ist eine eigene dokumentierte Entscheidung mit Begründung; „Bestanden“ allein genügt nicht.

## Adapter und bekannte Lücken

| Adapter | Status |
|---|---|
| Manuell | implementiert: Prüfpaket (JSON, ohne Soll) → manuelle Erfassung in der Software → Upload der EEL-Datei |
| Simulator | Demonstration mit wählbaren Fehlerbildern; **keine Aussage über echte Software** |
| Lexware (und andere) | **Noch nicht konfiguriert** – keine Schnittstellenkenntnis, keine behauptete Kompatibilität |

Offen und bewusst nicht erfunden: Zeichenkodierung der EEL-Datei (die Beispieldatei enthält bereits U+FFFD-Ersatzzeichen; die Quellen legen nichts fest – sie bleibt ein Klärungsvorgang), Layout von DBNA/DBAP und VOSZ/DSKO/NCSZ (nur als Rohsätze aus der Beispieldatei), sechsmonatige Gleichheitsgrenze (Quellen widersprechen sich → Klärungsvorgang), Zeitstempel-Vergleich. Siehe `docs/FACHLICHE-GRUNDLAGEN.md`.

## Projektstruktur

```
server/src/domain/   Fachlogik (Kriterien, Testfälle, Engine DBVO, Vergleich, Berichte, Zertifizierung)
server/src/adapters/ Adapter manuell/Simulator
server/src/ai/       Hessian-AI-Client, Promptversionen
server/src/migrations/ SQL-Migrationen
server/test/         Server-Tests
web/src/             Oberfläche (React)   web/e2e/  Browser-Test
sources/             Eingangsdokumente (GG EEL 13.1, Verfahrensbeschreibung 13.4, Beispieldateien)
docs/                Fachliche Grundlagen, Demo-Leitfaden
```
