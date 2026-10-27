-- Migration 002: Änderungsmanagement, Folgeantworten, Stufen je Testlauf

create table change_impacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id),
  criterion_id uuid not null references criteria(id),
  from_version_id uuid references criteria_versions(id),
  to_version_id uuid not null references criteria_versions(id),
  testcase_id uuid not null references testcases(id),
  affected_version_id uuid not null references testcase_versions(id),  -- bisher freigegebene/aktuelle Testfallversion
  draft_version_id uuid references testcase_versions(id),              -- neu erzeugter Entwurf
  explanation text not null,
  diff jsonb not null default '{}'::jsonb,
  running_runs integer not null default 0,
  status text not null default 'offen' check (status in ('offen', 'erledigt')),
  created_at timestamptz not null default now(),
  unique (to_version_id, testcase_id)
);

alter table test_runs add column stage integer not null default 0;

-- Vom Portal erzeugte Folgeantworten der Krankenkasse (getrennt von Eingangsdaten, Software-Ausgaben und Importen)
create table followup_replies (
  id uuid primary key default gen_random_uuid(),
  test_run_id uuid not null references test_runs(id),
  stage integer not null,
  file_name text not null,
  storage_path text not null,
  sha256 text not null,
  bindings jsonb not null default '{}'::jsonb,   -- aus Importen gebundene dynamische IDs
  note text,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  unique (test_run_id, stage)
);

alter table import_files add column kind text not null default 'software_ausgabe' check (kind in ('software_ausgabe', 'sonstige'));
alter table import_files add column stage integer;

alter table test_runs add column azvu text;
alter table test_runs add column completion_note text;          -- dokumentierter Abschluss bei erwarteter Nicht-Erzeugung
alter table test_runs add column completion_by uuid references users(id);
alter table test_runs add column completion_at timestamptz;
alter table test_runs add column finalized boolean not null default false;  -- Lauf ohne weitere Rückgaben abgeschlossen
alter table test_runs add column last_comparison_id uuid;
