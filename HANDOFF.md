# Continuation checkpoint — AuditFlow

## User goal
Build the complete ITSG hackathon solution in `adenispiroglu-max/Hackathon-itsg`.
User authorized coding, GitHub work and autonomous routine implementation. Roughly 15 hours were available when starting.
Hessian.AI is optional if unavailable. Only supplied data exists; no payroll-software connection.
User requested checkpoints so another AI can continue if context runs out.

## Repository baseline
- Private repository, originally README only.
- Base commit: `556a5491d3d87f51fc9edc791fc364935d9a6a86`.
- Work branch: `codex/auditflow-prototype`.
- No Base44 app existed in the repository. A portable local Python/web application was implemented instead.

## Implemented
- Durable SQLite store, all original approvals pending, provenance and local hash-linked events.
- Fully authored synthetic demo documents and profiles. Original documents were inspected locally but are NOT in the repository.
- Four mapped fixture rules C1–C4; independent source matching and substantive review gates.
- TXT/PDF/DOCX import; literal offline draft mode; optional real model extraction with validation.
- Optional model adapter using the endpoint/model IDs on the supplied handout; no key committed.
- Eight synthetic/historical fixture cases, 29/30/31-day thresholds and explicitly unresolved boundaries.
- Scenario simulation, always-send bug simulator, synthetic sample import and five controlled mutations.
- Sample-specific byte-position parser, checks, explicit incomplete/technical states and snapshots.
- German responsive UI: dashboard, sources, rules, cases, checks, reports, coverage, changes, reference timeline.
- JSON/PDF downloads, local server access token option and no external frontend dependencies.

## Verified so far
- `python -m unittest discover -s tests -v`: 38 tests passed at first backend checkpoint.
- `node --check auditflow/static/app.js`: passed.
- `python -m compileall -q auditflow`: passed.
- Live model attempt: HTTP 403 from execution environment. Do not report successful inference.
- See docs/VALIDATION.md for subsequent verification updates.

## Critical limitations
- Parser layout inferred from one fixture, not confirmed technical annex; only 41 fully supported.
- The timeline documents the full source scenario; it does not execute all message types.
- Only four illustrative fixture criteria are executable; generated arbitrary rules remain unmapped.
- Simulator and checker share logic; an independent vendor/reference implementation is absent.
- Exact date boundaries and typo in March fixture require ITSG confirmation.
- No monetary-benefit calculation/certification, no real insurer/target software, no production hardening.
- Credential exists only outside repo in current execution scratch/process environment. Never reproduce it.

## Run
`python -m auditflow` from repo root. Open http://127.0.0.1:8080.
Optional imports/exports: `python -m pip install -r requirements.txt`.
Tests: `python -m unittest discover -s tests -v`.
Use a temporary AUDITFLOW_DB for demos/tests rather than changing shipped seed defaults.

## Next actions
1. Finish browser end-to-end checks and inspect desktop/mobile layouts.
2. Add/verify backend-2 generated boundary drafts and optional model-backed test drafting if time permits.
3. Record all observed verification results, capture demo evidence and improve UX defects found.
4. Finish docs/API, architecture, pitch script and demo fallback.
5. Commit tested source and updated notes to GitHub; open a reviewable PR without merging main automatically.
6. If continuing beyond prototype, obtain authoritative technical annexes and actual payroll exports first.

## Automatic upload review
The original raw fixture and later original source excerpts/scenario identifiers were rejected for GitHub upload by automatic review. Do not retry uploading them indirectly. The repository data was replaced with entirely authored demo statements, new synthetic dates and generic IDs. A separate local-only source copy may exist in the originating scratch workspace; do not export it without resolving authorization.

## Latest completed checkpoint
- Added deterministic boundary generation and optional model test drafting; all outputs pending.
- Fixed browser form submission (`name="id"` shadowing form.id) using getAttribute('id').
- Fixed mobile grid overflow and verified all nine views at desktop/mobile widths.
- **44 tests passed**; E2E passed reviews, golden synthetic file, mutation failure, downloads,
  boundary drafts, document import and literal extraction with zero page errors.
