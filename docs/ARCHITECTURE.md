# Architecture and rationale

## Three backends, one reproducible application

1. **Sources and AI**: `model.py` and source operations in `service.py` ingest versioned
   text, draft requirements and verify quotation provenance. Model output remains data.
2. **Profiles and tests**: case operations in `service.py` create synthetic scenarios,
   deterministic boundary drafts and optional model drafts. `domain.py` makes calendar
   assumptions explicit. Human-reviewed expectations are a separate gate.
3. **Checks and evidence**: `parser.py` preserves byte positions for a narrow fixture.
   `service.py` distinguishes eligibility, file checks and expectation matching. Reports
   keep snapshots and `store.py` persists them in SQLite.

The standard-library HTTP server provides a simple local demo without a build toolchain.
The UI uses static HTML/CSS/JavaScript, fetches same-origin APIs and renders escaped text.
PDF/DOCX support is optional; the prepared demo has no network dependency.

## Why no autonomous agent

The valuable task is repeatable evidence handling. The app explicitly chooses which step
runs, which source/version it uses and what must be reviewed. An autonomous planner adds
little value to the first demo. The model adapter can be replaced independently.

## Why the repository contains synthetic sources

Automatic upload review rejected the original fixture and later source-derived material.
No bypass was used. The committed seed is authored from scratch with synthetic dates and
IDs. Original authoritative documents may be imported by the operator. The seed's literal
quote matching demonstrates provenance mechanics, not verification against legislation.

## Practical next steps beyond the hackathon

- Obtain matching technical record annexes and authoritative rule/version decisions.
- Replace fixture-only layout handling with a versioned schema implementation.
- Implement and validate the full correction sequence, not only its timeline.
- Connect a real vendor sandbox; record actual software/configuration versions.
- Establish an independent reference calculator before claiming monetary validation.
- Add robust source section alignment and transitive dependency tracking.
- Add authentication, authorisation, durable object storage, backups and external audit
  storage before any shared production deployment.
- Validate actual model access in the organizer's network; current attempt returned 403.

No invented cost/time saving, certification success rate or model-accuracy claim is used.

## 0.3 selected integration

`static/workspace.js` adds dashboard/help/glossary, typed-draft UI and an evidence drawer
without a frontend build. `assistant.py` resolves stored report/result references and
returns deterministic evidence explanations or explicitly requested model explanations.
The server runs this endpoint outside the store-wide mutation lock. Document imports
can retain a selected physical PDF page range, with range-aware deduplication. Existing
ruleset execution, review gates, bulk jobs and database entities are preserved. MERGE.md
documents the source comparison, retained boundaries and deliberately excluded paths.

## 0.4/0.5 additions

`documents.py` owns persisted original BLOBs, assistive source identity/version recognition,
append-only source comparison, per-section resumable extraction and exact-quote AI review
validation. `workflow.py` owns customer-bound phase orchestration and immutable report
snapshots. Generation is committed per approved requirement and network operations run
outside the store lock. Active semantic-basis changes invalidate package preparation;
finished records preserve historic evidence. `library.js` supplies human-readable documents,
structured forms, Unicode-safe marks and merged result/coverage views. `workflow.js`
supplies ERP-style worklist/object/process views, customer input, gate forms, case catalog,
result import and sign-off. Remote sidebar polish and icons are preserved.

No destructive migration or new runtime dependency. Original files and customers remain
in runtime SQLite, never source control. Per-workflow SMTP opt-in and human release precede
transport; unknown transmission states are never automatically retried. The free-text case
specification contract is distinct from existing bounded executable C1/C2/C4 templates.
