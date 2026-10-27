# Customers integration (0.7)

Concepts adapted from `feat/dokumente-versionen-8094`: manufacturer/software registry,
version statuses and decision history, submissions and rule-date reminders. The navigation
label is **Kunden**, English **Customers**. This is a selective integration into the current
conveyor branch, not a wholesale merge of the divergent branch.

## Data and linkage

SQLite item kinds: `manufacturer`, `software_version`, `submission`, `customer_reminder`.
Manufacturers store name, contact and email; versions reference the manufacturer. Duplicates
use whitespace-normalized case-insensitive customer/software/version names. Archived matching
records must be restored rather than silently recreated. No demo manufacturers or approvals
are seeded. Creating another version for an existing customer does not overwrite its contact.

New workflows accept `software_version_id`. Company/software/version are resolved server-side,
even when a client submits conflicting labels. Contact/email can be changed for that workflow;
the stored customer object is a frozen snapshot. Without an ID, validated free-entry data
registers/reuses master data. Startup migration adds IDs to retained legacy workflows and
demo auto_projects without rewriting their snapshots or approvals. Runtime databases from
another checkout are not transferred by this code change.

## Human version decisions

Stored states: neu → in_pruefung → freigegeben or abgelehnt; rejected versions can be reopened.
An approved version can display `erneut_pruefen` with its stored decision retained. A new
review can then be started. Decisions require a self-declared reviewer name and reason;
there are no authenticated users/roles or enforced independent identities.

The newest started non-hidden/non-trashed conveyor workflow by creation time is authoritative.
Intake-only folders are not evidence. Gate requirements:

- Imported manufacturer results exist.
- Results exactly cover the current case IDs, all pass, and counts agree.
- The workflow has positive human final sign-off and is closed.
- The current requirement basis equals the frozen basis hash.
- All retained submissions are approved and visible (hidden submissions block).

Approval freezes workflow ID, package/result/basis hashes and the final human review. Changed,
hidden or deleted evidence, a new started process, or an effective confirmed reminder causes
an existing stored approval to display `erneut_pruefen`. No worker tick is needed to detect
changed requirements. Missing observations, unclear results and failures have no waiver API.
Older bounded demo jobs remain accessible under packages; they are not accepted as conveyor
final-sign-off evidence. This does not establish legal conformity or official certification.

## Submissions and reminders

Submissions store original PDF/DOCX/TXT bytes (base64 in SQLite), SHA-256, size (max 5 MB),
uploader, status and all decisions. Metadata/state/selection exports omit the file payload.
Download returns the original bytes; UTF-8 filenames use a safe Content-Disposition header.
Files are not parsed or automatically substantively approved. Malicious/control/path filenames,
invalid base64 and unsupported extensions are rejected. No malware scanning is claimed.

Reminders require a real calendar date, source note, reviewer and explicit affected version
IDs. There are no invented deadlines or automatic legal classifications. Effective confirmed
reminders mark earlier approvals for review; they never automatically revoke a certification.
Dates are evaluated using the server calendar date, at day granularity. A same-day approval
is treated as renewed for that effective date. Hiding a reminder does not waive its obligation.

## Lifecycle

Customer hide/trash cascades downstream to versions, submissions, associated workflows and
reports/outbox, and linked legacy projects/jobs. A source action never deletes customer master
data. Shared law/source files and their requirements are retained when a customer is removed.
Versions can be selected in bulk. Whole-customer trash is a separate explicit UI action, so
select-all in a filtered version list cannot accidentally select hidden sibling versions.

Trash groups can be restored. Restoring a child while its parent is archived is blocked.
Permanent deletion requires the existing trash-only DELETE confirmation. Shared reminders
are retained while they still refer to another version; a reminder whose complete target set
is deleted is included in the group. Historical opaque version IDs in shared reminders are
retained as historical references and do not recreate deleted customers. Existing local event
redaction and shared-source preservation semantics continue to apply.

## API

- GET `/api/customers` and `/api/state.customers`: registry/view metadata.
- POST `/api/customers/create`: company or manufacturer_id, software, software_version,
  optional contact/email, reviewer. Duplicate versions are rejected.
- POST `/api/customers/update`: manufacturer id, company, contact/email, reviewer, note.
- POST `/api/customers/transition`: version id, action start/approve/reject/reopen, reviewer, note.
- POST `/api/customers/submit`: version_id, name, base64, reviewer.
- POST `/api/customers/review-submission`: submission id, boolean approve, reviewer, note.
- GET `/api/customers/submissions/{id}`: original bytes, unavailable when archived/hidden.
- POST `/api/customers/reminder`: title, effective_date, source_note, version_ids, reviewer.
- Existing workspace selection/hide/trash/restore/purge/export/forward APIs accept these kinds.

Existing token authentication and same-origin write policy apply. No real emails or live
model calls are needed for this integration. The customer's email alone never enables auto-send.
