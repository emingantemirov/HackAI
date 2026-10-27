/* Optional browser regression; use the same disposable server and opt-in as browser_smoke.cjs. */
const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
if(process.env.AUDITFLOW_E2E_ALLOW_WRITES!=='1')throw Error('Disposable test database required.');
const base=process.env.AUDITFLOW_URL||'http://127.0.0.1:8080';
if(!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base))throw Error('Local test server required.');
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];
 page.on('pageerror',x=>errors.push(x.message));page.on('console',x=>{if(x.type()==='error')errors.push(x.text())});
 const out=path.resolve('test-results');fs.mkdirSync(out,{recursive:true});
 await page.goto(base+'/#packages');await page.waitForSelector('#manufacturer-setup');await page.locator('#manufacturer-setup').evaluate(el=>{if(el.id==='manufacturer-setup')workspaceSetupOpen=true;if(el.id==='manufacturer-change-setup')workspaceChangesOpen=true;el.open=true;});
 await page.getByRole('button',{name:'+ Software anlegen'}).click();
 await page.locator('[name="manufacturer"]').fill('Synthetic Browser Company');await page.locator('[name="software"]').fill('Browser Payroll');await page.locator('[name="software_version"]').fill('1.0');
 await page.locator('[name="auto_on_rule_change"]').uncheck();await page.getByRole('button',{name:'Prüfziel speichern'}).click();await page.waitForFunction(()=>!document.querySelector('dialog').open);
 async function submitResults(){
  const j=await page.evaluate(()=>state.automation.jobs[0]);
  const input=await (await page.request.get(base+'/api/automation/jobs/'+j.id+'/input')).json();
  const record={records:input.cases.map(c=>({case_id:c.case_id,observed:{message_present:true}}))};
  await page.getByRole('button',{name:'Softwareergebnisse importieren',exact:true}).click();
  await page.locator('#auto-import-form input[type=file]').setInputFiles({name:'synthetic-manufacturer-results.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record))});
  await page.getByRole('button',{name:'Importieren & automatisch auswerten',exact:true}).click();
  await page.waitForFunction(()=>state.automation.jobs[0].status==='completed',null,{timeout:20000});
 }
 async function approve(){
  await page.locator('#auto-approve-form [name="reviewer"]').fill('Browser test identity');
  await page.locator('#auto-approve-form [name="note"]').fill('Synthetic template acceptance test, no official approval.');
  await page.locator('[name="acknowledge_demo"]').check();await page.getByRole('button',{name:'Vorlagen freigeben'}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog').open&&state.automation.packages.every(p=>p.status==='approved'));
 }
 await page.getByRole('button',{name:'Paket prüfen',exact:true}).click();await approve();
 await page.locator('#manufacturer-setup').evaluate(el=>{if(el.id==='manufacturer-setup')workspaceSetupOpen=true;if(el.id==='manufacturer-change-setup')workspaceChangesOpen=true;el.open=true;});
 await page.locator('#auto-start-form [name="count"]').fill('36');
 await page.getByRole('button',{name:'Testpaket erstellen'}).click();
 await page.waitForFunction(()=>state?.automation?.jobs?.[0]?.status==='waiting_import',null,{timeout:20000});
 await submitResults();
 await page.waitForSelector('.auto-detail');
 const first=await page.evaluate(()=>state.automation.jobs[0]);if(first.completed!==36||first.mode!=='import')throw Error('Full suite failed.');
 await page.screenshot({path:path.join(out,'automation-desktop.png'),fullPage:true});
 await page.locator('.auto-detail [data-action="auto-profile"]').first().click();await page.waitForSelector('dialog[open]');await page.locator('#close-dialog').click();
 const reportPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Gesamtbericht JSON',exact:true}).click();const report=await reportPromise;await report.saveAs(path.join(out,'automation-report.json'));
 const csvPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Ergebnisse CSV',exact:true}).click();await (await csvPromise).saveAs(path.join(out,'automation-results.csv'));
 await page.locator('#manufacturer-setup').evaluate(el=>{if(el.id==='manufacturer-setup')workspaceSetupOpen=true;if(el.id==='manufacturer-change-setup')workspaceChangesOpen=true;el.open=true;});
 await page.getByRole('button',{name:'Neue Version',exact:true}).first().click();
 await page.locator('#lib-package-form [name="days"]').fill('32');
 await page.getByRole('button',{name:'Neuen Stand speichern',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('dialog').open);
 await page.getByRole('button',{name:'Paket prüfen',exact:true}).click();await approve();
 await page.locator('#manufacturer-change-setup').evaluate(el=>{if(el.id==='manufacturer-setup')workspaceSetupOpen=true;if(el.id==='manufacturer-change-setup')workspaceChangesOpen=true;el.open=true;});
 const newest=await page.evaluate(()=>state.automation.packages.at(-1).id);
 await page.locator('#auto-impact-form [name="package_id"]').selectOption(newest);
 await page.getByRole('button',{name:'Betroffene Tests bestimmen'}).click();await page.waitForSelector('#auto-impact-output .note');
 const plan=await page.evaluate(()=>autoPlan);if(!(plan.selected_count>0&&plan.selected_count<36))throw Error('No partial impact selection.');
 await page.getByRole('button',{name:'Hersteller-Testpaket bereitstellen'}).click();
 await page.waitForFunction(()=>state.automation.jobs[0].status==='waiting_import'&&state.automation.jobs[0].selection==='impact',null,{timeout:20000});
 await submitResults();
 await page.waitForFunction(()=>state?.automation?.jobs?.[0]?.status==='completed'&&state.automation.jobs[0].selection==='impact',null,{timeout:20000});
 await page.locator('.auto-detail [data-action="auto-profile"]').first().waitFor();const second=await page.evaluate(()=>state.automation.jobs[0]);if(second.counts.fail===0)throw Error('Outdated vendor not detected.');
 await page.screenshot({path:path.join(out,'automation-impact.png'),fullPage:true});
 // Exercise imported software output through the UI, with missing results preserved.
 await page.locator('#manufacturer-setup').evaluate(el=>{if(el.id==='manufacturer-setup')workspaceSetupOpen=true;if(el.id==='manufacturer-change-setup')workspaceChangesOpen=true;el.open=true;});
 await page.locator('#auto-start-form [name="count"]').fill('9');
 await page.getByRole('button',{name:'Testpaket erstellen'}).click();
 await page.waitForFunction(()=>state.automation.jobs[0].status==='waiting_import',null,{timeout:20000});
 const importJob=await page.evaluate(()=>state.automation.jobs[0]);
 await page.getByRole('button',{name:'Softwareergebnisse importieren',exact:true}).click();
 const record={records:[{case_id:importJob.suite_id+':00001',observed:{message_present:true}}]};
 await page.locator('#auto-import-form input[type=file]').setInputFiles({name:'synthetic-software-output.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(record))});
 await page.getByRole('button',{name:'Importieren & automatisch auswerten',exact:true}).click();
 await page.waitForFunction(()=>state.automation.jobs[0].status==='completed'&&state.automation.jobs[0].mode==='import',null,{timeout:20000});
 const imported=await page.evaluate(()=>state.automation.jobs[0]);if(imported.counts.not_assessable!==8)throw Error('Missing imported outputs were not preserved.');
 await page.locator('.auto-detail [data-action="auto-profile"]').first().waitFor();
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(200);
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Automation mobile overflow.');
 await page.screenshot({path:path.join(out,'automation-mobile.png'),fullPage:true});
 console.log(JSON.stringify({fullSuite:36,profiles:36,impactSelected:plan.selected_count,impactSkipped:plan.skipped_count,detectedFailures:second.counts.fail,downloads:['json','csv'],importMissingOutputs:8,viewports:[1440,390],pageErrors:errors}));
 await browser.close();if(errors.length)process.exit(1);
})().catch(e=>{console.error(e);process.exit(1)});
