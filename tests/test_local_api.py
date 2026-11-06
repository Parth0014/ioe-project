import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class LocalApiTests(unittest.TestCase):
    def test_existing_totals_survive_and_local_apis_work_without_cloud(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(server, 'DB', Path(directory)/'energy.sqlite3'), patch.object(server, 'CONFIG', Path(directory)/'config.json'), patch.dict('os.environ', {'MONGODB_URI': ''}):
                server.init_db()
                now = time.time()
                with server.db_connection() as conn:
                    conn.execute("INSERT INTO samples(timestamp,main_ma,main_w,branch_a_w,branch_b_w,wh_total,wh_a,wh_b,flags,data_mode) VALUES(?,100,23,12,11,50,30,20,'[]','LIVE')", (now-10,))
                engine = server.EnergyEngine('LIVE')
                try:
                    client = server.create_app(engine).test_client()
                    result = client.get('/api/dashboard')
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(result.json['totals']['total_wh'], 50)
                    self.assertEqual(result.json['source'], 'local')
                    self.assertFalse(result.json['cloud']['enabled'])
                    engine.accept({'s1_mA': 100, 's2_mA': 60})
                    self.assertEqual(client.get('/api/dashboard').json['connection'], 'CONNECTED')
                    report = client.get('/api/analytics?range=24h&mode=LIVE')
                    self.assertEqual(report.status_code, 200)
                    self.assertGreaterEqual(report.json['summary']['samples'], 2)
                    self.assertEqual(client.get('/api/analytics?range=all').status_code, 400)
                    self.assertEqual(client.get('/api/export.csv').status_code, 200)
                    self.assertEqual(client.get('/analytics').status_code, 200)
                    self.assertEqual(client.get('/').status_code, 200)
                finally:
                    engine.cloud.close()
