"""Customer conveyor gates, provenance, results, SMTP uncertainty and restart behavior."""
import base64
import copy
import json
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from auditflow.server import create_service
from auditflow.workflow import report_html,report_pdf
from auditflow.domain import InputError
from auditflow.model import ModelError


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.s=create_service(Path(self.temp.name)/'data.sqlite3');self.f=self.s.workflow
        self.no_worker=patch.object(self.f,'start');self.no_worker.start()
    def tearDown(self):
        self.no_worker.stop();self.f.close();self.s.documents.close();self.s.automation.close();self.temp.cleanup()
    def create(self,**kw):
        return self.f.create({'name':'Synthetic audit','company':'Synthetic company','contact':'Synthetic reviewer','email':'test@example.invalid',
                              'software':'Synthetic software','software_version':'1','mode':'offline',**kw})
    def source(self,w):
        d=self.s.import_document({'name':'Synthetic conveyor.txt','version':'1','base64':base64.b64encode(b'A complete synthetic requirement with a verifiable and sufficiently long source statement.').decode()})
        self.f.attach({'id':w['id'],'document_id':d['id']})
        self.s.documents.process_section(d,d['sections'][0],'offline')
        self.s.store.put('document_job',{'id':'completed-job','document_id':d['id'],'status':'completed','mode':'offline'})
        w=self.s.store.get('workflow',w['id']);w['phase']='sources';self.f.save(w);return d
    def ready_cases(self):
        w=self.create();d=self.source(w);self.f.tick(w['id'])
        for r in self.s.store.filtered('requirement','source_id',d['id']):self.s.approve('requirement',r['id'],{'reviewer':'Synthetic expert','note':'Synthetic source checked','approve':True})
        self.f.tick(w['id']);self.f.tick(w['id']);return self.f.tick(w['id'])
    def release(self,w):
        for c in w['cases']:self.f.edit_case({'id':w['id'],'case_id':c['id'],'expected':True,'rationale':'Synthetic independently specified expectation'})
        return self.f.release({'id':w['id'],'reviewer':'Synthetic expert','note':'Synthetic inputs and expectations independently checked','acknowledged':True})
    def delivered(self):
        w=self.release(self.ready_cases());return self.f.manual_delivery({'id':w['id'],'reviewer':'Synthetic operator','note':'Synthetic test handoff'})
    def import_data(self,w,values=None):
        return {'id':w['id'],'data':{'workflow_id':w['id'],'package_hash':w['package_hash'],'records':[{'case_id':c['id'],'value':v} for c,v in zip(w['cases'],values if values is not None else [True]*len(w['cases']))]}}
    def test_input_validation_and_no_empty_run(self):
        for kw in [{'email':'bad\r\nBcc:a@b.de'},{'mode':'invented'},{'auto_send':'yes'},{'company':''}]:
            with self.assertRaises(InputError):self.create(**kw)
        w=self.create()
        with self.assertRaises(InputError):self.f.begin({'id':w['id']})
        self.assertEqual(self.f.tick(w['id'])['phase'],'intake')
    def test_sources_report_and_human_gate(self):
        w=self.create();d=self.source(w);w=self.f.tick(w['id'])
        self.assertEqual(w['phase'],'requirements');self.assertEqual(len(w['reports']),1)
        self.assertEqual(self.f.tick(w['id'])['phase'],'requirements')
        self.assertFalse(w['cases'])
        r=self.s.store.get('workflow_report',w['reports'][0]);self.assertIn('Quellenabgleich',r['title'])
        self.assertEqual(r['sections'][0]['data'][0]['Fingerabdruck'],d['sha256'])
    def test_rejected_requirement_blocks_generation(self):
        w=self.create();d=self.source(w);self.f.tick(w['id']);r=self.s.store.filtered('requirement','source_id',d['id'])[0]
        self.s.approve('requirement',r['id'],{'reviewer':'Synthetic expert','note':'Needs correction','approve':False})
        self.assertEqual(self.f.tick(w['id'])['phase'],'requirements')
    def test_generation_is_resumable_and_offline_never_claims_ai(self):
        w=self.ready_cases();self.assertEqual(w['phase'],'case_review');self.assertEqual(len(w['reports']),3)
        self.assertEqual(len(w['cases']),2);self.assertTrue(all(c['expected']['value'] is None and c['generation_mode']=='offline' for c in w['cases']))
        other=create_service(Path(self.temp.name)/'data.sqlite3');self.assertEqual(other.workflow.tick(w['id'])['cases'],w['cases'])
        with self.assertRaises(InputError):self.f.release({'id':w['id'],'reviewer':'X','note':'Y','acknowledged':True})
    def test_inference_generation_validates_schema_and_null_questions(self):
        req={'id':'r','source_id':'d','section_id':'s','title':'S','criterion':'Synthetic requirement','source_excerpt':'Synthetic requirement'}
        c={'title':'Synthetic test','type':'positive','profile':{'kind':'synthetic'},'inputs':{'flag':True},'steps':['Observe result'],
           'expected':{'field':'flag','value':True,'rationale':'Synthetic independent basis'},'questions':[]}
        with patch('auditflow.workflow.Model.call',return_value=json.dumps({'cases':[c,c]})):
            cases=self.f.generate(req,'live','wid',0,0)
        self.assertEqual(cases[0]['generation_mode'],'live');self.assertEqual(cases[0]['requirement_id'],'r')
        c['expected']['value']=None
        with patch('auditflow.workflow.Model.call',return_value=json.dumps({'cases':[c,c]})):
            with self.assertRaises(ModelError):self.f.generate(req,'live','wid',0,0)
    def test_changed_requirement_invalidates_package_and_preserves_reports(self):
        w=self.release(self.ready_cases());old_reports=list(w['reports'])
        r=w['requirement_snapshot'][0];self.s.documents.revise({'id':r['id'],'criterion':'A changed synthetic criterion requiring a new human decision.'})
        with self.assertRaises(InputError):self.f.package(w['id'])
        w=self.f.tick(w['id']);self.assertEqual(w['phase'],'requirements');self.assertFalse(w['cases']);self.assertEqual(w['reports'],old_reports)
    def test_export_hides_expected_and_requires_case_release(self):
        w=self.ready_cases()
        with self.assertRaises(InputError):self.f.package(w['id'])
        w=self.release(w);p=self.f.package(w['id'])
        self.assertEqual(p['package_hash'],w['package_hash']);self.assertNotIn('expected',p['cases'][0]);self.assertNotIn('rationale',p['cases'][0]);self.assertIn('profile',p['cases'][0])
    def test_missing_and_boolean_numeric_results_not_falsely_passed(self):
        w=self.delivered();w=self.f.import_results(self.import_data(w,[1]))
        self.assertEqual(w['result']['counts'],{'pass':0,'fail':1,'not_assessable':1})
        with self.assertRaises(InputError):self.f.close_workflow({'id':w['id'],'decision':'accepted','reviewer':'X','signature':'X','note':'Checked','acknowledged':True})
        r=self.f.close_workflow({'id':w['id'],'decision':'rework','reviewer':'X','signature':'X','note':'Needs rework','acknowledged':True})
        self.assertEqual(r['phase'],'closed');self.assertEqual(r['final_review']['decision'],'rework')
    def test_wrong_package_duplicates_unknown_and_invalid_results_are_atomic(self):
        w=self.delivered();body=self.import_data(w)
        for bad in [dict(body['data'],package_hash='wrong'),dict(body['data'],records=body['data']['records']*2),dict(body['data'],records=[{'case_id':'unknown','value':True}]),dict(body['data'],records=[{'case_id':w['cases'][0]['id'],'value':{'bad':True}}])]:
            with self.assertRaises(InputError):self.f.import_results({'id':w['id'],'data':bad})
        self.assertEqual(self.s.store.get('workflow',w['id'])['phase'],'results')
    def test_positive_final_report_signature_and_immutability(self):
        w=self.delivered();w=self.f.import_results(self.import_data(w));old=w['reports'][-1]
        self.assertEqual(w['result']['counts']['pass'],2)
        with self.assertRaises(InputError):self.f.close_workflow({'id':w['id'],'decision':'accepted','reviewer':'Expert','signature':'Other','note':'Checked','acknowledged':True})
        w=self.f.close_workflow({'id':w['id'],'decision':'accepted','reviewer':'Expert','signature':'Expert','note':'Checked','acknowledged':True})
        self.assertEqual(w['phase'],'closed');self.assertNotEqual(old,w['reports'][-1]);self.assertIn('offen',self.s.store.get('workflow_report',old)['title'])
        with self.assertRaises(InputError):self.f.import_results(self.import_data(w))
        report=self.s.store.get('workflow_report',w['reports'][-1]);self.assertIn(b'Expert',report_html(report))
        if importlib.util.find_spec('reportlab'):self.assertTrue(report_pdf(report).startswith(b'%PDF'))
        else:
            with self.assertRaisesRegex(InputError,'reportlab'):report_pdf(report)
    def test_mail_missing_uncertain_sent_and_no_duplicate(self):
        w=self.release(self.ready_cases())
        with patch.dict(os.environ,{'AUDITFLOW_SMTP_HOST':'','AUDITFLOW_MAIL_FROM':''}):
            self.assertEqual(self.f.deliver({'id':w['id']})['delivery']['status'],'not_configured')
        with patch.dict(os.environ,{'AUDITFLOW_SMTP_HOST':'smtp.example.invalid','AUDITFLOW_MAIL_FROM':'sender@example.invalid'}),patch.object(self.f,'_smtp',side_effect=OSError('network')):
            self.assertEqual(self.f.deliver({'id':w['id']})['delivery']['status'],'unknown')
            with self.assertRaises(InputError):self.f.deliver({'id':w['id']})
        w=self.delivered();w['phase']='delivery';w['delivery']={'status':'ready'};self.f.save(w)
        with patch.dict(os.environ,{'AUDITFLOW_SMTP_HOST':'smtp.example.invalid','AUDITFLOW_MAIL_FROM':'sender@example.invalid'}),patch.object(self.f,'_smtp') as smtp:
            sent=self.f.deliver({'id':w['id']});self.assertEqual(sent['delivery']['status'],'sent');self.assertEqual(sent['phase'],'results')
            self.f.deliver({'id':w['id']});self.assertEqual(smtp.call_count,1)
            attachment=list(smtp.call_args.args[0].iter_attachments())[0];self.assertNotIn(b'expected',attachment.get_payload(decode=True))
    def test_report_html_escapes_untrusted_content(self):
        w=self.create();self.f.report(w,'test','<script>bad</script>',[{'heading':'<b>x</b>','text':'<img src=x>'}]);r=self.s.store.get('workflow_report',w['reports'][0])
        html=report_html(r).decode();self.assertNotIn('<script>',html);self.assertIn('&lt;script&gt;',html)
    def test_attachment_is_idempotent_and_locked_after_start(self):
        w=self.create();d=self.source(w)
        with self.assertRaises(InputError):self.f.attach({'id':w['id'],'document_id':d['id']})
        with self.assertRaises(InputError):self.f.detach({'id':w['id'],'document_id':d['id']})


    def test_partial_case_cursor_survives_new_service_without_duplicates(self):
        w=self.create();d=self.source(w)
        original=self.s.store.filtered('requirement','source_id',d['id'])[0]
        second=copy.deepcopy(original);second.update(id='second-synthetic-requirement',title='Second synthetic rule')
        self.s.store.put('requirement',second);self.s.documents.review(second['id'],'offline')
        self.f.tick(w['id'])
        for r in self.s.store.filtered('requirement','source_id',d['id']):self.s.approve('requirement',r['id'],{'reviewer':'Synthetic','note':'Test only','approve':True})
        self.f.tick(w['id']);partial=self.f.tick(w['id']);self.assertEqual(partial['case_cursor'],1)
        restarted=create_service(Path(self.temp.name)/'data.sqlite3')
        continued=restarted.workflow.tick(w['id']);self.assertEqual(continued['case_cursor'],2)
        ready=restarted.workflow.tick(w['id']);self.assertEqual(ready['phase'],'case_review');self.assertEqual(len(ready['cases']),4)
        self.assertEqual(len({c['id'] for c in ready['cases']}),4)

    def test_new_revision_automatically_queues_a_fresh_precheck(self):
        w=self.ready_cases();old=w['requirement_snapshot'][0]
        with patch.object(self.s.documents,'start'):
            new=self.s.documents.revise({'id':old['id'],'criterion':'A revised synthetic condition requiring fresh review.'})
        self.assertNotIn('ai_review',new)
        jobs=self.s.store.filtered('document_job','document_id',old['source_id'])
        self.assertEqual(jobs[-1]['status'],'queued')
        self.assertEqual(self.f.tick(w['id'])['phase'],'requirements')


