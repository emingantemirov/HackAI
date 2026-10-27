# Workspace controls — 0.6

Every main list has explicit Filter and Sort icons. Requirements and cases support human
status and new/read filters; documents, cases, requirements, workflows and report lists
support visibility. Sorting supports newest/oldest, title, unread and visible-first where
relevant. The underlying source text, statuses and approval logic are never changed by a
filter or sort. Source families retain their versioned originals.

## Selection, export and corrections

Edit enables checkboxes; Done returns to reading. Selection supports one or multiple records
and Select all visible. Filter changes clear selection. Contextual trash/export icons appear
only in selection mode. JSON, readable HTML and optional PDF export resolve the actual
selected server-side IDs and preserve provenance/status. Forwarding uses an explicit recipient
and selected content snapshot; queued/sent/unknown/unconfigured states appear in the mailbox.
A missing SMTP connection never becomes a fabricated sent message. No forwarding occurred
in development. HTML/model text is escaped on display.

Approved requirements show **Korrigieren / Correct**. This creates a new pending revision and
fresh precheck; it never overwrites a historical approval. Newly created requirement/case IDs
have red unread dots until clicked/opened; checkbox selection does not count as reading.
Read marks are persisted. Existing records are migrated as read on the first upgrade.

## Document lifecycle and trash

A document card operates on its full family, including versions and imported page views.
Hide/show propagates along explicit source/requirement/case/workflow/report references.
Hidden records remain visibly dimmed and struck through; they can be filtered/sorted and
shown again. Multiple independent hidden-source causes are retained, so showing one source
does not accidentally unhide records still hidden by another. Hidden processing is paused.

Moving a source to trash archives its family and explicitly linked requirements, cases,
workflows, intermediate/final reports, jobs/results, source prechecks and dependent chat/mail
records. A single trash batch records this recoverable group. It disappears from ordinary
lists. Restore the batch from Settings → Trash to recover its data/statuses together. Existing
approvals remain historical facts, not new approvals. An outstanding model failure may still
require Retry after restoration. A sending email must finish before its records can be trashed.

**Permanent delete** is available only inside Settings → Trash and requires typing `DELETE`.
It removes selected trash data and their archived dependants, including dependants placed
in trash by an earlier operation. Original BLOBs are removed only when no other retained
source references their hash. Restoration is then unavailable. Sent mail at the recipient
cannot be recalled. Linked local event payloads are redacted and the local hash chain is
rebuilt with an explicit erasure event; this is a local trace, not externally sealed audit
storage. Other independent records and shared original bytes are retained. No actual user
source was permanently deleted in development; tests use temporary synthetic databases.

## Settings, mailbox and working time

The bottom-left gear opens:

- German/English UI, preserving source documents, requirement text and user records.
- Light, dark or system theme and compact list spacing.
- SMTP host/port/TLS/from/username. Password stays in `AUDITFLOW_SMTP_PASSWORD` on the server;
  no secret is accepted or returned by the browser settings API. TLS certificate verification
  remains enabled. Test saved connection checks TLS/auth only; it sends no message.
- Model connectivity test; the model credential remains in the process environment.
- Manual time tracking and CSV export. Visible-page heartbeats accrue at most 90 seconds per
  gap; server restart stops an open session at its last heartbeat. This is local session
  tracking, not a payroll/time-attendance compliance system.
- Recoverable trash and explicit permanent erasure.

The top-left envelope opens system start/update notifications and the outbox. Read state is
persistent. Workflow deliveries are durably recorded per package; preparing a later package
does not erase old delivery history. SMTP acceptance is distinct from recipient delivery.
IMAP/incoming customer email and real multi-user accounts are not connected.

## System assistant and case quantity

The corner assistant is now a conversation over the whole system, with saved history.
No selected finding is required. Local mode reports actual stored counts, links matching
records and provides authored workflow/settings help; it is explicitly labelled without AI.
Live mode supplies bounded source matches, system facts, help, recent conversation and optional
server-resolved finding evidence to the configured model. It cannot execute actions, change
records, approve requirements or send mail. Model failures are shown; no fake fallback.
Original source/user content is protected from interface translation.

Choose **requested test case count (1–4,000)** while creating a workflow, in intake or at the
requirement gate. At least one case per approved requirement is required. Generation distributes
the requested total across requirements in durable batches of at most four, with unique IDs and
saved cursors. The exact requested total is produced; failed live batches stop explicitly.
Without a key these remain clearly incomplete local skeletons, not meaningful AI-validated
coverage. Inputs/expectations must be independently reviewed before release. Case count alone
does not establish coverage or legal correctness. The separate bounded synthetic bulk engine
remains unchanged in scope. Real model/SMTP operation remains unverified in this environment.
