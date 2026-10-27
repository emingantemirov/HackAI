"""Source versioning, scoped AI recommendations, file persistence and safe revisions."""
import base64
import copy
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from auditflow.server import create_service
from auditflow.model import ModelError
from auditflow.domain import InputError


class DocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.service=create_service(Path(self.temp.name)/'db.sqlite3')
        self.lib=self.service.documents
    def tearDown(self):
        self.lib.close();self.service.automation.close();self.temp.cleanup()
    def upload(self,text='A complete synthetic requirement with a sufficiently long source sentence.',version='1',**kwargs):
        return self.service.import_document({'name':'Synthetic procedure.txt','version':version,'base64':base64.b64encode(text.encode()).decode(),**kwargs})
    def test_original_and_duplicate_persist_across_restart(self):
        d=self.upload();again=self.upload()
        self.assertEqual(d['id'],again['id']);self.assertEqual(again['upload_outcome'],'duplicate')
        restarted=create_service(Path(self.temp.name)/'db.sqlite3')
        self.assertIn(b'A complete synthetic',restarted.documents.original(d['id']))
    def test_automatic_family_and_comparison_keeps_history(self):
        d=self.upload();new=self.upload('A changed synthetic requirement with a different minimum and enough source text.',version='2')
        self.assertEqual(d['family_id'],new['family_id']);self.assertEqual(new['previous_id'],d['id'])
        self.assertEqual(new['version_state'],'new_version');self.assertEqual(len(new['comparison']['changes']),1)
        self.assertEqual(self.service.store.get('document',d['id'])['version'],'1')
    def test_same_version_correction_and_distinct_family(self):
        old=self.upload();corrected=self.upload('A corrected synthetic statement that must never overwrite the old version.')
        self.assertEqual(corrected['version_state'],'corrected');self.assertNotEqual(old['id'],corrected['id'])
        other=self.service.import_document({'name':'Other topic.txt','version':'1','base64':base64.b64encode(b'A wholly different synthetic source statement.').decode()})
        self.assertNotEqual(other['family_id'],old['family_id'])
    def test_auto_version_and_title_normalization(self):
        d=self.service.import_document({'name':'Procedure_v1.txt','smart_upload':True,'mode':'offline','base64':base64.b64encode(b'Version 1\nA complete synthetic source statement for a versioned document.').decode()})
        new=self.service.import_document({'name':'Procedure_v2.txt','smart_upload':True,'mode':'offline','base64':base64.b64encode(b'Version 2\nA changed synthetic source statement for a versioned document.').decode()})
        self.assertEqual(d['version'],'1');self.assertEqual(new['version'],'2');self.assertEqual(d['family_id'],new['family_id'])
    def test_idempotent_section_processing_and_no_fake_ai(self):
        d=self.upload();s=d['sections'][0]
        self.lib.process_section(d,s,'offline');count=len(self.service.store.list('requirement'))
        self.lib.process_section(d,s,'offline')
        self.assertEqual(len(self.service.store.list('requirement')),count)
        r=next(r for r in self.service.store.list('requirement') if r['source_id']==d['id'])
        self.assertEqual(r['ai_review']['mode'],'offline');self.assertEqual(r['ai_review']['recommendation'],'clarify');self.assertEqual(r['status'],'pending')
    def test_live_review_marks_exact_span_and_never_approves(self):
        r=self.service.store.get('requirement','C1');before=copy.deepcopy(r)
        quote=r['criterion'][:15]
        response={'recommendation':'revise','reason':'An exception needs review.','issues':[{'target':'criterion','quote':quote,'reason':'Ambiguous wording','suggestion':'Clarify with the source'}]}
        with patch('auditflow.documents.Model.call',return_value=json.dumps(response)):
            review=self.lib.review(r['id'])
        saved=self.service.store.get('requirement',r['id'])
        self.assertEqual(saved['status'],before['status']);self.assertEqual(saved['criterion'],before['criterion'])
        issue=review['issues'][0];self.assertEqual(r['criterion'][issue['start']:issue['end']],quote)
        self.assertEqual(len(self.service.store.list('requirement_review')),1)
    def test_unmatched_or_empty_revision_markers_are_rejected(self):
        for issues in [[],[{'target':'source','quote':'fabricated not-in-source','reason':'x','suggestion':'y'}]]:
            with patch('auditflow.documents.Model.call',return_value=json.dumps({'recommendation':'revise','reason':'Test','issues':issues})):
                with self.assertRaises(ModelError):self.lib.review('C1')
        self.assertNotIn('ai_review',self.service.store.get('requirement','C1'))
    def test_live_failure_is_not_a_recommendation(self):
        with patch('auditflow.documents.Model.call',side_effect=ModelError('Unavailable')):
            with self.assertRaises(ModelError):self.lib.review('C1')
        self.assertEqual(self.service.store.list('requirement_review'),[])
    def test_revision_retains_old_freedom_and_invalidates_review(self):
        old=self.service.store.get('requirement','C1');self.lib.review('C1','offline')
        new=self.lib.revise({'id':'C1','criterion':'A revised synthetic criterion requiring a separate approval.'})
        self.assertEqual(new['previous_requirement_id'],'C1');self.assertEqual(new['status'],'pending')
        self.assertNotIn('ai_review',new);self.assertIsNone(new['mapping'])
        self.assertEqual(self.service.store.get('requirement','C1')['criterion'],old['criterion'])
    def test_unmodified_complete_basis_inherits_approval_but_changed_validity_does_not(self):
        old=self.upload();self.lib.process_section(old,old['sections'][0],'offline')
        r=next(r for r in self.service.store.list('requirement') if r['source_id']==old['id'])
        self.service.approve('requirement',r['id'],{'approve':True,'reviewer':'Synthetic test','note':'Demo-only test approval'})
        new=self.upload(version='2');self.lib.process_section(new,new['sections'][0],'offline')
        child=next(r for r in self.service.store.list('requirement') if r['source_id']==new['id'])
        self.assertEqual(child['status'],'approved');self.assertIsNotNone(child['approval_inherited_from'])
        changed=self.upload(version='3',valid_from='2027-01-01');self.lib.process_section(changed,changed['sections'][0],'offline')
        child=next(r for r in self.service.store.list('requirement') if r['source_id']==changed['id'])
        self.assertEqual(child['status'],'pending')
    def test_review_metadata_does_not_invalidate_existing_coverage(self):
        for rid in ['C1','C2','C3','C4']:self.service.approve('requirement',rid,{'approve':True,'reviewer':'Test','note':'Synthetic only'})
        self.service.approve('case','CASE-001',{'approve':True,'reviewer':'Test','note':'Synthetic only'})
        self.service.run({});self.lib.review('C1','offline')
        self.assertFalse(any(c['status']=='stale' for c in self.service.coverage()['cells'] if c['case_id']=='CASE-001'))
    def test_worker_failure_and_resume_are_explicit(self):
        d=self.upload()
        with patch('auditflow.documents.Model.call',side_effect=ModelError('Synthetic unavailable model')):
            job=self.lib.queue(d['id'],'live')
            for _ in range(250):
                saved=self.service.store.get('document_job',job['id'])
                if saved['status']=='failed':break
                time.sleep(.02)
            self.assertEqual(saved['status'],'failed');self.assertIn('Synthetic',saved['error'])
        job=self.lib.queue(d['id'],'offline')
        for _ in range(250):
            saved=self.service.store.get('document_job',job['id'])
            if saved['status']=='completed':break
            time.sleep(.02)
        self.assertEqual(saved['status'],'completed');self.assertEqual(saved['cursor'],saved['total'])
    def test_unknown_family_leaves_no_document_or_file(self):
        count=len(self.service.store.list('document'))
        with self.assertRaises(InputError):self.upload(family_id='missing')
        self.assertEqual(len(self.service.store.list('document')),count)
    def test_readable_pdf_for_text_and_seed(self):
        try:import reportlab
        except ImportError:self.skipTest('optional PDF extras not installed')
        self.assertTrue(self.lib.pdf(self.upload()['id']).startswith(b'%PDF'))
        self.assertTrue(self.lib.pdf('DOC-CRITERIA').startswith(b'%PDF'))