class WorkflowHTTPTests(unittest.TestCase):
    def test_customer_workflow_routes_auth_downloads_and_validation(self):
        import threading
        import urllib.request
        import urllib.error
        from http.server import ThreadingHTTPServer
        from auditflow.server import handler_for
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'AUDITFLOW_ACCESS_TOKEN':'synthetic-http-test'}):
            s=create_service(Path(tmp)/'db.sqlite3');server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(s))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
            def request(path,data=None,auth=True):
                headers={'Authorization':'Bearer synthetic-http-test'} if auth else {}
                if data is not None:headers['Content-Type']='application/json'
                req=urllib.request.Request(base+path,headers=headers,data=json.dumps(data).encode() if data is not None else None)
                return urllib.request.urlopen(req)
            try:
                with self.assertRaises(urllib.error.HTTPError) as err:request('/api/state',auth=False)
                self.assertEqual(err.exception.code,401)
                with request('/api/workflow/create',{'name':'Synthetic audit','company':'Synthetic','contact':'Test','email':'test@example.invalid','software':'Demo','software_version':'1','mode':'offline'}) as r:w=json.load(r)
                with request('/api/state') as r:self.assertEqual(json.load(r)['workflow']['items'][0]['id'],w['id'])
                s.workflow.report(w,'test','Synthetic intermediate report',[{'heading':'State','text':'Source comparison pending'}]);rid=w['reports'][0]
                if importlib.util.find_spec('reportlab'):
                    with request('/api/workflow/reports/'+rid+'/pdf') as r:self.assertEqual(r.read(4),b'%PDF')
                else:
                    with self.assertRaises(urllib.error.HTTPError) as pdf_error:request('/api/workflow/reports/'+rid+'/pdf')
                    self.assertEqual(pdf_error.exception.code,422);self.assertIn('reportlab',json.load(pdf_error.exception)['error']);pdf_error.exception.close()
                with request('/api/workflow/reports/'+rid+'/html') as r:self.assertIn(b'Synthetic intermediate',r.read())
                for path in ['/workflow.js','/icons.js']:
                    with request(path,auth=False) as r:self.assertEqual(r.status,200)
                with self.assertRaises(urllib.error.HTTPError) as err:request('/api/workflow/'+w['id']+'/package')
                self.assertEqual(err.exception.code,422)
            finally:server.shutdown();server.server_close();thread.join();s.workflow.close();s.documents.close();s.automation.close()

if __name__=='__main__':unittest.main()
