"""Integration regressions for the adapted Base44 workflow, using synthetic evidence."""
import base64
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from auditflow.assistant import explain
from auditflow.domain import InputError
from auditflow.model import ModelError
from auditflow.server import create_service


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = create_service(Path(self.temp.name) / 'db.sqlite3')

    def tearDown(self):
        self.service.automation.close()
        self.temp.cleanup()

    def ready(self):
        for rid in ['C1', 'C2', 'C3', 'C4']:
            self.service.approve('requirement', rid, {'reviewer': 'Synthetic test', 'note': 'Test only', 'approve': True})

    def test_typed_drafts_preserve_links_and_do_not_fake_reviews(self):
        self.ready()
        for kind, expected in [('positive', True), ('negative', False), ('missing_data', None)]:
            c = self.service.generate_cases({'mode': 'template', 'test_type': kind})[0]
            self.assertEqual(c['test_type'], kind)
            self.assertEqual(c['expected_message'], expected)
            self.assertEqual(c['review_status'], 'pending')
            self.assertEqual(c['requirement_ids'], ['C1', 'C2', 'C4'])
            self.assertEqual(len(c['requirements_snapshot']), 3)
            self.assertIsNone(c['model_id'])
            if expected is None:
                with self.assertRaises(InputError):
                    self.service.approve('case', c['id'], {'reviewer':'Test', 'note':'Test', 'approve':True})
            else:
                self.service.approve('case', c['id'], {'reviewer':'Test', 'note':'Test', 'approve':True})
                # Correct suppression in a negative test is a successful behavior test.
                self.assertEqual(self.service.run({'case_id':c['id']})['overall_status'], 'pass')

    def test_template_boundary_keeps_unknown_case(self):
        self.ready()
        cases = self.service.generate_cases({'mode':'template', 'test_type':'boundary'})
        self.assertEqual(len(cases), 4)
        self.assertEqual(cases[-1]['expected_message'], None)
        self.assertTrue(all(c['test_type']=='boundary' for c in cases))

    def test_type_and_scope_errors_do_not_write(self):
        self.ready()
        count = len(self.service.store.list('case'))
        with self.assertRaises(InputError):
            self.service.generate_cases({'mode':'template', 'test_type':'imaginary'})
        c = self.service.store.get('case','CASE-001')
        c['ruleset']='future-unmapped';self.service.store.put('case',c)
        with self.assertRaises(InputError):
            self.service.generate_cases({'mode':'template', 'test_type':'positive'})
        self.assertEqual(len(self.service.store.list('case')),count)

    def test_assistant_resolves_stored_evidence_and_cannot_change_verdict(self):
        run = self.service.run({})
        before = copy.deepcopy(run)
        body = {'question':'Explain', 'ref':{'kind':'run','id':run['id']}, 'finding':{'status':'pass'}}
        result = explain(self.service.store, body)
        self.assertEqual(result['mode'],'offline')
        self.assertIsNone(result['model_id'])
        self.assertEqual(result['evidence']['status'],'not_assessable')
        self.assertEqual(self.service.store.get('run',run['id']),before)
        self.assertTrue(result['next_steps'])

    def test_assistant_selects_single_actual_finding(self):
        run = self.service.run({})
        result = explain(self.service.store, {'question':'Why?', 'ref':{'kind':'run','id':run['id'],'finding_id':'C1'}})
        self.assertEqual(len(result['evidence']['findings']),1)
        with self.assertRaises(InputError):
            explain(self.service.store, {'question':'Why?', 'ref':{'kind':'run','id':run['id'],'finding_id':'invented'}})

    def test_assistant_live_is_explicit_and_failure_is_not_success(self):
        run = self.service.run({})
        body = {'question':'Why?', 'mode':'live','ref':{'kind':'run','id':run['id']}}
        with patch('auditflow.assistant.Model.call',return_value='A synthetic explanation') as call:
            result = explain(self.service.store,body)
            self.assertEqual(result['mode'],'live')
            self.assertIn(run['id'],call.call_args.args[1])
        with patch('auditflow.assistant.Model.call',side_effect=ModelError('Unavailable')):
            with self.assertRaises(ModelError):explain(self.service.store,body)

    def test_assistant_rejects_unbounded_or_unlinked_input(self):
        for body in [{'question':'x'*1001,'ref':{}},{'question':'x'},{'question':'x','ref':{'kind':'other'}}]:
            with self.assertRaises(InputError):explain(self.service.store,body)

    def test_automation_assistant_uses_frozen_job_package(self):
        a=self.service.automation
        p=a.approve_package({'package_id':'AUTO-PACKAGE-1','reviewer':'Synthetic','note':'Test','acknowledge_demo':True})
        project=a.create_project({'manufacturer':'Synthetic','software':'Example','software_version':'1'})
        job=a.launch({'project_id':project['id'],'package_id':p['id'],'count':9,'mode':'simulation','behavior':'healthy'})
        # Wait for worker via its persisted terminal state, bounded to 5 seconds.
        import time
        for _ in range(100):
            if a.detail(job['id'])['status']=='completed':break
            time.sleep(.05)
        rows=a.results(job['id'])['items']
        self.assertTrue(rows)
        r=rows[0]
        result=explain(self.service.store,{'question':'Why?', 'ref':{'kind':'automation','job_id':job['id'],'case_id':r['case_id']}})
        self.assertEqual(result['evidence']['expected'],r['expected'])
        self.assertEqual(result['evidence']['package_hash'],p['rules_hash'])
        self.assertEqual(result['evidence']['execution_mode'],'simulation')
        with self.assertRaises(KeyError):
            explain(self.service.store,{'question':'Why?','ref':{'kind':'automation','job_id':job['id'],'case_id':'wrong'}})

    def pdf_body(self):
        try:
            from reportlab.pdfgen import canvas
            import pdfplumber
        except ImportError:self.skipTest('optional PDF import dependencies unavailable')
        output=io.BytesIO();c=canvas.Canvas(output)
        for page in range(1,4):
            c.drawString(40,700,f'Synthetic original PDF page {page} contains a long enough source statement for literal extraction.');c.showPage()
        c.save()
        return {'name':'Synthetic.pdf','version':'1','base64':base64.b64encode(output.getvalue()).decode()}

    def test_pdf_range_preserves_original_pages_and_distinct_identity(self):
        body=self.pdf_body()
        ranged={**body,'pages_from':2,'pages_to':3}
        doc=self.service.import_document(ranged)
        self.assertEqual([s['id'] for s in doc['sections']],['page-2','page-3'])
        self.assertEqual(doc['sections'][0]['page'],2)
        self.assertIn('page 2',doc['sections'][0]['text'])
        self.assertEqual(self.service.import_document(ranged)['id'],doc['id'])
        full=self.service.import_document(body)
        self.assertNotEqual(full['id'],doc['id'])
        self.assertEqual(full['sha256'],doc['sha256'])
        draft=self.service.draft({'document_id':doc['id'],'section_id':'page-2'})[0]
        self.assertEqual(draft['section_id'],'page-2')
        self.assertEqual(draft['citation_status'],'verified')

    def test_pdf_invalid_ranges_do_not_create_documents(self):
        body=self.pdf_body();before=len(self.service.store.list('document'))
        for start,end in [(0,2),(3,2),(1,4),(1,101),(True,2),(1.2,2),(None,2)]:
            with self.assertRaises(InputError):self.service.import_document({**body,'pages_from':start,'pages_to':end})
        with self.assertRaises(InputError):
            self.service.import_document({'name':'example.txt','base64':base64.b64encode(b'Text').decode(),'pages_from':1,'pages_to':2})
        self.assertEqual(len(self.service.store.list('document')),before)