- Added scripts/browser_smoke.cjs and GitHub Actions configuration.
- Added docs/API.md, docs/ARCHITECTURE.md, docs/PITCH.md and updated validation notes.
- First GitHub checkpoint commit: `4aee193d4cad7d2dfb90fd72559da1ed571f4e85`.

## Remaining external dependencies
Only real inference access (403 here), normative technical annexes, expert confirmation of
boundary rules and a vendor sandbox remain unverified. Do not describe the prototype as
full EEL certification, independent benefit calculation or a live payroll audit.

## Final handoff priorities
The implementation and documented demo are ready for local use. Run the README start commands and import authorised originals locally. The next substantive improvement is authoritative source-to-executable-rule mapping plus independent software/reference validation, not additional cosmetic code. UI regression script and backend tests should be rerun after changes.

## GitHub CI observed
Workflow run https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40390304421 completed all four jobs successfully: backend on Python 3.11, 3.12 and 3.13; frontend JavaScript syntax. Tested code commit: `69d7a0e5f180ba85bfe7fb3397afe1798b32b7fa`. Pull request: https://github.com/adenispiroglu-max/Hackathon-itsg/pull/1.

# Active update: 0.2 bulk automation and ITSG-inspired UI

User requested end-to-end automation, then added an ITSG-style frontend requirement.
Local working branch: codex/automation-update. Publish tested files back to the existing
remote codex/auditflow-prototype branch / PR #1 so the user's existing clone can git pull.
Remote starting head: eec21eb1eff3bd7277bea6ace4492c7c77f7bf79.

Implemented: persistent software projects, versioned reviewed synthetic packages, 1–4,000
profiles/cases, analytical template expectations separate from target simulator, background
execution, paginated results, missing-safe software JSON import, JSON/CSV bulk reports,
change-impact selection, optional automatic dispatch on package approval, full suite reruns,
stop/resume and restart recovery. Existing 0.1 data/screens are preserved.

Frontend adds Automatisierung, automatically refreshed progress and ITSG-inspired red
#D50032 / white / charcoal styling. The reference color was observed in the public ITSG
site HTML. No official asset or source document was uploaded. See docs/DESIGN.md.

Important boundaries: these are authored synthetic DBVO templates, not arbitrary law-to-code
compilation; only three structured types are in bulk automation. Income/hours are metadata.
Model access remains unverified. No external payroll product or independent legal oracle is
connected. Recurring full checks are explicit actions, not a configured calendar scheduler.

Verification complete: 69 tests passed, including a 4,000-case run,
restart after a committed partial chunk, auto change dispatch and missing import results.
Legacy and automation Playwright scripts exercise desktop/mobile UI and downloads.
Update docs/VALIDATION.md with final observed results before publishing.

0.2 final local checks: all 69 unittests passed. Both browser scripts passed with no page errors; automation additionally verified result import with eight missing observations. Structured package review automatically triggers enabled project reruns; full reruns reuse profiles. Original sources and credentials remain outside the repository.


## 0.2 GitHub verification observed

Code commit `2299a3b459ad9dc44144a781936d3c516daaaee7` passed all six jobs in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40400880383:
frontend syntax, backend Python 3.11/3.12/3.13/3.14, and Windows/Python 3.14.
The user's existing clone can update via `git pull origin codex/auditflow-prototype`.
Stop the old server first, restart `python -m auditflow`, and open `/#automation`.

# 0.3 completed local checkpoint — selective ZIP integration

User approved integrating useful parts of `itsg-ai-payroll-audit (1).zip`. Inspected its
React/Base44 source and isolated problematic evaluator paths; see docs/MERGE.md.
Implemented selected UI/workflow patterns in the existing native frontend, preserving
Python startup, SQLite data and all bulk automation. This is NOT a wholesale React port,
Base44 deploy or merge of a second git history. No cloud auth/account was migrated.

New: unified dashboard/live job refresh, four workflow cards, source-specific PDF page
ranges, typed linked test drafts with rule snapshots/provenance, glossary/help and a
read-only evidence assistant for legacy reports and bulk results. Explicit offline mode
uses stored facts; explicit live mode uses Model. Request references are resolved by the
server; model markup is escaped and failures never become a fabricated AI success.
No store-wide lock is held over assistant inference. No new runtime dependencies.
Version 0.3.0; existing database entities remain compatible, no destructive migration.

