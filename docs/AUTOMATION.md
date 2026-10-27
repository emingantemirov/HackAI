# Automation 0.2 — contracts and limits

## Workflow

A software-review project identifies manufacturer, software and version. One package review
covers explicit parameters, template version and analytical expectation version. The worker
generates a suite of at most 4,000 synthetic profiles/cases and either runs a mock target or
waits for imported output. Matching and reporting resume automatically after import.

The supported structured types are `certificates` (C1), `calendar_gap` (C2) and
`minimum_days` (C4). C3 remains in the existing raw-file demo. Arbitrary new legislation is
not compiled into executable code. Public sources may be imported/drafted on the source
screen, but making a new rule executable still requires supported mapping and review.

All package scope is `synthetic_demo`. The 30→32 change is fictional. No state-issued rule,
legal approval, authentic payroll vendor or benefit calculation is claimed.

## Automatic change events

A project can opt into `auto_on_rule_change`. Approving a descendant rule package creates a
persistent change event. After existing work completes, ready suites using that package
lineage are selected. The dispatcher follows explicit dependencies, targets relevant test
families, detects changed expected outcomes and includes a fixed core regression sample.
It queues a new job without requiring a click for every case. Imported-output jobs wait for
new target output; simulation jobs run directly. Previously completed versions/results stay
unchanged. Older delayed events do not roll back a newer reviewed baseline.

Manual impact preview is available for projects without that policy. Full recurring reruns
reuse the existing profiles and preserve import vs simulation mode. No unattended calendar-year scheduler is configured.

## Persistence and restart

SQLite stores projects, immutable reviewed package versions, suites, cases, imports,
results, jobs and change events as new entity kinds alongside 0.1 data. Batches of 100 cases
or results are committed atomically with progress. After a restart, running jobs become
queued and resume from their last committed cursor; IDs remain stable, avoiding duplicates.
A single local worker processes queued jobs. This is not a distributed production queue.

## Evidence and counts

- Generated profile IDs are unique per suite/case and marked synthetic.
- Income, hours and employment type are profile metadata, not comprehensive legal scenarios.
- Analytic expectations use controlled generator facts and explicit parameters.
- The target simulator uses a separate implementation. Both still implement authored demo
  assumptions rather than an external authoritative reference.
- Exact unresolved boundaries and open-AU facts remain not assessable.
- Imported outputs require matching case IDs and boolean/null `message_present` values.
- Missing imports, unknown expectations and unknown actual values never become passes.
- Completed means processing finished; it does not mean every test passed or software approved.
- Every job freezes its package, project, hashes, count, selection reasons and version.
- Bulk reports are JSON/CSV; existing single-case reports also support PDF.

## New API

| Method | Path | Body / output |
|---|---|---|
| GET | `/api/automation/state` | Summary only; no 4,000-profile payload in the main UI state. |
| POST | `/api/automation/project` | manufacturer, software, software_version, auto_on_rule_change? |
| POST | `/api/automation/package` | parent_id, name, rules; creates pending version. |
| POST | `/api/automation/approve` | package_id, reviewer, note, acknowledge_demo:true |
| POST | `/api/automation/start` | project_id, package_id, count:1..4000, mode, behavior |
| GET | `/api/automation/cases/<suite>` | offset/limit; paginated profiles and cases. |
| GET | `/api/automation/jobs/<id>` | Frozen job configuration and current progress. |
| GET | `/api/automation/jobs/<id>/results` | offset/limit; paginated results. |
| GET | `/api/automation/jobs/<id>/input` | Complete ready input package for a software operator. |
| GET | `/api/automation/jobs/<id>/report` | Complete JSON evidence report. |
| GET | `/api/automation/jobs/<id>/csv` | CSV result overview. |
| POST | `/api/automation/import` | job_id, records:[{case_id, observed:{message_present}}] |
| POST | `/api/automation/impact` | suite_id, package_id, baseline_job_id? |
| POST | `/api/automation/rerun` | suite_id, package_id, mode?, behavior?; affected subset. |
| POST | `/api/automation/full-rerun` | suite_id, package_id, mode?, behavior?; full rerun, preserving prior execution mode by default. |
| POST | `/api/automation/cancel` | job_id |
| POST | `/api/automation/resume` | job_id |

The mock target behaviors are healthy, always_send, ignore_certificate and outdated_threshold.
Only a configured actual model call is labelled AI inference. The 4,000-case pipeline itself
is deterministic/template-based and does not depend on successful model access.
