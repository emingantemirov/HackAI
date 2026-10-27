const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ctx={console,uxItems:(v,x)=>x,uxToolbar:()=>'',uxEntry:()=>'',document:{addEventListener(){}},setInterval(){},fieldNames:{},labels:{},sessionStorage:{getItem(){return ''}},e,
 btn:(t,a,attrs='')=>`<button data-action="${a}" ${attrs}>${t}</button>`,icon:()=>'<svg></svg>',fmt:()=> 'Synthetic date',badge:x=>`<span>${e(x)}</span>`,reviewCard:()=>'<p>Untersuchung erforderlich</p>',markText:t=>e(t),
 readable:x=>e(JSON.stringify(x)),state:{workflow:{items:[],reports:[],mail_configured:false},documents:[],requirements:[],document_jobs:[]}};
vm.createContext(ctx);vm.runInContext(fs.readFileSync('auditflow/static/workflow.js','utf8'),ctx);
assert.equal(ctx.flowBoolean('Ja'),true);assert.equal(ctx.flowBoolean('Nein'),false);assert.throws(()=>ctx.flowBoolean('unbekannt'));
const w={id:'w',name:'<script>synthetic</script>',phase:'intake',mode:'offline',customer:{company:'Demo',contact:'Test',email:'test@example.invalid',software:'Demo',software_version:'1'},document_ids:[],reports:[],cases:[],case_cursor:0,requirement_snapshot:[{}],delivery:{status:'ready'},final_review:{decision:'accepted',reviewer:'Synthetic expert',at:'2026-10-27',note:'Test'},result:{counts:{pass:1,fail:0,not_assessable:0},rows:[{title:'Synthetic',expected:true,actual:true,status:'pass'}]}};
ctx.state.workflow.items=[w];
for(const phase of ['intake','sources','requirements','generation','case_review','delivery','results','final_review','closed']){
 w.phase=phase;const html=ctx.workflowDashboard();assert.ok(html.includes('flow-rail'));assert.ok(!html.includes('<script>synthetic'));assert.ok(html.includes('&lt;script&gt;synthetic'));assert.ok(!html.includes('<pre>'));
 if(phase==='intake')assert.ok(html.includes('flow-files'));
 if(phase==='requirements')assert.ok(html.includes('Keine Anforderung erkannt'));
 if(phase==='case_review')assert.ok(html.includes('flow-release-form'));
 if(phase==='results')assert.ok(html.includes('flow-results-form'));
 if(phase==='final_review')assert.ok(html.includes('flow-close-form'));
 if(phase==='closed')assert.ok(html.includes('Fachlich abgesegnet'));
}
ctx.state.workflow.reports=[{id:'r',workflow_id:'w',kind:'sources',title:'Zwischenbericht · Quellenabgleich'}];
assert.ok(ctx.flowReportButton(w,'sources').includes('aria-label="Zwischenbericht'));
const libContext={document:{addEventListener(){}},setInterval(){},labels:{},e};vm.createContext(libContext);vm.runInContext(fs.readFileSync('auditflow/static/library.js','utf8'),libContext);
assert.ok(libContext.markText('📄 Prüfe die Frist',{issues:[{target:'criterion',quote:'Frist',start:12,end:17,reason:'Test'}]},'criterion').includes('>Frist</mark>'));
assert.ok(!libContext.markText('Unchanged',{issues:[{target:'criterion',quote:'invented',start:0,end:7}]},'criterion').includes('<mark'));
console.log('Frontend contracts: all 9 conveyor phases, escaped input, report icons and Unicode marks passed.');

// Empty/filtered workflow lists must guide real customer work, never present demo tools as the primary action.
ctx.heading=(tag,title,desc,action='')=>`<h1>${title}</h1><p>${desc}</p>${action}`;
ctx.cases=()=>'<p>LEGACY DEMO TOOLS</p>';
let empty=ctx.workflowCasesPage();
assert.ok(empty.includes('data-action="flow-new"'));assert.ok(empty.includes('data-action="flow-select"'));assert.ok(empty.includes('class="panel"><summary>Unabhängige synthetische Demofälle'));
assert.ok(empty.indexOf('flow-select')<empty.indexOf('LEGACY DEMO TOOLS'));
ctx.state.workflow.items=[];empty=ctx.workflowCasesPage();assert.ok(empty.includes('Noch keine Vorgänge vorhanden.'));assert.ok(empty.includes('Herstellerergebnisse'));
