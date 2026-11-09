import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import server


class LocalApiTests(unittest.TestCase):
    def test_open_serial_port_without_packets_reports_waiting_state(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(server, 'DB', Path(directory)/'energy.sqlite3'), patch.object(server, 'CONFIG', Path(directory)/'config.json'), patch.dict('os.environ', {'MONGODB_URI': ''}):
                engine = server.EnergyEngine('LIVE')
                engine.port = 'COM5'
                engine.connection_status = 'WAITING_FOR_DATA'
                engine.error = 'Serial port COM5 is open; waiting for DATA at 115200 baud.'
                try:
                    response = server.create_app(engine).test_client().get('/api/dashboard')
                    self.assertEqual(response.json['connection'], 'WAITING')
                    self.assertIsNone(response.json['latest'])
                    self.assertIn('COM5', response.json['error'])
                finally:
                    engine.cloud.close()

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
                    analytics_page = client.get('/analytics')
                    self.assertEqual(analytics_page.status_code, 200)
                    self.assertIn(b'class="app-header"', analytics_page.data)
                    self.assertIn(b'id="nav-dashboard"', analytics_page.data)
                    self.assertNotIn(b'id="mode"', analytics_page.data)
                    self.assertNotIn(b'Demo data', analytics_page.data)
                    self.assertEqual(client.get('/').status_code, 200)
                finally:
                    engine.cloud.close()

    def test_clear_data_requires_confirmation_and_restarts_history_from_zero(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(server, 'DB', Path(directory)/'energy.sqlite3'), patch.object(server, 'CONFIG', Path(directory)/'config.json'), patch.dict('os.environ', {'MONGODB_URI': ''}):
                server.init_db()
                with server.db_connection() as conn:
                    conn.execute("INSERT INTO samples(timestamp,main_ma,main_w,branch_a_w,branch_b_w,wh_total,wh_a,wh_b,flags,data_mode) VALUES(1,100,23,12,11,50,30,20,'[]','LIVE')")
                    conn.execute("INSERT INTO events(timestamp,kind,title,details,data_mode) VALUES(1,'info','Old event','Old details','LIVE')")
                engine = server.EnergyEngine('LIVE')
                try:
                    device_id = engine.cloud.device_id
                    engine.previous_power = {'main_w': 23, 'branch_a_w': 12, 'branch_b_w': 11,
                                             'sensor_layout': 'independent'}
                    engine.last_recorded_wall = 10
                    engine.events.append({'title': 'Old event'})
                    engine.last_alert_at['demand'] = 1
                    engine.alert_hits['demand'] = 4
                    client = server.create_app(engine).test_client()

                    self.assertIn(b'id="clear-data-button"', client.get('/').data)
                    self.assertEqual(client.get('/api/clear-data').status_code, 405)
                    rejected = client.post('/api/clear-data', json={'confirmation': 'wrong'})
                    self.assertEqual(rejected.status_code, 400)
                    with server.db_connection() as conn:
                        self.assertEqual(conn.execute('SELECT COUNT(*) FROM samples').fetchone()[0], 1)

                    result = client.post('/api/clear-data', json={'confirmation': 'clear data'})
                    self.assertEqual(result.status_code, 200)
                    self.assertEqual(result.json['deleted'], {'samples': 1, 'events': 1})
                    self.assertEqual(result.json['state']['totals']['total_wh'], 0)
                    self.assertEqual(result.json['state']['history'], [])
                    self.assertEqual(result.json['state']['events'], [])
                    self.assertEqual(engine.cloud.device_id, device_id)
                    self.assertEqual((engine.total_wh, engine.a_wh, engine.b_wh), (0, 0, 0))
                    self.assertIsNone(engine.previous_power)
                    self.assertEqual(engine.last_recorded_wall, 0)
                    self.assertEqual(list(engine.events), [])
                    self.assertEqual(engine.last_alert_at, {})
                    self.assertEqual(engine.alert_hits, {})
                    with server.db_connection() as conn:
                        self.assertEqual(conn.execute('SELECT COUNT(*) FROM samples').fetchone()[0], 0)
                        self.assertEqual(conn.execute('SELECT COUNT(*) FROM events').fetchone()[0], 0)
                        self.assertEqual(conn.execute('SELECT COUNT(*) FROM cloud_outbox').fetchone()[0], 0)

                    engine.accept({'s1_mA': 100, 's2_mA': 60, 'independent': 1})
                    self.assertEqual((engine.total_wh, engine.a_wh, engine.b_wh), (0, 0, 0))
                    with server.db_connection() as conn:
                        self.assertEqual(conn.execute('SELECT COUNT(*) FROM samples').fetchone()[0], 1)
                finally:
                    engine.cloud.close()
