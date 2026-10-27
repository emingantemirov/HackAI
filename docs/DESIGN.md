# ITSG-inspired frontend

The public ITSG site was inspected on 26 October 2026:
https://www.itsg.de/tag/in-eigener-sache/

Its HTML styling uses the red accent `#D50032`; the public child-theme stylesheet refers to
Fira Sans Condensed. AuditFlow adopts the red/white/charcoal language with local system-font
fallbacks, clear tables, restrained borders, red navigation accents and a light sidebar.
No remote font/CDN is required. Pass/fail/unknown statuses retain distinct semantic colors.

The AuditFlow mark is authored SVG. The header's ITSG text is a challenge reference, not an
imported official logo asset. The UI remains explicitly labelled a hackathon prototype.
This is a visual adaptation, not a claim of exact compliance with an unpublished design guide.

Desktop and mobile views are checked through the reproducible browser smoke scripts.

## 0.3 adapted workspace

The supplied Base44 app informed the four workflow cards, evidence assistant panel,
structured test-type selection, PDF range controls, glossary and help patterns. These are
implemented in the existing native frontend (workspace.js), using existing API/status
semantics and ITSG-inspired red tokens. No React bundle, Base44 cloud auth, external
font request, static source excerpt or original sample was imported. The assistant panel
is read-only and labels local evidence explanations separately from real model output.

## 0.3.2 minimal dashboard / Figma

Figma concept: https://www.figma.com/design/bmj0psVtlm26tSuizevY52?node-id=2-395
Session: a0fde1ba-626d-4ced-baa6-b81f68bd93c8. Native editable text, auto-layout,
library Stats Card/Button/Icon Button instances and vector graphics; no rasterized screen.
Three essential KPIs, a per-package result ring, next action and compact package list.
The design uses Inter (available in Figma); web CSS prefers locally available Inter, then
Segoe UI/Arial, with no external font download. The ITSG-inspired red is retained.
Figma data are illustrative, explicitly labelled. Result proportions were visually checked
and corrected using native arcs. Runtime dashboard values are not taken from the concept.

The application removes duplicate hero, phase cards, history totals and repeated tables from
its overview. New package setup, source-change follow-up and complete lists remain accessible
with progressive disclosure. A white-ringed red chat/spark SVG replaces the labelled assistant
trigger; title/aria-label preserve discoverability and keyboard accessibility. Softer panel
radii, more whitespace and simplified headings apply throughout the application.

## 0.5 ERP-style conveyor

Vorgänge is now the default: compact customer worklist, object header, six-stage process
rail, small clickable intermediate-document icons and a single active work area. Nine
business steps are grouped without hiding human gates. Contact/email/software belong to
the workflow input. Human-readable reports and structured forms replace ordinary JSON dumps.
Versioned source library remains a separate reference view. Customer-bound cases and results
also appear in their matching catalog views; legacy demo tools stay available at #packages.
The existing ITSG-inspired red/white/charcoal styling and remote collapsible sidebar/icon
work are preserved. No SAP assets or integration are implied. CSS adapts the rail to three
columns and the worklist to a compact row on narrow screens. Form labels are programmatically
linked to controls. Recommendations highlight exact quotations, with Unicode codepoint offsets.
