-- Quellen entfernen = archivieren: Versionen und Protokoll bleiben unveränderlich erhalten.
alter table source_versions add column removed_at timestamptz;
alter table source_versions add column removed_by uuid references users(id);
alter table criteria add column archived_at timestamptz;
alter table criteria add column archived_by_source uuid references source_versions(id);
alter table testcases add column archived_at timestamptz;
alter table testcases add column archived_by_source uuid references source_versions(id);
