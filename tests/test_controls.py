"""Workspace lifecycle, UI metadata, scoped read-only chat, email and timer contracts."""
import base64
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from auditflow.server import create_service
from auditflow.domain import InputError
from auditflow.model import ModelError
from auditflow.workspace import mail_settings

class ControlsTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.s=create_service(Path(self.temp.name)/'test.sqlite3');self.w=self.s.workspace
    def tearDown(self):
        self.w.close();self.s.documents.close();self.s.workflow.close();self.s.automation.close();self.temp.cleanup()
    def source(self,version='1'):
        return self.s.import_document({'name':'Synthetic lifecycle.txt','version':version,'base64':base64.b64encode(('A complete synthetic source rule that is long enough for traceable extraction. Version '+version).encode()).decode()})
    def linked(self):
        d=self.source();r=self.s.draft({'document_id':d['id'],'section_id':d['sections'][0]['id'],'mode':'offline'})[0]
        wf=self.s.workflow.create({'name':'Synthetic workflow','company':'Demo','contact':'Demo','email':'demo@example.invalid','software':'Demo','software_version':'1','mode':'offline'})
        self.s.workflow.attach({'id':wf['id'],'document_id':d['id']});wf=self.s.store.get('workflow',wf['id']);wf['phase']='requirements';self.s.workflow.save(wf)
        return d,r,wf
    def test_existing_items_migrate_read_new_entries_are_unread(self):
        self.assertNotIn('C1',self.w.state()['unseen']['requirement'])
        d=self.source();r=self.s.draft({'document_id':d['id'],'section_id':d['sections'][0]['id']})[0]
        self.assertIn(r['id'],self.w.state()['unseen']['requirement']);self.w.mark_read({'entries':[{'kind':'requirement','id':r['id']}]})
        restarted=create_service(Path(self.temp.name)/'test.sqlite3');self.assertNotIn(r['id'],restarted.workspace.state()['unseen']['requirement'])
    def test_source_trash_cascades_all_versions_requirements_and_workflows(self):
        d,r,wf=self.linked();new=self.source('2');self.s.workflow.report(wf,'test','Synthetic intermediate',[{'heading':'Test','text':'Synthetic report'}])
        result=self.w.trash({'entries':[{'kind':'document','id':new['id']}]})
        for kind,id in [('document',d['id']),('document',new['id']),('requirement',r['id']),('workflow',wf['id'])]:self.assertTrue(self.s.store.get(kind,id)['trashed_at'])
        self.assertFalse(self.s.workflow.state()['items']);self.assertGreaterEqual(result['trashed'],5)
        self.w.restore_batch({'entries':[{'kind':'trash_batch','id':result['batch_id']}]})
        self.assertFalse(self.s.store.get('document',d['id']).get('trashed_at'));self.assertEqual(self.s.store.get('workflow',wf['id'])['phase'],'requirements')
    def test_hide_propagates_and_pauses_without_destroying_approvals(self):
        d,r,wf=self.linked();self.s.approve('requirement',r['id'],{'reviewer':'Synthetic','note':'Synthetic check','approve':True})
        self.w.hide({'entries':[{'kind':'document','id':d['id']}],'hidden':True})
        self.assertTrue(self.s.store.get('requirement',r['id'])['hidden']);self.assertEqual(self.s.store.get('requirement',r['id'])['status'],'approved')
        self.assertEqual(self.s.workflow.tick(wf['id'])['phase'],'requirements')
        with self.assertRaises(InputError):self.s.workflow.set_count({'id':wf['id'],'count':4})
        self.w.hide({'entries':[{'kind':'document','id':d['id']}],'hidden':False});self.assertFalse(self.s.store.get('workflow',wf['id'])['hidden'])
    def test_independent_hidden_sources_do_not_unhide_each_other(self):
        d,r,wf=self.linked();self.w.hide({'entries':[{'kind':'document','id':d['id']}],'hidden':True});self.w.hide({'entries':[{'kind':'requirement','id':r['id']}],'hidden':True})
        self.w.hide({'entries':[{'kind':'document','id':d['id']}],'hidden':False});self.assertTrue(self.s.store.get('requirement',r['id'])['hidden'])
    def test_purge_requires_explicit_confirmation_and_removes_original_blob(self):
        d,r,wf=self.linked();batch=self.w.trash({'entries':[{'kind':'document','id':d['id']}]});body={'entries':[{'kind':'trash_batch','id':batch['batch_id']}]}
        with self.assertRaises(InputError):self.w.purge(body)
        self.w.purge({**body,'confirmation':'DELETE'})
        for kind,id in [('document',d['id']),('requirement',r['id']),('workflow',wf['id']),('trash_batch',batch['batch_id'])]:
            with self.assertRaises(KeyError):self.s.store.get(kind,id)
        with self.s.store.connect() as db:self.assertIsNone(db.execute('SELECT sha FROM document_files WHERE sha=?',(d['sha256'],)).fetchone())
    def test_export_is_snapshot_and_escapes_source_html(self):
        d=self.source();r=self.s.draft({'document_id':d['id'],'section_id':d['sections'][0]['id']})[0];r['title']='<script>synthetic</script>';self.s.store.put('requirement',r)
        body={'entries':[{'kind':'requirement','id':r['id']}],'format':'html'};data,mime,name=self.w.export(body)
        self.assertIn(b'&lt;script&gt;',data);self.assertNotIn(b'<script>',data);self.assertIn('html',mime)
        self.assertEqual(self.s.store.get('requirement',r['id'])['status'],'pending')
    def test_selection_invalid_or_duplicate_is_atomic(self):
        for entries in [[],[{'kind':[],'id':'x'}],[{'kind':'case','id':'CASE-001'}]*2,[{'kind':'invented','id':'x'}]]:
            with self.assertRaises(InputError):self.w.selection({'entries':entries})
        self.assertFalse(self.s.store.get('case','CASE-001').get('trashed_at'))
    def test_settings_validate_and_do_not_accept_or_return_secrets(self):
        with patch.dict(os.environ,{'AUDITFLOW_SMTP_PASSWORD':'synthetic-test-secret','HAI_API_KEY':'synthetic-model-secret'}):
            saved=self.w.update_settings({'language':'en','theme':'dark','compact':True,'smtp':{'host':'smtp.example.invalid','port':465,'tls':'ssl','sender':'demo@example.invalid','user':'demo'}})
            packed=json.dumps(saved);self.assertNotIn('synthetic-test-secret',packed);self.assertNotIn('synthetic-model-secret',packed)
            self.assertEqual(mail_settings(self.s.store)['host'],'smtp.example.invalid');self.assertTrue(self.s.workflow.mail_configured())
            with self.assertRaises(InputError):self.w.update_settings({'smtp':{'password':'bad'}})
            with self.assertRaises(InputError):self.w.update_settings({'smtp':{'port':0}})
    def test_chat_without_finding_answers_system_questions_without_writes(self):
        before=self.s.store.list('requirement');answer=self.w.chat({'question':'Wie viele Anforderungen sind offen?','mode':'offline'})
        self.assertIn('offene',answer['answer']);self.assertEqual(answer['mode'],'offline');self.assertEqual(before,self.s.store.list('requirement'))
        english=self.w.chat({'question':'How does approval work?','language':'en','mode':'offline'});self.assertIn('human',english['answer'])
    def test_chat_live_failure_is_not_fabricated_and_output_is_plain_data(self):
        with patch('auditflow.workspace.Model.call',side_effect=ModelError('synthetic unavailable')):
            with self.assertRaises(ModelError):self.w.chat({'question':'Explain the system','mode':'live'})
        self.assertFalse(self.s.store.list('chat_message'))
        with patch('auditflow.workspace.Model.call',return_value='<script>synthetic UI escaping fixture</script>'):
            result=self.w.chat({'question':'Explain the system','mode':'live'})
        self.assertEqual(result['mode'],'live');self.assertIn('<script>',result['answer'])
    def test_timer_heartbeat_caps_gaps_and_boot_stops_old_session(self):
        s=self.w.timer({'action':'start','work_date':'2026-10-27'});self.assertEqual(s['seconds'],0)
        s['last_seen']='2026-10-26T00:00:00+00:00';self.s.store.put('work_session',s)
        s=self.w.timer({'action':'heartbeat'});self.assertEqual(s['seconds'],90)
        with patch.object(self.w,'start'):self.w.boot()
        self.assertTrue(self.s.store.get('work_session',s['id'])['ended_at']);self.assertTrue(self.w.messages())
    def test_forward_missing_smtp_remains_explicit_no_fake_sent(self):
        with patch.dict(os.environ,{'AUDITFLOW_SMTP_HOST':'','AUDITFLOW_MAIL_FROM':''}),patch.object(self.w,'start'):
            m=self.w.forward({'entries':[{'kind':'case','id':'CASE-001'}],'email':'demo@example.invalid','subject':'Synthetic export'})
        self.assertEqual(m['status'],'queued');self.assertNotIn('report',m)
        with self.assertRaises(InputError):self.w.forward({'entries':[{'kind':'case','id':'CASE-001'}],'email':'bad\r\nBcc:a@b.com'})
    def test_exact_requested_case_count_and_invalid_total_block(self):
        d,r,wf=self.linked();self.s.documents.review(r['id'],'offline');self.s.approve('requirement',r['id'],{'reviewer':'Demo','note':'Synthetic only','approve':True})
        self.s.workflow.set_count({'id':wf['id'],'count':17});self.s.workflow.tick(wf['id'])
        for _ in range(8):wf=self.s.workflow.tick(wf['id'])
        self.assertEqual(wf['phase'],'case_review');self.assertEqual(len(wf['cases']),17);self.assertEqual(len({c['id'] for c in wf['cases']}),17)
        with self.assertRaises(InputError):self.s.workflow.set_count({'id':wf['id'],'count':4})

    def test_permanent_purge_also_removes_earlier_trashed_dependants_and_redacts_notes(self):
        import hashlib
        d,r,wf=self.linked();self.s.approve('requirement',r['id'],{'reviewer':'Synthetic','note':'Private synthetic review note to erase','approve':True})
        first=self.w.trash({'entries':[{'kind':'requirement','id':r['id']}]})
        second=self.w.trash({'entries':[{'kind':'document','id':d['id']}]})
        with self.assertRaises(InputError):self.w.restore_batch({'entries':[{'kind':'trash_batch','id':first['batch_id']}]})
        self.w.purge({'entries':[{'kind':'trash_batch','id':second['batch_id']}],'confirmation':'DELETE'})
        with self.assertRaises(KeyError):self.s.store.get('requirement',r['id'])
        self.assertNotIn('Private synthetic review note',json.dumps(self.s.store.events()))
        previous=''
        for event in self.s.store.events():
            payload=json.dumps(event['data'],sort_keys=True,ensure_ascii=False)
            self.assertEqual(event['hash'],hashlib.sha256((previous+event['at']+event['action']+payload).encode()).hexdigest());previous=event['hash']

    def test_delivery_mailbox_history_survives_a_new_package_basis(self):
        d,r,wf=self.linked();wf.update(package_hash='synthetic-package',delivery={'status':'sent','at':'2026-10-27T00:00:00+00:00'});self.s.workflow.save(wf)
        self.assertEqual(len([m for m in self.w.messages() if m.get('status')=='sent']),1)
        self.s.workflow._invalidate(wf)
        self.assertEqual(len([m for m in self.w.messages() if m.get('status')=='sent']),1)

    def test_purge_keeps_shared_blob_for_another_document_family(self):
        d=self.source();other=copy.deepcopy(d);other.update(id='synthetic-other-view',family_id='synthetic-other-view',name='Other source.txt');self.s.store.put('document',other)
        batch=self.w.trash({'entries':[{'kind':'document','id':d['id']}]});self.w.purge({'entries':[{'kind':'trash_batch','id':batch['batch_id']}],'confirmation':'DELETE'})
        self.assertTrue(self.s.documents.original(other['id']))

