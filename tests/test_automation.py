import copy
import json
import tempfile
import time
import unittest
from pathlib import Path
from auditflow.server import create_service
from auditflow.automation import validate_package,generate_case,default_package,fingerprint
from auditflow.automation_reference import expectation
from auditflow.automation_target import execute
from auditflow.domain import InputError


class AutomationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'db.sqlite3'
        self.service=create_service(self.path);self.auto=self.service.automation
        self.project=self.auto.create_project({'manufacturer':'Demo manufacturer','software':'Demo payroll','software_version':'1.0'})

    def tearDown(self):self.auto.close();self.tmp.cleanup()

    def approve(self,id='AUTO-PACKAGE-1'):
        return self.auto.approve_package({'package_id':id,'reviewer':'Automated test identity','note':'Synthetic template test only','acknowledge_demo':True})

    def launch(self,**kwargs):
        self.approve();return self.auto.launch({'project_id':self.project['id'],'package_id':'AUTO-PACKAGE-1','count':18,**kwargs})

    def wait(self,job,states=('completed','failed','waiting_import')):
        deadline=time.monotonic()+35
        while time.monotonic()<deadline:
            result=self.auto.detail(job['id'])
            if result['status'] in states:
                self.assertNotEqual(result['status'],'failed',result.get('error'));return result
            time.sleep(.02)
        self.fail('Job timeout: '+str(self.auto.detail(job['id'])))

    def new_package(self,days=32,parent='AUTO-PACKAGE-1'):
        p=self.auto.store.get('auto_package',parent);rules=copy.deepcopy(p['rules']);rules['C4']['params']['days']=days
        new=self.auto.package_version({'parent_id':parent,'name':'Synthetic threshold change','rules':rules})
        return self.approve(new['id'])

    def test_unapproved_launch_is_blocked(self):
        with self.assertRaises(InputError):self.auto.launch({'project_id':self.project['id'],'package_id':'AUTO-PACKAGE-1','count':10})

    def test_no_fabricated_approval(self):
        with self.assertRaises(InputError):self.auto.approve_package({'package_id':'AUTO-PACKAGE-1','reviewer':'Test','note':'Test'})
        self.assertEqual(self.auto.store.get('auto_package','AUTO-PACKAGE-1')['status'],'pending')

    def test_one_approval_covers_template_generated_cases(self):
        job=self.wait(self.launch())
        self.assertEqual(job['completed'],18);self.assertEqual(job['counts']['fail'],0)
        self.assertEqual(job['counts']['not_assessable'],4)
        cases=self.auto.cases(job['suite_id'])
        self.assertEqual(cases['total'],18)
        self.assertEqual(len({c['profile']['id'] for c in cases['items']}),18)
        self.assertTrue(all(c['expectation_review']=='derived_from_authorized_template' for c in cases['items']))

    def test_independent_simulator_analytical_agreement(self):
        p=default_package()
        for i in range(90):
            c=generate_case(i,'suite',p)
            self.assertEqual(c['expectation']['message_present'],execute(c['profile'],p['rules'])['message_present'])

    def test_buggy_vendor_detected(self):
        job=self.wait(self.launch(behavior='always_send'))
        self.assertGreater(job['counts']['fail'],0)

    def test_4000_cases_profiles_pagination_and_bulk_report(self):
        job=self.wait(self.launch(count=4000))
        self.assertEqual(job['completed'],4000)
        self.assertEqual(sum(job['counts'].values()),4000)
        self.assertEqual(job['counts']['technical_error'],0)
        self.assertEqual(job['counts']['fail'],0)
        page=self.auto.cases(job['suite_id'],3990,25)
        self.assertEqual(len(page['items']),10)
        self.assertEqual(len(self.auto.export(job['id'],'report')['results']),4000)

    def test_change_selects_subset_and_detects_stale_vendor(self):
        old=self.wait(self.launch(count=90));new=self.new_package()
        plan=self.auto.impact({'suite_id':old['suite_id'],'package_id':new['id']})
        self.assertEqual(plan['changed_rules'],['C4'])
        self.assertGreater(plan['selected_count'],0);self.assertLess(plan['selected_count'],90)
        self.assertTrue(any('core_regression' in s['reasons'] for s in plan['selected']))
        rerun=self.wait(self.auto.rerun({'suite_id':old['suite_id'],'package_id':new['id'],'behavior':'outdated_threshold'}))
        self.assertEqual(rerun['total'],plan['selected_count']);self.assertGreater(rerun['counts']['fail'],0)
        self.assertEqual(self.auto.detail(old['id'])['package']['rules']['C4']['params']['days'],30)

    def test_change_uses_latest_completed_version(self):
        old=self.wait(self.launch(count=36));v2=self.new_package()
        self.wait(self.auto.rerun({'suite_id':old['suite_id'],'package_id':v2['id'],'behavior':'healthy'}))
        rules=copy.deepcopy(v2['rules']);rules['C1']['params']['require_current']=False
        v3=self.auto.package_version({'parent_id':v2['id'],'name':'Synthetic proof change','rules':rules});self.approve(v3['id'])
        plan=self.auto.impact({'suite_id':old['suite_id'],'package_id':v3['id']})
        self.assertEqual(plan['changed_rules'],['C1'])

    def test_import_missing_outputs_not_passed(self):
        job=self.wait(self.launch(count=9,mode='import'))
        self.assertEqual(job['status'],'waiting_import')
        inputs=self.auto.export(job['id'],'input');self.assertEqual(len(inputs['cases']),9)
        id=inputs['cases'][0]['case_id']
        self.auto.import_results({'job_id':job['id'],'records':[{'case_id':id,'observed':{'message_present':True}}]})
        done=self.wait(job)
        self.assertEqual(done['counts']['pass'],1);self.assertEqual(done['counts']['not_assessable'],8)

    def test_import_rejects_duplicates_unknown_and_bad_types(self):
        job=self.wait(self.launch(count=9,mode='import'));id=self.auto.export(job['id'],'input')['cases'][0]['case_id']
        good={'case_id':id,'observed':{'message_present':True}}
        for records in [[good,good],[{'case_id':'unknown','observed':{'message_present':True}}],[{'case_id':id,'observed':{'message_present':'true'}}]]:
            with self.assertRaises(InputError):self.auto.import_results({'job_id':job['id'],'records':records})
        self.assertEqual(self.auto.detail(job['id'])['status'],'waiting_import')

    def test_exact_boundary_never_silently_passes(self):
        p=default_package();c=generate_case(8,'s',p)
        self.assertIsNone(c['expectation']['message_present'])
        self.assertIsNone(execute(c['profile'],p['rules'])['message_present'])

    def test_dependency_cycle_rejected(self):
        p=default_package();p['rules']['C1']['depends_on']=['C4'];p['rules']['C4']['depends_on']=['C1']
        with self.assertRaises(InputError):validate_package(p['rules'])

    def test_unknown_rule_type_rejected(self):
        p=default_package();p['rules']['C4']['type']='arbitrary_code'
        with self.assertRaises(InputError):validate_package(p['rules'])

    def test_generation_deterministic_for_same_suite(self):
        p=default_package();self.assertEqual(generate_case(57,'s',p),generate_case(57,'s',p))

    def test_invalid_count_no_job_created(self):
        self.approve()
        for count in [True,0,4001,1.5,'4000']:
            with self.assertRaises(InputError):self.auto.launch({'project_id':self.project['id'],'package_id':'AUTO-PACKAGE-1','count':count})
        self.assertEqual(self.auto.state()['jobs'],[])

    def test_restart_preserves_completed_jobs(self):
        job=self.wait(self.launch())
        fresh=create_service(self.path)
        try:self.assertEqual(fresh.automation.detail(job['id'])['status'],'completed')
        finally:fresh.automation.close()

    def test_interrupted_chunks_resume_without_duplicate_results(self):
        self.approve()
        original=self.auto.store.put_many
        def checkpoint(items):
            original(items)
            if any(kind=='auto_job' and item.get('cursor',0)>=100 for kind,item in items):
                self.auto.stop.set()
        self.auto.store.put_many=checkpoint
        job=self.auto.launch({'project_id':self.project['id'],'package_id':'AUTO-PACKAGE-1','count':250})
        deadline=time.monotonic()+10
        while self.auto.detail(job['id'])['cursor']<100 and time.monotonic()<deadline:time.sleep(.01)
        self.auto.close()
        self.assertEqual(self.auto.detail(job['id'])['cursor'],100)
        fresh=create_service(self.path);self.auto=fresh.automation
        self.assertEqual(self.auto.detail(job['id'])['status'],'queued')
        self.auto.start();done=self.wait(job)
        self.assertEqual(done['completed'],250)
        self.assertEqual(self.auto.results(job['id'])['total'],250)
        self.assertEqual(sum(done['counts'].values()),250)

    def test_rule_approval_triggers_enabled_project_automatically(self):
        project=self.auto.store.get('auto_project',self.project['id']);project['auto_on_rule_change']=True
        self.auto.store.put('auto_project',project)
        old=self.wait(self.launch(count=36));new=self.new_package()
        deadline=time.monotonic()+10;triggered=None
        while time.monotonic()<deadline:
            triggered=next((j for j in self.auto.state()['jobs'] if j.get('trigger')=='approved_rule_change'),None)
            if triggered:break
            time.sleep(.02)
        self.assertIsNotNone(triggered)
        done=self.wait(triggered)
        self.assertEqual(done['package']['id'],new['id'])
        self.assertEqual(done['selection'],'impact');self.assertLess(done['total'],36)
        self.assertEqual(self.auto.detail(old['id'])['package']['id'],'AUTO-PACKAGE-1')

    def test_annual_rerun_reuses_profiles(self):
        old=self.wait(self.launch(count=18))
        new=self.wait(self.auto.full_rerun({'suite_id':old['suite_id'],'package_id':'AUTO-PACKAGE-1'}))
        self.assertEqual(new['total'],18);self.assertEqual(new['selection'],'annual')
        self.assertEqual(self.auto.cases(old['suite_id'])['total'],18)
        self.assertEqual(len(self.auto.state()['suites']),1)

    def test_full_rerun_never_silently_simulates_imported_software(self):
        old=self.wait(self.launch(count=9,mode='import'))
        first=self.auto.export(old['id'],'input')['cases'][0]['case_id']
        self.auto.import_results({'job_id':old['id'],'records':[{'case_id':first,'observed':{'message_present':True}}]})
        self.wait(old)
        again=self.wait(self.auto.full_rerun({'suite_id':old['suite_id'],'package_id':'AUTO-PACKAGE-1'}))
        self.assertEqual(again['mode'],'import');self.assertEqual(again['status'],'waiting_import')

    def test_waiting_import_can_cancel(self):
        job=self.wait(self.launch(mode='import'));self.auto.cancel(job['id'])
        self.assertEqual(self.auto.detail(job['id'])['status'],'cancelled')
        self.auto.resume(job['id']);self.assertEqual(self.wait(job)['status'],'waiting_import')

    def test_rule_package_hash_required(self):
        self.approve();p=self.auto.store.get('auto_package','AUTO-PACKAGE-1');p['rules']['C4']['params']['days']=90
        self.auto.store.put('auto_package',p)
        with self.assertRaises(InputError):self.auto.launch({'package_id':p['id'],'project_id':self.project['id']})