Local branch codex/merge-audit-ui. Starting remote head observed
54b2e5dbb321d2c150200620c56f2621f30e273e on codex/auditflow-prototype / PR #1.
Publish verified changed files to that existing remote branch with expected-head lease,
so the user's existing Windows clone can pull normally. Do not merge main automatically.

Verification: 80 Python tests pass. Three browser suites pass at desktop/mobile with zero
page errors. New suite covers typed drafts, real local PDF range import, single/bulk
assistant evidence, escaped mocked AI output and explicit failure. Existing suite verifies
36-case fictional change regression (17 selected/19 skipped/eight detected mismatches).
Desktop/mobile screenshots inspected. Real inference, real vendor connection, normative
legal mapping, monetary calculation and multi-user identity remain outside verified scope.

Next: publish, observe CI and record exact code commit/run. Run `python -m auditflow`,
then open /#dashboard. Reports/bulk rows -> Erklären; Fälle -> Gezielte Testentwürfe;
Quellen import -> optional PDF pages; Hilfe & Ablauf -> short demo instructions.

## 0.3 GitHub verification observed

Published code commit `d7e68783117ab136e52fecd4822c1e1ea7012d2f` to the existing
`codex/auditflow-prototype` branch / PR #1. All six GitHub jobs passed in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40407389909:
backend Python 3.11/3.12/3.13/3.14, JavaScript syntax and Windows/Python 3.14.
No merge into main was performed. The user can stop the server, run
`git pull origin codex/auditflow-prototype`, then `python -m auditflow` and open
http://127.0.0.1:8080/#dashboard. Real inference remains unverified.

# 0.3.1 navigation simplification — current UI contract

User asked to remove separate Automatisierung, Prüfung starten, Änderungen,
Nachrichtenfolge and Glossar pages. Navigation now has exactly seven entries: Übersicht,
Quellen & KI, Anforderungen, Profile & Testfälle, Prüfberichte, Testabdeckung, Hilfe & Ablauf.
Manufacturer package preparation and result import are embedded once in Übersicht; its
summary is not duplicated as a second page. Quellversionen vergleichen is below document
inspection in Quellen & KI. Glossary/timeline/direct execution renderers and their action
links are removed. Old bookmarked hashes redirect to dashboard, sources or reports.

The user clarified manufacturers execute the tests. UI launch and explicit subset/full
reruns now create import-mode packages, never simulations. New packages wait for
manufacturer observations; simulation controls and fictitious fault-run buttons are not
available in the UI. Existing simulation reports remain labelled as historical simulation;
legacy APIs remain compatible for backend tests and existing integrations. No records were
deleted. Existing opted-in project events retain backend policy semantics; newly UI-created
import suites also wait for imports after rule changes.

Local branch codex/simplify-navigation; parent remote head observed
6209f2e0a27a855f2ac6f58d2db6b65983be45f2. Browser scripts updated to use the embedded
manufacturer workflow. The original smoke script exercises legacy execution compatibility
through the API and reads resulting reports through the retained UI. No user-facing
execution screen is restored by tests. See VALIDATION.md for final results before publish.

0.3.1 final local check: 80 Python tests passed (8.430 s); JavaScript syntax, compileall and diff checks passed.

# 0.3.2 minimal dashboard / icon assistant

User invoked Figma and requested a simpler, less dense UI with beautiful overview graphics
and an icon-only assistant in the corner. Created an editable Figma concept at
https://www.figma.com/design/bmj0psVtlm26tSuizevY52?node-id=2-395 using discovered library
instances, auto-layout, editable labels and vectors. Verified native node types/no image
fills and Inter typography, corrected clipped layout and SVG ring rendering. Figma values
are illustrative. No app data, original documents or credentials were uploaded to Figma.