class WorkspaceHTTPTests(unittest.TestCase):
    def test_assistant_auth_validation_and_no_fake_model_success(self):
        import os
        import threading
        import urllib.request
        import urllib.error
        from http.server import ThreadingHTTPServer
        from auditflow.server import handler_for
        with tempfile.TemporaryDirectory() as temp:
            service=create_service(Path(temp)/'db.sqlite3')
            run=service.run({})
            server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(service))
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            url='http://127.0.0.1:'+str(server.server_port)
            def post(body,token=None):
                headers={'Content-Type':'application/json'}
                if token:headers['Authorization']='Bearer '+token
                return urllib.request.urlopen(urllib.request.Request(url+'/api/assistant/explain',data=json.dumps(body).encode(),headers=headers),timeout=5)
            try:
                with urllib.request.urlopen(url+'/workspace.js') as response:self.assertIn(b'workspaceDashboard',response.read())
                body={'question':'Why?', 'ref':{'kind':'run','id':run['id']}}
                with patch.dict(os.environ,{'AUDITFLOW_ACCESS_TOKEN':'synthetic-test-token','HAI_API_KEY':''}):
                    with self.assertRaises(urllib.error.HTTPError) as error:post(body)
                    self.assertEqual(error.exception.code,401)
                    with post(body,'synthetic-test-token') as response:self.assertEqual(json.load(response)['mode'],'offline')
                    with self.assertRaises(urllib.error.HTTPError) as error:post({**body,'mode':'live'},'synthetic-test-token')
                    self.assertEqual(error.exception.code,502)
                    with self.assertRaises(urllib.error.HTTPError) as error:post({'question':'No linked evidence'},'synthetic-test-token')
                    self.assertEqual(error.exception.code,422)
            finally:
                server.shutdown();server.server_close();thread.join();service.automation.close()
