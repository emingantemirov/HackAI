"""Persistent automation for a bounded synthetic rule-template package.
No fabricated human approvals, target connectivity, general legal compiler or certification.
"""
import copy
import csv
import hashlib
import io
import json
import threading
import time
from calendar import monthrange
from datetime import date,timedelta
from uuid import uuid4
from .domain import InputError,validate_scenario,add_months
from .store import now
from .automation_reference import expectation
from .automation_target import execute

VERSION='automation-0.2'
RULE_TYPES={'C1':'certificates','C2':'calendar_gap','C4':'minimum_days'}
LIMIT=4000


def fingerprint(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def integer(v,low,high,label):
    if type(v) is not int or not low<=v<=high:raise InputError(f'{label}: ganze Zahl zwischen {low} und {high} erforderlich.')
    return v


def validate_package(rules):
    if not isinstance(rules,dict) or set(rules)!=set(RULE_TYPES):raise InputError('Unterstützte Regelfamilien: C1, C2 und C4.')
    for key,rule_type in RULE_TYPES.items():
        r=rules[key]
        if not isinstance(r,dict) or r.get('type')!=rule_type:raise InputError('Nicht implementierter Regeltyp: '+key)
        if not isinstance(r.get('params'),dict):raise InputError('Regelparameter fehlen.')
        deps=r.get('depends_on',[])
        if not isinstance(deps,list) or any(d not in RULE_TYPES or d==key for d in deps):raise InputError('Ungültige Regelabhängigkeit.')
    p=rules['C1']['params']
    if set(p)!={'require_current','require_prior'} or any(type(v) is not bool for v in p.values()):raise InputError('C1 benötigt zwei boolesche Nachweisparameter.')
    p=rules['C2']['params']
    if set(p)!={'months','exact_boundary'}:raise InputError('Ungültige C2-Parameter.')
    integer(p['months'],1,12,'Kalendermonate')
    if p['exact_boundary'] not in ['unresolved','inclusive','exclusive']:raise InputError('Unbekannte Grenzkonvention.')
    p=rules['C4']['params']
    if set(p)!={'days'}:raise InputError('Ungültige C4-Parameter.')
    integer(p['days'],1,365,'Mindesttage')
    # Reject cycles in explicit impact dependencies.
    def visit(key,path):
        if key in path:raise InputError('Zyklische Regelabhängigkeit.')
        for d in rules[key].get('depends_on',[]):visit(d,path+[key])
    for key in rules:visit(key,[])
    return rules


def default_package():
    rules={
      'C1':{'type':'certificates','title':'Nachweise','params':{'require_current':True,'require_prior':True},'depends_on':[]},
      'C2':{'type':'calendar_gap','title':'Kalendermonatsgrenze','params':{'months':6,'exact_boundary':'unresolved'},'depends_on':[]},
      'C4':{'type':'minimum_days','title':'Mindesttage im Systembestand','params':{'days':30},'depends_on':[]}}
    return {'id':'AUTO-PACKAGE-1','name':'Synthetisches DBVO-Paket · Version 1','version':1,'parent_id':None,
            'scope':'synthetic_demo','rules':rules,'rules_hash':fingerprint(rules),'status':'pending',
            'source_note':'Selbst verfasste Testvorlagen. Keine amtliche Regelversion oder fachliche Zertifizierung.',
            'created_at':now(),'template_version':'profiles-v1','oracle_version':'analytical-v1'}


def generate_case(index,suite_id,package):
    """Nine test families, each with a distinct reproducible synthetic person profile.
    Demographic values are test metadata, not extra legal decision criteria.
    """
    family=index%9
    anchor=date(2026+(index//2700),1+(index//9)%12,11)
    total=[35,35,35,29,30,31,35,None,35][family]
    certified_current=family!=1;certified_prior=family!=2
    current_days=10
    end=None if total is None else anchor+timedelta(days=current_days-1)
    prior_days=25 if total is None else total-current_days
    gap_months=8 if family==6 else 6 if family==8 else 1
    if family==8:
        prior_end=add_months(anchor,-gap_months)
    else:
        prior_end=add_months(anchor,-gap_months)-timedelta(days=3)
    prior_begin=prior_end-timedelta(days=prior_days-1)
    scenario={'current':{'begin':str(anchor),'end':str(end) if end else None,'certified':certified_current},
              'prior':[{'begin':str(prior_begin),'end':str(prior_end),'certified':certified_prior}],
              'report_date':str(anchor),'insurance':'synthetic-demo'}
    validate_scenario(scenario)
    id=f'{suite_id}:{index+1:05}'
    profile={'id':'PROFILE:'+id,'synthetic':True,'employee_label':f'Testperson {index+1:05}',
             'employment_type':['full_time','part_time','fixed_term'][index%3],
             'monthly_gross_eur':str(1800+(index*37)%6200)+'.00','weekly_hours':[20,30,35,40][index%4],
             'scenario':scenario,'note':'Einkommen/Arbeitszeit sind hier Metadaten; keine Lohnberechnung.'}
    facts={'current_begin':str(anchor),'prior_end':str(prior_end),'current_certified':certified_current,
           'prior_certified':certified_prior,'total_certified_days':None if end is None else current_days+(prior_days if certified_prior else 0)}
    target=['C1','C1','C1','C4','C4','C4','C2','C4','C2'][family]
    return {'id':id,'suite_id':suite_id,'index':index,'name':f'{index+1:05} · '+['Normalfall','Aktueller Nachweis fehlt','Früherer Nachweis fehlt','29 Tage','30 Tage','31 Tage','Große Lücke','Offenes Ende','Exakte Kalendergrenze'][family],
            'profile':profile,'facts':facts,'requirement_ids':[target],'core_regression':index%50==0,
            'expectation':expectation(facts,package['rules']),'template_hash':fingerprint({'scenario':scenario,'facts':facts}),
            'expectation_review':'derived_from_authorized_template','package_id':package['id']}


class Automation:
    def __init__(self,store):
        self.store=store;self.stop=threading.Event();self.wake=threading.Event();self.thread=None;self.guard=threading.Lock()
        if not store.list('auto_package'):store.put('auto_package',default_package())
        # Running work is resumable: committed result IDs and cursor share one transaction.
        for job in store.list('auto_job'):
            if job['status']=='running':
                job['status']='queued';job['recovery_note']='Nach Neustart fortgesetzt.';store.put('auto_job',job)

    def close(self):
        self.stop.set();self.wake.set()
        if self.thread and self.thread.is_alive():self.thread.join(5)

    def start(self):
        with self.guard:
            if self.thread and self.thread.is_alive():self.wake.set();return
            self.thread=threading.Thread(target=self._worker,name='auditflow-automation',daemon=True)
            self.thread.start();self.wake.set()

    def state(self):
        jobs=[j for j in self.store.list('auto_job') if not j.get('trashed_at')]
        for job in jobs:
            if job.get('plan'):job['plan']={k:v for k,v in job['plan'].items() if k!='selected'}
        return {'packages':self.store.list('auto_package'),'projects':self.store.list('auto_project'),
                'suites':[s for s in self.store.list('auto_suite') if not s.get('trashed_at')],'jobs':list(reversed(jobs)),
                'limit':LIMIT,'version':VERSION,'scope':'synthetic_demo'}

    def package_version(self,body):
        parent=self.store.get('auto_package',body['parent_id']);rules=copy.deepcopy(body['rules']);validate_package(rules)
        if fingerprint(rules)==parent['rules_hash']:raise InputError('Keine Regeländerung vorhanden.')
        if not isinstance(body.get('name'),str) or not body['name'].strip():raise InputError('Versionsname fehlt.')
        p={**copy.deepcopy(parent),'id':str(uuid4()),'name':body['name'].strip()[:150],'version':max(p['version'] for p in self.store.list('auto_package'))+1,
           'parent_id':parent['id'],'rules':rules,'rules_hash':fingerprint(rules),'status':'pending','created_at':now()}
        for k in ['reviewer','review_note','reviewed_at']:p.pop(k,None)
        self.store.put('auto_package',p);self.store.event('auto_package_draft',{'id':p['id'],'parent':parent['id']});return p

    def approve_package(self,body):
        p=self.store.get('auto_package',body['package_id'])
        if p['status']=='approved':return p
        for field in ['reviewer','note']:
            if not isinstance(body.get(field),str) or not body[field].strip():raise InputError('Prüfer und Freigabebegründung erforderlich.')
        if body.get('acknowledge_demo') is not True:raise InputError('Synthetischen Demoumfang ausdrücklich bestätigen.')
        validate_package(p['rules']);p.update(status='approved',reviewer=body['reviewer'].strip()[:100],review_note=body['note'].strip()[:2000],reviewed_at=now())
        self.store.put('auto_package',p);self.store.event('auto_package_review',{'id':p['id'],'reviewer':p['reviewer'],'rules_hash':p['rules_hash']})
        if p.get('parent_id'):
            self.store.put('auto_change',{'id':'change:'+p['id'],'package_id':p['id'],'processed_suites':[],'created_at':now()})
            self.start()
        return p

    def create_project(self,body):
        fields=['manufacturer','software','software_version']
        if any(not isinstance(body.get(k),str) or not body[k].strip() for k in fields):raise InputError('Hersteller, Software und Version sind erforderlich.')
        p={'id':str(uuid4()),**{k:body[k].strip()[:160] for k in fields},'created_at':now(),'scope':'synthetic_demo','auto_on_rule_change':body.get('auto_on_rule_change') is True}
        self.store.put('auto_project',p);return p

    def _package(self,id):
        p=self.store.get('auto_package',id)
        for rule_id in p['rules']:
            try:rule=self.store.get('requirement',rule_id)
            except KeyError:raise InputError('Demogrundlage wurde entfernt; Quelle und Anforderungen zuerst wiederherstellen.') from None
            if rule.get('hidden') or rule.get('trashed_at'):raise InputError('Demogrundlage ist ausgeblendet oder im Papierkorb.')
        if p['status']!='approved':raise InputError('Regel-/Vorlagenpaket zuerst einmalig freigeben.')
        if fingerprint(p['rules'])!=p['rules_hash']:raise InputError('Paketintegrität stimmt nicht.')
        validate_package(p['rules']);return p

    def launch(self,body):
        p=self._package(body['package_id']);project=self.store.get('auto_project',body['project_id'])
        count=integer(body.get('count',36),1,LIMIT,'Fallanzahl')
        mode=body.get('mode','simulation');behavior=body.get('behavior','healthy')
        if mode not in ['simulation','import']:raise InputError('Modus muss simulation oder import sein.')
        if behavior not in ['healthy','always_send','ignore_certificate','outdated_threshold']:raise InputError('Unbekanntes Simulationsverhalten.')
        suite={'id':str(uuid4()),'project_id':project['id'],'package_id':p['id'],'count':count,'generated':0,
               'created_at':now(),'template_version':p['template_version'],'status':'generating'}
        self.store.put('auto_suite',suite)
        return self._job(suite,p,project,mode,behavior,'full',None)

    def _job(self,suite,p,project,mode,behavior,selection,plan):
        job={'id':str(uuid4()),'suite_id':suite['id'],'package':copy.deepcopy(p),'project':copy.deepcopy(project),
             'status':'queued','phase':'generation' if suite['generated']<suite['count'] else 'execution',
             'mode':mode,'behavior':behavior,'selection':selection,'plan':plan,'cursor':0,'completed':0,
             'total':len(plan['selected']) if plan else suite['count'],'counts':{'pass':0,'fail':0,'not_assessable':0,'technical_error':0},
             'cancel_requested':False,'created_at':now(),'version':VERSION,'assessment_scope':'synthetic_demo',
             'decision':'Keine Zertifizierungsentscheidung; vollständiger Automatiklauf nur im angegebenen Umfang.'}
        self.store.put('auto_job',job);self.store.event('auto_job_created',{'id':job['id'],'suite':suite['id'],'selection':selection})
        self.start();return job

    def cases(self,suite_id,offset=0,limit=25):
        return self.store.page('auto_case',offset,limit,where_key='suite_id',where_value=suite_id)

    def detail(self,job_id):return self.store.get('auto_job',job_id)

    def results(self,job_id,offset=0,limit=25):
        return self.store.page('auto_result',offset,limit,where_key='job_id',where_value=job_id)

    def cancel(self,id):
        with self.store.lock:
            job=self.detail(id)
            if job['status'] in ['queued','running','waiting_import']:
                job['cancel_requested']=True
                if job['status']!='running':job['status']='cancelled'
                self.store.put('auto_job',job)
        self.wake.set();return job

    def resume(self,id):
        with self.store.lock:
            job=self.detail(id)
            if job['status'] not in ['cancelled','failed']:raise InputError('Nur abgebrochene oder fehlgeschlagene Läufe können fortgesetzt werden.')
            job.update(status='queued',cancel_requested=False)
            for key in ['finished_at','error']:job.pop(key,None)
            self.store.put('auto_job',job)
        self.start();return job

    def impact(self,body):
        suite=self.store.get('auto_suite',body['suite_id'])
        if suite['status']!='ready':raise InputError('Testsuite ist noch nicht vollständig erzeugt.')
        baselines=[j for j in self.store.list('auto_job') if j['suite_id']==suite['id'] and j['status']=='completed']
        if body.get('baseline_job_id'):
            selected=self.detail(body['baseline_job_id'])
            if selected['suite_id']!=suite['id'] or selected['status']!='completed':raise InputError('Ungültiger Vergleichslauf.')
            old=selected['package']
        else:old=baselines[-1]['package'] if baselines else self.store.get('auto_package',suite['package_id'])
        new=self._package(body['package_id'])
        changed={k for k in RULE_TYPES if old['rules'][k]!=new['rules'][k]}
        if not changed:raise InputError('Keine ausführbare Regeländerung gegenüber der Suite.')
        affected=set(changed)
        while True:
            expanded=affected|{k for k,r in new['rules'].items() if set(r.get('depends_on',[]))&affected}
            if expanded==affected:break
            affected=expanded
        selected=[];total=suite['count'];all_cases=self.store.filtered('auto_case','suite_id',suite['id'])
        for c in all_cases:
            reasons=[]
            if affected.intersection(c['requirement_ids']):reasons.append('changed_or_dependent_rule')
            before=expectation(c['facts'],old['rules']);after=expectation(c['facts'],new['rules'])
            if before['message_present']!=after['message_present']:reasons.append('expected_behavior_changed')
            if c['core_regression']:reasons.append('core_regression')
            if reasons:selected.append({'case_id':c['id'],'reasons':reasons,'old_expected':before['message_present'],'new_expected':after['message_present']})
        return {'suite_id':suite['id'],'old_package_id':old['id'],'new_package_id':new['id'],'changed_rules':sorted(changed),
                'dependent_rules':sorted(affected-changed),'selected':selected,'selected_count':len(selected),'total_count':total,
                'skipped_count':total-len(selected),'note':'Vorlagenabhängigkeiten plus geänderte analytische Erwartung und Kernregression; keine allgemeine Rechtsfolgenanalyse.'}

    def rerun(self,body):
        plan=self.impact(body);suite=self.store.get('auto_suite',plan['suite_id']);p=self._package(body['package_id'])
        project=self.store.get('auto_project',suite['project_id'])
        mode=body.get('mode','simulation');behavior=body.get('behavior','outdated_threshold')
        if mode not in ['simulation','import'] or behavior not in ['healthy','always_send','ignore_certificate','outdated_threshold']:raise InputError('Ungültiger Ausführungsmodus.')
        return self._job(suite,p,project,mode,behavior,'impact',plan)

    def full_rerun(self,body):
        suite=self.store.get('auto_suite',body['suite_id'])
        if suite['status']!='ready':raise InputError('Suite wird noch erzeugt.')
        p=self._package(body['package_id']);project=self.store.get('auto_project',suite['project_id'])
        previous=[j for j in self.store.list('auto_job') if j['suite_id']==suite['id']]
        latest=previous[-1] if previous else {}
        mode=body.get('mode',latest.get('mode','simulation'))
        behavior=body.get('behavior',latest.get('behavior','healthy'))
        if mode not in ['simulation','import'] or behavior not in ['healthy','always_send','ignore_certificate','outdated_threshold']:raise InputError('Ungültiger Ausführungsmodus.')
        return self._job(suite,p,project,mode,behavior,'annual',None)

    def _dispatch_changes(self):
        for event in self.store.list('auto_change'):
            p=self.store.get('auto_package',event['package_id'])
            ancestors=set();parent=p.get('parent_id')
            while parent:
                ancestors.add(parent);parent=self.store.get('auto_package',parent).get('parent_id')
            for suite in self.store.list('auto_suite'):
                if suite['id'] in event['processed_suites'] or suite['package_id'] not in ancestors:continue
                project=self.store.get('auto_project',suite['project_id'])
                if not project.get('auto_on_rule_change') or suite['status']!='ready':continue
                previous=[j for j in self.store.list('auto_job') if j['suite_id']==suite['id']]
                # Wait for existing work, including imported results, before advancing baseline.
                if any(j['status'] in ['queued','running','waiting_import'] for j in previous):continue
                completed=[j for j in previous if j['status']=='completed']
                if completed and completed[-1]['package'].get('reviewed_at','')>p.get('reviewed_at',''):
                    event['processed_suites'].append(suite['id']);self.store.put('auto_change',event);continue
                try:
                    plan=self.impact({'suite_id':suite['id'],'package_id':p['id']})
                except InputError:
                    event['processed_suites'].append(suite['id']);self.store.put('auto_change',event);continue
                latest=previous[-1] if previous else {}
                mode=latest.get('mode','simulation');behavior=latest.get('behavior','healthy')
                job=self._job(suite,p,project,mode,behavior,'impact',plan)
                job['trigger']='approved_rule_change';self.store.put('auto_job',job)
                event['processed_suites'].append(suite['id']);self.store.put('auto_change',event)
                self.store.event('auto_change_dispatched',{'package_id':p['id'],'suite_id':suite['id'],'job_id':job['id'],'selected':job['total']})

    def import_results(self,body):
        # One complete submission per waiting job. Missing case results stay not assessable.
        with self.store.lock:
            job=self.detail(body['job_id'])
            if job['status']!='waiting_import':raise InputError('Dieser Lauf wartet nicht auf Ergebnisse.')
            records=body.get('records')
            if not isinstance(records,list) or not 1<=len(records)<=LIMIT:raise InputError('1 bis 4000 Ergebnisobjekte erforderlich.')
            allowed=set(self._ids(job));seen=set();items=[]
            for r in records:
                if not isinstance(r,dict) or r.get('case_id') not in allowed or r['case_id'] in seen:raise InputError('Unbekannte oder doppelte Testfall-ID im Ergebnisimport.')
                observed=r.get('observed')
                if not isinstance(observed,dict) or set(observed)!={'message_present'} or (observed['message_present'] is not None and type(observed['message_present']) is not bool):raise InputError('observed benötigt message_present: true, false oder null.')
                seen.add(r['case_id']);items.append(('auto_observed',{'id':job['id']+':'+r['case_id'],'job_id':job['id'],'case_id':r['case_id'],'observed':observed}))
            job.update(status='queued',phase='execution',input_hash=fingerprint(records),imported_count=len(records))
            self.store.put_many(items+[('auto_job',job)])
        self.start();return job

    def _ids(self,job):
        if job['plan']:return [x['case_id'] for x in job['plan']['selected']]
        return [f"{job['suite_id']}:{i+1:05}" for i in range(job['total'])]

    def _worker(self):
        while not self.stop.is_set():
            with self.store.lock:self._dispatch_changes()
            candidates=[j for j in self.store.list('auto_job') if j['status']=='queued' and not j.get('hidden') and not j.get('trashed_at')]
            if not candidates:self.wake.wait(.3);self.wake.clear();continue
            job=candidates[0]
            try:self._execute(job['id'])
            except Exception as e:
                with self.store.lock:

                    try:job=self.detail(job['id'])
                    except KeyError:continue
                    job.update(status='failed',error='Automatikfehler: '+type(e).__name__+': '+str(e)[:240],finished_at=now())
                    self.store.put('auto_job',job)

    def _execute(self,id):
        with self.store.lock:
            job=self.detail(id)
            if job.get('trashed_at') or job.get('hidden'):return
            if job.get('cancel_requested'):job['status']='cancelled';self.store.put('auto_job',job);return
            job['status']='running';job.setdefault('started_at',now());self.store.put('auto_job',job)
        suite=self.store.get('auto_suite',job['suite_id'])
        generation_package=self.store.get('auto_package',suite['package_id'])
        # Store each generation chunk plus progress in one transaction.
        while suite['generated']<suite['count']:
            if self.stop.is_set():return
            with self.store.lock:
                current=self.detail(id)
                if current.get('trashed_at') or current.get('hidden'):
                    current['status']='queued';self.store.put('auto_job',current);return
                if current['cancel_requested']:current['status']='cancelled';self.store.put('auto_job',current);return
                end=min(suite['generated']+100,suite['count'])
                items=[('auto_case',generate_case(i,suite['id'],generation_package)) for i in range(suite['generated'],end)]
                suite.update(generated=end,status='ready' if end==suite['count'] else 'generating')
                current.update(generated=end,phase='generation')
                self.store.put_many(items+[('auto_suite',suite),('auto_job',current)])
        with self.store.lock:
            job=self.detail(id)
            if job['mode']=='import' and not job.get('input_hash'):
                job.update(status='waiting_import',phase='waiting_import');self.store.put('auto_job',job);return
            job['phase']='execution';self.store.put('auto_job',job)
        ids=self._ids(job)
        reason_map={r['case_id']:r['reasons'] for r in job['plan']['selected']} if job['plan'] else {}
        while job['cursor']<len(ids):
            if self.stop.is_set():return
            with self.store.lock:
                current=self.detail(id)
                if current.get('trashed_at') or current.get('hidden'):
                    current['status']='queued';self.store.put('auto_job',current);return
                if current['cancel_requested']:current.update(status='cancelled',finished_at=now());self.store.put('auto_job',current);return
                job=current
                results=[]
                batch_ids=ids[job['cursor']:job['cursor']+100]
                batch_cases=self.store.get_many('auto_case',batch_ids)
                batch_actual=self.store.get_many('auto_observed',[job['id']+':'+cid for cid in batch_ids]) if job['mode']=='import' else {}
                for case_id in batch_ids:
                    c=batch_cases[case_id];expected=expectation(c['facts'],job['package']['rules'])
                    if job['mode']=='simulation':actual=execute(c['profile'],job['package']['rules'],job['behavior'])
                    else:
                        actual=batch_actual.get(job['id']+':'+case_id,{}).get('observed',{'message_present':None})
                    a=actual['message_present'];b=expected['message_present']
                    status='not_assessable' if a is None or b is None else 'pass' if a==b else 'fail'
                    reasons=reason_map.get(case_id,[]) if job['plan'] else ['full_suite']
                    result={'id':job['id']+':'+case_id,'job_id':job['id'],'case_id':case_id,'profile_id':c['profile']['id'],
                            'case_name':c['name'],'status':status,'expected':expected,'actual':actual,'selection_reasons':reasons,
                            'package_hash':job['package']['rules_hash'],'input_hash':c['template_hash'],'created_at':now()}
                    results.append(('auto_result',result));job['counts'][status]+=1
                job['cursor']+=len(results);job['completed']=job['cursor']
                self.store.put_many(results+[('auto_job',job)])
        with self.store.lock:
            job=self.detail(id);job.update(status='completed',phase='report',finished_at=now())
            self.store.put('auto_job',job);self.store.event('auto_job_complete',{'id':id,'counts':job['counts'],'package_hash':job['package']['rules_hash']})

    def export(self,id,kind):
        job=self.detail(id);ids=self._ids(job)
        if kind=='input':
            if self.store.get('auto_suite',job['suite_id'])['status']!='ready':raise InputError('Eingabepaket wird noch erzeugt.')
            cases={c['id']:c for c in self.store.filtered('auto_case','suite_id',job['suite_id'])}
            return {'job_id':id,'software':job['project'],'package':job['package'],
                    'cases':[{'case_id':cid,'profile':cases[cid]['profile']} for cid in ids],
                    'result_contract':{'records':[{'case_id':'<case_id>','observed':{'message_present':'boolean or null'}}]}}
        return {'job':job,'results':self.store.filtered('auto_result','job_id',id),
                'limitations':['Synthetische Regel-/Profilvorlagen, keine amtliche Konformitätsaussage.',
                               'Simulation ist keine angebundene Hersteller-Software.',
                               'Importierte JSON-Ergebnisse sind nicht automatisch auf Herstellerherkunft authentifiziert.',
                               'Keine Berechnung von Lohn oder Leistungsansprüchen.']}

    def _exists(self,id):
        try:self.store.get('auto_case',id);return True
        except KeyError:return False
