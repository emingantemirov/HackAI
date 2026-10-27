-- EEL Prüfportal – Datenmodell (Migration 001)
-- Grundprinzipien:
--  * Fachliche Objekte (Kriterium, Testfall, Bericht) sind logische Objekte mit unveränderlichen Versionen.
--  * Freigaben gelten für genau eine Version. Inhalte eingereichter/freigegebener Versionen sind per Trigger gesperrt.
--  * Ablehnungen ohne Begründung sind auch auf Datenbankebene unmöglich (CHECK).
--  * Prüfläufe referenzieren unveränderliche Versionen ihrer Grundlagen.

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('pruefstelle', 'hersteller')),
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  email text not null unique,
  name text not null,
  role text not null check (role in ('admin', 'fachbearbeitung', 'pruefer', 'kunde')),
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
  -- Rolle/Organisationsart (Kunde ↔ Hersteller) wird in auth.ts beim Anlegen erzwungen
);

create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table counters (
  org_id uuid not null references organizations(id),
  key text not null,
  value integer not null default 0,
  primary key (org_id, key)
);

-- ---------------------------------------------------------------------------
-- Softwareprofile und Regelwerksstände
-- ---------------------------------------------------------------------------

create table software_products (
  id uuid primary key default gen_random_uuid(),
  owner_org_id uuid not null references organizations(id),
  vendor text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner_org_id, vendor, name)
);

create table software_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references software_products(id),
  version text not null,
  configuration jsonb not null default '{}'::jsonb,
  adapter_key text not null default 'manual',
  created_at timestamptz not null default now(),
  unique (product_id, version)
);

-- Regelwerksstand: Dokumentversion (z. B. 13.1) ist von der Datensatzversion (z. B. 13) getrennt.
create table rulesets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  label text not null,
  document_version text not null,
  record_version text not null,
  valid_from date not null,
  valid_to date,
  transition_note text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Quellen
-- ---------------------------------------------------------------------------

create table source_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  title text not null,
  publisher text,
  area text,
  created_at timestamptz not null default now()
);

create table source_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  document_id uuid not null references source_documents(id),
  version_label text not null,
  valid_from date,
  valid_to date,
  input_kind text not null check (input_kind in ('pdf', 'docx', 'text', 'datei')),
  file_name text,
  mime_type text,
  sha256 text not null,
  size_bytes integer not null,
  storage_path text not null,
  extracted_text text,
  -- Fundstellen: [{kind:'seite'|'absatz', n:int, start:int, end:int}] mit Offsets in extracted_text
  locators jsonb not null default '[]'::jsonb,
  extraction_status text not null check (extraction_status in ('ok', 'ocr_pruefung_erforderlich', 'fehlgeschlagen')),
  extraction_note text,
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, sha256)
);

-- ---------------------------------------------------------------------------
-- Kriterien
-- ---------------------------------------------------------------------------

create table criteria (
  id uuid primary key default gen_random_uuid(),   -- stabile ID; Original-IDs aus Quellen werden übernommen
  org_id uuid not null references organizations(id),
  code text not null,
  slug text not null,                              -- stabiler fachlicher Schlüssel (Dublettenprüfung, Änderungsvergleich)
  area text not null default 'DBVO',
  created_at timestamptz not null default now(),
  unique (org_id, code),
  unique (org_id, slug)
);

create table criteria_versions (
  id uuid primary key default gen_random_uuid(),
  criterion_id uuid not null references criteria(id),
  version integer not null,
  title text not null,
  description text not null default '',
  preconditions text not null default '',
  rule text not null default '',
  exceptions text not null default '',
  expected_behavior text not null default '',
  valid_from date,
  valid_to date,
  data_fields jsonb not null default '[]'::jsonb,
  message_types jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  -- [{source_version_id, quote, locator:{kind,n}, verified:boolean}]
  evidence jsonb not null default '[]'::jsonb,
  -- Herkunft: 'quelle-uebernommen' | 'ki-ableitung' | 'demo-ableitung' | 'manuell'
  origin text not null,
  ai_meta jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'clarification', 'submitted', 'approved', 'rejected', 'superseded')),
  change_note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references users(id),
  submitted_at timestamptz,
  unique (criterion_id, version)
);
create index criteria_versions_status_idx on criteria_versions(criterion_id, version desc);

