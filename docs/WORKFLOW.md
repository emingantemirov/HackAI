# Customer audit conveyor — 0.5

The default workspace is **Vorgänge**: a customer worklist, an object header, six main
stations and exactly one active work area. It is an ERP-inspired local workflow, not a
SAP integration. Existing customer-independent synthetic bulk tools are under
**Demopakete & Werkzeuge** (`/#packages`). Existing records remain available.

## User's nine steps and implemented behavior

| Requested step | Implemented behavior |
| --- | --- |
| 1. Input and source matching | Create customer/contact/email/software/version; choose multiple files, inspect filename/size and text preview or open the selected file; upload originals; reuse identical content or save/compare a separate version. Attach existing sources if needed. Start freezes the input list. |
| 2. Intermediate report | Automatic source/version/comparison snapshot. Read via document icon or download HTML/PDF. |
| 3. Requirements and recommendation | Resumable document jobs extract drafts and source-bounded AI recommendations. Exact validated quotations are highlighted for revision. Human approval is separate. New revisions remain pending and are automatically queued for a fresh precheck. |
| 4. Intermediate report | After all current linked requirements have completed prechecks and verified, human-approved interpretations, save an immutable approval snapshot. |
| 5. Test cases | Automatically draft 2–4 cases per approved requirement with synthetic profiles, inputs, steps and source-linked expected observations. Do not execute generated code or invent a payroll adapter. |
| 6. Intermediate report | Automatically snapshot the generated test specifications. Open questions/unknown expectations must be resolved, then inputs and expected values independently reviewed before package release. |
| 7. Customer delivery | Optional automatic SMTP TLS delivery after release to the stored customer email; JSON input package and readable HTML instructions, excluding internal expected values. PDF instructions are downloadable. Without SMTP use download and explicitly record actual manual handoff. |
| 8. Test results | Manufacturer runs software externally and returns the exact workflow/package identifiers and case observations. Import validates the entire file before writes, compares typed scalar values and preserves missing results as not assessable. |
| 9. Final report | Automatic final report with source versions, human approvals, package release, handoff, expected/actual results and counts. Human acceptance or rework plus repeated name and rationale closes the record. Positive acceptance is blocked for any deviation or missing result. |

Intermediate files are small accessible document-icon buttons at the completed stations.
A collapsible **Vorgangsakte** retains every report, including superseded snapshots.
Reports show the actual processing mode, never a fabricated live AI result.

## Human and model boundaries

A quote match establishes provenance, not legal correctness. A recommendation is not an
approval. Both requirement interpretation and test expected values need human review.
AI uses the supplied version/context and records model/prompt provenance. Structured test
specifications can describe arbitrary supplied requirements, but this does not compile new
legal prose into executable rules or establish an independent legal/payroll oracle.

Without a model key, automatic local mode creates literal requirement candidates and two
explicitly incomplete test skeletons per requirement. Their expectations are unknown. The
operator must concretize them before release. Explicit live mode stops on failed/invalid
model responses and resumes via retry without duplicating committed progress.

Changed/revised requirements, source references or human approvals invalidate an active
package and return the workflow to requirement review. Prior reports remain historical.
Closed workflows retain their frozen basis. Start a new workflow for a later rule year;
there is no silent 2026/2027 fixture mixing. Source detection is assistive: locally based on
title/version, optionally model-assisted with validated known family IDs. Original content
is preserved, and ambiguous identity should be corrected with explicit family selection.
Older uploaded numeric versions/validity dates do not displace newer source-library stands.
Partial PDF views are distinct import scopes, not complete replacements.

## Manufacturer response contract

Exported input package schema: `auditflow-customer-tests-v1`. Keep its identifiers unchanged.
Return JSON with `workflow_id`, `package_hash` and `records`, each containing `case_id` and
`value`. `value` is a JSON boolean, finite number, string or null. Use the field named by
`observe_field`. Internal expectations and their rationale are withheld from the input
package. Missing/null results remain not assessable. Booleans are distinct from numbers;
JSON numeric integers/floats compare numerically. There are no assumed tolerance, rounding,
monetary-calculation or vendor-specific parser rules. Duplicate/unknown case IDs, wrong
package identifiers, unsupported values and oversized lists are rejected atomically.
Imported files are not independently authenticated as belonging to a vendor.

## Email configuration

The process environment must contain `AUDITFLOW_SMTP_HOST` and `AUDITFLOW_MAIL_FROM`.
Optional: `AUDITFLOW_SMTP_PORT` (587), `AUDITFLOW_SMTP_TLS` (`starttls` or `ssl`),
`AUDITFLOW_SMTP_USER`, `AUDITFLOW_SMTP_PASSWORD`. TLS uses normal certificate verification.
Do not enter secrets into source files, chat, browser forms or GitHub. `.env.example` only
lists names: `.env` is not loaded automatically. Auto-send is an explicit per-workflow opt-in
and only occurs after both human gates. SMTP acceptance is not delivery/read confirmation.

A persisted `sending` state becomes `unknown` on restart. Ambiguous errors are not retried
automatically, preventing duplicate delivery after an uncertain SMTP acknowledgement.
Check the actual outbox before manually documenting handoff. No recipient was contacted in
development; SMTP tests are mocked. A working real model/SMTP service is not verified here.

## Persistence and scope

SQLite adds `document_files` for original bytes and generic item kinds `document_job`,
`requirement_review`, `workflow`, `workflow_report`. Existing tables/entities are retained.
Document workers commit after each section; workflow generation commits after each approved
requirement. Repeated ticks do not duplicate completed cases or phase reports. No network
inference/SMTP call holds the global database lock. Reports are append-only application
snapshots, not externally tamper-proof archival records. Typed name confirmation is not a
qualified electronic signature. This remains a local single-user hackathon prototype.

The existing authored C1/C2/C4 engine still supports up to 4,000 deterministic demo cases
and selected regression. The new free-text workflow and that bounded executable demo engine
have distinct contracts and datasets. No complete payroll certification, SAP connection,
actual customer API execution, independent benefit oracle or production authorization is claimed.
