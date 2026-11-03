"""Synthetic cache health and HTTP errors; never reads the real lottery cache."""
import csv
from datetime import datetime, timezone, timedelta
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import data_status
import main
import scraper
import pandas as pd
from fastapi.testclient import TestClient

NOW = datetime(2026, 10, 14, tzinfo=timezone(timedelta(hours=7)))


def row(day='2026-10-01'):
    result = {'date': day}
    for key, _, digits, slots in data_status.CATEGORIES:
        values = [str(i).zfill(digits) for i in range(slots)]
        if slots == 1:
            result[key] = values[0]
        elif key in ('prize4', 'prize5'):
            result[key] = ' '.join(values)
        else:
            result.update({f'{key}_{i+1}': value for i, value in enumerate(values)})
    return result


class DataStatusTests(unittest.TestCase):
    def test_complete_leading_zero_values(self):
        report = data_status.cache_health([row()], checked_at=NOW)
        self.assertEqual(report['state'], 'ready')
        self.assertTrue(all(c['latest_draw_complete'] for c in report['categories']))

    def test_missing_category_not_fabricated(self):
        sample = row()
        sample['prize4'] = ''
        report = data_status.cache_health([sample], checked_at=NOW)
        category = next(c for c in report['categories'] if c['key']=='prize4')
        self.assertEqual((category['valid_draws'], category['latest_valid_date']), (0, None))
        self.assertEqual(report['state'], 'warning')

    def test_duplicates_future_and_invalid_dates_are_excluded(self):
        report = data_status.cache_health([row(), row(), row('2026-10-16'), row('2026-02-30')], checked_at=NOW)
        self.assertEqual(report['rejected_date_rows'], 4)
        self.assertEqual(report['state'], 'empty')

    def test_stale_threshold(self):
        self.assertFalse(data_status.cache_health([row('2026-09-09')], checked_at=NOW)['stale'])
        self.assertTrue(data_status.cache_health([row('2026-09-08')], checked_at=NOW)['stale'])

    def test_no_number_repair_or_prize_pool_duplicates(self):
        sample=row()
        sample['prize1']='12345'
        sample['prize2_2']=sample['prize2_1']
        sample['back3_2']=sample['back3_1']
        report=data_status.cache_health([sample], checked_at=NOW)
        statuses={c['key']:c['latest_draw_complete'] for c in report['categories']}
        self.assertFalse(statuses['prize1']);self.assertFalse(statuses['prize2']);self.assertTrue(statuses['back3'])

    def test_read_only_version_changes_with_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'fixture.csv'
            sample=row()
            with path.open('w',encoding='utf-8',newline='') as stream:
                writer=csv.DictWriter(stream,fieldnames=list(sample));writer.writeheader();writer.writerow(sample)
            before=path.read_bytes()
            report=data_status.read_cache_health(path,NOW)
            self.assertEqual(path.read_bytes(),before)
            self.assertEqual(report['data_version'],data_status.hashlib.sha256(before).hexdigest())

    def test_missing_cache_http_status_and_no_refresh(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main,'BASE_DIR',Path(directory)), patch.object(main,'get_df',side_effect=AssertionError('loader forbidden')), patch.object(main,'incremental_update',side_effect=AssertionError('refresh forbidden')):
            response=TestClient(main.app).get('/api/data-status')
            self.assertEqual(response.status_code,404)
            self.assertEqual(response.json()['error_code'],'cache_missing')
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_analysis_gets_do_not_start_scraping_when_cache_is_missing(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(main,'BASE_DIR',Path(directory)), \
             patch.object(main,'_df_cache',None), patch.object(main,'_df_signature',None), \
             patch.object(main,'load_data',side_effect=AssertionError('network scrape forbidden')) as loader:
            client=TestClient(main.app)
            for endpoint in ('/api/summary','/api/prize-history?n=20','/api/predict/all?date=2026-11-01'):
                with self.subTest(endpoint=endpoint):
                    response=client.get(endpoint)
                    self.assertEqual(response.status_code,503,response.text)
                    self.assertEqual(response.json()['error_code'],'cache_missing')
                    self.assertFalse(response.json()['retryable'])
            loader.assert_not_called()
            self.assertEqual(list(Path(directory).iterdir()),[])

    def test_cache_only_loader_does_not_scrape_if_file_disappears_during_read(self):
        with tempfile.TemporaryDirectory() as directory, \
             patch.object(scraper,'CACHE_FILE',Path(directory)/'lottery_cache.csv'), \
             patch.object(scraper,'scrape_year',side_effect=AssertionError('network scrape forbidden')) as scrape:
            with self.assertRaises(FileNotFoundError):
                scraper.load_data(allow_scrape=False)
            scrape.assert_not_called()

    def test_analysis_get_handles_cache_disappearing_after_signature_read(self):
        with patch.object(main,'_df_cache',None), patch.object(main,'_df_signature',None), \
             patch.object(main,'_cache_signature',return_value=(1,1)), \
             patch.object(main,'load_data',side_effect=FileNotFoundError) as loader:
            response=TestClient(main.app).get('/api/prize-history?n=20')
            self.assertEqual(response.status_code,503,response.text)
            self.assertEqual(response.json()['error_code'],'cache_missing')
            self.assertFalse(response.json()['retryable'])
            loader.assert_called_once_with(allow_scrape=False)

    def test_analysis_get_reports_invalid_cache_without_retrying(self):
        with patch.object(main,'_df_cache',None), patch.object(main,'_df_signature',None), \
             patch.object(main,'_cache_signature',return_value=(1,1)), \
             patch.object(main,'load_data',side_effect=pd.errors.ParserError('private cache detail')) as loader:
            response=TestClient(main.app).get('/api/summary')
            self.assertEqual(response.status_code,422,response.text)
            self.assertEqual(response.json()['error_code'],'cache_invalid')
            self.assertFalse(response.json()['retryable'])
            self.assertNotIn('private cache detail',response.text)
            loader.assert_called_once_with(allow_scrape=False)

    def test_invalid_csv_safe_error(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(main,'BASE_DIR',Path(directory)):
            path=Path(directory)/'lottery_cache.csv';path.write_text('date,date\nx,x\n',encoding='utf-8')
            response=TestClient(main.app).get('/api/data-status')
            self.assertEqual(response.status_code,422)
            self.assertEqual(response.json()['error_code'],'cache_invalid')

    def test_calculation_error_has_safe_non_success_status(self):
        with patch.object(main.logging.Logger,'error'):
            response=main._api_failure(RuntimeError('secret-file-path'),data=[])
        self.assertEqual(response.status_code,500)
        self.assertNotIn(b'secret-file-path',response.body)
        self.assertIn(b'calculation_failed',response.body)

    def test_provenance_excludes_target_and_future_inputs(self):
        frame=pd.DataFrame({'date':pd.to_datetime(['2026-10-01','2026-10-16']), 'prize1':['000001','999999']})
        target=pd.Timestamp('2026-10-16')
        first=data_status.prediction_provenance(frame,target)
        frame.loc[1,'prize1']='111111'
        second=data_status.prediction_provenance(frame,target)
        self.assertEqual(first['data_version'],second['data_version'])
        self.assertEqual(first['history_cutoff'],'2026-10-01')
        self.assertEqual(first['input_draws'],1)
        self.assertEqual(len(first['engine_sha256']),64)

    def test_partial_prediction_retains_category_failure_and_provenance(self):
        frame=pd.DataFrame({'date':pd.to_datetime(['2026-10-01']), 'prize1':['000001']})
        with patch.object(main,'get_df',return_value=frame), patch.object(main,'predict_prize1_ultimate',return_value=pd.DataFrame()), patch.object(main,'predict_with_reasons',side_effect=RuntimeError('private_details')):
            result=main.api_predict_all(top_n=5,beam_width=50,k_back=10,preset='balanced',date='2026-10-16')
        self.assertEqual(result['report_status'],'partial')
        self.assertEqual(result['categories']['bottom2']['error_code'],'calculation_failed')
        self.assertNotIn('private_details',str(result))
        self.assertEqual(result['report_provenance']['history_cutoff'],'2026-10-01')

    def test_prize1_preset_echoes_normalized_requested_target(self):
        frame=pd.DataFrame({'date':pd.to_datetime(['2026-10-01']), 'prize1':['000001']})
        prediction=pd.DataFrame([{'num':'000007','score':1.0}])
        with patch.object(main,'get_df',return_value=frame), patch.object(main,'predict_prize1_ultimate',return_value=prediction):
            result=main.api_predict_prize1(top_n=5,beam_width=50,k_back=10,preset='balanced',date='2026-11-01')
        self.assertEqual(result['date'],'2026-11-01')
        self.assertEqual(result['predictions'][0]['num'],'000007')

    def test_lucky_news_returns_the_normalized_requested_target(self):
        class FakeResponse:
            text='Lucky results include 007 and 05.'

        class FakeClient:
            def __init__(self,**_kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*_args): return False
            async def get(self,*_args,**_kwargs): return FakeResponse()
        FakeResponse.raise_for_status=lambda self: None

        with patch('httpx.AsyncClient',FakeClient):
            response=TestClient(main.app).get('/api/lucky-news?date=2026-11-01')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['date'],'2026-11-01')
        self.assertIn('1 พ.ย. 2569',response.json()['query'])

    def test_lucky_news_source_failure_is_not_reported_as_empty_success(self):
        class FakeClient:
            def __init__(self,**_kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self,*_args): return False
            async def get(self,*_args,**_kwargs): raise RuntimeError('fixture source failure')

        with patch('httpx.AsyncClient',FakeClient):
            response=TestClient(main.app).get('/api/lucky-news?date=2026-11-01')
        payload=response.json()
        self.assertEqual(response.status_code,200)
        self.assertEqual(payload['date'],'2026-11-01')
        self.assertFalse(payload['ok'])
        self.assertEqual(payload['error_code'],'news_source_unavailable')
        self.assertEqual(payload['numbers_3'],[])


if __name__=='__main__':
    unittest.main()
