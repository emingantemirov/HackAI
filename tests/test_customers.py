"""Customer master data, workflow linkage and strict evidence/lifecycle integration."""
import base64
import copy
import json
import os
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from datetime import date,timedelta
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from auditflow.server import create_service,handler_for
from auditflow.domain import InputError


class CustomerTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'db.sqlite3';self.s=create_service(self.path);self.c=self.s.customers
    def tearDown(self):
        self.s.workspace.close();self.s.workflow.close();self.s.documents.close();self.s.automation.close();self.temp.cleanup()
    def version(self,**kw):
        return self.c.create({'company':'Synthetic Customer (fiktiv)','software':'Demo payroll','software_version':'1','reviewer':'Demo',
                              'contact':'Demo reviewer','email':'demo@example.invalid',**kw})
    def workflow(self,v,**kw):
        return self.s.workflow.create({'software_version_id':v['id'],'name':'Synthetic process','mode':'offline',**kw})
    def decide(self,v,action):return self.c.transition({'id':v['id'],'action':action,'reviewer':'Demo','note':'Synthetic decision only'})
    def selection(self,kind,id):return {'entries':[{'kind':kind,'id':id}]}
    def completed(self):
        v=self.version();w=self.workflow(v);f=self.s.workflow
        d=self.s.import_document({'name':'Synthetic customer.txt','version':'1','base64':base64.b64encode(b'A complete synthetic requirement with sufficient text for traceable extraction in tests only.').decode()})
        f.attach({'id':w['id'],'document_id':d['id']});self.s.documents.process_section(d,d['sections'][0],'offline')
        self.s.store.put('document_job',{'id':'synthetic-job','document_id':d['id'],'status':'completed','mode':'offline'})
        w=self.s.store.get('workflow',w['id']);w['phase']='sources';f.save(w);f.tick(w['id'])
        for r in self.s.store.filtered('requirement','source_id',d['id']):self.s.approve('requirement',r['id'],{'reviewer':'Demo','note':'Synthetic checked','approve':True})
        for _ in range(4):w=f.tick(w['id'])
        self.assertEqual(w['phase'],'case_review')
        for case in w['cases']:f.edit_case({'id':w['id'],'case_id':case['id'],'expected':True,'rationale':'Synthetic checked observation'})
        w=f.release({'id':w['id'],'reviewer':'Demo','note':'Synthetic checked','acknowledged':True})
        w=f.manual_delivery({'id':w['id'],'reviewer':'Demo','note':'Synthetic handed over'})
        w=f.import_results({'id':w['id'],'data':{'workflow_id':w['id'],'package_hash':w['package_hash'],'records':[{'case_id':c['id'],'value':True} for c in w['cases']]}})
        self.assertFalse(self.c.gate(v)['ok'])
        w=f.close_workflow({'id':w['id'],'decision':'accepted','reviewer':'Demo','signature':'Demo','note':'Synthetic final check','acknowledged':True})
        return v,w,d

    def test_new_database_has_no_invented_customer_or_approval(self):
        self.assertEqual(self.c.state()['versions'],[]);self.assertEqual(self.c.state()['manufacturers'],[])
    def test_create_normalized_duplicates_and_multiple_versions(self):
        v=self.version()
        with self.assertRaises(InputError):self.version(company='  synthetic   customer (fiktiv) ',software='DEMO PAYROLL')
        second=self.version(software_version='2');self.assertEqual(second['manufacturer_id'],v['manufacturer_id']);self.assertEqual(len(self.c.state()['manufacturers']),1)
    def test_select_version_prefills_server_side_and_keeps_frozen_contact(self):
        v=self.version();w=self.workflow(v,company='spoofed',software='wrong',software_version='99')
        self.assertEqual(w['customer']['company'],'Synthetic Customer (fiktiv)');self.assertEqual(w['customer']['software_version'],'1')
        self.c.update({'id':v['manufacturer_id'],'company':'Renamed','contact':'New','email':'new@example.invalid','reviewer':'Demo','note':'Updated contact'})
        self.assertEqual(self.s.store.get('workflow',w['id'])['customer']['email'],'demo@example.invalid')
        new=self.workflow(v);self.assertEqual(new['customer']['email'],'new@example.invalid');self.assertEqual(new['customer']['company'],'Renamed')
    def test_free_entry_registers_once_without_overwriting_contact(self):
        body={'name':'Synthetic','company':'Example','software':'Demo','software_version':'1','contact':'First','email':'first@example.invalid'}
        w=self.s.workflow.create(body);other=self.s.workflow.create({**body,'contact':'Second','email':'second@example.invalid'})
        self.assertEqual(w['software_version_id'],other['software_version_id']);self.assertEqual(len(self.c.state()['versions']),1)
        self.assertEqual(self.c.state()['manufacturers'][0]['email'],'first@example.invalid')
    def test_migration_is_idempotent_no_approval_and_no_reseed_after_purge(self):
        v=self.version();w=self.workflow(v)
        old=self.s.store.get('workflow',w['id']);old.pop('manufacturer_id');old.pop('software_version_id');self.s.store.put('workflow',old)
        self.c.migrate();self.c.migrate();self.assertEqual(len(self.c.state()['versions']),1)
        self.assertEqual(self.s.store.get('workflow',w['id'])['software_version_id'],v['id']);self.assertEqual(self.c.state()['versions'][0]['status'],'neu')
        batch=self.s.workspace.trash(self.selection('manufacturer',v['manufacturer_id']));self.s.workspace.purge({**self.selection('trash_batch',batch['batch_id']),'confirmation':'DELETE'})
        self.c.migrate();self.assertEqual(self.c.state()['versions'],[])
    def test_actual_conveyor_evidence_and_human_final_signoff_required(self):
        v,w,d=self.completed();self.assertTrue(self.c.gate(v)['ok']);self.decide(v,'start');approved=self.decide(v,'approve')
        self.assertEqual(approved['status'],'freigegeben');self.assertEqual(approved['history'][-1]['package_hash'],w['package_hash'])
        self.assertEqual(approved['history'][-1]['final_review']['decision'],'accepted')
    def test_approval_without_results_and_impossible_transitions_blocked(self):
        v=self.version()
        with self.assertRaises(InputError):self.decide(v,'approve')
        self.decide(v,'start')
        with self.assertRaises(InputError):self.decide(v,'approve')
        self.assertEqual(self.decide(v,'reject')['status'],'abgelehnt');self.assertEqual(self.decide(v,'reopen')['status'],'in_pruefung')
    def test_new_started_workflow_does_not_reuse_old_pass_or_accept_unclear(self):
        v,w,d=self.completed();self.decide(v,'start');self.decide(v,'approve')
        new=self.workflow(v);self.assertEqual(self.c.view(v)['status'],'neu') # raw unsaved v remains a value, not live state
        self.assertEqual(self.c.state()['versions'][0]['status'],'freigegeben') # intake alone is not a started audit
        new['phase']='results';new['cases']=copy.deepcopy(w['cases']);new['result']={'rows':[],'counts':{'pass':0,'not_assessable':2,'fail':0}}
        self.s.store.put('workflow',new)
        self.assertFalse(self.c.gate(v)['ok']);self.assertEqual(self.c.state()['versions'][0]['status'],'erneut_pruefen')
    def test_changed_requirements_invalidate_customer_evidence_without_worker_tick(self):
        v,w,d=self.completed();self.decide(v,'start');self.decide(v,'approve');r=w['requirement_snapshot'][0]
        self.s.documents.revise({'id':r['id'],'criterion':'Synthetic changed requirement requires fresh human review.'})
        self.assertFalse(self.c.gate(v)['ok']);self.assertEqual(self.c.state()['versions'][0]['status'],'erneut_pruefen')
    def test_confirmed_rule_date_requires_recheck_preserves_decision(self):
        v,w,d=self.completed();self.decide(v,'start');self.decide(v,'approve')
        stored=self.s.store.get('software_version',v['id']);stored['history'][-1]['at']=(date.today()-timedelta(days=2)).isoformat()+'T00:00:00Z';self.s.store.put('software_version',stored)
        self.c.reminder({'title':'Synthetic update','effective_date':date.today().isoformat(),'source_note':'Synthetic document 2 §1','version_ids':[v['id']],'reviewer':'Demo'})
        view=self.c.state()['versions'][0];self.assertEqual(view['status'],'erneut_pruefen');self.assertEqual(view['stored_status'],'freigegeben')
        with self.assertRaises(InputError):self.c.reminder({'title':'Bad','effective_date':'2026-02-30','source_note':'Synthetic','version_ids':[v['id']],'reviewer':'Demo'})
    def test_submission_bytes_metadata_review_and_hidden_blocks_release(self):
        v,w,d=self.completed();self.decide(v,'start');s=self.c.submit({'version_id':v['id'],'name':'Synthetic.txt','base64':base64.b64encode(b'Synthetic evidence').decode(),'reviewer':'Demo'})
        self.assertNotIn('data_base64',json.dumps(self.c.state()));self.assertNotIn('data_base64',s);self.assertEqual(self.c.download(s['id'])[0],b'Synthetic evidence')
        self.assertFalse(self.c.gate(v)['ok']);self.c.review_submission({'id':s['id'],'reviewer':'Demo','note':'Synthetic checked','approve':False});self.assertFalse(self.c.gate(v)['ok'])
        self.c.review_submission({'id':s['id'],'reviewer':'Demo','note':'Synthetic checked','approve':True});self.assertTrue(self.c.gate(v)['ok'])
        self.s.workspace.hide({**self.selection('submission',s['id']),'hidden':True});self.assertFalse(self.c.gate(v)['ok'])
        report=self.s.workspace.export_report(self.selection('submission',s['id']));self.assertNotIn('data_base64',json.dumps(report))
    def test_customer_hide_trash_restore_purge_preserves_shared_sources(self):
        v,w,d=self.completed();m=v['manufacturer_id'];selection=self.selection('manufacturer',m)
        s=self.c.submit({'version_id':v['id'],'name':'Synthetic.txt','base64':'U3ludGhldGlj','reviewer':'Demo'})
        self.s.workspace.hide({**selection,'hidden':True});self.assertTrue(self.s.store.get('workflow',w['id'])['hidden'])
        with self.assertRaises(InputError):self.workflow(v)
        self.s.workspace.hide({**selection,'hidden':False});self.assertFalse(self.s.store.get('workflow',w['id'])['hidden'])
        batch=self.s.workspace.trash(selection);self.assertEqual(self.c.state()['versions'],[])
        with self.assertRaises(InputError):self.c.download(s['id'])
        self.s.workspace.restore_batch(self.selection('trash_batch',batch['batch_id']));self.assertEqual(len(self.c.state()['versions']),1)
        batch=self.s.workspace.trash(selection);self.s.workspace.purge({**self.selection('trash_batch',batch['batch_id']),'confirmation':'DELETE'})
        for kind,id in [('workflow',w['id']),('manufacturer',m),('software_version',v['id']),('submission',s['id'])]:
            with self.assertRaises(KeyError):self.s.store.get(kind,id)
        self.assertEqual(self.s.store.get('document',d['id'])['id'],d['id'])
    def test_source_deletion_cannot_delete_customer_master_data(self):
        v,w,d=self.completed();self.s.workspace.trash(self.selection('document',d['id']))
        self.assertEqual(len(self.c.state()['versions']),1);self.assertFalse(self.c.gate(v)['ok'])
    def test_bad_contacts_files_and_reminders_are_rejected(self):
        for changes in [{'email':'a\r\nBcc:a@b.de'},{'software_version':''},{'reviewer':''}]:
            with self.assertRaises(InputError):self.version(**changes)
        self.assertFalse(self.c.state()['versions']);v=self.version()
        for changes in [{'name':'bad.exe','base64':'QQ=='},{'name':'demo.txt','base64':'??'},{'name':'demo.txt','base64':''}]:
            with self.assertRaises(InputError):self.c.submit({'version_id':v['id'],'reviewer':'Demo',**changes})
        with self.assertRaises(InputError):self.c.review_submission({'id':'x','reviewer':'Demo','note':'Check','approve':'yes'})
        with self.assertRaises(InputError):self.c.submit({'version_id':v['id'],'name':'bad\r\nInjected.txt','base64':'QQ==','reviewer':'Demo'})
    def test_child_restore_requires_parent_and_shared_reminders_preserve_other_versions(self):
        v=self.version();other=self.version(software_version='2');workspace=self.s.workspace
        reminder=self.c.reminder({'title':'Synthetic shared update','source_note':'Synthetic §1','reviewer':'Demo','effective_date':'2099-01-01','version_ids':[v['id'],other['id']]})
        child=workspace.trash(self.selection('software_version',v['id']))
        self.assertFalse(self.s.store.get('customer_reminder',reminder['id']).get('trashed_at'))
        parent=workspace.trash(self.selection('manufacturer',v['manufacturer_id']))
        with self.assertRaises(InputError):workspace.restore_batch(self.selection('trash_batch',child['batch_id']))
        workspace.restore_batch(self.selection('trash_batch',parent['batch_id']));workspace.restore_batch(self.selection('trash_batch',child['batch_id']))
        self.assertEqual(len(self.c.state()['versions']),2)
    def test_http_auth_routes_and_asset(self):
        with patch.dict(os.environ,{'AUDITFLOW_ACCESS_TOKEN':'synthetic-customer-token'}):
            server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.s));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
            def call(path,body=None,auth=True):
                headers={'Authorization':'Bearer synthetic-customer-token'} if auth else {}
                if body is not None:headers['Content-Type']='application/json'
                return urllib.request.urlopen(urllib.request.Request(base+path,headers=headers,data=json.dumps(body).encode() if body is not None else None))
            try:
                with self.assertRaises(urllib.error.HTTPError) as err:call('/api/customers',auth=False)
                self.assertEqual(err.exception.code,401);err.exception.close()
                with call('/api/customers/create',{'company':'Synthetic','software':'Demo','software_version':'1','reviewer':'Demo'}) as r:v=json.load(r)
                with call('/api/customers') as r:self.assertEqual(json.load(r)['versions'][0]['id'],v['id'])
                with call('/api/customers/submit',{'version_id':v['id'],'name':'Überblick Prüfung.txt','base64':'U3ludGhldGlj','reviewer':'Demo'}) as r:s=json.load(r)
                with call('/api/customers/submissions/'+s['id']) as r:
                    self.assertIn("filename*=UTF-8''%C3%9Cberblick",r.headers['Content-Disposition']);self.assertEqual(r.read(),b'Synthetic')
                with call('/customers.js') as r:self.assertIn('function customersPage()',r.read().decode())
                with call('/api/state') as r:self.assertIn('customers',json.load(r))
            finally:server.shutdown();server.server_close();thread.join()