Implemented in existing native frontend: three KPIs (package jobs, distinct generated
profiles, waiting imports), latest completed manufacturer-import ring with text legend,
next-action card, three latest package rows/Alle anzeigen, collapsed setup/change tools,
icon-only accessible chat/spark corner button and calmer shared spacing/panels/headings.
Latest result is ordered by finish time, not creation time; simulations and superseded
suite runs do not enter the graphic. Default view does not open a report or technical form.
No chart library or external font/runtime dependency. Existing package/import/review flow
is unchanged. Local branch codex/clean-dashboard; starting local commit c62a768.

Observed: 80 Python tests passed (8.304 s). All three browser suites passed at 1440/390 px
with zero page errors. Added browser checks for exactly three metrics, icon-only accessible
trigger, collapsed setup, completion-time/import-only summary semantics, graphic values
matching stored counts and expanding/collapsing the full package list. Final desktop/mobile
screenshots inspected. Sources/reviews/imports/PDF/assistant and backend 4,000-case checks
remain covered. Publish to existing codex/auditflow-prototype with expected-head lease.

# Active checkpoint — 0.5 customer audit conveyor (2026-10-27)

Latest user requests an ERP-style conveyor: customer/input files, automatic source identity
and version comparison, intermediate reports behind document icons, AI recommendations with
exact revision marks, HUMAN requirement approval, automatic case/profile drafting, reviewed
package delivery, manufacturer result import and human final sign-off.

Local branch codex/document-review-workflow. Unpublished 0.4 work is included. Remote PR #1
head observed c37cbf00ffafa278726038120e7675ce36fc9e01 on codex/auditflow-prototype.
Remote-only sidebar/polish/icons changes from 122281a were inspected and preserved locally.
Do not overwrite them or merge main. Publish verified files using expected-head lease.

Implemented documents.py/library.js: original BLOB persistence, source families/version
history, automatic compare and resumable section jobs, exact-quote validated AI recommendations,
Unicode-safe highlights, human-readable UI, merged results/coverage, new pending revisions.
Older versions stay historical; partial PDF views remain separate. Changed complete source
basis never silently inherits a human approval. Local mode never claims AI inference.

Implemented workflow.py/workflow.js: customer-bound SQLite worklist, immutable input after
start, durable phase/case cursor, requirement gate, AI 2–4 cases per approved requirement or
explicit local skeletons with unknown expectations, case/expectation review gate, snapshots,
JSON package excluding expected values, SMTP TLS auto-send opt-in, manual handoff, exact package
result import, missing-safe typed comparisons, final report and human named acceptance/rework.
Source/approval changes invalidate live packages and return to requirement review. Closed
records preserve their historic basis. Intermediate HTML/PDF reports are append-only snapshots.
SMTP ambiguous delivery is unknown, never automatically retried. Real SMTP and real AI calls
have NOT been verified; all tests use synthetic data/mocked inference and SMTP.

Observed at this checkpoint: 115 Python tests passed (14.466s); pure Node frontend contracts
pass all nine phases, escaping, report controls and Unicode marks. Current subsequent catalog/help
and polling changes still need final checks. Native cloud browser confirmed input creation,
source attachment, automatic source analysis → requirement gate and readable document-icon
report. One synthetic human decision persisted; no real rules approved. Preview uses an ignored
package.json and preview_dev.py with synthetic-only var/conveyor-preview.sqlite3; remove temporary
preview files before final handoff. Do not commit runtime DB or screenshots/originals/secrets.

Next: finish targeted backend/frontend tests, inspect updated browser flow, update docs, commit,
publish to existing PR branch, observe CI. Earlier browser suites were adapted for #packages
but are not claimed rerun for 0.5. Live AI, real mail, SAP integration, arbitrary payroll evaluation,
cryptographic signatures, official certification and multi-user auth remain unverified/out of scope.

0.5 final local checkpoint: 117 Python tests passed (15.936 s), all JS syntax/compileall/diff
checks passed; Node contracts now also verify German Ja/Nein parsing. Native browser verified
all four synthetic human approvals → automatic eight local skeletons → package gate, with
three readable intermediate reports. Final HTML/PDF includes source versions, approvals,
package release, handoff and results; signed report retains that full evidence snapshot.
Customer JSON/HTML/PDF hides internal expected values. New revisions queue fresh prechecks;
missing/stale prechecks prevent generation even after human approval. No real inference or
mail was performed. Publish next, then record actual remote SHA and CI run.

