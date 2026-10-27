# Validation log

## First checkpoint
- 38 unittest tests passed (calendar, fixture parsing, service workflows, model failures, HTTP/API behavior).
- JavaScript syntax and Python compilation passed.
- Original sample parsed as 4 AU periods, DBVO starting at byte 350, AZVU distinct from reference ID.
- Real inference connection attempt received HTTP 403. No successful model inference claimed.

This demonstrates internal implementation behavior within the documented fixture scope. It does not establish normative/legal correctness or conformance of external payroll software.

## Repository data policy
Automatic review rejected original fixture and original source-excerpt uploads. The checked-in seed is now entirely authored synthetic content with new dates/references. Original-file checks were local only. Normative source grounding must be established by importing authorized originals and reviewing mappings.

## Final functional checkpoint
- **44 unittest tests passed** in the available Python environment, including PDF generation.
- Browser E2E: nine application views at 1440 px and 390 px, no page errors or body overflow.
- E2E exercised rule and expectation reviews, a passing synthetic file, wrong-AZVU failure,
  JSON/PDF downloads, four pending boundary drafts, TXT import and literal draft extraction.
- Browser testing caught and fixed a form `id` shadowing bug and a mobile grid overflow.
- PDF report inspected programmatically for readable nonempty pages.
- Optional live test generation is implemented but actual inference remains unverified (403).
- GitHub Actions configuration added; cloud CI results are not claimed until observed.

Reproduction: `scripts/browser_smoke.cjs` requires Playwright/Chromium and a disposable local
server database; the guard prevents accidental execution without explicit test opt-in.

## GitHub CI observed
Workflow run https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40390304421 completed all four jobs successfully: backend on Python 3.11, 3.12 and 3.13; frontend JavaScript syntax. Tested code commit: `69d7a0e5f180ba85bfe7fb3397afe1798b32b7fa`. Pull request: https://github.com/adenispiroglu-max/Hackathon-itsg/pull/1.


# Version 0.2 automation + ITSG-inspired UI

- **69 unittest tests passed** in the local environment.
- A 4,000-case run generated 4,000 distinct synthetic profile IDs, completed all results,
  preserved missing/unknown states and exported all 4,000 report rows.
- Persistence test interrupted a run after 100 committed results, reopened the database,
  resumed and finished 250 rows without duplicate results or counters.
- Automatic change-dispatch and full recurring profile reuse are tested.
- JSON imports reject duplicate/unknown IDs and wrong value types. Partial output leaves
  omitted cases not assessable, including an HTTP-route test.
- Legacy browser checks still pass. New automation E2E passed at desktop/mobile widths:
  project/package review, 36-profile bulk run, profile inspection, JSON/CSV export,
  rule-version change, 17-case impact subset (19 skipped), 8 outdated-target failures,
  and imported output with 8 intentionally missing observations.
- No page errors in either browser script. ITSG-inspired red/white/charcoal layout inspected.
- The new pipeline uses separate analytical and target-simulator implementations; this
  remains internal synthetic testing and does not establish legal or vendor conformance.


## 0.2 GitHub verification observed

Code commit `2299a3b459ad9dc44144a781936d3c516daaaee7` passed all six jobs in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40400880383:
frontend syntax, backend Python 3.11/3.12/3.13/3.14, and Windows/Python 3.14.
The user's existing clone can update via `git pull origin codex/auditflow-prototype`.
Stop the old server first, restart `python -m auditflow`, and open `/#automation`.

## 0.3 selective integration — observed local verification

- 80 Python tests passed (8.400 s in the recorded complete run), including the unchanged
  4,000-profile pipeline and new evidence-reference, negative/missing draft, PDF range
  identity/deduplication and HTTP authorization/failure tests.
- Legacy browser smoke: all nine original views at desktop/mobile, review gates, synthetic
  file pass, mutation failure, JSON/PDF export, boundary drafts and document import passed.
- Automation browser smoke: 36 profiles, 17 selected/19 skipped on fictional rule change,
  eight detected target errors, JSON/CSV export and missing-result import passed.
- New workspace browser smoke: typed positive/negative/missing-data drafts through the UI,
  correctly suppressed negative case passes, PDF pages 2–3 retain original page IDs,
  assistant reads stored single and bulk evidence, mocked model markup is escaped and
  mocked inference failure stays an explicit error. New dashboard/help/glossary and
  assistant tested at 1440 and 390 px; no horizontal document overflow or page errors.