-- ---------------------------------------------------------------------------
-- Testfälle
-- ---------------------------------------------------------------------------

create table testcases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null,
  area text not null default 'DBVO',
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table testcase_versions (
  id uuid primary key default gen_random_uuid(),
  testcase_id uuid not null references testcases(id),
  version integer not null,
  title text not null,
  purpose text not null default '',
  test_type text not null check (test_type in ('positiv', 'negativ', 'grenzfall', 'sonderfall', 'mehrstufig')),
  initial_state jsonb not null default '{}'::jsonb,       -- synthetische Testdaten, Ausgangszustand
  events jsonb not null default '[]'::jsonb,              -- Ereignisse und Bearbeitungsschritte
  expected jsonb not null default '{}'::jsonb,            -- Soll: Meldungen und Feldwerte
  expects_no_message boolean not null default false,      -- ausdrücklich erwartete Nicht-Erzeugung
  observation_note text,                                  -- Testabschluss / Beobachtungszeitraum bei Nicht-Erzeugung
  derivation text not null default '',                    -- nachvollziehbare Herleitung des Soll-Ergebnisses
  profile_requirements jsonb not null default '{}'::jsonb,
  test_date date,                                         -- fixiertes Tagesdatum im Testkontext
  blocked_by jsonb not null default '[]'::jsonb,          -- offene Klärungsvorgänge (IDs)
  generated_by text not null check (generated_by in ('engine', 'ki', 'manuell')),
  ai_meta jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'clarification', 'submitted', 'approved', 'rejected', 'superseded')),
  change_note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references users(id),
  submitted_at timestamptz,
  unique (testcase_id, version)
);

-- Kriterien-Testfall-Zuordnung (auf Versionsebene)
create table testcase_criteria (
  testcase_version_id uuid not null references testcase_versions(id),
  criterion_id uuid not null references criteria(id),
  criterion_version_id uuid not null references criteria_versions(id),
  primary key (testcase_version_id, criterion_version_id)
);

-- ---------------------------------------------------------------------------
-- Freigaben, Klärungen
-- ---------------------------------------------------------------------------

create table approval_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  object_type text not null check (object_type in ('criterion', 'testcase', 'report', 'certification')),
  object_id uuid not null,            -- logisches Objekt
  version_id uuid not null,           -- geprüfte Version
  version_number integer not null,
  decision text not null check (decision in ('submitted', 'approved', 'rejected', 'withdrawn')),
  reason text,
  hints text,
  decided_by uuid not null references users(id),
  decided_at timestamptz not null default now(),
  history jsonb not null default '[]'::jsonb,   -- bisheriger Bearbeitungsverlauf zum Zeitpunkt der Entscheidung
  constraint rejection_needs_reason check (decision <> 'rejected' or length(btrim(coalesce(reason, ''))) >= 10)
);
create index approval_decisions_obj_idx on approval_decisions(object_type, object_id, decided_at);

create table clarifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  code text not null,
  title text not null,
  description text not null,
  kind text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  options jsonb not null default '[]'::jsonb,         -- [{key,label,consequence}]
  decision_key text,
  decision_note text,
  decided_by uuid references users(id),
  decided_at timestamptz,
  affected jsonb not null default '{}'::jsonb,        -- {criterion_ids:[], testcase_ids:[]}
  source_refs jsonb not null default '[]'::jsonb,     -- Quellenbelege (Originaltext bleibt erhalten)
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (org_id, code),
  constraint resolved_needs_decision check (status <> 'resolved' or (decision_key is not null and decided_by is not null))
);