class DocumentHTTPTests(unittest.TestCase):
    def test_upload_download_and_document_auth(self):
        import threading
        import urllib.request
        import urllib.error
        from http.server import ThreadingHTTPServer
        from auditflow.server import handler_for
        with tempfile.TemporaryDirectory() as temp:
            service=create_service(Path(temp)/'state.sqlite3')
            server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(service));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            url='http://127.0.0.1:'+str(server.server_port)
            raw=b'A synthetic document for the automatic upload and persistent original test.'
            body={'name':'HTTP source.txt','version':'1','mode':'offline','base64':base64.b64encode(raw).decode()}
            def post(path,body):
                return urllib.request.urlopen(urllib.request.Request(url+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'}),timeout=5)
            try:
                with post('/api/documents/upload',body) as response:doc=json.load(response)
                with post('/api/documents/upload',body) as response:self.assertEqual(json.load(response)['upload_outcome'],'duplicate')
                with urllib.request.urlopen(url+'/api/documents/'+doc['id']+'/original') as response:self.assertEqual(response.read(),raw)
                with patch.dict(os.environ,{'AUDITFLOW_ACCESS_TOKEN':'synthetic-local-test'}):
                    with self.assertRaises(urllib.error.HTTPError) as error:urllib.request.urlopen(url+'/api/documents/'+doc['id']+'/original')
                    self.assertEqual(error.exception.code,401)
                with urllib.request.urlopen(url+'/library.js') as response:self.assertIn(b'libraryRequirements',response.read())
                try:import reportlab
                except ImportError:return
                with urllib.request.urlopen(url+'/api/documents/'+doc['id']+'/pdf') as response:self.assertTrue(response.read().startswith(b'%PDF'))
            finally:
                server.shutdown();server.server_close();thread.join();service.documents.close();service.automation.close()

class MetadataTests(unittest.TestCase):
    setUp=DocumentTests.setUp
    tearDown=DocumentTests.tearDown
    upload=DocumentTests.upload
    def test_smart_upload_does_not_drop_changed_validity(self):
        old=self.upload(smart_upload=True,mode='offline',valid_from='2026-01-01')
        new=self.upload(smart_upload=True,mode='offline',valid_from='2027-01-01')
        self.assertNotEqual(old['id'],new['id']);self.assertEqual(new['valid_from'],'2027-01-01')
    def test_older_upload_is_history_and_next_comparison_uses_active_version(self):
        active=self.upload(version='2')
        history=self.upload('A historic synthetic requirement with sufficient source text.',version='1')
        self.assertTrue(history['is_historical']);self.assertEqual(history['version_state'],'historical_version')
        nextdoc=self.upload('The next synthetic source statement with sufficiently long source text.',version='3')
        self.assertEqual(nextdoc['previous_id'],active['id']);self.assertFalse(nextdoc['is_historical'])
    def test_restart_resumes_committed_section_without_duplicate_requirements(self):
        d=self.upload('The first long synthetic source statement with a certificate condition.\n\nThe second long synthetic source statement with a duration condition.')
        self.lib.process_section(d,d['sections'][0],'offline')
        job={'id':'resume-source-test','document_id':d['id'],'mode':'offline','status':'running','cursor':1,'total':2,'created_at':'2026-10-27T00:00:00Z','error':None}
        self.service.store.put('document_job',job)
        self.lib.start()
        for _ in range(250):
            saved=self.service.store.get('document_job',job['id'])
            if saved['status']=='completed':break
            time.sleep(.02)
        self.assertEqual(saved['status'],'completed')
        self.assertEqual(len([r for r in self.service.store.list('requirement') if r['source_id']==d['id']]),2)

    def test_reupload_restores_missing_original_without_new_document(self):
        doc=self.upload()
        with self.service.store.connect() as db:db.execute('DELETE FROM document_files WHERE sha=?',(doc['sha256'],))
        doc['file_available']=False;self.service.store.put('document',doc)
        restored=self.upload(smart_upload=True,mode='offline')
        self.assertEqual(restored['id'],doc['id']);self.assertTrue(restored['file_available'])
        self.assertTrue(self.lib.original(doc['id']))
    def test_source_highlight_uses_verified_unicode_offsets(self):
        doc=self.upload('📄 Eine synthetische Vorschrift mit einer eindeutig bezeichneten Frist und genügend Kontext.')
        self.lib.process_section(doc,doc['sections'][0],'offline')
        r=next(r for r in self.service.store.list('requirement') if r['source_id']==doc['id'])
        proposal={'recommendation':'revise','reason':'Die Frist braucht eine Präzisierung.','issues':[{'target':'source','quote':'Frist','reason':'Unklarer Bezug','suggestion':'Den Bezug im Entwurf erläutern.'}]}
        with patch('auditflow.documents.Model.call',return_value=json.dumps(proposal)):
            review=self.lib.review(r['id'])
        issue=review['issues'][0];self.assertEqual(doc['sections'][0]['text'][issue['start']:issue['end']],'Frist')
    def test_invalid_metadata_is_rejected_before_storage(self):
        before=len(self.service.store.list('document'))
        for fields in [{'valid_from':'2027-02-30'},{'version':{'not':'text'}},{'folder':'x'*101}]:
            with self.assertRaises(InputError):self.upload(**fields)
        self.assertEqual(len(self.service.store.list('document')),before)