0.5 published code: bd9fb73c6a96852f539555eb24ff39b7724b38b7 on codex/auditflow-prototype / PR #1. Remote parent c37cbf0 was preserved using expected-head lease. Main was not merged. CI observation pending. Temporary package.json/preview_dev.py removed and disposable preview stopped. Browser screenshot could not synchronize to the main container; do not return a broken screenshot link.

CI found two new tests assumed optional reportlab was installed. Corrected the tests to
verify explicit PDF-unavailable fallback without skipping human/HTML checks; Python 3.13
CI now installs existing optional requirements. Both local environments pass: 117 tests
with extras (13.092 s) and no-site-packages runtime (12.351 s, four optional tests skipped).
Initial remote run 40436352597 failed only those two assumptions, including Windows. Await
corrective commit CI; never claim the failed run succeeded.

Corrective remote head: 84c23feebd7f94db7928f7fe79d210486e9621ba. CI push run 40436631573 and PR run 40436636009 in progress. Local worktree was clean after 345cec9 before this note.

## 0.5 verified remote handoff

Code head **84c23feebd7f94db7928f7fe79d210486e9621ba** passed all six jobs in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40436631573:
Python 3.11/3.12/3.13/3.14 on Linux (3.13 includes optional document extras), frontend
syntax/contracts and Windows/Python 3.14. Initial failed PDF-test assumptions were fixed;
no application feature was disabled to make CI pass. Later commits only record these notes.

Update the user's existing clone: stop old server, `git pull origin codex/auditflow-prototype`,
then `python -m auditflow`, open http://127.0.0.1:8080/#dashboard and hard-refresh. Install
requirements.txt if PDF/DOCX support is missing. Choose Vorgänge → Neuer Vorgang. For live
preparation configure a working server-side HAI_API_KEY/model endpoint; for real delivery
configure SMTP as docs/WORKFLOW.md, then opt in per workflow. No key, originals, customer
runtime data or screenshot was uploaded. The preview was disposable and is stopped.

# Active 0.6 checkpoint — list controls, settings, system chat and lifecycle

User requested sort/filter icons throughout useful lists, edit mode with multi-checkbox
selection, trash/export/forward actions, aligned source card actions, Correct instead of
re-approving approved requirements, a system-wide Joule-like read-only chat, bottom-left
settings (English UI only, dark/light/system, SMTP, time tracking), top-left mailbox,
new/unread red dots for requirements/cases, uploaded-file inventory and exact case count.
Additional steering: document deletion cascades to all linked business records; hide dims
and strikes through source/dependants; visibility sorting/filtering; settings trash supports
explicit permanent deletion. All authorized as app behavior; no actual customer mail sent.

Local branch codex/workspace-controls. Remote starting head b0d9ad8b14a87210390c5d32562d5e7b6bf2641a.
New workspace.py handles read migration/marks, settings without secrets, SMTP test, time
sessions with capped heartbeats, read-only chat/history, selection export/forward/outbox,
explicit dependency closure, cascade trash batches/restoration, independently layered hide
sources and confirmed permanent purge. workflow.py now supports exact 1–4,000 requested
cases using durable batches <=4 each; legacy unspecified total still gives 2/requirement.
New controls.js/locale.js supply controls/theme/static UI translations while protecting
source text and record content. No subagents used. Git publication is still pending.

Observed so far: 130 Python tests passed (15.631s), prior Node frontend contracts pass.
New 13 tests cover lifecycle versions/linked workflows, read migration, hide layering,
purge/blob removal, no-secret settings, readonly/no-ref chat, live failure, time cap and
exact 17-case output. Subsequent worker race protection/locale patches need final rerun.
Native browser on isolated synthetic preview confirmed EN+dark, original source text
unchanged, new-dot clears on click, edit checkboxes and two-item export dialog; system chat
opened without finding. Still finish source hide/trash/restore UI and chat response checks.

