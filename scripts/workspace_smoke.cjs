/* Adapted workspace E2E. Disposable local database only. See browser_smoke.cjs. */
const {chromium}=require('playwright');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');const path=require('node:path');
if(process.env.AUDITFLOW_E2E_ALLOW_WRITES!=='1')throw Error('Disposable test DB required.');
const base=process.env.AUDITFLOW_URL||'http://127.0.0.1:8080';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Local disposable test server required.');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',x=>errors.push(x.message));
 const api=async(p,body)=>{const r=await page.request.post(base+'/api/'+p,{data:body});if(!r.ok())throw Error(await r.text());return r.json();};
 await page.goto(base+'/#packages');await page.waitForSelector('.workspace-stages');
 if(await page.locator('.dashboard-kpi').count()!==3)throw Error('Overview must show exactly three metrics');
 if((await page.locator('#assistant-toggle').textContent()).trim())throw Error('Assistant trigger must be icon-only');
 if(await page.locator('#assistant-toggle').getAttribute('aria-label')!=='Befund-Assistent öffnen')throw Error('Assistant accessibility label missing');
 if(await page.locator('#manufacturer-setup').getAttribute('open')!==null)throw Error('Setup should be collapsed initially');
 const proof=await page.evaluate(()=>dashboardSummary({jobs:[
  {id:'simulation',suite_id:'x',mode:'simulation',status:'completed',created_at:'2026-10-26T22:00:00Z',finished_at:'2026-10-26T22:00:00Z'},
  {id:'old-created-new-import',suite_id:'a',mode:'import',status:'completed',created_at:'2026-10-25T10:00:00Z',finished_at:'2026-10-26T21:00:00Z'},
  {id:'new-created-old-import',suite_id:'a',mode:'import',status:'completed',created_at:'2026-10-26T11:00:00Z',finished_at:'2026-10-26T12:00:00Z'}],suites:[{generated:9}]}));
 if(proof.latest.id!=='old-created-new-import'||proof.profiles!==9||proof.packages!==3)throw Error('Dashboard mixed historical or repeated results');

 const expectedNav=['Vorgänge','Quellen & KI','Anforderungen','Profile & Testfälle','Ergebnisse & Abdeckung','Hilfe & Ablauf'];
 const actualNav=await page.locator('#nav a').evaluateAll(links=>links.map(a=>a.childNodes[1].textContent.trim()));
 if(JSON.stringify(actualNav)!==JSON.stringify(expectedNav))throw Error('Unexpected navigation: '+actualNav);
 for(const [old,target] of [['automation','dashboard'],['check','reports'],['changes','sources'],['chain','dashboard'],['glossary','dashboard'],['coverage','reports']]){
  await page.goto(base+'/#'+old);await page.waitForURL('**/#'+target);
  if(await page.locator('#run-form').count())throw Error('Retired execution screen still present');
 }
 await page.goto(base+'/#sources');await page.waitForSelector('.document-grid');
 if(await page.locator('#diff-form').count())throw Error('Manual comparison form must be removed');
 const doc1=await api('documents/upload',{name:'Synthetic version comparison.txt',version:'1',mode:'offline',base64:Buffer.from('Synthetic original requirement with a deliberately long source statement.').toString('base64')});
 const doc2=await api('documents/upload',{name:'Synthetic version comparison.txt',version:'2',mode:'offline',base64:Buffer.from('Synthetic revised requirement with a deliberately long changed source statement.').toString('base64')});
 if(doc1.family_id!==doc2.family_id||doc2.comparison.changes.length!==1)throw Error('Automatic version comparison failed');
 await page.reload();await page.locator(`[data-action="lib-document"][data-id="${doc2.id}"]`).click();await page.waitForSelector('.document-comparison details');
 const docDownload=page.waitForEvent('download');await page.getByRole('button',{name:'PDF herunterladen',exact:true}).click();await docDownload;

 for(const id of ['C1','C2','C3','C4'])await api('review',{kind:'requirement',id,approve:true,reviewer:'Workspace E2E',note:'Synthetic test only'});
 await page.goto(base+'/#cases');
 for(const kind of ['positive','negative','missing_data']){
  await page.getByRole('button',{name:'Gezielte Testentwürfe',exact:true}).click();
  await page.locator('#draft-type').selectOption(kind);
  const before=await page.locator('.case-card').count();
  await page.getByRole('button',{name:'Entwürfe erstellen',exact:true}).click();
  await page.waitForFunction(n=>document.querySelectorAll('.case-card').length===n+1,before);
 }
 // Negative expected suppression is a passing software behavior test.
 let state=await (await page.request.get(base+'/api/state')).json();
 const negative=state.cases.find(x=>x.test_type==='negative');
 await api('review',{kind:'case',id:negative.id,approve:true,reviewer:'Workspace E2E',note:'Synthetic test only'});
 const run=await api('run',{case_id:negative.id});if(run.overall_status!=='pass')throw Error('Correct negative case must pass');
 await page.reload();await page.waitForSelector('h1');
 await page.goto(base+'/#reports');await page.locator(`[data-action="open-run"][data-id="${run.id}"]`).click();
 await page.getByRole('button',{name:'Befund erklären',exact:true}).first().click();
 await page.locator('#ws-assistant-form button').click();
 await page.waitForSelector('#assistant-answer .assistant-prose');
 if(!(await page.locator('#assistant-answer').textContent()).includes('Lokale Erklärung'))throw Error('Offline mode not labelled');
 // Render model output as text even if it contains markup. No live inference is claimed.
 await page.route('**/api/assistant/explain',r=>r.fulfill({json:{answer:'<img src=x onerror=alert(1)> synthetic answer',mode:'live',model_id:'synthetic-mock',prompt_version:'test',next_steps:['Inspect evidence'],evidence:{status:'pass'},note:'Mock transport only'}}));
 await page.locator('#assistant-mode').selectOption('live');await page.locator('#ws-assistant-form button').click();
 await page.waitForFunction(()=>document.querySelector('.assistant-prose')?.textContent.includes('<img'));
 if(await page.locator('#assistant-answer img').count())throw Error('Model HTML executed');
 await page.unroute('**/api/assistant/explain');
 await page.locator('#assistant-close').click();
 // Real API failure remains an error, no invented AI answer.
 await page.route('**/api/assistant/explain',r=>r.fulfill({status:502,json:{error:'Synthetic unavailable model'}}));
 await page.locator('#assistant-toggle').click();await page.locator('#ws-assistant-form button').click();
 await page.waitForFunction(()=>document.querySelector('#assistant-answer').textContent.includes('Erklärung fehlgeschlagen'));
 await page.unroute('**/api/assistant/explain');await page.locator('#assistant-close').click();
 // Import original PDF pages 2-3 through the actual file input and range fields.
 const pdf=spawnSync(process.env.PYTHON||'python3',['-c',"import io,sys;from reportlab.pdfgen import canvas;b=io.BytesIO();c=canvas.Canvas(b);[(c.drawString(40,700,'Synthetic original source page '+str(i)+' with a statement for the import test.'),c.showPage()) for i in range(1,4)];c.save();sys.stdout.buffer.write(b.getvalue())"]);
 if(pdf.status!==0)throw Error('Synthetic PDF generation failed');
 await page.goto(base+'/#sources');await page.getByRole('button',{name:'+ Dokument hochladen',exact:true}).click();
 await page.locator('#source-file').setInputFiles({name:'Workspace Synthetic.pdf',mimeType:'application/pdf',buffer:pdf.stdout});
 await page.locator('input[name=version]').fill('test-1');await page.locator('#lib-upload-form details').evaluate(el=>el.open=true);await page.locator('#pages-from').fill('2');await page.locator('#pages-to').fill('3');
 await page.getByRole('button',{name:'Hochladen und verarbeiten',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog').open);
 await page.waitForFunction(()=>document.querySelector('#source-section option')?.value==='page-2');
 const options=await page.locator('#source-section option').allTextContents();
 if(JSON.stringify(options)!==JSON.stringify(['PDF-Seite 2','PDF-Seite 3']))throw Error('PDF page identity lost: '+options);
 // A new automatik job exposes the assistant against its actual persisted result.
 let a=await (await page.request.get(base+'/api/automation/state')).json();
 let pkg=a.packages.find(x=>x.status==='approved');
 if(!pkg)pkg=await api('automation/approve',{package_id:a.packages[0].id,reviewer:'Workspace E2E',note:'Synthetic only',acknowledge_demo:true});
 const project=await api('automation/project',{manufacturer:'Synthetic',software:'WorkspaceExample',software_version:'1'});
 const job=await api('automation/start',{project_id:project.id,package_id:pkg.id,count:9,mode:'simulation',behavior:'healthy'});
 for(let i=0;i<100;i++){const j=await (await page.request.get(base+'/api/automation/jobs/'+job.id)).json();if(j.status==='completed')break;await page.waitForTimeout(100);}
 await page.goto(base+'/#packages');await page.reload();await page.locator(`[data-action="auto-open"][data-id="${job.id}"]`).click();
 await page.waitForSelector('.auto-detail');await page.locator('.auto-detail [data-action="ws-explain"]').first().click();
 await page.locator('#assistant-mode').selectOption('offline');await page.locator('#ws-assistant-form button').click();await page.waitForSelector('#assistant-answer .assistant-prose');
 if(!(await page.locator('#assistant-answer').textContent()).includes('Regelpaket-Fingerabdruck'))throw Error('Automation evidence missing');
 await page.locator('#assistant-close').click();
 await page.getByRole('button',{name:'Bericht schließen',exact:true}).click();
 const latest=await page.evaluate(()=>dashboardSummary(state.automation).latest);
 if(!latest||!await page.locator('.result-ring').count())throw Error('Imported result graphic missing');
 const graphic=await page.locator('.result-ring').getAttribute('aria-label');
 if(!graphic.includes('Bestanden: '+latest.counts.pass)||!graphic.includes('Nicht beurteilbar: '+latest.counts.not_assessable))throw Error('Chart does not match stored result counts');
 if(await page.locator('.package-row').count()>3)throw Error('Package list not compact');
 if(await page.getByRole('button',{name:'Alle anzeigen',exact:true}).count()){await page.getByRole('button',{name:'Alle anzeigen',exact:true}).click();if(await page.locator('.package-row').count()!==await page.evaluate(()=>state.automation.jobs.length))throw Error('Full package list unavailable');await page.getByRole('button',{name:'Weniger anzeigen',exact:true}).click();}
 fs.mkdirSync('test-results',{recursive:true});
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000});
  for(const route of ['dashboard','sources','help','reports']){
   await page.goto(base+'/#'+route);await page.waitForTimeout(100);
   if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Overflow '+route+' '+width);
  }
  await page.goto(base+'/#packages');await page.screenshot({path:path.join('test-results',`workspace-${width}.png`),fullPage:true});
  await page.locator('#assistant-toggle').click();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Assistant overflow');
  await page.screenshot({path:path.join('test-results',`assistant-${width}.png`),fullPage:true});
  await page.locator('#assistant-close').click();
 }
 console.log(JSON.stringify({views:[1440,390],navigation:6,overviewMetrics:3,assistantTrigger:'icon-only',chart:'stored-import-only',retiredRoutes:'redirected',sourceVersionComparison:'passed',typedDrafts:3,negativeCase:'pass',pdfOriginalPages:[2,3],assistant:['stored-single','stored-bulk','escaped-mock-output','explicit-failure'],pageErrors:errors}));
 await browser.close();if(errors.length)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
