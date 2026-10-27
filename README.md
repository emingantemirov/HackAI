# AuditFlow

## Customers (0.7)

The navigation entry is **Kunden** (Customers). It stores customer/manufacturer contact details,
software and distinct versions. New workflows can select a stored version with contact prefill;
free-entry workflows register their customer/version automatically. Existing workflow customer
snapshots are never rewritten when a contact changes. Existing workflows/demo projects receive
additive master-data links on startup, without invented approvals or fictional customer seeds.

Each version shows its workflows, human decision history, manufacturer document submissions
and confirmed rule-change reminders. Approval requires complete passing manufacturer results
and positive human final sign-off in the newest started visible conveyor workflow, a current
requirement basis and approved submissions. Unknown results cannot be waived into a pass.
There is no automatic official certification or account/login management.

Lists reuse workspace filters, sorting, export, visibility and recoverable trash. Bulk selection
selects software versions; deleting a whole customer is a separate explicit action in edit mode.
Customer deletion cascades to its versions/submissions/workflows, preserving shared source files.
See [customer contracts](docs/CUSTOMERS.md).

**AuditFlow 0.6: customer input → versioned sources → AI recommendations → human requirement approval → test specifications → reviewed customer delivery → manufacturer results → human final sign-off.**

## Workspace controls (0.6)

Filter/sort lists by human status, new/read and visibility. **Bearbeiten** enables multi-select
with trash, JSON/HTML/PDF export and explicit email forwarding. Approved requirements use
**Korrigieren** to create a new revision. New requirements/cases show a red dot until opened.
Source card actions align, and uploads list already stored documents.

Document hide/show dims and strikes through linked records. Source deletion moves its family
and downstream requirements/cases/workflows/results into one recoverable trash group.
**Settings → Trash** restores the group or permanently removes it after typing `DELETE`.
Original bytes shared with other sources remain retained. See [workspace behavior](docs/WORKSPACE.md).

The bottom-left gear controls English/German UI (documents unchanged), dark/light/system theme,
SMTP connection settings and manual session time tracking/CSV. The top-left envelope contains
system notifications and actual outbox states. The corner assistant answers system questions
without requiring a selected finding; local help and live AI remain explicitly distinct.
Requested case quantity (1–4,000; minimum one per requirement) is chosen before workflow generation.

## Current workspace: customer audit conveyor (0.5)

Open **Vorgänge → Neuer Vorgang**. Enter customer contact/email and software version,
inspect/upload source files and start the workflow. Automatic source comparison, resumable
requirement preparation and exact-quote AI revision marks lead to a human approval gate.
After approval, test cases/profiles are drafted automatically. Independently check their
inputs/expected values and release the package for download or optional SMTP delivery.
Import the manufacturer's response and review/sign off the automatically prepared final report.

Small **document icons** open immutable intermediate reports at each completed station.
The source library retains originals, PDF reading/downloads and version history. Requirements,
profiles/cases and results are also accessible in their corresponding navigation views.
Changed active requirements invalidate old packages and require a new review.

Live AI needs a working server-side model connection. Offline mode is explicitly local:
unknown case expectations must be concretized, never silently treated as AI-approved.
Email requires server-side SMTP configuration and per-workflow auto-send opt-in. Without it,
use download/manual handoff. A typed name records human sign-off; it is not a qualified
signature or official certification. Neither real model inference nor real SMTP delivery
was verified in development. See [workflow and setup](docs/WORKFLOW.md).

The earlier synthetic bulk/demo workspace remains at **Demopakete & Werkzeuge** (`/#packages`).
It supports up to 4,000 bounded C1/C2/C4 cases. The older sections below document those
retained demo capabilities; their old “Übersicht” links now correspond to that tools view.


A complete local demo with three Python backend modules and a responsive German web UI.
Core runtime uses Python's standard library. No Node build, cloud account or model key is needed to explore the offline workflow.

## New: shared audit workspace (0.3)

The selected workflows from the supplied React/Base44 ZIP have been adapted to the
existing local app. The dashboard now combines single-case and bulk work. Reports and
bulk result rows include an **Erklären** button for a read-only evidence assistant:
local explanation without a key, or explicit live-model mode. The latter needs the
server-side model configuration below and never silently falls back to a fake AI answer.

