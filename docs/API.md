# Local HTTP API

Same-origin JSON API. API errors have `{ "error": "..." }` and a non-2xx status.
If `AUDITFLOW_ACCESS_TOKEN` is configured, send `Authorization: Bearer <local access token>`.
This is separate from the model API key, which never reaches the browser.

| Method | Path | Purpose / request |
|---|---|---|
| GET | `/api/health` | Runtime health and version. |
| GET | `/api/state` | Sources, rules, cases, reports, coverage, model configuration state. |
| GET | `/api/events` | Local traceability events. Not externally tamper-proof. |
| POST | `/api/import` | `{name, version, valid_from?, base64}`; TXT/MD/PDF/DOCX, ≤5 MB. |
| POST | `/api/draft` | `{document_id, section_id, mode: "offline" or "live"}`; pending candidates. |
| POST | `/api/verify` | `{id}`; exact linked-source quotation check. |
| POST | `/api/review` | `{kind: "requirement" or "case", id, reviewer, note, approve: true/false}`. |
| POST | `/api/cases` | `{name, scenario, expected_message: true/false/null, expectation_source}`. |
| POST | `/api/generate` | `{case_id, mode: "boundary" or "live"}`; C1/C2/C4 approval required; outputs pending. |
| POST | `/api/run` | `{case_id, mode: "scenario" or "message", software_mode?: "healthy" or "buggy", mutation?, base64?}`. |
| POST | `/api/diff` | `{old_id, new_id}`; structurally matched sections and direct dependents. |
| POST | `/api/model/test` | `{}`; real connection request, no fabricated fallback success. |
| GET | `/api/runs/<id>` | Frozen JSON report download. |
| GET | `/api/runs/<id>/pdf` | PDF report download; optional reportlab required. |

## Status semantics

- Requirement quotation state and substantive review state are separate.
- Scenario rules describe **eligibility**, not a verdict on a real software product.
- A correctly suppressed simulated message can match its expectation even when eligibility is false.
- Message-mode rules judge whether the imported enquiry meets the limited fixture checks.
- Overall pass requires required approvals and a complete applicable comparison.
- Unsupported/unresolved context yields `not_assessable`; malformed input/execution yields `technical_error`.
- Existing reports contain frozen case and rule snapshots. Coverage marks results stale after changed reviews.

## Example

```json
{
  "case_id": "CASE-001",
  "mode": "message",
  "mutation": "wrong_azvu"
}
```

The response includes `overall_status`, `rule_status`, `comparison_status`, per-rule results,
raw/scenario evidence, checker/parser versions, input hash and limitations. No actual payroll
software is called by this endpoint.

## Narrow implementation boundaries

Only `fixture-2026` has executable rules. Newly extracted requirements remain unmapped even
if approved; arbitrary legal text is not compiled into executable code. Supporting a new
ruleset requires a reviewed implementation and independent fixtures. There is no public
multi-user permission model, hosted deployment or real insurer connector.

## Automation 0.2

The persistent bulk workflow, supported package schemas, imports, automatic change events
and new endpoints are documented in `AUTOMATION.md`. Single-case APIs remain compatible.

## Adapted workspace 0.3

- `POST /api/import`: additive `pages_from` / `pages_to` positive integer fields for PDF
  only. Both must be present if either is supplied; inclusive range <=100 pages. A range
  past the PDF is rejected. Original section IDs/page numbers and whole-file hash remain.
- `POST /api/generate`: existing `boundary` / `live` modes remain; `template` adds offline
  typed drafts. `test_type` is `positive`, `negative`, `boundary`, or `missing_data`.
  Generated cases retain requirement IDs/snapshots, model_id, prompt_version and mode.
- `POST /api/assistant/explain`: `{question, mode: "offline"|"live", ref}`. For a single
  report use `ref:{kind:"run",id, finding_id?}`; for a bulk result use
  `ref:{kind:"automation",job_id,case_id}`. Server-resolved evidence only. Output contains
  answer, explicit mode/model/prompt version, evidence, next_steps and scope note.
  Unknown references, missing question/evidence or unsupported modes are errors. Existing
  access token and same-origin requirements apply. Live inference failures return 502.
  The endpoint has no approval/update capability and does not hold the store lock over
  network inference. No persistent chat history is created.

## 0.5 customer conveyor and 0.4 document library

