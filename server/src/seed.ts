// Demodaten. Ausschließlich synthetisch. Es werden KEINE Freigaben vorweggenommen: alles startet als Entwurf.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config.js';
import { type Db, tx } from './db.js';
import { HaiClient } from './ai/hai.js';
import { createUser, type Actor } from './auth.js';
import { importSourceFile } from './domain/sources.js';
import { deriveFromSource } from './domain/derive.js';
import { DBVO_CLARIFICATIONS, ensureClarification } from './domain/clarifications.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SOURCES_DIR = path.resolve(here, '..', '..', 'sources');

export const DEMO_USERS = [
  { email: 'admin@demo.example', name: 'Ada Admin', role: 'admin' as const, org: 'pruefstelle' },
  { email: 'fachbearbeitung@demo.example', name: 'Fabian Fachbearbeitung', role: 'fachbearbeitung' as const, org: 'pruefstelle' },
  { email: 'pruefer@demo.example', name: 'Paula Prüferin', role: 'pruefer' as const, org: 'pruefstelle' },
  { email: 'pruefer2@demo.example', name: 'Peter Prüfer', role: 'pruefer' as const, org: 'pruefstelle' },
  { email: 'kunde@demo.example', name: 'Karla Kunde (Hersteller)', role: 'kunde' as const, org: 'hersteller' },
  { email: 'kunde2@demo.example', name: 'Konrad Konkurrenz (anderer Hersteller)', role: 'kunde' as const, org: 'hersteller2' },
];

export async function seedBase(db: Db, password: string) {
  const exists = await db.query('select 1 from organizations limit 1');
  if (exists.rowCount) return { skipped: true };
  return tx(db, async (t) => {
    const mk = async (name: string, kind: string) => (await t.query('insert into organizations(name, kind) values ($1,$2) returning id', [name, kind])).rows[0].id as string;
    const orgs: Record<string, string> = {
      pruefstelle: await mk('Demo-Prüfstelle (Prototyp)', 'pruefstelle'),
      hersteller: await mk('Demo-Softwarehaus Nord GmbH (synthetisch)', 'hersteller'),
      hersteller2: await mk('Demo-Softwarehaus Süd GmbH (synthetisch)', 'hersteller'),
    };
    for (const u of DEMO_USERS) await createUser(t, { orgId: orgs[u.org], email: u.email, name: u.name, role: u.role, password });
    const prod = async (vendor: string, name: string, version: string, adapter: string) => {
      const p = await t.query('insert into software_products(owner_org_id, vendor, name) values ($1,$2,$3) returning id', [orgs.pruefstelle, vendor, name]);
      return (await t.query('insert into software_versions(product_id, version, adapter_key) values ($1,$2,$3) returning id', [p.rows[0].id, version, adapter])).rows[0].id as string;
    };
    const sw = {
      manual: await prod('Demo-Softwarehaus Nord GmbH', 'Entgeltabrechnung Demo (manueller Ablauf)', '1.0', 'manual'),
      simulator: await prod('Portal-Simulator', 'Simulator (Demonstration, keine echte Software)', '1.0', 'simulator'),
      lexware: await prod('Lexware', 'Lexware (Beispielprofil, nicht konfiguriert)', 'nicht angegeben', 'lexware'),
    };
    const rs = (await t.query(
      `insert into rulesets(org_id, label, document_version, record_version, valid_from, transition_note) values ($1,$2,$3,$4,$5,$6) returning id`,
      [orgs.pruefstelle, 'Gemeinsame Grundsätze EEL V13.1', '13.1', '13', '2026-01-01', 'Übergangsregelung: Datensatzversionen 12 und 13 sind bis 28.02.2026 zulässig (laut Vorgabe des Prototyp-Auftrags; bitte am Originaldokument prüfen).'])).rows[0].id as string;
    return { orgs, sw, ruleset: rs };
  });
}

export async function seedDemo(db: Db, cfg: AppConfig) {
  const org = (await db.query(`select id from organizations where kind = 'pruefstelle' limit 1`)).rows[0]?.id as string | undefined;
  if (!org) throw new Error('Bitte zuerst die Basisdaten anlegen (npm run db:seed).');
  const user = (await db.query(`select id, name, org_id, role from users where email = 'fachbearbeitung@demo.example'`)).rows[0];
  const actor: Actor = { kind: 'user', id: user.id, label: user.name, orgId: user.org_id, role: user.role, orgKind: 'pruefstelle' };
  const hai = new HaiClient(cfg, db);
  const files = [
    { file: 'GG_EEL_V13.1.pdf', title: 'Gemeinsame Grundsätze EEL', version: '13.1', validFrom: '2026-01-01', area: 'DBVO' },
    { file: 'Verfahrensbeschreibung_DTA_EEL_V13.4.pdf', title: 'Verfahrensbeschreibung DTA EEL', version: '13.4', validFrom: '2027-01-01', area: 'DBVO' },
    { file: 'DTA-EEL-Beispiel_Vorerkrankung.docx', title: 'DTA EEL Beispiel Vorerkrankung (ergänzende Kriterien)', version: 'ohne Versionsangabe', validFrom: null, area: 'DBVO' },
    { file: 'Hinweise_DTA-EEL-Beispiel_Vorerkrankung_Testkonstellation.docx', title: 'Hinweise zur Testkonstellation Vorerkrankung', version: 'ohne Versionsangabe', validFrom: null, area: 'DBVO' },
    { file: 'TEEL0-Test1-DBVO.eel', title: 'Beispieldatei TEEL0-Test1-DBVO (EEL-Referenzdatei)', version: 'ohne Versionsangabe', validFrom: null, area: 'DBVO' },
  ];
  const ids: Record<string, string> = {};
  for (const f of files) {
    const p = path.join(SOURCES_DIR, f.file);
    if (!fs.existsSync(p)) { console.warn(`Quelle fehlt: ${p}`); continue; }
    const r = await tx(db, (t) => importSourceFile(t, actor, cfg, { title: f.title, versionLabel: f.version, validFrom: f.validFrom, area: f.area }, f.file, null, fs.readFileSync(p)));
    ids[f.file] = r.sourceVersionId;
    console.log(`${r.duplicate ? 'Bereits vorhanden' : 'Importiert'}: ${f.title}`);
  }
  await tx(db, async (t) => { for (const d of DBVO_CLARIFICATIONS) await ensureClarification(t, actor, org, d); });
  const run = async (file: string, mode: 'uebernahme' | 'demo') => {
    if (!ids[file]) return;
    const r = await deriveFromSource({ db, cfg, hai, actor, orgId: org, sourceVersionId: ids[file], mode });
    console.log(`Ableitung (${mode}) aus ${file}: neu ${r.neu.length}, geändert ${r.geaendert.length}, unverändert ${r.unveraendert.length}, verworfen ${r.verworfen.length}`);
  };
  await run('DTA-EEL-Beispiel_Vorerkrankung.docx', 'uebernahme');
  await run('DTA-EEL-Beispiel_Vorerkrankung.docx', 'demo');
  await run('Hinweise_DTA-EEL-Beispiel_Vorerkrankung_Testkonstellation.docx', 'demo');
  await run('GG_EEL_V13.1.pdf', 'demo');
  await run('Verfahrensbeschreibung_DTA_EEL_V13.4.pdf', 'demo');
  return { ok: true };
}