- Desktop dashboard and mobile assistant screenshots were visually inspected locally.
- No live model inference or Base44 authentication was verified or claimed. Mocked output
  is only UI/error-handling evidence. Source archive and credentials were not uploaded.

## 0.3 GitHub verification observed

Published code commit `d7e68783117ab136e52fecd4822c1e1ea7012d2f` to the existing
`codex/auditflow-prototype` branch / PR #1. All six GitHub jobs passed in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40407389909:
backend Python 3.11/3.12/3.13/3.14, JavaScript syntax and Windows/Python 3.14.
No merge into main was performed. The user can stop the server, run
`git pull origin codex/auditflow-prototype`, then `python -m auditflow` and open
http://127.0.0.1:8080/#dashboard. Real inference remains unverified.

## 0.3.1 navigation and manufacturer handoff

- All three browser suites passed at 1440/390 px, with zero page errors.
- Seven navigation entries verified. Retired automation/check/changes/chain/glossary
  bookmarks redirect; no direct execution form or obsolete navigation link remains.
- Source version comparison executed from Quellen & KI against two synthetic versions.
- Embedded dashboard workflow creates import-mode packages, exports results, imports
  synthetic manufacturer observations, selects 17/36 cases for a fictional rule change,
  waits for new observations and preserves eight missing observations as not assessable.
  The intentionally all-true manufacturer fixture yields 12 deviations in the selected
  subset; this is fixture behavior, not a real manufacturer assessment.
- Typed drafts, PDF page ranges, assistant evidence and historical report downloads still
  pass. The legacy API path is tested for compatibility without restoring its removed UI.
- Desktop dashboard screenshot visually inspected. No backend schema/data migration.

0.3.1 final local check: 80 Python tests passed (8.430 s); JavaScript syntax, compileall and diff checks passed.

## 0.3.2 observed local validation

80 Python tests passed (8.304 s). All three browser suites passed with zero page errors at
1440/390 px. New checks verify three KPIs, accessible icon-only assistant, initially collapsed
setup, last-completed-import-only result selection, chart values against stored counts and
full-list expansion. Dashboard screenshots were inspected at desktop/mobile widths. Existing
review/source/PDF/import/targeted-package/assistant paths still pass. Figma concept is editable
and uses labelled illustrative values; it is not evidence of real vendor inference or tests.

## 0.5 customer conveyor / integrated 0.4 sources — observed 2026-10-27

- Full Python suite: **117 tests passed (15.936 s)** on the local runtime. Includes original
  persistence/dedup/version history, exact anchored AI marks and Unicode offsets, malformed
  model outputs, source/review changes, customer validation, source/precheck/human gates,
  resumable per-requirement case cursors, automatic fresh prechecks after revision, expected-
  value release gate, hidden expected values in customer exports, strict package imports,
  boolean-vs-number distinction, missing-safe results, positive final acceptance blocking,
  final human signature checks, immutable report history, HTML escaping/PDF and HTTP routes.
- SMTP tests use mocked transport: missing configuration, ambiguous failure, successful
  acknowledgement and duplicate-send prevention. No real customer was emailed.
- Node frontend contracts passed all nine phases, escaped source/customer text, report icon
  controls, Unicode quote slicing and readable boolean parsing. JS syntax checks across all
  tracked static/script JS and Python compileall passed; `git diff --check` passed.
- Native browser QA on disposable synthetic data confirmed customer input, existing-source
  attachment, automatic source-analysis transition to requirement gate, readable intermediate
  report via document icon and persisted synthetic human decisions. After all four demo
  approvals the workflow automatically produced eight explicitly local test skeletons and
  three intermediate reports, then stopped at package review. Visual process/worklist checked.
- The four older Playwright suites were adapted/retained for the revised routes but were NOT
  rerun for the final 0.5 change. Do not report old 0.3/0.4 browser results as fresh 0.5 results.
- Real model connectivity remains unverified (prior attempt HTTP 403). Live tests are mocked,
  not live legal assessment. Real SMTP, customer software, arbitrary law-to-code compilation,
  SAP integration, full payroll/monetary correctness, qualified signatures and multi-user
  production operation are not established by these tests.