All `/api/*` routes retain existing token/origin protections. Calls use JSON objects and
existing error distinctions (422 invalid input, 502 model failure). No secret is accepted
from client-side workflow forms. See WORKFLOW.md for the manufacturer result contract.

Document routes: POST `/api/documents/upload` (smart version recognition, stored original,
background analysis), `/api/documents/analyze` (document_id, mode auto/live/offline),
`/api/requirements/precheck` (id, mode live/offline), `/api/requirements/revise`
(id, criterion; new pending revision and queued precheck). GET `/api/documents/{id}/original`
and `/pdf`. State includes `document_jobs`, source families/history and current AI reviews.
Recommendations contain recommendation/reason/issues with exact quote, target and validated
Unicode-codepoint start/end positions. Invalid/unanchored revision output is rejected.

State also includes `workflow: {items,reports,mail_configured}`. Report summaries omit their
full contents; fetch a selected report to read it. Customer-bound cases are inside each
workflow, separate from old fixture `cases` and `automation` entities.

POST `/api/workflow/{action}`:

- `create`: name, company, contact, email, software, software_version, mode (auto/live/offline), auto_send boolean.
- `attach` / `detach`: id (workflow), document_id; only before start.
- `begin`: id; queues document analysis and starts durable phase progression.
- `retry`: id; retry failed source/generation preparation, retaining committed progress.
- `edit-case`: id, case_id, expected (typed scalar), rationale, optional structured inputs/profile. Only before package release.
- `release`: id, reviewer, note, acknowledged=true. Requires all expectations known and questions resolved.
- `deliver`: id; attempt configured SMTP delivery. Unknown delivery is never blindly retried.
- `manual-delivery`: id, reviewer, note; records an actual manual handoff.
- `import`: id, data={workflow_id,package_hash,records:[{case_id,value}]}.
- `close`: id, reviewer, signature (same repeated name), note, decision=accepted/rework, acknowledged=true.

GET `/api/workflow/{id}/package` downloads approved customer JSON without expected values;
`/{id}/customer-pdf` returns readable input-only instructions. GET
`/api/workflow/reports/{report_id}` returns a selected immutable report; append `/html` or
`/pdf` to download it. Report HTML escapes user/source text; PDF requires existing reportlab.
New JS assets `/library.js`, `/workflow.js`, `/icons.js` are same-origin and buildless.

## Workspace controls (0.6)

GET `/api/workspace/state`: settings (no secrets), unread IDs, trash groups, time sessions,
messages and read-message IDs. Included in ordinary `/api/state` as `workspace`.
GET `/api/workspace/chat`: up to 50 non-trashed stored chat turns.

POST `/api/workspace/{action}`:

- `settings`: language=de/en, theme=light/dark/system, compact boolean; optional
  smtp={host,port,tls=starttls/ssl,sender,user}. Secrets are rejected; password is environment-only.
- `smtp-test`: TLS/auth connectivity check only, no message.
- `seen`: entries=[{kind,id}] persists read marks.
- `trash`: entries; documents cover their full family and explicit downstream dependency closure.
- `hide`: entries, hidden boolean; propagates independent hidden-source tags.
- `restore`: entries=[{kind:'trash_batch',id}] or supported standalone trash records.
- `purge`: entries and confirmation='DELETE'; only trash can be permanently removed.
- `export`: entries, format=json/html/pdf; returns an authenticated file download.
- `forward`: entries, email, subject, note; queues actual selected snapshot delivery.
- `timer`: action=start/heartbeat/stop; start accepts ISO work_date.
- `messages-read`: ids of current mailbox items.
- `chat`: question, mode=offline/live, language=de/en, optional stored finding ref.

Selection kinds: document, requirement, case, workflow, run, auto_job, workflow_case.
Nested workflow cases use `workflow_id|case_id` as selection ID. Draft-case removal requires
at least one case per requirement; approved packages cannot be edited by this route.
Source cascade trash pauses processing and retains original phases for restore. Permanent
purge redacts linked event payloads and rebuilds the explicitly local hash chain.
POST `/api/workflow/count`: id, count integer 1–4,000 before generation.
Workflow create additionally accepts requested_cases. Missing total retains legacy 2/requirement.
# Customers (0.7)

See [customer API and evidence/lifecycle contracts](CUSTOMERS.md). `/api/state` now includes
`customers`. Workflow creation accepts an optional `software_version_id` and resolves the
stored company/software/version on the server; old free-entry clients remain supported.
