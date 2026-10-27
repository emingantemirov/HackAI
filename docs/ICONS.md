# Icons

`auditflow/static/icons.js` defines inline SVG outline icons on a 24×24 grid. The path data was written for AuditFlow and does not come from an icon library. Colour comes only from `currentColor`. The file has no dependencies and needs no build step.

## API

- `icon(name, opts)` returns an `<svg>` string, or `''` if the name is unknown.
  - `opts.size`: width and height in px. Default 18.
  - `opts.stroke`: stroke width. Default 1.5. Use 2 for the active nav item.
  - `opts.title`: optional accessible name. With a title, the SVG gets `role="img"`; without one, it gets `aria-hidden="true"`.
  - `opts.className`: optional class on the `<svg>`.
- `statusIcon(status, opts)` maps the run status values `pass`, `fail`, `not_assessable` and `technical_error` to the matching `status-*` icon.

## Names and intended use

| Icon name | Used for | Current glyph |
|---|---|---|
| `dashboard` | nav `dashboard` (Übersicht) | ◫ |
| `sources` | nav `sources` (Quellen & KI, including version comparison) | ▤ |
| `requirements` | nav `requirements` (Anforderungen) | ≡ |
| `cases` | nav `cases` (Profile & Testfälle) | ⊞ |
| `reports` | nav `reports` (Prüfberichte) | ▥ |
| `coverage` | nav `coverage` (Testabdeckung) | ▦ |
| `help` | nav `help` (Hilfe & Ablauf) | ⓘ |
| `refresh` | `#refresh` button in the top bar | ↻ |
| `close` | `#close-dialog` and `#assistant-close` | × |
| `assistant` | `#assistant-toggle` (Befund-Assistent) | (text only) |
| `status-pass` | `.big-status .symbol` when the status is `pass` | ✓ |
| `status-fail` | `.big-status .symbol` when the status is `fail` | ! |
| `status-not-assessable` | `.big-status .symbol` when the status is `not_assessable` | ◷ |
| `status-technical-error` | `.big-status .symbol` when the status is `technical_error` | ◷ (falls through today) |

The nav ids match the icon names, so `icon(id)` works directly.

## Wiring steps

1. `auditflow/server.py` serves static files only from a fixed whitelist: the `files` dict in `do_GET`. Add this entry, otherwise `/icons.js` returns 404:
   `'/icons.js':('icons.js','text/javascript; charset=utf-8')`
   The CSP `script-src 'self'` already allows the file. Inline SVG inserted through `innerHTML` is not blocked.
2. In `index.html`, add `<script src="/icons.js" defer></script>` before `<script src="/app.js" defer></script>`. Deferred scripts run in document order.
3. In the nav renderer in `app.js`, replace `<span class="glyph">${g}</span>` with
   `<span class="glyph">${icon(id,{stroke:id===page?2:1.5})}</span>`
   The glyph column in `pages` can then be dropped.
4. Status symbol in `reportDetail`: replace the `✓`/`!`/`◷` ternary with `${statusIcon(r.overall_status,{size:28})}`.
5. Buttons: set the button content to `icon('refresh',{size:16})` and `icon('close',{size:20})`. Keep the existing `title` and `aria-label`. For the assistant button, put `icon('assistant',{size:16})` before the text. `.btn` already uses `inline-flex` with a gap.
6. CSS suggestion:
   ```css
   .nav-item .glyph{width:18px;height:18px;display:grid;place-items:center}
   .nav-item .glyph svg{display:block}
   .big-status .symbol svg,.icon-button svg,.close svg{display:block}
   .icon-button{display:inline-grid;place-items:center}
   ```
   `.nav-item .glyph{font-size:18px}` is no longer needed. The existing `.nav-item .glyph` and `.nav-item.active .glyph` colour rules still apply through `currentColor`. The `@media(max-width:760px)` rule that hides `.glyph` still works.
7. Run `node --check auditflow/static/icons.js` and the existing unittest suite.


## 0.5 integration
The prepared icon set is now loaded before app.js and mapped to the six main navigation entries. The customer conveyor uses a matching inline document symbol for intermediate reports. Existing sidebar polish is preserved.
