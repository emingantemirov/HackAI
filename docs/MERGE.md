# 0.3 — adapted audit workspace

## Decision and provenance

Inspected the supplied `itsg-ai-payroll-audit (1).zip` (135 archive entries) and compared
its React/Base44 entities/functions/UI with AuditFlow 0.2. The projects have different
runtimes and persistence contracts; the ZIP is not a patch or an established shared git
history. Selected interaction patterns have been reimplemented against the existing local
AuditFlow API. This is a selective functional integration, not a wholesale git merge or
React/Base44 deployment. No npm build or additional cloud account is required.

## Included

- Unified dashboard for software targets, original single-case data, generated profiles,
  active/waiting jobs, pending requirements/packages and historical findings. Live job
  state is refreshed on the dashboard. History counts are labelled as history, not a
  current manufacturer-conformance assessment.
- Four workflow cards, latest job links, help/demo instructions and glossary.
- Read-only evidence assistant for stored single-case reports (optionally one criterion)
  and individual bulk results. Local evidence explanation needs no model; explicit live
  mode uses the existing server-side Model adapter. No Base44 InvokeLLM remains.
- Server resolves report/result references; arbitrary browser finding text cannot replace
  the recorded evidence. Inference runs without holding the worker's global store lock.
  Model HTML is displayed as text. Errors remain errors, without fabricated AI fallback.
- Positive, negative, boundary and missing-data drafts. All remain pending, retain rule IDs
  and rule snapshots, generation mode and prompt/model provenance. Template mode uses
  authored 2026 demo facts; boundary/live modes use the selected baseline. No novel
  arbitrary legal requirement is compiled into a checker.
- Optional PDF page range at import (inclusive, original physical PDF page numbers,
  at most 100 selected pages; existing whole-document import remains available).
  File hash describes the entire uploaded file; page_range describes the imported view.
  Deduplication includes version, validity date and range. Section IDs remain page-N.

## Preserved

The existing standard-library server, SQLite database, 4,000-case pipeline, separate
analytical expectation/mock target, review gates, unknown outcomes, versioned packages,
automatic targeted reruns, import contract, legacy parser, exports and old reports.
No migration or destructive reseed is required. Existing documents without page_range
are treated as whole-document imports; existing cases need no test_type field.
The frontend retains ITSG-inspired red/white styling and prototype scope labels.

## Intentionally not imported

- Base44 auth/account storage, SDK, hosted file services and publishing config. A separate
  production identity/access design is still needed for a multi-user service.
- ZIP's original sample data/source excerpts/contact details, cloud configuration or
  credentials. The uploaded archive remains outside this repository.
- Its deterministic evaluator/parser: isolated synthetic probes reproduced invalid dates
  normalizing to other dates; empty/manual-only requirement sets yielding pass; and a
  correctly suppressed negative scenario yielding overall fail despite a matching
  behavior comparison. These paths were not made part of AuditFlow.
- Static section-number-only source passages and approval-as-executability shortcuts.
- ZIP's unlinked generated cases (empty requirementIds) and unsupported blanket legal
  assumptions for open AU, exact boundaries and duration from transmitted periods.

## Validation and deployment

See VALIDATION.md and HANDOFF.md for observed local and remote checks. Live model access
must be verified in the user's environment; mocked UI/model tests are never evidence of
real inference. Existing 4,000 profiles represent controlled template variations, not
4,000 independently sourced legal obligations. No real payroll vendor or monetary oracle
has been added. Use Python 3.11+ and `python -m auditflow`; optional PDF dependencies
remain in requirements.txt.

## Subsequent UI simplification (0.3.1)

The glossary, illustrative timeline and direct execution screens were removed at the
user's request. The manufacturer package workspace is embedded in Übersicht; source
version comparison is embedded in Quellen & KI. New/manual rerun packages from the UI
always wait for manufacturer output. No direct simulation/execution controls remain in
the UI, while stored historical reports and compatibility APIs are preserved.
