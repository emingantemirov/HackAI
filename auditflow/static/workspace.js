'use strict';
/* Selected interaction patterns from the supplied Base44 app, adapted to AuditFlow's
   local API. No Base44 account, SDK, hosted data or original sample is copied. */
const testTypes={positive:'Positivfall',negative:'Negativfall',boundary:'Grenzfall',missing_data:'Fehlende Daten',custom:'Eigener Fall'};
const testTypeLabel=t=>testTypes[t]||t;
let assistantRef=null,assistantBusy=false;
const uiIcons={
 package:'<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="M3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5"/>',
 people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6M21 21v-2a6 6 0 0 0-4-5.65"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 spark:'<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3L12 3Z"/>',
 document:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>'
};
const uiIcon=(name,cls='')=>`<svg class="ui-icon ${cls}" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${uiIcons[name]||uiIcons.package}</svg>`;
function dashboardSummary(a){
 // Most recent completed import per suite; exclude historical simulations and earlier reruns.
 const latestBySuite=new Map();
 for(const j of [...a.jobs].sort((x,y)=>Date.parse(y.finished_at||y.created_at)-Date.parse(x.finished_at||x.created_at)))if(j.mode==='import'&&j.status==='completed'&&!latestBySuite.has(j.suite_id))latestBySuite.set(j.suite_id,j);
 const jobs=[...latestBySuite.values()];
 const latest=jobs[0]||null;
 return {latest,waiting:a.jobs.filter(j=>j.mode==='import'&&j.status==='waiting_import').length,
   profiles:a.suites.reduce((n,s)=>n+s.generated,0),packages:a.jobs.length};
}
function resultGraphic(job){
 if(!job)return `<div class="chart-empty"><div class="empty-ring">${uiIcon('document')}</div><strong>Noch keine Ergebnisse</strong><p>Nach dem ersten Herstellerimport erscheint hier die Auswertung.</p></div>`;
 const colors={pass:'#20806a',fail:'#d50032',not_assessable:'#b77a19',technical_error:'#727987'};
 const rows=['pass','fail','not_assessable','technical_error'].map(status=>({status,count:job.counts[status]||0}));
 const total=rows.reduce((n,x)=>n+x.count,0);
 let offset=0;
 const rings=rows.filter(x=>x.count>0).map(x=>{const length=x.count/Math.max(total,1)*100;const circle=`<circle class="result-segment" cx="60" cy="60" r="48" pathLength="100" fill="none" stroke="${colors[x.status]}" stroke-width="10" stroke-dasharray="${length} ${100-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"/>`;offset+=length;return circle;}).join('');
 return `<div class="result-visual"><div class="ring-wrap"><svg class="result-ring" viewBox="0 0 120 120" role="img" aria-label="${e(rows.map(x=>(labels[x.status]||x.status)+': '+x.count).join(', '))}"><circle cx="60" cy="60" r="48" fill="none" stroke="#edf0f2" stroke-width="10"/>${rings}</svg><div class="ring-caption"><strong>${total.toLocaleString('de-DE')}</strong><span>ausgewertet</span></div></div><ul class="chart-legend">${rows.filter(x=>x.status!=='technical_error'||x.count>0).map(x=>`<li><span class="legend-dot legend-${x.status}"></span><span>${e(labels[x.status])}</span><strong>${x.count.toLocaleString('de-DE')}</strong></li>`).join('')}</ul></div><div class="chart-foot"><span>${e(job.project.software)} · ${e(job.package.name)}${job.selection==='impact'?' · Teilprüfung':''}</span>${btn('Ansehen '+uiIcon('arrow'),'auto-open',`data-id="${e(job.id)}"`,'small')}</div>`;
}
function workspaceDashboard(){
 const a=state.automation||{jobs:[],suites:[],projects:[],packages:[]};
 const summary=dashboardSummary(a);
 const pending=state.requirements.filter(r=>r.status==='pending').length;
 const latest=summary.latest;
 const n=v=>v.toLocaleString('de-DE');
 return `<div class="dashboard-heading"><div><h1>Alles Wichtige im Blick.</h1><p>Testpakete vorbereiten. Herstellerergebnisse verstehen.</p></div>${btn('+ Testpaket','ws-prepare','','primary')}</div>`+
 `<div class="dashboard-kpis workspace-stages">${[['package',n(summary.packages),'Testpakete','Erstellte Pakete'],['people',n(summary.profiles),'Testprofile','Synthetisch erzeugt'],['clock',n(summary.waiting),'Warten auf Ergebnisse','Rückmeldung vom Hersteller']].map(([icon,value,title,note])=>`<div class="dashboard-kpi"><span class="kpi-icon">${uiIcon(icon)}</span><div><span class="kpi-label">${title}</span><strong>${value}</strong><small>${note}</small></div></div>`).join('')}</div>`+
 `<div class="dashboard-insights"><section class="panel result-panel"><div class="panel-header"><div><h2>Letztes Herstellerergebnis</h2><p>Ein Paket · ein klarer Überblick</p></div><span class="subtle-chip">${latest?'Letzter Import':'Noch offen'}</span></div>${resultGraphic(latest)}</section>`+
 `<section class="panel next-panel"><span class="next-icon">${uiIcon('spark')}</span><h2>${summary.waiting?'Ergebnisse übernehmen.':pending?'Regeln für Tests vorbereiten.':'Bereit für das nächste Paket?'}</h2><p>${summary.waiting?'Ein Testpaket wartet auf die Rückmeldung des Herstellers. Importiere die Ergebnisse, um Soll und Ist zu vergleichen.':pending?'Prüfe die vorgeschlagenen Anforderungen. Danach kannst du daraus ein Testpaket vorbereiten.':'Erstelle Testfälle und Profile für die Software des Herstellers. Die Ausführung übernimmt der Hersteller.'}</p>${summary.waiting?btn('Ergebnisse importieren '+uiIcon('arrow'),'ws-waiting','','primary'):pending?'<a class="btn primary" href="#requirements">Anforderungen ansehen '+uiIcon('arrow')+'</a>':btn('Testpaket vorbereiten '+uiIcon('arrow'),'ws-prepare','','primary')}<div class="mini-handoff"><span>${uiIcon('package')} Paket</span><span>→</span><span>${uiIcon('people')} Hersteller</span><span>→</span><span>${uiIcon('check')} Ergebnis</span></div></section></div>`+
 manufacturerWorkspace()+
 `<p class="scope-caption">Synthetische Demo · Hersteller führen die Tests aus · Keine automatische Zulassung</p>`;
}
function workspaceHelp(){
 return heading('Hilfe','Vom Eingang bis zur Absegnung','Die KI bereitet vor. Menschen entscheiden an den fachlichen Freigaben.')+`<section class="panel"><h2>Der Vorgang als Fließband</h2><ol class="help-steps"><li>Unter Vorgänge eine Eingangsmappe mit Kunden-E-Mail, Ansprechpartner und Softwarestand anlegen. Dateien auswählen, Vorschau prüfen und hochladen.</li><li>AuditFlow erkennt vorhandene Quellen, vergleicht Versionen und speichert neue Stände. Originale bleiben erhalten. Das Dateisymbol bei Quellen öffnet den ersten Zwischenbericht.</li><li>Die KI formuliert Anforderungen und eine Empfehlung. Überarbeitungsbedarf wird an der exakten Textstelle markiert. Eine fachkundige Person prüft und gibt die Anforderungen frei.</li><li>Nach vollständiger Freigabe entsteht automatisch der zweite Zwischenbericht; anschließend werden konkrete Testfälle mit synthetischen Profilen erstellt.</li><li>Über das Dateisymbol den Testfallbericht lesen. Eingaben und erwartete Werte unabhängig prüfen. Offene Fälle konkretisieren und das Testpaket freigeben.</li><li>Bei eingerichteter SMTP-Verbindung und gewähltem automatischem Versand wird das freigegebene Paket an die hinterlegte Kunden-E-Mail geschickt. Alternativ herunterladen und die tatsächliche Übergabe dokumentieren.</li><li>Der Kunde führt die Tests in seiner Software durch. Die Ergebnisdatei mit Vorgangs-ID, Paketfingerabdruck und Fallbeobachtungen importieren. Fehlende Ergebnisse bleiben offen.</li><li>AuditFlow erstellt den Endbericht. Eine Person prüft die Befunde und dokumentiert Absegnung oder Nacharbeit mit Namensbestätigung. Positive Absegnung ist bei offenen oder abweichenden Ergebnissen gesperrt.</li></ol></section><div class="grid-even"><section class="panel"><h2>Was automatisch läuft</h2><p>Quellenvergleich, gespeicherte Entwürfe, KI-Empfehlungen bei funktionierender Modellverbindung, Testfallerstellung nach Anforderungsfreigabe, Zwischenberichte und Ergebnisauswertung. Der Fortschritt bleibt beim Neustart erhalten.</p><p>Neue oder überarbeitete Anforderungen brauchen eine Freigabe. Ändert sich eine laufende Grundlage, wird das alte Paket gesperrt und der Vorgang kehrt zur Anforderungsprüfung zurück.</p></section><section class="panel"><h2>Verbindungen und Grenzen</h2><p>HAI_API_KEY und SMTP-Einstellungen werden ausschließlich serverseitig aus Prozess-Umgebungsvariablen gelesen. Die Anwendung lädt keine .env automatisch. Konfiguriert bedeutet noch nicht erfolgreich verbunden.</p><p>Ohne KI-Verbindung gibt es klar gekennzeichnete lokale Prüfgerüste mit offenen Erwartungen. Keine erfundenen Gesetze, keine automatische Gesetz-zu-Code-Kompilierung, keine amtliche Zertifizierung. Namensbestätigung ist keine qualifizierte elektronische Signatur.</p><p>Die Struktur orientiert sich an ERP-Arbeitsvorrat, Vorgangsakte und Freigaben. SAP, Base44, Hersteller-APIs und eine Mehrbenutzerverwaltung sind nicht angebunden.</p></section></div><section class="panel"><h2>Bestehende Funktionen</h2><p>Die begrenzte C1-/C2-/C4-Demo mit bis zu 4.000 reproduzierbaren Profilen und gezielter Änderungsprüfung bleibt unter <a href="#packages">Demopakete & Werkzeuge</a> verfügbar. Dieser Vorlagenumfang ist von frei formulierten KI-Testfallentwürfen getrennt.</p><p>Der Befund-Assistent am rechten unteren Rand erläutert gespeicherte Einzel- und Demopaketbefunde. Er kann keine Freigaben erteilen.</p></section>`;
}
function generationDialog(){
 modal(`<h2>Gezielte Testentwürfe</h2><p>Die ausgewählte Fallart wird mit den freigegebenen C1-/C2-/C4-Demoregeln verknüpft. Vorlagenfälle verwenden feste synthetische Daten aus 2026; Grenzfälle und KI-Entwürfe nutzen den Ausgangsfall. Alle Erwartungen bleiben fachlich zu prüfen.</p><form id="ws-generate-form"><div class="field"><label for="draft-baseline">Ausgangsfall / Regelstand</label><select id="draft-baseline" name="case_id">${state.cases.map(c=>`<option value="${e(c.id)}">${e(c.name)} · ${e(c.ruleset)}</option>`).join('')}</select></div><div class="field"><label for="draft-type">Testfallart</label><select id="draft-type" name="test_type">${Object.entries(testTypes).filter(([k])=>k!=='custom').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div class="field"><label for="draft-mode">Erzeugung</label><select id="draft-mode" name="mode"><option value="template">Synthetische Vorlage · ohne KI</option><option value="live">KI-Entwurf · Modellverbindung erforderlich</option></select></div><div class="note">Fehlender Nachweisstatus bleibt unbekannt. Negative Fälle erwarten korrekt keine Anfrage. Grenzfälle enthalten bewusst offene Erwartungen.</div><button class="btn primary">Entwürfe erstellen</button></form>`);
}
function showAssistant(ref){
 if(assistantBusy)return toast('Bitte die laufende Erklärung abwarten.');
 if(ref)assistantRef=ref;
 const panel=document.getElementById('assistant-panel');panel.hidden=false;
 document.getElementById('assistant-toggle').setAttribute('aria-expanded','true');
 document.getElementById('assistant-toggle').hidden=true;
 if(ref){document.getElementById('assistant-answer').textContent='';document.getElementById('assistant-context').textContent=(ref.kind==='run'?'Einzelbericht '+ref.id+(ref.finding_id?' · '+ref.finding_id:''):'Automatiklauf '+ref.job_id+' · Fall '+ref.case_id);}
 document.getElementById('assistant-question').focus();
}
function closeAssistant(){document.getElementById('assistant-panel').hidden=true;document.getElementById('assistant-toggle').hidden=false;document.getElementById('assistant-toggle').setAttribute('aria-expanded','false');document.getElementById('assistant-toggle').focus();}
document.getElementById('assistant-toggle').onclick=()=>showAssistant(null);
document.getElementById('assistant-close').onclick=closeAssistant;
document.getElementById('assistant-panel').addEventListener('keydown',event=>{if(event.key==='Escape')closeAssistant();});
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-action]');if(!b||!b.dataset.action.startsWith('ws-'))return;
 b.disabled=true;try{
  if(b.dataset.action==='ws-generate')generationDialog();
  if(b.dataset.action==='ws-all-jobs'){workspaceAllJobs=!workspaceAllJobs;render();}
  if(b.dataset.action==='ws-waiting'){const job=state.automation.jobs.find(j=>j.mode==='import'&&j.status==='waiting_import');if(job){autoSelected=job.id;autoOffset=0;await autoFetchRows();render();document.querySelector('.auto-detail')?.scrollIntoView({block:'start'});document.querySelector('.auto-detail [data-action="auto-import"]')?.click();}}
  if(b.dataset.action==='ws-prepare'){workspaceSetupOpen=true;render();document.querySelector('#manufacturer-setup').open=true;document.querySelector('#manufacturer-workspace').scrollIntoView({behavior:'smooth',block:'start'});}

  if(b.dataset.action==='ws-explain')showAssistant(b.dataset.kind==='run'?{kind:'run',id:b.dataset.id,...(b.dataset.finding?{finding_id:b.dataset.finding}:{})}:{kind:'automation',job_id:b.dataset.job,case_id:b.dataset.case});
 }catch(err){toast(err.message);}finally{b.disabled=false;}
});
document.addEventListener('submit',async event=>{
 const form=event.target;const id=form.getAttribute('id');if(!id?.startsWith('ws-'))return;event.preventDefault();
 const data=Object.fromEntries(new FormData(form));const button=event.submitter;if(button)button.disabled=true;
 try{
  if(id==='ws-generate-form'){const created=await api('generate',data);document.getElementById('dialog').close();await load();toast(created.length+' verknüpfte Testentwürfe gespeichert.');}
  if(id==='ws-assistant-form'){
   if(!assistantRef)throw Error('Zuerst in einem Bericht oder einer Ergebniszeile „Erklären“ wählen.');
   if(assistantBusy)return;assistantBusy=true;
   const target=document.getElementById('assistant-answer');target.textContent='Erklärung wird geladen …';
   try{
    const r=await api('assistant/explain',{...data,ref:assistantRef});
    target.innerHTML=`<p class="pill">${r.mode==='live'?'KI · '+e(r.model_id):'Lokale Erklärung · ohne KI'}</p><div class="assistant-prose">${e(r.answer)}</div><h3>Nächste Prüfschritte</h3><ol>${r.next_steps.map(s=>`<li>${e(s)}</li>`).join('')}</ol><details><summary>Verwendete gespeicherte Belege</summary>${readable(r.evidence)}</details><p class="muted">${e(r.note)} · ${e(r.prompt_version)}</p>`;
   }catch(err){target.textContent='Erklärung fehlgeschlagen: '+err.message;}
   finally{assistantBusy=false;}
  }
 }catch(err){toast(err.message);}finally{if(button)button.disabled=false;}
});