class ControlsHTTPTests(unittest.TestCase):
    def test_workspace_routes_are_authenticated_and_export_actual_selection(self):
        import threading,urllib.request,urllib.error
        from http.server import ThreadingHTTPServer
        from auditflow.server import handler_for
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'AUDITFLOW_ACCESS_TOKEN':'synthetic-controls-token'}):
            s=create_service(Path(tmp)/'db.sqlite3');server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(s));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base='http://127.0.0.1:'+str(server.server_port)
            def call(path,body=None,auth=True):
                headers={'Authorization':'Bearer synthetic-controls-token'} if auth else {}
                if body is not None:headers['Content-Type']='application/json'
                return urllib.request.urlopen(urllib.request.Request(base+path,headers=headers,data=json.dumps(body).encode() if body is not None else None))
            try:
                with self.assertRaises(urllib.error.HTTPError) as err:call('/api/workspace/state',auth=False)
                self.assertEqual(err.exception.code,401);err.exception.close()
                with call('/api/workspace/settings',{'language':'en','theme':'dark'}) as response:self.assertEqual(json.load(response)['language'],'en')
                with call('/api/workspace/export',{'entries':[{'kind':'case','id':'CASE-001'}],'format':'json'}) as response:self.assertEqual(json.load(response)['sections'][0]['data']['id'],'CASE-001')
                with call('/api/workspace/chat',{'question':'How does the system work?','language':'en','mode':'offline'}) as response:self.assertIn('read-only',json.load(response)['answer'])
                with call('/api/workspace/chat') as response:self.assertEqual(len(json.load(response)),1)
                for path in ['/controls.js','/locale.js']:
                    with call(path,auth=False) as response:self.assertEqual(response.status,200)
            finally:server.shutdown();server.server_close();thread.join();s.workspace.close();s.documents.close();s.workflow.close();s.automation.close()

if __name__=='__main__':unittest.main()
