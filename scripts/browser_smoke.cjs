/* Optional E2E test. Run only against a disposable local test DB.
   npm install --no-save playwright
   AUDITFLOW_E2E_ALLOW_WRITES=1 node scripts/browser_smoke.cjs
   Set BROWSER_EXECUTABLE if a non-default Chromium binary is installed. */
const {chromium}=require('playwright');
const fs=require('fs');const path=require('path');
if(process.env.AUDITFLOW_E2E_ALLOW_WRITES!=='1')throw Error('Use a disposable DB and set AUDITFLOW_E2E_ALLOW_WRITES=1.');
const base=process.env.AUDITFLOW_URL||'http://127.0.0.1:8080';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Local disposable test server required.');
const output=path.resolve('test-results');fs.mkdirSync(output,{recursive:true});
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',x=>errors.push(x.message));
 await page.goto(base);await page.waitForSelector('h1');
 await page.screenshot({path:path.join(output,'desktop.png'),fullPage:true});
 const pages=['dashboard','sources','requirements','cases','reports','help'];
 for(const name of pages){await page.goto(base+'/#'+name);await page.waitForTimeout(80);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Desktop overflow: '+name);}
 async function review(kind,id){
  await page.goto(base+'/#'+(kind==='case'?'cases':'requirements'));
  await page.locator(`[data-action="review"][data-kind="${kind}"][data-id="${id}"]`).click();
  await page.locator('#reviewer').fill('Automated browser test');
  await page.locator('#review-note').fill('Synthetic demo only. Test identity, not real substantive approval.');
  await page.getByRole('button',{name:'Freigeben',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open);
 }
 for(const id of ['C1','C2','C3','C4'])await review('requirement',id);
 await review('case','CASE-001');
 async function run(mutation){
  // The direct-execution screen was retired. Exercise legacy API compatibility,
  // then inspect its historical report through the retained UI.
  const response=await page.request.post(base+'/api/run',{data:{mode:'message',mutation}});
  if(!response.ok())throw Error(await response.text());const report=await response.json();
  await page.goto(base+'/#reports');await page.reload();
  await page.locator(`[data-action="open-run"][data-id="${report.id}"]`).click();
  await page.waitForSelector('.big-status');
 }
 await run('');if(!await page.locator('.big-status.pass').count())throw Error('Golden synthetic sample did not pass.');
 await page.screenshot({path:path.join(output,'passing-report.png'),fullPage:true});
 const jsonDownload=page.waitForEvent('download');await page.locator('[data-format="json"]').click();
 const downloaded=await jsonDownload;await downloaded.saveAs(path.join(output,'report.json'));
 const pdfDownload=page.waitForEvent('download');await page.locator('[data-format="pdf"]').click();
 const pdf=await pdfDownload;await pdf.saveAs(path.join(output,'report.pdf'));
 await run('wrong_azvu');if(!await page.locator('.big-status.fail').count())throw Error('Mutation was not detected.');
 await page.goto(base+'/#cases');const countBefore=await page.locator('.case-card').count();
 await page.locator('[data-action="generate-cases"][data-mode="boundary"]').first().click();
 await page.waitForFunction(n=>document.querySelectorAll('.case-card').length===n+4,countBefore);
 await page.goto(base+'/#sources');await page.getByRole('button',{name:'+ Dokument hochladen'}).click();
 await page.locator('#source-file').setInputFiles({name:'Synthetic UI import.txt',mimeType:'text/plain',buffer:Buffer.from('A synthetic source statement for testing document import and literal candidate extraction.')});
 await page.locator('input[name="version"]').fill('UI-test-1');await page.getByRole('button',{name:'Hochladen und verarbeiten',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog').open);
 await page.waitForSelector('.document-detail');
 await page.waitForFunction(()=>state.document_jobs.some(j=>j.document_id===activeDoc&&j.status==='completed'));
 await page.goto(base+'/#requirements');await page.waitForSelector('.recommendation');
 if(!await page.getByText('Lokaler Quellenabgleich · ohne KI',{exact:true}).count())throw Error('Offline preparation was not labelled');
 await page.setViewportSize({width:390,height:844});
 await page.goto(base+'/#dashboard');await page.waitForTimeout(100);
 await page.screenshot({path:path.join(output,'mobile.png'),fullPage:true});
 for(const name of pages){await page.goto(base+'/#'+name);await page.waitForTimeout(80);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow: '+name);}
 console.log(JSON.stringify({pages:6,viewports:[1440,390],review:'passed',goldenSample:'passed',mutation:'detected',downloads:['json','pdf'],boundaryDrafts:4,documentImport:'passed',literalDraft:'passed',pageErrors:errors}));
 await browser.close();if(errors.length)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