Preview running through sites-preview with ignored package.json/preview_dev.py and
var/controls-preview.sqlite3, containing authored synthetic data only. Stop/remove those
helpers before commit. Real keys cleared for preview; never commit any DB/secret/original.
Live AI/SMTP not verified. Permanent deletion can only act on trash with DELETE confirmation.
No production multi-user auth, SAP connection, independent legal oracle or official signature.

0.6 checkpoint: 134 tests passed with extras (13.905s) and without site packages (14.130s,
four optional skips). Native browser confirmed system chat with actual counts, dark/EN UI,
source dim/strike, cascade trash and restoring source+requirement through settings. Follow-up
fixes protect in-flight worker writes from lifecycle races, persist package mail history,
purge earlier-trash dependants and redact linked event payloads while rebuilding the local
(non-sealed) chain. Document shared-byte retention is tested. Final guards and docs still
need final run, commit, GitHub publication and CI. Working tree is authorized, not published.

0.6 final local verification: 134 tests passed with optional document extras (14.943s) and
without site packages (13.751s, four optional skips). Both Node contract suites, all static
JS/script syntax checks, compileall and diff checks pass. Final sidebar ARIA translation
state was also covered by controls contracts. Native QA used synthetic fixtures only;
preview was stopped and ignored package.json/preview_dev.py removed. Source original bytes,
DBs, customer data and credentials are excluded from git. Publish to existing PR branch
using b0d9ad8b14a87210390c5d32562d5e7b6bf2641a as expected head; observe new CI next.

0.6 code published as 9606d9c348a683219d08933c453704e8f27f83c0 on codex/auditflow-prototype / PR #1. Expected-head lease preserved b0d9ad8. Push CI run 40444920446 and PR CI 40444923452 are in progress; no merge into main.

## 0.6 verified GitHub handoff

Code **9606d9c348a683219d08933c453704e8f27f83c0** passed all six jobs in
https://github.com/adenispiroglu-max/Hackathon-itsg/actions/runs/40444920446:
Linux Python 3.11/3.12/3.13/3.14 (3.13 includes optional document extras), frontend syntax plus
both render/control contract suites, and Windows/Python 3.14. There is no pending code fix.
Later commits only record verification. Existing source/approval/data migrations are additive.

User update: stop server (Ctrl+C), `git pull origin codex/auditflow-prototype`, restart
`python -m auditflow`, then Ctrl+F5. Bearbeiten enables contextual trash/export; document eye
icon propagates hide/show; gear bottom left → Papierkorb restores groups or confirms DELETE.
Envelope is top left; assistant is bottom right. Choose requested case count in workflow
creation/intake or requirement gate. API/SMTP secrets remain server-side, never in chat/git.
No live inference/mail or actual user-data purge was performed. Preview is stopped, helpers
removed and runtime databases remain ignored. Read docs/WORKSPACE.md for lifecycle/erasure
semantics and scope before future changes. Do not merge main automatically.


## 0.7 Kunden integration (2026-10-27)

User explicitly approved selectively adopting the customer/software features from
feat/dokumente-versionen-8094 under navigation name **Kunden**. Local branch
codex/customers-integration; remote expected parent 08f23f46d232b6548112d4f4b3051670bc3dc7bb.
No whole-branch merge and no main merge. No subagents. Customers/manufacturers, software
versions, contact edits with frozen workflow snapshots, submissions/decision history,
confirmed reminders, filters/sorting/edit/export and existing hide/trash are implemented.

Customers.py adapts the branch concepts to current workflows, not old auto_job approval.
A selected software version is resolved server-side. Free entry registers master data.
Startup links existing workflows/auto_projects without approvals or fictitious customers.
Approval gate requires the newest started visible conveyor's complete passing import,
positive human final sign-off, current basis and approved visible submissions. No waiver
of unknown observations. New evidence changes and effective confirmed reminders mark a
stored approval for recheck, preserving history. Typed names remain self-declared.

Lifecycle closure includes customer/version/submission/workflow/project dependants. Shared
source documents are preserved. Version-only bulk selection never selects parent customers;
whole-customer trash is a separate explicit UI action. Shared reminders retain historical
opaque IDs while other target versions remain. Original submission bytes stay in SQLite;
metadata/export omit payload. Safe Unicode download filenames use RFC5987 header encoding.
No runtime database from the other checkout was imported or committed.

