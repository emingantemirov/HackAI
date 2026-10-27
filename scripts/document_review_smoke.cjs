/* New document workflow E2E: disposable local DB, synthetic inputs only. */
const {chromium}=require('playwright');const fs=require('node:fs');
if(process.env.AUDITFLOW_E2E_ALLOW_WRITES!=='1')throw Error('Disposable DB required');
const base=process.env.AUDITFLOW_URL||'http://127.0.0.1:8080';if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Local test server required');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/#sources');await page.waitForSelector('.document-grid');
 const unicode=await page.evaluate(()=>markText('📄 Prüfe die Frist',{issues:[{target:'criterion',quote:'Frist',start:12,end:17,reason:'Test'}]},'criterion'));
 if(!unicode.includes('>Frist</mark>'))throw Error('Unicode highlight offsets are incorrect');
 async function upload(version,text){
  await page.getByRole('button',{name:'+ Dokument hochladen',exact:true}).click();
  await page.locator('#source-file').setInputFiles({name:'Library workflow.txt',mimeType:'text/plain',buffer:Buffer.from(text)});
  await page.locator('#lib-upload-form [name=version]').fill(version);await page.locator('#lib-upload-form [name=folder]').fill('Prüfverfahren');
  await page.getByRole('button',{name:'Hochladen und verarbeiten',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog').open);
  await page.waitForFunction(()=>state.document_jobs.some(j=>j.document_id===activeDoc&&j.status==='completed'));
  return page.evaluate(()=>activeDoc);
 }
 const old=await upload('1','A synthetic source requirement with a minimum of thirty days and an explicitly confirmed certificate.');
 const current=await upload('2','A synthetic source requirement with a minimum of thirty-two days and an explicitly confirmed certificate.');
 await page.waitForSelector('.document-comparison details');
 if(await page.locator('#diff-form').count())throw Error('Manual version comparison should be absent');
 const before=await page.evaluate(()=>state.documents.length);await upload('2','A synthetic source requirement with a minimum of thirty-two days and an explicitly confirmed certificate.');
 if(await page.evaluate(()=>state.documents.length)!==before)throw Error('Duplicate source created');
 const original=page.waitForEvent('download');await page.getByRole('button',{name:'Original herunterladen',exact:true}).click();await original;
 const pdf=page.waitForEvent('download');await page.getByRole('button',{name:'PDF herunterladen',exact:true}).click();await pdf;
 await page.locator('#lib-version').selectOption(old);await page.waitForFunction(id=>activeDoc===id,old);
 await page.locator('#lib-version').selectOption(current);
 await page.screenshot({path:'test-results/source-library-1440.png',fullPage:true});
 const real=(await (await page.request.get(base+'/api/state')).json()).requirements.find(r=>r.source_id===current);
 if(!real)throw Error('Automatic requirement extraction missing');
 // UI-only synthetic model fixture. Server recommendation validation is covered in Python.
 const quote=real.criterion.slice(0,25);
 await page.goto(base+'/#requirements');
 await page.evaluate(({id,quote})=>{const r=state.requirements.find(x=>x.id===id);r.ai_review={mode:'live',model_id:'synthetic-UI-mock',status:'completed',created_at:new Date().toISOString(),recommendation:'revise',reason:'Synthetic UI recommendation: clarify the highlighted wording.',issues:[{target:'criterion',quote,start:0,end:quote.length,reason:'Synthetic ambiguity test',suggestion:'Use an unambiguous statement grounded in the source.'}]};render();},{id:real.id,quote});
 const card=page.locator(`[data-action="lib-revise"][data-id="${real.id}"]`).locator('xpath=ancestor::article');
 await card.locator('mark').first().waitFor();if(await card.locator('mark').first().textContent()!==quote)throw Error('Wrong highlighted passage');
 if(!await card.getByText('Überarbeitung empfohlen',{exact:true}).count())throw Error('Recommendation missing');
 if(!await card.getByText('Prüfung offen',{exact:true}).count())throw Error('AI silently approved requirement');
 if(await page.locator('pre').count())throw Error('Raw code block in requirement UI');
 await page.screenshot({path:'test-results/requirement-review-1440.png',fullPage:true});
 await card.getByRole('button',{name:'Überarbeiten',exact:true}).click();await page.locator('#lib-revise-form [name=criterion]').fill('A clearly revised synthetic requirement for the human review test.');
 await page.getByRole('button',{name:'Neue Fassung speichern',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('dialog').open);
 const after=(await (await page.request.get(base+'/api/state')).json()).requirements.find(r=>r.previous_requirement_id===real.id);
 if(!after||after.status!=='pending'||after.ai_review?.model_id==='synthetic-UI-mock')throw Error('Revision kept approval or recommendation');
 await page.goto(base+'/#cases');await page.getByRole('button',{name:'+ Testfall anlegen',exact:true}).click();
 if(await page.locator('textarea[name=scenario]').count())throw Error('JSON scenario editor still exposed');await page.locator('#lib-case-form [name=name]').fill('Readable form test case');await page.locator('#lib-case-form [name=expectation_source]').fill('Synthetic test; expectation intentionally remains open.');const countBefore=await page.locator('.case-card').count();await page.getByRole('button',{name:'Testfall als Entwurf speichern',exact:true}).click();await page.waitForFunction(n=>document.querySelectorAll('.case-card').length===n+1,countBefore);
 await page.goto(base+'/#reports');await page.waitForSelector('.coverage-bars');
 if(!await page.getByRole('heading',{name:'Ergebnisse & Abdeckung',exact:true}).count())throw Error('Combined results page missing');
 if(await page.locator('#nav a').count()!==6)throw Error('Results navigation not merged');
 if(await page.locator('pre').count())throw Error('Raw code block in report UI');
 await page.screenshot({path:'test-results/results-coverage-1440.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 for(const route of ['sources','requirements','cases','reports']){await page.goto(base+'/#'+route);await page.waitForTimeout(150);if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Mobile overflow '+route);}
 await page.goto(base+'/#sources');await page.screenshot({path:'test-results/source-library-390.png',fullPage:true});
 console.log(JSON.stringify({automaticVersionComparison:'passed',duplicate:'reused',downloads:['original','pdf'],versionHistory:'passed',automaticRequirements:'passed',recommendation:'mocked-render-checked',exactHighlight:'passed',revision:'pending-without-old-review',humanForms:'passed',combinedResults:'passed',pageErrors:errors}));
 await browser.close();if(errors.length)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
