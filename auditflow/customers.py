"""Customer/software records adapted from feat/dokumente-versionen-8094.

Uses the current conveyor's frozen customer snapshots and strict final gate. A stored
decision is a prototype process record, never official certification or authenticated identity.
"""
import base64
import copy
import hashlib
import re
from datetime import date
from uuid import uuid4
from .domain import InputError
from .store import now
from .workflow import text

STATUSES=['neu','in_pruefung','freigegeben','abgelehnt','erneut_pruefen']
MIME={'pdf':'application/pdf','docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','txt':'text/plain; charset=utf-8'}


def key(value):return re.sub(r'\s+',' ',value).strip().casefold()


class Customers:
    def __init__(self,service):
        self.service=service;self.store=service.store
        self.migrate()

    def active(self,kind,id):
        item=self.store.get(kind,id)
        if item.get('trashed_at') or item.get('hidden'):raise InputError('Eintrag ist ausgeblendet oder im Papierkorb.')
        return item

    def contact(self,body,required=False):
        contact=text(body.get('contact',''),'Ansprechpartner',200,required)
        email=text(body.get('email',''),'E-Mail',254,required)
        if email and not re.fullmatch(r'[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+',email):raise InputError('Gültige Kunden-E-Mail erforderlich.')
        return {'contact':contact,'email':email}

    def _ensure(self,company,software,version,contact=None):
        """Reuse known records; never resurrect archived ones or overwrite a contact on import."""
        company=text(company,'Unternehmen');software=text(software,'Software');version=text(version,'Softwareversion',100)
        m=next((m for m in self.store.list('manufacturer') if key(m['name'])==key(company)),None)
        if m:self.active('manufacturer',m['id'])
        else:
            m={'id':str(uuid4()),'name':company,'created_at':now(),**(contact or {'contact':'','email':''})}
            self.store.put('manufacturer',m)
        v=next((v for v in self.store.list('software_version') if v['manufacturer_id']==m['id'] and key(v['software'])==key(software) and key(v['version'])==key(version)),None)
        if v:self.active('software_version',v['id'])
        else:
            v={'id':str(uuid4()),'manufacturer_id':m['id'],'software':software,'version':version,'status':'neu','created_at':now(),'history':[]}
            self.store.put('software_version',v)
        return m,v

    def migrate(self):
        """Add links to legacy workflows/projects. Their snapshots and approvals stay unchanged."""
        with self.store.lock:
            for kind in ['workflow','auto_project']:
                for w in self.store.list(kind):
                    if w.get('software_version_id') or w.get('trashed_at') or w.get('hidden'):continue
                    c=w.get('customer') if kind=='workflow' else {'company':w.get('manufacturer'),'software':w.get('software'),'software_version':w.get('software_version')}
                    if not c or not all(isinstance(c.get(k),str) and c[k].strip() for k in ['company','software','software_version']):continue
                    try:m,v=self._ensure(c['company'],c['software'],c['software_version'],{'contact':c.get('contact',''),'email':c.get('email','')})
                    except InputError:continue
                    w.update(manufacturer_id=m['id'],software_version_id=v['id']);self.store.put(kind,w)

    def create(self,body):
        by=text(body.get('reviewer',''),'Dein Name',100);contact=self.contact(body)
        with self.store.lock:
            if body.get('manufacturer_id'):company=self.active('manufacturer',body['manufacturer_id'])['name']
            else:company=text(body.get('company',''),'Unternehmen')
            matches=[v for v in self.store.list('software_version') if key(v['software'])==key(text(body.get('software',''),'Software')) and key(v['version'])==key(text(body.get('software_version',''),'Softwareversion',100))]
            makers={m['id'] for m in self.store.list('manufacturer') if key(m['name'])==key(company)}
            if any(v['manufacturer_id'] in makers for v in matches):raise InputError('Diese Softwareversion existiert bereits. Ggf. im Papierkorb wiederherstellen.')
            m,v=self._ensure(company,body['software'],body['software_version'],contact)
            self.store.event('customer_version_created',{'manufacturer_id':m['id'],'version_id':v['id'],'reviewer':by})
            return self.view(v)

    def update(self,body):
        by=text(body.get('reviewer',''),'Dein Name',100);note=text(body.get('note',''),'Begründung',2000)
        contact=self.contact(body);name=text(body.get('company',''),'Unternehmen')
        with self.store.lock:
            m=self.active('manufacturer',body['id'])
            if any(x['id']!=m['id'] and key(x['name'])==key(name) for x in self.store.list('manufacturer')):raise InputError('Dieser Kundenname existiert bereits.')
            m.update(name=name,**contact);self.store.put('manufacturer',m)
            self.store.event('customer_updated',{'manufacturer_id':m['id'],'reviewer':by,'note':note})
            return m

    def workflow_customer(self,body):
        """Selected version is resolved server-side; editable recipient fields form a frozen snapshot."""
        with self.store.lock:
            if body.get('software_version_id'):
                v=self.active('software_version',body['software_version_id']);m=self.active('manufacturer',v['manufacturer_id'])
            else:
                m,v=self._ensure(body.get('company',''),body.get('software',''),body.get('software_version',''),self.contact(body,True))
            contact=self.contact({'contact':body.get('contact',m.get('contact','')),'email':body.get('email',m.get('email',''))},True)
            return {'manufacturer_id':m['id'],'software_version_id':v['id'],'customer':{'company':m['name'],'software':v['software'],'software_version':v['version'],**contact}}

    def _workflows(self,v):
        return [w for w in self.store.list('workflow') if w.get('software_version_id')==v['id'] and not w.get('trashed_at')]

    def gate(self,v):
        active=[w for w in self._workflows(v) if not w.get('hidden')]
        # The newest started process is authoritative; an old pass never masks new failures.
        started=sorted([w for w in active if w['phase']!='intake'],key=lambda w:(w.get('created_at',''),w['id']))
        w=started[-1] if started else None;result=(w or {}).get('result') or {};counts=result.get('counts') or {}
        rows=result.get('rows') or [];cases=(w or {}).get('cases') or []
        complete=bool(cases and len(rows)==len(cases) and len({r.get('case_id') for r in rows})==len(cases)
                      and {r.get('case_id') for r in rows}=={c['id'] for c in cases} and all(r.get('status')=='pass' for r in rows)
                      and counts.get('pass')==len(cases) and not counts.get('fail') and not counts.get('not_assessable'))
        final=(w or {}).get('final_review') or {}
        try:current=bool(w and self.service.workflow.current_basis(w)==w.get('basis_hash'))
        except (KeyError,InputError):current=False
        pending=[s for s in self.store.list('submission') if s['version_id']==v['id'] and not s.get('trashed_at') and (s.get('hidden') or s['status']!='approved')]
        items=[{'label':'Herstellerergebnisse im aktuellen Vorgang vorhanden','ok':bool(result)},
               {'label':'Alle Ergebnisse vollständig und bestanden','ok':complete},
               {'label':'Vorgang fachlich positiv abgeschlossen','ok':bool(w and w['phase']=='closed' and final.get('decision')=='accepted')},
               {'label':'Freigegebene Prüfgrundlage weiterhin aktuell','ok':current},
               {'label':'Alle Einreichungen freigegeben','ok':not pending}]
        return {'ok':all(i['ok'] for i in items),'items':items,'workflow_id':w['id'] if w else None,'counts':counts,
                'basis_hash':(w or {}).get('basis_hash'),'package_hash':(w or {}).get('package_hash'),'result_hash':result.get('hash'),
                'final_review':copy.deepcopy(final)}

    def _reminders(self,v):
        today=date.today().isoformat()
        approvals=[h for h in v.get('history',[]) if h['action']=='approve'];approved=max((h['at'][:10] for h in approvals),default='')
        return [r for r in self.store.list('customer_reminder') if not r.get('trashed_at') and v['id'] in r['version_ids'] and r['effective_date']<=today and approved<r['effective_date']]

    def view(self,v):
        m=self.store.get('manufacturer',v['manufacturer_id']);gate=self.gate(v);status=v['status'];recheck=[]
        if status=='freigegeben':
            approval=next((h for h in reversed(v['history']) if h['action']=='approve'),{})
            if self._reminders(v):recheck.append('Bestätigte Regeländerung ist wirksam.')
            if not gate['ok'] or any(approval.get(k)!=gate.get(k) for k in ['workflow_id','package_hash','result_hash','basis_hash']):recheck.append('Aktueller Nachweis fehlt oder wurde geändert.')
            if recheck:status='erneut_pruefen'
        return {**v,'title':m['name']+' · '+v['software']+' '+v['version'],'manufacturer_name':m['name'],'stored_status':v['status'],
                'status':status,'gate':gate,'recheck':recheck,'workflows':[{'id':w['id'],'name':w['name'],'phase':w['phase'],'hidden':w.get('hidden',False)} for w in self._workflows(v)]}

    def transition(self,body):
        action=body.get('action');by=text(body.get('reviewer',''),'Dein Name',100);note=text(body.get('note',''),'Begründung',2000)
        transitions={'start':(['neu','erneut_pruefen'],'in_pruefung'),'approve':(['in_pruefung'],'freigegeben'),'reject':(['in_pruefung'],'abgelehnt'),'reopen':(['abgelehnt'],'in_pruefung')}
        if action not in transitions:raise InputError('Unbekannte Entscheidung.')
        with self.store.lock:
            v=self.active('software_version',body['id']);self.active('manufacturer',v['manufacturer_id']);view=self.view(v)
            allowed,target=transitions[action]
            if view['status'] not in allowed:raise InputError('Entscheidung im aktuellen Status nicht möglich.')
            gate=self.gate(v)
            if action=='approve' and not gate['ok']:raise InputError('Freigabe blockiert: '+', '.join(i['label'] for i in gate['items'] if not i['ok']))
            entry={'at':now(),'action':action,'from':view['status'],'to':target,'reviewer':by,'note':note}
            if action=='approve':entry.update({k:copy.deepcopy(gate[k]) for k in ['workflow_id','package_hash','result_hash','basis_hash','final_review']})
            v['status']=target;v['history'].append(entry);self.store.put('software_version',v)
            self.store.event('customer_decision',{'version_id':v['id'],**entry});return self.view(v)

    def submit(self,body):
        by=text(body.get('reviewer',''),'Dein Name',100);name=text(body.get('name',''),'Dateiname',200);suffix=name.lower().rsplit('.',1)[-1]
        if re.search(r'[\x00-\x1f\x7f/\\]',name):raise InputError('Ungültiger Dateiname.')
        if suffix not in MIME:raise InputError('PDF, DOCX oder TXT auswählen.')
        try:raw=base64.b64decode(body.get('base64') or '',validate=True)
        except (ValueError,TypeError):raise InputError('Ungültiger Datei-Upload.') from None
        if not raw or len(raw)>5_000_000:raise InputError('Leere Datei oder mehr als 5 MB.')
        with self.store.lock:
            v=self.active('software_version',body['version_id']);self.active('manufacturer',v['manufacturer_id'])
            s={'id':str(uuid4()),'version_id':v['id'],'name':name,'mime':MIME[suffix],'size':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),
               'data_base64':base64.b64encode(raw).decode(),'status':'pending','created_at':now(),'uploaded_by':by,'decisions':[]}
            self.store.put('submission',s);self.store.event('customer_submission',{'id':s['id'],'version_id':v['id'],'reviewer':by});return self.meta(s)

    @staticmethod
    def meta(s):return {k:v for k,v in s.items() if k!='data_base64'}

    def review_submission(self,body):
        by=text(body.get('reviewer',''),'Dein Name',100);note=text(body.get('note',''),'Begründung',2000)
        if type(body.get('approve')) is not bool:raise InputError('Freigabe muss wahr/falsch sein.')
        with self.store.lock:
            s=self.active('submission',body['id']);v=self.active('software_version',s['version_id']);self.active('manufacturer',v['manufacturer_id'])
            s['status']='approved' if body['approve'] else 'rejected';s['decisions'].append({'at':now(),'reviewer':by,'note':note,'approve':body['approve']})
            self.store.put('submission',s);self.store.event('customer_submission_review',{'id':s['id'],'version_id':v['id'],'reviewer':by,'note':note});return self.meta(s)

    def download(self,id):
        s=self.active('submission',id);v=self.active('software_version',s['version_id']);self.active('manufacturer',v['manufacturer_id'])
        return base64.b64decode(s['data_base64']),s['mime'],s['name']

    def reminder(self,body):
        by=text(body.get('reviewer',''),'Dein Name',100);title=text(body.get('title',''),'Titel');source=text(body.get('source_note',''),'Quelle',2000)
        value=body.get('effective_date','')
        try:
            if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):raise ValueError()
            date.fromisoformat(value)
        except ValueError:raise InputError('Gültiges Datum im Format YYYY-MM-DD erforderlich.') from None
        ids=body.get('version_ids')
        if not isinstance(ids,list) or not 1<=len(ids)<=500 or any(not isinstance(x,str) for x in ids) or len(ids)!=len(set(ids)):raise InputError('Betroffene Softwareversionen auswählen.')
        with self.store.lock:
            for id in ids:self.active('software_version',id)
            r={'id':str(uuid4()),'title':title,'source_note':source,'effective_date':value,'version_ids':ids,'reviewer':by,'created_at':now()}
            self.store.put('customer_reminder',r);self.store.event('customer_reminder',{'id':r['id'],'version_ids':ids,'reviewer':by});return r

    def state(self):
        return {'manufacturers':[m for m in self.store.list('manufacturer') if not m.get('trashed_at')],
                'versions':[self.view(v) for v in self.store.list('software_version') if not v.get('trashed_at')],
                'submissions':[self.meta(s) for s in self.store.list('submission') if not s.get('trashed_at')],
                'reminders':[r for r in self.store.list('customer_reminder') if not r.get('trashed_at')]}