Observed: first full pass 149 Python tests OK (20.049s); all static JS/script syntax,
compileall and three Node render/control suites passed. Added a further lifecycle regression
and Unicode HTTP download checks; final full runs below supersede this count. Native browser
on disposable var/customer-preview.sqlite3 verified Kunden navigation/layout, three-version
bulk export dialog, version detail gates, contact prefill, linked workflow creation and return
to the customer list showing the stored workflow. Synthetic data only; no email/model call.
Managed preview stopped and temporary package.json/preview_dev.py removed. Test DB ignored.
Full old browser suites and mobile/dark-mode manual reruns were not repeated for 0.7.
See docs/CUSTOMERS.md for exact contracts and scope. Final GitHub publication/CI next.

0.7 final local verification: **150 Python tests passed** with optional extras (17.016s);
`python3 -S` discovered 150 and passed with four optional skips (17.743s). All JavaScript
syntax, three Node contract suites, compileall and git diff --check pass. Native QA also
confirmed version-only select-all (3 versions, no parents), export dialog and successful
customer-linked workflow creation. Preview stopped and helpers removed. Publish only source,
tests and docs to codex/auditflow-prototype using expected head 08f23f46. No live model/mail.

0.7 code published as 9201959aa8e357dd5efcba47568e4025dcad5f12 on
codex/auditflow-prototype / PR #1 using the expected-head lease. Push CI run
40448487394: Linux Python 3.11–3.14 and frontend contracts already green; Windows job
still running at this checkpoint. Main was not merged and the source branch is untouched.
Update: stop Python server, git pull origin codex/auditflow-prototype, python -m auditflow,
then Ctrl+F5. Kunden is the second navigation entry. Choose a software version then
Neuer Vorgang to prefill contacts, or select it in the ordinary new-workflow form.

0.7 GitHub code 9201959 passed all six jobs in run 40448487394, including Windows/Python
3.14. PR #1 metadata updated. During completion the user supplied the exact Hessian cURL
contract and asked whether an API is connected. Inspected runtime: HAI_API_KEY is absent
in THIS environment, so no successful live connection can be claimed; the user's machine
is not inspectable from here. Existing adapter URL and Bearer format match. Corrected
default model spelling from vllm/GLM-Flash-Latest to user-supplied vllm/GLM-Flash:Latest in
model.py, .env.example and README. Added masked Windows PowerShell setup and a mocked
request/override contract test. Existing environment overrides must also be corrected
locally. No key was supplied in the cURL text: $HAI_API_KEY is only a variable reference.
No unauthenticated/live external call was made. Final adapter test run/publication next.

Adapter correction final local validation: 151 Python tests pass (15.407s), compileall
and diff check pass. Model request is mocked, not a live Hessian response. Customer code
already has six green remote jobs; the adapter follow-up requires its own remote CI.


## Demo gate confusion fix (2026-10-27)
User saw “Zuerst C1, C2 und C4 fachlich freigeben” when trying to generate a test report,
despite approving own requirements. Traced exact message to Service.generate_cases (legacy
bounded demo generator), not conveyor generation/reporting. Root UX bug: workflowCasesPage
fell back to the unqualified legacy cases() screen when no matching workflow cases existed.
Now it shows a clear workflow-first empty state with existing workflow links/new workflow,
explains approval/generation/report steps, and keeps legacy tools collapsed and explicitly
labelled Demo. Demo error identifies blocked demo IDs and directs own-source work to the
workflow. No approval bypass, no mapping arbitrary requirements to executable demo rules.
Added Node empty-list regression and backend message assertion. No user runtime DB inspected;
this diagnosis identifies the call path, not the actual status of their local approvals.
Remote parent before this fix 0994dda2530ec8ba2fbc99ee4925c171ddad4dd1; do not merge main.

Demo-gate fix validation: 151 Python tests passed (15.912s), all static JS syntax, three
Node contract suites including the new empty-list regression, compileall and diff check
passed. No new native browser or live model test. Publication on existing PR branch follows.