**Profile & Testfälle → Gezielte Testentwürfe** offers positive, negative, boundary and
missing-data cases, preserving rule links and pending human review. **Quellen & KI →
Dokument importieren** accepts an optional PDF page range with original page numbers.
Hilfe & Ablauf explains the manufacturer handoff workflow. No Base44 login or Node build is
required; cloud auth was not migrated. See [integration scope](docs/MERGE.md).

## Clear overview (0.3.2)

The dashboard shows three essential metrics, a labelled result ring for the latest completed
manufacturer import and the three most recent package jobs. Historical simulations and older
runs are not added into that graphic. Its next-action card points to review or import work.
Setup, rule-change tools and report details open only when needed; all packages remain
available through Alle anzeigen. The evidence assistant uses an accessible icon-only corner
button. No external fonts, image assets or chart dependencies are downloaded.

Editable Figma concept: https://www.figma.com/design/bmj0psVtlm26tSuizevY52?node-id=2-395
Figma values are explicitly illustrative; runtime figures come from the stored job data.

## Start on Windows

Install Python 3.11 or newer. Open PowerShell in this repository:

```powershell
python -m pip install -r requirements.txt
python -m auditflow
```

Open **http://127.0.0.1:8080**. Or double-click `START_WINDOWS.bat` after installing Python.
The optional packages enable PDF/DOCX imports and PDF exports. Without them, the synthetic demo sources, TXT imports, checks and JSON exports still work.

## Start on macOS / Linux

```bash
python3 -m pip install -r requirements.txt
python3 -m auditflow
```

## New: end-to-end automation

Open **Übersicht → Testpakete & Herstellerergebnisse**. There is no separate automation page.

1. Create a software target with manufacturer, software name and version. The optional
   change-trigger checkbox enables automatic affected-test execution after a new package approval.
2. Inspect and authorise the synthetic rule/template package once, with your name, reason
   and explicit acknowledgement of the demo scope. This is not official legal approval.
3. Choose 36 cases for a short demo, or **4,000** for a bulk run. Every case gets its own
   reproducible synthetic employee profile. Nine template families vary dates, certificate
   status and thresholds; income/hours are metadata, not payroll calculation inputs here.
4. Create the package. Export the input JSON for the manufacturer to run in its own software.
   Import the manufacturer JSON output; comparison and reporting resume automatically.
5. Open a case/profile, inspect pass/fail/not-assessable counts and download the report.
6. Create a new version (for example the explicitly fictional **30 → 32 day** change),
   inspect it and authorise it. Enabled projects automatically prepare affected manufacturer packages plus
   core regression; these wait for new output. Manual impact preview and a full recurring rerun are also available.

No separate fabricated approval is assigned to each generated case. The expectation basis
is the authorised, versioned synthetic template; changing its parameters needs a new review.
A separate analytical expectation module and a standalone mock target replace the old
single-checker simulation loop for automation. They are independent code paths, not an
independently certified legal oracle or an actual vendor integration.

### Imported software output

Choose **Testpaket exportieren · echte Ergebnisse importieren**. The worker generates a JSON
input package containing profile data and case IDs, without expected outcomes, then waits.
The target software/operator must produce a JSON file:

```json
{"records": [{"case_id": "<exported case ID>", "observed": {"message_present": true}}]}
```

Import it in the job report. Automatic evaluation then resumes. Duplicate/unknown case IDs
and wrong types are rejected; omitted or unknown results stay not assessable. Imported JSON
is not automatically authenticated as a particular vendor's output. No vendor API is invented.

Generation/results/cursors are committed in chunks. Interrupted running jobs resume on
server restart. A user can stop and continue a job. Historical reports retain their frozen
rule package. Existing 0.1 data and single-case screens remain available after updating.

The ITSG-inspired frontend uses the public site's red accent, white surfaces and charcoal
text, and retains a clear hackathon-prototype label. See `docs/DESIGN.md`.

## Simplified navigation (0.3.1)

The current navigation contains Vorgänge, Quellen & KI, Anforderungen, Profile & Testfälle,
Ergebnisse & Abdeckung and Hilfe & Ablauf. Reports and coverage share one view. The former Änderungen view is part of
Quellen & KI. Separate Automatisierung, Prüfung starten, Nachrichtenfolge and Glossar
screens are removed; old bookmarked routes redirect to the relevant current workspace.
Existing reports and database records remain available. Legacy execution APIs remain for
compatibility and backend regression checks; the UI does not offer direct simulation or
file-test execution. New and manual rerun packages created from the UI always use import
mode: the manufacturer executes the tests and returns observations.