-- ---------------------------------------------------------------------------
-- Prüfkampagnen, Testläufe, Austauschdateien
-- ---------------------------------------------------------------------------

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),           -- Prüfstelle
  customer_org_id uuid not null references organizations(id),  -- Hersteller (Mandantentrennung)
  name text not null,
  software_version_id uuid not null references software_versions(id),
  scope_area text not null default 'DBVO-41',
  ruleset_id uuid not null references rulesets(id),
  test_date date not null,                                     -- fixiertes Tagesdatum für reproduzierbare Tests
  status text not null default 'planned' check (status in ('planned', 'running', 'evaluated', 'closed')),
  scope_note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table test_runs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  testcase_id uuid not null references testcases(id),
  testcase_version_id uuid not null references testcase_versions(id),
  ruleset_id uuid not null references rulesets(id),            -- historischer Regelwerksstand bleibt erhalten
  status text not null default 'not_run' check (status in
    ('not_run', 'exported', 'awaiting_return', 'passed', 'failed', 'blocked', 'assignment_required', 'import_error')),
  blocked_reason text,
  package_id uuid,
  basis_outdated boolean not null default false,               -- Grundlage inzwischen überholt
  outdated_note text,
  superseded_by uuid references test_runs(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index test_runs_campaign_idx on test_runs(campaign_id, testcase_id, created_at desc);

create table export_packages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  package_no integer not null,
  adapter_key text not null,
  manifest jsonb not null,
  file_name text not null,
  storage_path text not null,
  sha256 text not null,
  status text not null default 'bereitgestellt' check (status in ('bereitgestellt')),
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (campaign_id, package_no)
);
alter table test_runs add constraint test_runs_package_fk foreign key (package_id) references export_packages(id);

create table import_files (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id),
  package_id uuid references export_packages(id),
  test_run_id uuid references test_runs(id),
  file_name text not null,
  sha256 text not null,
  size_bytes integer not null,
  storage_path text not null,
  encoding text,
  status text not null check (status in ('imported', 'assignment_required', 'import_error', 'duplicate')),
  error text,
  warnings jsonb not null default '[]'::jsonb,
  parsed jsonb,
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now()
);
create unique index import_files_dedupe on import_files(campaign_id, sha256) where status <> 'duplicate';

create table comparison_results (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid not null references test_runs(id),
  import_file_ids jsonb not null default '[]'::jsonb,
  expected_version_id uuid not null references testcase_versions(id),
  outcome text not null check (outcome in ('pass', 'fail', 'incomplete')),
  rows jsonb not null,                -- [{field, expected, actual, result, criterion, source}]
  summary jsonb not null,
  normalization jsonb not null,       -- ausdrücklich definierte Normalisierungen und Toleranzen
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Berichte, Versand, Zertifizierung
-- ---------------------------------------------------------------------------

create table reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  campaign_id uuid not null references campaigns(id),
  code text not null,
  kind text not null check (kind in ('fehlerbericht', 'pruefbericht')),
  created_at timestamptz not null default now(),
  unique (org_id, code)
);

create table report_versions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references reports(id),
  version integer not null,
  title text not null,
  content jsonb not null,
  ai_meta jsonb,
  status text not null default 'draft'
    check (status in ('draft', 'clarification', 'submitted', 'approved', 'rejected', 'superseded')),
  change_note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  submitted_by uuid references users(id),
  submitted_at timestamptz,
  unique (report_id, version)
);

-- Freigabe und tatsächliche Bereitstellung/Versand sind getrennte Aktionen
create table report_dispatches (
  id uuid primary key default gen_random_uuid(),
  report_version_id uuid not null references report_versions(id),
  kind text not null check (kind in ('bereitstellung', 'versand')),
  recipient text,
  attachments jsonb not null default '[]'::jsonb,
  status text not null check (status in ('bereitgestellt', 'versendet', 'nicht_konfiguriert', 'fehlgeschlagen')),
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now()
);

