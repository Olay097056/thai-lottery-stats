"""Synthetic-only registry regression tests; no production database or cache."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timedelta
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import astra
import first_prize as fp

class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db_patch = patch.object(fp, 'DB', Path(self.temp.name)/'registry.sqlite3')
        self.db_patch.start()
        self.target = (datetime.now(astra.THAILAND_TZ).date()+timedelta(days=10)).isoformat()
    def tearDown(self):
        self.db_patch.stop()
        self.temp.cleanup()
    def test_first_record_is_immutable(self):
        first=fp.register(self.target,'test-v1',['000001','000002','000003','000004','000005'],{}, {})
        second=fp.register(self.target,'test-v1',['000011','000012','000013','000014','000015'],{}, {})
        self.assertTrue(first['created']); self.assertFalse(second['created'])
        self.assertEqual(first['record'],second['record'])
    def test_duplicates_and_invalid_numbers(self):
        with self.assertRaises(ValueError): fp.register(self.target,'test',['000001']*5,{}, {})
        with self.assertRaises(ValueError): fp.register(self.target,'test',['12345']*5,{}, {})
        saved=fp.register(self.target,'test',['000001','000001','000002','000003','000004','000005'],{}, {})
        self.assertEqual(saved['record']['duplicates_removed'],1)
        self.assertEqual(len(saved['record']['numbers']),5)
    def test_past_registration_refused(self):
        with self.assertRaises(astra.AstraInputError): fp.register('2000-01-01','test',['000001']*5,{}, {})
    def test_client_cannot_supply_probability_model(self):
        saved=fp.register(self.target,'test',['000001','000002','000003','000004','000005'],{'probability_model':{'bad':True}}, {})
        self.assertIsNone(saved['record']['probability'])
        self.assertNotIn('probability_model',saved['record']['settings'])
    def test_empty_board_never_reads_cache(self):
        with patch.object(astra,'load_existing_astra_history',side_effect=AssertionError('cache read')):
            self.assertEqual(fp.board()['records'],[])
    def test_future_outcome_remains_pending(self):
        fp.register(self.target,'test',['000001','000002','000003','000004','000005'],{}, {})
        with patch.object(astra,'load_existing_astra_history',return_value=[{'date':self.target,'prize1':'000001'}]):
            self.assertEqual(fp.board()['records'][0]['status'],'pending')

class ProbabilityAndAblationTests(RegistryTests):
    def test_normalized_uniform_model_and_resolved_score(self):
        model=astra._build_model([],6)
        model['log_partition']=0.0
        fp.register(self.target,'astra-v1',['000001','000002','000003','000004','000005'],{'probability_model':model},{'code_sha256':'synthetic'},source='server_existing_cache')
        saved=fp.records()[0]
        self.assertAlmostEqual(saved['probability'],5e-6,places=12)
        later=datetime.now(astra.THAILAND_TZ)+timedelta(days=20)
        class Later(datetime):
            @classmethod
            def now(cls,tz=None): return later
        with patch.object(fp,'datetime',Later),patch.object(astra,'load_existing_astra_history',return_value=[{'date':self.target,'prize1':'000001'}]):
            board=fp.board();record=board['records'][0]
        self.assertTrue(record['hit'])
        self.assertAlmostEqual(record['log_loss'],record['uniform_log_loss'])
        self.assertAlmostEqual(board['summaries'][0]['model_expected_hits'],5e-6)
    def test_conflicting_outcomes_are_not_scored(self):
        fp.register(self.target,'test',['000001','000002','000003','000004','000005'],{}, {})
        later=datetime.now(astra.THAILAND_TZ)+timedelta(days=20)
        class Later(datetime):
            @classmethod
            def now(cls,tz=None): return later
        with patch.object(fp,'datetime',Later),patch.object(astra,'load_existing_astra_history',return_value=[{'date':self.target,'prize1':'000001'},{'date':self.target,'prize1':'000002'}]):
            self.assertEqual(fp.board()['records'][0]['status'],'pending')
    def test_ablation_changes_only_explicit_variant(self):
        import astra_sigma
        draws=[(i,(str(i%100).zfill(2),)) for i in range(30)]
        original=dict(astra_sigma.WEIGHTS)
        ordinary,_=astra_sigma.rank_category('bottom2',draws,self.target,count=5)
        explicit,_=astra_sigma.rank_category('bottom2',draws,self.target,count=5,omitted_component=None)
        self.assertEqual(ordinary,explicit)
        for component in ('H','D','N','L','B'):
            result,_=astra_sigma.rank_category('bottom2',draws,self.target,count=5,omitted_component=component)
            self.assertEqual(len(result),5)
            self.assertEqual(len({r['number'] for r in result}),5)
        self.assertEqual(original,astra_sigma.WEIGHTS)

if __name__=='__main__': unittest.main()