class AutomationHTTPTests(unittest.TestCase):
    def setUp(self):
        import threading
        from http.server import ThreadingHTTPServer
        from auditflow.server import handler_for
        self.tmp=tempfile.TemporaryDirectory();self.service=create_service(Path(self.tmp.name)/'http.sqlite3')
        self.server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(self.service))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url='http://127.0.0.1:'+str(self.server.server_port)
    def tearDown(self):
        self.server.shutdown();self.service.automation.close();self.server.server_close();self.thread.join();self.tmp.cleanup()
    def request(self,path,body=None):
        import urllib.request
        req=urllib.request.Request(self.url+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req) as r:return r.read()
    def test_database_connection_is_closed_after_context(self):
        import sqlite3
        with self.service.store.connect() as connection:
            self.assertEqual(connection.execute('SELECT 1').fetchone()[0],1)
        with self.assertRaises(sqlite3.ProgrammingError):connection.execute('SELECT 1')
    def test_state_and_automation_asset(self):
        self.assertIn('packages',json.loads(self.request('/api/automation/state')))
        self.assertIn(b'manufacturerWorkspace',self.request('/automation.js'))
    def test_job_routes_import_and_csv(self):
        p=json.loads(self.request('/api/automation/project',{'manufacturer':'HTTP demo','software':'HTTP mock','software_version':'1'}))
        self.request('/api/automation/approve',{'package_id':'AUTO-PACKAGE-1','reviewer':'HTTP test','note':'Synthetic only','acknowledge_demo':True})
        job=json.loads(self.request('/api/automation/start',{'project_id':p['id'],'package_id':'AUTO-PACKAGE-1','count':9,'mode':'import'}))
        deadline=time.monotonic()+10
        while time.monotonic()<deadline:
            j=json.loads(self.request('/api/automation/jobs/'+job['id']))
            if j['status']=='waiting_import':break
            time.sleep(.01)
        self.assertEqual(j['status'],'waiting_import')
        cases=json.loads(self.request('/api/automation/cases/'+job['suite_id']+'?offset=0&limit=1'))
        self.assertEqual(cases['total'],9);self.assertEqual(len(cases['items']),1)
        data=json.loads(self.request('/api/automation/jobs/'+job['id']+'/input'))
        self.assertEqual(len(data['cases']),9)
        self.request('/api/automation/import',{'job_id':job['id'],'records':[{'case_id':data['cases'][0]['case_id'],'observed':{'message_present':True}}]})
        while time.monotonic()<deadline:
            j=json.loads(self.request('/api/automation/jobs/'+job['id']))
            if j['status']=='completed':break
            time.sleep(.01)
        self.assertEqual(j['counts']['not_assessable'],8)
        self.assertIn(b'case_id,profile_id,status',self.request('/api/automation/jobs/'+job['id']+'/csv'))
        self.assertEqual(json.loads(self.request('/api/automation/jobs/'+job['id']+'/results'))['total'],9)

if __name__=='__main__':unittest.main()