create table certification_decisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  campaign_id uuid not null references campaigns(id),
  decision text not null check (decision in ('certified', 'withheld')),
  label text not null,                 -- im Prototyp: 'Zertifiziert im Demo-Prüfumfang'
  scope jsonb not null,
  basis jsonb not null,
  valid_from date,
  valid_to date,
  reason text,
  decided_by uuid not null references users(id),
  decided_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Audit, KI, Jobs, Einstellungen
-- ---------------------------------------------------------------------------

create table audit_events (
  id bigserial primary key,
  org_id uuid,
  at timestamptz not null default now(),
  actor_kind text not null check (actor_kind in ('user', 'ki', 'system')),
  actor_id uuid,
  actor_label text not null,
  action text not null,
  object_type text,
  object_id uuid,
  object_version integer,
  reason text,
  details jsonb not null default '{}'::jsonb,
  ai_model text,
  prompt_version text
);
create index audit_events_obj_idx on audit_events(object_type, object_id, at);

create table ai_calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  purpose text not null,
  model text not null,
  prompt_version text not null,
  status text not null,
  idempotency_key text,
  input_tokens integer,
  output_tokens integer,
  duration_ms integer,
  error text,
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  kind text not null,
  idempotency_key text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  progress integer not null default 0,
  total integer not null default 0,
  message text,
  result jsonb,
  error text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, kind, idempotency_key)
);

create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Unveränderlichkeit: Inhalte eingereichter, freigegebener, abgelehnter und ersetzter Versionen sind gesperrt.
-- Erlaubt sind nur Statuswechsel (und die zugehörigen Einreichungsfelder).
-- ---------------------------------------------------------------------------

create or replace function guard_version_content() returns trigger as $$
declare
  frozen text[] := array['submitted', 'approved', 'rejected', 'superseded'];
  content_old jsonb;
  content_new jsonb;
begin
  if old.status = any(frozen) then
    content_old := to_jsonb(old) - 'status' - 'submitted_by' - 'submitted_at';
    content_new := to_jsonb(new) - 'status' - 'submitted_by' - 'submitted_at';
    if content_old is distinct from content_new then
      raise exception 'Version % ist im Status % gesperrt: inhaltliche Änderungen erzeugen eine neue Version.', old.id, old.status
        using errcode = 'P0001';
    end if;
    -- Status darf aus gesperrten Zuständen nur kontrolliert wechseln
    if old.status <> new.status and not (
         (old.status = 'submitted' and new.status in ('approved', 'rejected', 'draft', 'superseded')) or
         (old.status = 'approved' and new.status = 'superseded')
       ) then
      raise exception 'Ungültiger Statusübergang % -> %', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger criteria_versions_guard before update on criteria_versions
  for each row execute function guard_version_content();
create trigger testcase_versions_guard before update on testcase_versions
  for each row execute function guard_version_content();
create trigger report_versions_guard before update on report_versions
  for each row execute function guard_version_content();

-- Löschen von Versionen ist nie erlaubt (Nachvollziehbarkeit)
create or replace function forbid_delete() returns trigger as $$
begin
  raise exception 'Löschen ist nicht erlaubt (%).', tg_table_name using errcode = 'P0001';
end;
$$ language plpgsql;

create trigger criteria_versions_nodelete before delete on criteria_versions for each row execute function forbid_delete();
create trigger testcase_versions_nodelete before delete on testcase_versions for each row execute function forbid_delete();
create trigger report_versions_nodelete before delete on report_versions for each row execute function forbid_delete();
create trigger approval_decisions_nodelete before delete on approval_decisions for each row execute function forbid_delete();
create trigger audit_events_nodelete before delete on audit_events for each row execute function forbid_delete();
create trigger audit_events_noupdate before update on audit_events for each row execute function forbid_delete();