CI portability correction: the first 0.5 run exposed two tests that incorrectly assumed
optional reportlab was installed. The application returned the expected explicit 422/PDF
unavailable error. Tests now assert this fallback while still exercising HTML and human
sign-off. A Python 3.13 CI leg installs the existing optional requirements to exercise actual
PDF/DOCX capabilities; other versions/Windows retain standard-library-only coverage.
Observed after correction: 117 tests pass with extras (13.092 s); `python -S` also passes all
117 discovered tests without extras (12.351 s, four pre-existing optional tests skipped).
Frontend contracts pass. New remote CI result still to be recorded.

### Observed corrected GitHub CI

Code commit `84c23feebd7f94db7928f7fe79d210486e9621ba` passed all six jobs in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40436631573:
Linux Python 3.11, 3.12, 3.13 (with optional PDF/DOCX extras), 3.14; frontend syntax/contracts;
and Windows/Python 3.14. Subsequent documentation-only commits record this exact verified
code result. Real model/SMTP connections and full browser regression remain unverified.

## 0.6 workspace controls — observed local validation

134 Python tests passed with document extras (13.905 s); the standard-library-only run also
passed 134 discovered tests (14.130 s, four optional tests skipped). Later lifecycle guards
require final confirmation before publish. New controls contracts cover human status,
new/read and visibility filtering, title/unread sorting (including nested workflow cases),
edit-only checkboxes, red dots and reversible English UI translation while leaving source
text unchanged. Existing nine-phase render contracts and JS syntax/compileall checks pass.

New Python tests exercise source-family cascade trash/restoration, independent hide causes,
paused workflow gates, confirmed permanent purge, shared original bytes, earlier-trash
closure, local audit-payload erasure and valid rebuilt chain, readonly no-ref chat/model
failure, settings with no returned/accepted secrets, capped time sessions, authenticated
workspace routes, exact requested case totals, export snapshots and durable outbox history.

Native browser QA on authored synthetic data verified English/dark mode, aligned source
card actions, checkbox multi-selection/export dialog, new-dot dismissal, no-ref system chat
answer with actual counts, dimmed/struck source, source+requirement cascade trash and common
restore through Settings → Trash. Permanent purge is verified in disposable backend tests;
no actual user data was purged and no real mail/model inference was performed. Full older
Playwright suites remain retained but were not rerun for 0.6. Screenshot synchronization to
the main container is unavailable; do not link a nonexistent screenshot.

Final 0.6 local rerun after lifecycle guards: **134 tests pass with extras (14.943s)**;
**134 discovered tests pass without site packages (13.751s, four optional skips)**. Both Node
contract suites and all JS syntax/compileall/diff checks pass. Source-job/automation/workflow
workers respect hidden/trash state without recreating purged progress records. Publication
and remote Linux/Windows results are recorded separately below when actually observed.

### 0.6 observed GitHub result

Code `9606d9c348a683219d08933c453704e8f27f83c0` passed all six jobs in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40444920446:
Linux Python 3.11–3.14, optional document extras on 3.13, frontend syntax with both Node
contract suites, and Windows/Python 3.14. Subsequent documentation-only commits record
this exact verified code. No real model/SMTP connectivity or full older Playwright rerun
is implied by this result.


## 0.7 Customers integration

- 150 Python tests passed with document extras (17.016s). Without site packages: 150
  discovered, OK with four optional skips (17.743s). New tests exercise actual conveyor
  creation → source/reviews → manufacturer import → final sign-off → version decision;
  old-pass/new-process isolation, changed-basis checks, contact snapshots, registry
  dedup/migration, submission bytes/decisions, dated reminders, lifecycle/shared sources,
  parent restore ordering, authenticated HTTP and Unicode download headers.
- All JS/script syntax, compileall, diff check, and three Node contract suites pass. The
  customer suite covers naming, list/detail/forms escaping, filters, version-only bulk
  selection, prefill and workflow selector, English labels.
- Native browser on synthetic disposable data verified Kunden nav/layout, edit/select-all
  and three-version export dialog, version detail, prefilled contact/software selection,
  creation of the linked workflow and updated customer list. Preview stopped. No new full
  browser regression/mobile/dark rerun and no real SMTP/model calls were performed.
- No official certification, authenticated reviewer identities, independent payroll oracle
  or cross-checkout runtime database transfer is claimed.