## Scope and honesty

- Four illustrative DBVO-like demo criteria and Abgabegrund 41, using a fully synthetic 2026 profile.
- Original documents are not distributed in GitHub. Import your authorized source documents through the UI. All shipped source statements are authored synthetic demo material, not legal authority.
- Sample-specific fixed-width parser, **not** a verified general technical DTA-EEL implementation. Unsupported blocks/records fail explicitly.
- No payroll vendor integration, real insurer exchange, official certification or independently implemented benefit calculation.
- The 41→61→01→61→88→01→62 scenario is shown as a sourced timeline. Only a synthetic 41 file has executable raw-file support.
- Exact six-month boundaries, twelve-month clipping and uncertified periods with seamless follow-up require specialist clarification. Open-AU counting requires an explicit policy and is not auto-approved.
- The legacy single-case simulator shares its checker. The new bulk pipeline uses separate analytical and mock-target modules; neither establishes external vendor conformance.
- Verified citation ≠ approved interpretation. Generated free-text requirements remain drafts without executable mappings; automation uses only the supported, reviewed structured template types.
- Reports retain their scenario and requirement snapshots. The local event hash chain supports traceability, **not tamper-proof external audit storage**.

## Optional model connection

The user-supplied Hessian.AI cURL example specifies the chat route below and the exact model ID `vllm/GLM-Flash:Latest`. The adapter uses these defaults. Credentials must be supplied locally:

```powershell
$haiSecret = Read-Host "Team API key" -AsSecureString
$env:HAI_API_KEY = [System.Net.NetworkCredential]::new("", $haiSecret).Password
Remove-Variable haiSecret
$env:AUDITFLOW_MODEL = "vllm/GLM-Flash:Latest"
python -m auditflow
```

The PowerShell prompt masks input; the key is available to Python in this terminal's process environment. Never commit the real value or paste it in chat. `.env.example` lists names; the app reads process environment and does not automatically load `.env`. An existing `AUDITFLOW_MODEL` environment override takes precedence: update it to the exact ID above if it still contains the older spelling.

Endpoint default: `https://hip-gw.hessian.ai/v1/chat/completions`.
Override `AUDITFLOW_MODEL_URL` only with a trusted HTTPS endpoint. The API key is sent to the configured endpoint.

Use **Quellen & KI → KI-Verbindung testen**. The development-environment connectivity attempt received **HTTP 403**; successful live extraction is therefore not claimed. Offline literal drafting is distinct and labelled.

## Quality checks

```bash
python -m unittest discover -s tests -v
node --check auditflow/static/app.js
node scripts/frontend_contracts.cjs
```

The tests use temporary databases and synthetic review identities. They do not approve the shipped seed data. See `docs/VALIDATION.md` for observed results and limitations.

## Data and server operation

Data persists in `var/auditflow.sqlite3`; restarting does not erase approvals or reports.
Back up this file with SQLite's backup API before changing deployments. To start a separate session, set `AUDITFLOW_DB` to a new path.
Default binding is localhost. Network mode requires `AUDITFLOW_ACCESS_TOKEN`, entered by users via **Zugang**. This is a single-user/local hackathon server, not hardened production hosting. Do not expose it directly to the internet.

## Architecture and handoff

- Backend 1: `model.py`, document import/extraction/review/diff in `service.py`.
- Backend 2: scenarios, cases and coverage in `service.py`; calendar conditions in `domain.py`.
- Backend 3: `parser.py`, run orchestration/evidence in `service.py`, exports in `server.py`.
- UI: `auditflow/static/`; HTTP API: `server.py`; persistence: `store.py`.

See **`HANDOFF.md`** for exact progress, reproducible commands and next steps for another developer or AI. No credentials belong in that file.

## Fixture privacy
The committed sample is constructed from scratch with synthetic name/contact fields. No original identifying header/contact bytes are uploaded. It preserves the narrow layout, synthetic scenario dates and explicitly supplied example references. The untouched original was inspected only locally.

## Boundary and AI test drafts

After reviewing C1/C2/C4, **Grenzfälle ableiten** creates 29/30/31-day drafts and an unresolved
open-AU case. **KI-Testentwürfe** uses the configured real model, validates its structured
output and keeps every expectation pending. It cannot replace an independent reference.

The pitch script is in `docs/PITCH.md`; API contracts and design rationale are in `docs/`.
