import copy
import json
import unittest
from datetime import date
from pathlib import Path
from auditflow.domain import InputError, add_months, assess, check_chain, aggregate
from auditflow.parser import parse, mutate
ROOT=Path(__file__).resolve().parents[1]
SEED=json.loads((ROOT/'data/seed.json').read_text())

class CalendarTests(unittest.TestCase):
    def test_month_end_and_leap_year(self):
        self.assertEqual(add_months(date(2024,8,31),6),date(2025,2,28))
        self.assertEqual(add_months(date(2023,8,31),6),date(2024,2,29))
        self.assertEqual(add_months(date(2024,2,29),-12),date(2023,2,28))

    def test_source_fixture_has_35_days(self):
        result=assess(SEED['cases'][0]['scenario'])
        self.assertEqual(result[-1]['actual'],35)
        self.assertEqual([r['status'] for r in result],['pass','pass','pass'])

    def test_independent_threshold_cases(self):
        for id,total,status in [('CASE-003',29,'fail'),('CASE-004',30,'pass'),('CASE-005',31,'pass')]:
            s=next(c['scenario'] for c in SEED['cases'] if c['id']==id)
            result=assess(s)[-1]
            self.assertEqual(result['actual'],total)
            self.assertEqual(result['status'],status)

    def test_exact_boundary_unresolved(self):
        result=assess(SEED['cases'][7]['scenario'])
        self.assertEqual(result[1]['status'],'not_assessable')

    def test_open_au_needs_explicit_policy(self):
        s=copy.deepcopy(SEED['cases'][5]['scenario'])
        self.assertEqual(assess(s)[-1]['status'],'not_assessable')
        s['open_end_policy']='reviewed_inclusive_7_days'
        # June 11 through June 17 inclusive = 7; prior system stock = 25.
        self.assertEqual(assess(s)[-1]['actual'],32)

    def test_invalid_calendar_dates_rejected(self):
        s=copy.deepcopy(SEED['cases'][0]['scenario']);s['current']['end']='2026-02-30'
        with self.assertRaises(InputError):assess(s)

    def test_overlap_not_double_counted(self):
        s=copy.deepcopy(SEED['cases'][0]['scenario']);s['prior'].append(copy.deepcopy(s['prior'][0]))
        with self.assertRaises(InputError):assess(s)

    def test_unknown_proof_not_silently_false(self):
        s=copy.deepcopy(SEED['cases'][0]['scenario']);s['current']['certified']=None
        self.assertEqual(assess(s)[0]['status'],'not_assessable')

    def test_threshold_is_not_message_sum(self):
        s=SEED['cases'][0]['scenario'];one=[{'begin':'2026-03-01','end':'2026-03-03'}]
        self.assertEqual(check_chain(one,s)['status'],'pass')
        self.assertEqual(assess(s)[-1]['actual'],35)

    def test_long_gap_fails_chain(self):
        s=copy.deepcopy(SEED['cases'][0]['scenario'])
        s['prior']=[{'begin':'2025-01-01','end':'2025-01-31','certified':True}]
        self.assertEqual(check_chain(s['prior'],s)['status'],'fail')

    def test_invalid_current_proof_status_rejected(self):
        s=copy.deepcopy(SEED['cases'][0]['scenario']);s['current']['certified']='yes'
        with self.assertRaises(InputError):assess(s)

    def test_empty_results_not_pass(self):self.assertEqual(aggregate([]),'not_assessable')

class FixtureParserTests(unittest.TestCase):
    def setUp(self):self.raw=(ROOT/'data/sample.teel').read_bytes()
    def test_original_fixture(self):
        p=parse(self.raw)
        self.assertEqual(p['abgabegrund'],'41')
        self.assertEqual(p['dbvo']['count'],4)
        self.assertEqual(p['dbvo']['au_ab_ag'],'2026-06-11')
        self.assertTrue(p['dbvo']['insurer_fields_zero'])
        self.assertEqual(p['dbid']['aktenzeichen_verursacher'],'DEMO-REFERENCE-001')
        self.assertNotEqual(p['dbid']['referenz_id'],'DEMO-REFERENCE-001')
        self.assertEqual(p['blocks']['DBVO']['position'],350)
    def test_mutated_period(self):
        p=parse(mutate(self.raw,'wrong_period'))
        self.assertEqual(p['dbvo']['periods'][0]['begin'],'2026-02-28')
    def test_truncation_is_technical(self):
        with self.assertRaises(InputError):parse(mutate(self.raw,'truncated'))
    def test_header_flags_checked(self):
        b=self.raw.replace(b'JNNNNNNNNNJNNNNNJJN',b'XNNNNNNNNNJNNNNNJJN')
        with self.assertRaises(InputError):parse(b)
    def test_embedded_token_does_not_locate_block(self):
        # DBNA contents can contain the token DBVO without moving the real block.
        lines=self.raw.splitlines(keepends=True)
        for i,line in enumerate(lines):
            if line.startswith(b'DSLW'):
                b=bytearray(line);b[250:254]=b'DBVO';lines[i]=bytes(b)
        self.assertEqual(parse(b''.join(lines))['blocks']['DBVO']['position'],350)

if __name__=='__main__':unittest.main()