## Visual polish checkpoint (2026-10-27)

Applied the `impeccable` frontend polish pass to the shared AuditFlow UI. The dashboard
now uses a clearer heading without decorative kicker labels, stronger primary actions,
calmer KPI grouping, more legible workflow summary metrics, visible keyboard focus,
improved empty-state hierarchy, and mobile-safe spacing. Existing ITSG red/white/charcoal
language, German copy, offline behavior and workflow functionality are preserved.

Changed `auditflow/static/style.css`, `auditflow/static/workflow.js` and
`auditflow/static/workspace.js`. Verified at 1440px and 390px with no horizontal
overflow. `python -m unittest discover -s tests -v`: 151 passed, 4 optional skipped.
Frontend `node --check` and `scripts/frontend_contracts.cjs`: passed. Editor diagnostics
for all three changed frontend files: no errors. The local server runs at
http://127.0.0.1:8080/#dashboard. The Impeccable context launcher was unavailable from
the checkout, so project `DESIGN.md`, operate/polish guidance and the craft-floor were
read directly before editing.

## Typography readability checkpoint (2026-10-27)

Design-only pass requested by the user. No backend procedure or Python source was changed.
Updated `auditflow/static/style.css` with a role-based readable type scale: 16px body
floor, 36px desktop page headings, 30px mobile headings, 20px section headings, 16px
primary content paragraphs, 14px controls/secondary copy and 12px metadata. Inputs use
16px text to avoid small-screen zoom behavior; line heights and responsive rules were
adjusted with the scale. Verified on Requirements at 1440px and 390px with no horizontal
overflow. CSS diagnostics are clean; frontend Node syntax checks and `git diff --check`
passed. The Impeccable launcher could not start because its engine cache requires extra
network/write permissions, so the typeset and craft-floor references were read directly.

## AuditFlow presentation dashboard checkpoint (2026-10-27)

Design-only dashboard enhancement requested by the user. `auditflow/static/workflow.js`
now presents AuditFlow above the live work queue with a product-introduction hero, three
principles (source-based, human-reviewed, traceable) and four linked workflow steps.
The existing German workflow list, filters, empty state, actions and routes remain below
the presentation layer; the system name remains AuditFlow. `auditflow/static/style.css`
adds the desktop/mobile layout, deep-red presentation surface, responsive process cards,
dark-theme handling and reduced-motion behavior. No backend or procedure changed.
Browser checks passed at 1440px and 390px with no horizontal overflow; CSS diagnostics,
Node syntax checks, frontend contracts and `git diff --check` passed.

## Typography second lift (2026-10-27)

User requested a further small increase for eye comfort. Frontend-only change in
`auditflow/static/style.css`: body/content roles now use 17px, controls and secondary
copy 15px, metadata 13px, desktop page headings 38px and mobile page headings 32px.
No backend or procedure was changed. CSS diagnostics, frontend syntax checks and
`git diff --check` pass. The local server was restarted at http://127.0.0.1:8080.
## Topbar and AuditFlow brand checkpoint (2026-10-27)

- `auditflow/static/style.css` centers the ITSG mark in the full topbar independently of the breadcrumb and right-side controls, including a compact mobile treatment.
- `auditflow/static/workflow.js` keeps the system name `AuditFlow` and presents it as a larger, high-weight product wordmark in the explanatory dashboard hero.
- Backend routes, API calls, data flow, and review procedures were not changed.
- Static validation passed: JavaScript syntax checks and the frontend contract suite passed. The local server process was unstable during the final browser refresh, so the browser tab may need a reload once the existing local server is running.
## AuditFlow motion checkpoint (2026-10-27)

- `auditflow/static/style.css` adds a restrained dashboard entrance, a slow hero-orbit drift, stagger-ready panel timing, and hover/focus feedback for principles and process steps.
- Motion uses transform and opacity for lightweight rendering; `prefers-reduced-motion` removes movement and preserves the usable static layout.
- No backend, API route, data flow, or review procedure changed.
- JavaScript syntax checks, frontend contracts, and editor diagnostics passed.
