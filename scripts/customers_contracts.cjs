// Render and interaction contracts without a browser or third-party dependencies.
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const v={id:'v',manufacturer_id:'m',manufacturer_name:'Synthetic <script>',software:'Demo',version:'1',title:'Synthetic <script> · Demo 1',status:'neu',gate:{items:[{label:'Check',ok:false}],workflow_id:null},recheck:[],workflows:[],history:[]};
const state={customers:{manufacturers:[{id:'m',name:'Synthetic <script>',contact:'Demo',email:'demo@example.invalid'}],versions:[v],submissions:[],reminders:[]},workspace:{settings:{language:'de'},unseen:{}},workflow:{items:[]}};
let modalHTML='',form=null;
const ctx={state,e:esc,icon:()=>'<svg/>',btn:(label,action,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`,heading:(eyebrow,title,desc,actions='')=>`<h1>${title}</h1><p>${desc}</p>${actions}`,badge:s=>`<span>${esc(s)}</span>`,fmt:()=>'',sessionStorage:{getItem:()=>''},location:{hash:'#customers'},URLSearchParams,
 document:{addEventListener:()=>{},getElementById:()=>form},setInterval:()=>{},modal:html=>{modalHTML=html},labels:{},fieldNames:{},flowNames:{},flowPhases:[]};
vm.createContext(ctx);
const controls=fs.readFileSync('auditflow/static/controls.js','utf8');vm.runInContext(controls.slice(0,controls.indexOf('function uxInit()')),ctx);
vm.runInContext(fs.readFileSync('auditflow/static/customers.js','utf8'),ctx);
let html=ctx.customersPage();assert.ok(html.includes('<h1>Kunden</h1>'));assert.ok(!html.includes('<script>'));assert.ok(html.includes('Synthetic &lt;script&gt;'));assert.ok(html.includes('data-ux-kind="software_version"'));
ctx.uxView('customers').editing=true;html=ctx.customersPage();assert.ok(html.includes('cust-trash-customer'));assert.ok(ctx.uxEntry('software_version','v').includes('type="checkbox"'));assert.ok(!ctx.uxEntry('manufacturer','m').includes('type="checkbox"'),'select-all filtered versions must not select their parent customer');
ctx.uxView('customers').status='freigegeben';assert.ok(!ctx.customersPage().includes('data-ux-id="v"'));ctx.uxView('customers').status='all';
ctx.uxView('customers').search='synthetic';assert.equal(ctx.uxItems('customers',[v]).length,1);
ctx.custNew();assert.ok(modalHTML.includes('cust-create-form'));assert.ok(!modalHTML.includes('<script>'));
ctx.custEdit('m');assert.ok(modalHTML.includes('Existing')||modalHTML.includes('Bestehende Vorgänge'));assert.ok(!modalHTML.includes('<script>'));
form={elements:Object.fromEntries(['company','contact','email','software','software_version','name'].map(k=>[k,{value:'',readOnly:false}]))};ctx.custPrefill('v');assert.equal(form.elements.company.value,'Synthetic <script>');assert.equal(form.elements.email.value,'demo@example.invalid');assert.equal(form.elements.software_version.readOnly,true);ctx.custPrefill('');assert.equal(form.elements.software_version.readOnly,false);
ctx.location.hash='#customers?version=v';html=ctx.customersPage();assert.ok(html.includes('Freigabe-Voraussetzungen'));assert.ok(html.includes('cust-workflow'));assert.ok(!html.includes('<script>'));
state.customers.submissions=[{id:'s',version_id:'v',name:'Synthetic <img>.txt',size:10,status:'pending',decisions:[],created_at:'2026-01-01'}];html=ctx.customersPage();assert.ok(html.includes('Synthetic &lt;img&gt;.txt'));assert.ok(html.includes('data-ux-view="submissions"'));
vm.runInContext(fs.readFileSync('auditflow/static/workflow.js','utf8'),ctx);ctx.flowNew();assert.ok(modalHTML.includes('id="cust-flow-version"'));assert.ok(modalHTML.includes('value="v"'));
ctx.NodeFilter={SHOW_TEXT:4};ctx.document.createTreeWalker=()=>({nextNode:()=>null});ctx.document.querySelectorAll=()=>[];vm.runInContext(fs.readFileSync('auditflow/static/locale.js','utf8'),ctx);state.workspace.settings.language='en';assert.equal(ctx.uxT('Kunden'),'Customers');assert.equal(ctx.uxT('Kunde / gespeicherte Softwareversion'),'Customer / stored software version');
console.log('Customer contracts passed: naming, escaped list/detail/forms, status search, version-only bulk selection, contact prefill, workflow selector and English UI labels.');
