import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server
from energy_math import Settings, derive, parse_data


class IndependentSensorTests(unittest.TestCase):
    def test_each_zone_uses_its_own_sensor_in_all_four_load_states(self):
        for sensor1, sensor2 in ((0, 0), (175, 0), (0, 260), (175, 260)):
            with self.subTest(sensor1=sensor1, sensor2=sensor2):
                packet = parse_data(
                    f'DATA,s1_mA={sensor1},s2_mA={sensor2},independent=1,boot=1,seq=1'
                )
                reading = derive(packet, Settings())
                self.assertEqual(reading['branch_a_ma'], sensor1)
                self.assertEqual(reading['branch_b_ma'], sensor2)
                self.assertEqual(reading['main_ma'], sensor1 + sensor2)
                self.assertAlmostEqual(reading['main_w'], (sensor1 + sensor2) * .23)
                self.assertEqual(reading['flags'], [])
                self.assertIsNone(reading['signed_residual_ma'])

    def test_reference_gains_apply_to_the_corresponding_sensor(self):
        reading = derive({'s1_mA': 100, 's2_mA': 200, 'independent': 1},
                         Settings(main_reference_gain=1.1, branch_reference_gain=.9))
        self.assertEqual(reading['branch_a_ma'], 110)
        self.assertEqual(reading['branch_b_ma'], 180)
        self.assertEqual(reading['main_ma'], 290)

    def test_old_packets_keep_their_original_feeder_branch_mapping(self):
        reading = derive({'s1_mA': 100, 's2_mA': 60}, Settings())
        self.assertEqual(reading['main_ma'], 100)
        self.assertEqual(reading['branch_a_ma'], 60)
        self.assertEqual(reading['branch_b_ma'], 40)

    def test_zone_b_only_serial_packet_reaches_dashboard_and_records_energy(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(server, 'DB', Path(directory) / 'energy.sqlite3'), \
                 patch.object(server, 'CONFIG', Path(directory) / 'config.json'), \
                 patch.dict('os.environ', {'MONGODB_URI': ''}):
                engine = server.EnergyEngine('LIVE')
                try:
                    with patch('server.time.monotonic', side_effect=[10, 12]):
                        for seq in (1, 2):
                            packet = parse_data(
                                f'DATA,s1_mA=0,s2_mA=260,independent=1,boot=1,seq={seq}'
                            )
                            engine.accept(packet)
                    state = server.create_app(engine).test_client().get('/api/dashboard').json
                    self.assertEqual(state['latest']['branch_a_ma'], 0)
                    self.assertEqual(state['latest']['branch_b_ma'], 260)
                    self.assertEqual(state['latest']['main_ma'], 260)
                    self.assertEqual(state['totals']['a_wh'], 0)
                    self.assertAlmostEqual(state['totals']['b_wh'], 59.8 * 2 / 3600, places=5)
                    self.assertEqual(state['totals']['total_wh'], state['totals']['b_wh'])
                    self.assertEqual(state['calibration_status'], 'AUTO_ON_FIRMWARE_BOOT')
                    self.assertFalse(engine.request_idle_calibration())
                finally:
                    engine.cloud.close()

    def test_layout_change_keeps_saved_energy_and_does_not_bridge_the_change(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(server, 'DB', Path(directory) / 'energy.sqlite3'), \
                 patch.object(server, 'CONFIG', Path(directory) / 'config.json'), \
                 patch.dict('os.environ', {'MONGODB_URI': ''}):
                server.init_db()
                with server.db_connection() as conn:
                    conn.execute("""INSERT INTO samples
                        (timestamp,main_ma,main_w,branch_a_w,branch_b_w,wh_total,wh_a,wh_b,flags,data_mode)
                        VALUES(1,100,23,12,11,50,30,20,'[]','LIVE')""")
                engine = server.EnergyEngine('LIVE')
                try:
                    with patch('server.time.monotonic', side_effect=[10, 12, 14]):
                        engine.accept({'s1_mA': 100, 's2_mA': 60,
                                       's1_raw_mA': 100, 'idle_valid': 1})
                        engine.accept({'s1_mA': 0, 's2_mA': 260, 'independent': 1})
                        self.assertEqual((engine.total_wh, engine.a_wh, engine.b_wh), (50, 30, 20))
                        engine.accept({'s1_mA': 0, 's2_mA': 260, 'independent': 1})
                    self.assertAlmostEqual(engine.total_wh, 50 + 59.8 * 2 / 3600)
                    self.assertEqual(engine.a_wh, 30)
                    self.assertAlmostEqual(engine.b_wh, 20 + 59.8 * 2 / 3600)
                    with server.db_connection() as conn:
                        original = conn.execute('SELECT wh_total,wh_a,wh_b FROM samples WHERE timestamp=1').fetchone()
                    self.assertEqual(tuple(original), (50, 30, 20))
                finally:
                    engine.cloud.close()


if __name__ == '__main__':
    unittest.main()
