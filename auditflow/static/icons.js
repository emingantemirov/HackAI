// AuditFlow icon set: inline SVG outline icons on a 24x24 grid.
// Path data authored for AuditFlow (no third-party icon library).
// Colour comes only from currentColor; size and stroke width are set per call.
// Usage: icon('dashboard') or icon('dashboard',{size:18,stroke:2,title:'Übersicht'}). Unknown names return ''.
const AUDITFLOW_ICONS={
 customers:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
 // Navigation
 dashboard:'<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/>',
 sources:'<path d="M15 2.5H9a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8.5a2 2 0 0 0 2-2V7z"/><path d="M15 2.5V7h4.5"/><path d="M10.5 11h5.5M10.5 14.5h4"/><path d="M4 7v12.5a2 2 0 0 0 2 2h9"/>',
 requirements:'<path d="M10 6.5h10M10 12h10M10 17.5h10"/><path d="M3.5 6.5l1.25 1.25L7 5.5"/><path d="M3.5 12l1.25 1.25L7 11"/><path d="M3.5 17.5l1.25 1.25L7 16.5"/>',
 cases:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10.5" r="2"/><path d="M6 16a3 3 0 0 1 6 0"/><path d="M14.5 10h3.5M14.5 13.5h3.5"/>',
 reports:'<path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"/><rect x="9" y="2.5" width="6" height="3.5" rx="1"/><path d="M9 13.5l2 2 4-4"/>',
 coverage:'<path d="M19 13a8 8 0 1 1-8-8"/><path d="M11 5v8h8"/><path d="M14 2.5a7.5 7.5 0 0 1 7.5 7.5H14z"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
 // Controls
 refresh:'<path d="M20 12a8 8 0 1 1-2.34-5.66L20 8.68"/><path d="M20 4v4.68h-4.68"/>',
 close:'<path d="M6 6l12 12M18 6L6 18"/>',
 assistant:'<path d="M5 4.5h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-4.5 3.5v-3.5H5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z"/><path d="M12 7.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
 // Run status
 'status-pass':'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.75 2.75L16 9.5"/>',
 'status-fail':'<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
 'status-not-assessable':'<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
 'status-technical-error':'<path d="M10.3 4.2L2.9 17a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4"/><path d="M12 16.75h.01"/>'
};
// Maps the run status values used in reports (pass, fail, not_assessable, technical_error) to icon names.
const AUDITFLOW_STATUS_ICONS={pass:'status-pass',fail:'status-fail',not_assessable:'status-not-assessable',technical_error:'status-technical-error'};
function icon(name,opts){
 const body=Object.prototype.hasOwnProperty.call(AUDITFLOW_ICONS,name)?AUDITFLOW_ICONS[name]:'';
 if(!body)return '';
 const o=opts||{},size=Number(o.size)||18,stroke=Number(o.stroke)||1.5;
 const cls=o.className?` class="${String(o.className).replace(/[^\w -]/g,'')}"`:'';
 const title=o.title?`<title>${String(o.title).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))}</title>`:'';
 const a11y=title?'role="img"':'aria-hidden="true"';
 return `<svg${cls} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" ${a11y} focusable="false">${title}${body}</svg>`;
}
function statusIcon(status,opts){return icon(AUDITFLOW_STATUS_ICONS[status]||'',opts);}

