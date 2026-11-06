"""Opt-in real MongoDB tests; only accepts a disposable localhost server."""
import os
import time
import unittest
import uuid
from unittest.mock import patch
from urllib.parse import urlparse

from analytics import local_analytics, mongo_analytics
from cloud import CloudStore
from cloud_dashboard import MongoReader
from tests import test_cloud as fixtures
from tests.test_cloud import connect


@unittest.skipUnless(os.environ.get('GRIDSCOPE_TEST_MONGO_URI'), 'Set GRIDSCOPE_TEST_MONGO_URI to a disposable localhost MongoDB')
class MongoIntegration(unittest.TestCase):
    def setUp(self):
        fixtures.CloudTests.setUp(self)
        self.uri = os.environ['GRIDSCOPE_TEST_MONGO_URI']
        if urlparse(self.uri).hostname not in ('localhost', '127.0.0.1'):
            raise RuntimeError('Integration tests may only use localhost MongoDB')
        self.name = 'gridscope_test_' + uuid.uuid4().hex
        self.env = patch.dict(os.environ, {'MONGODB_DB': self.name})
        self.env.start()
        self.store = CloudStore(self.db, uri=self.uri, start_worker=False)
        self.store._connect()

    def tearDown(self):
        self.store.client.drop_database(self.name)
        self.store.close()
        self.env.stop()
        fixtures.CloudTests.tearDown(self)

    def test_actual_upserts_aggregation_and_device_scope(self):
        self.store.sync_collection('samples')
        self.store.acknowledge('samples', 0)  # acknowledgement never regresses
        self.store.sync_collection('samples')
        scope = {'device_id': self.store.device_id, 'mode': 'LIVE'}
        self.assertEqual(self.store.samples.count_documents(scope), 3)
        self.store.samples.insert_one({'device_id': 'other', 'mode': 'LIVE', 'ts': 101, 'wh_total': 99999, 'main_w': 99999})
        actual = mongo_analytics(self.store.samples, self.store.device_id, 'LIVE', 101, 103, 3600)
        with connect(self.db) as conn:
            import sqlite3
            conn.row_factory = sqlite3.Row
            expected = local_analytics(conn, 'LIVE', 101, 103, 3600, 5.56)
        self.assertEqual(actual, expected)
        self.assertEqual(mongo_analytics(self.store.samples, self.store.device_id, 'DEMO', 100, 103, 3600), [])

    def test_real_reset_gap_events_and_throttle(self):
        with connect(self.db) as conn:
            conn.execute("INSERT INTO samples VALUES(110,100,100,60,40,1,.6,.4,0,'[]','LIVE')")
            conn.execute("INSERT INTO events VALUES(1,110,'warning','Test event','Test details','LIVE')")
        self.store.sync_collection('samples')
        self.store.sync_collection('events')
        actual = mongo_analytics(self.store.samples, self.store.device_id, 'LIVE', 101, 111, 3600)
        self.assertEqual(actual[0]['energy_wh'], 2)
        self.assertEqual(actual[0]['recorded_seconds'], 1)
        self.assertEqual(actual[0]['resets'], 1)
        reader = MongoReader(self.uri, self.name, self.store.device_id)
        try:
            for _ in range(15): self.assertTrue(reader.allow_login('test-client'))
            self.assertFalse(reader.allow_login('test-client'))
            self.assertEqual(reader.db.events.find_one({'device_id': self.store.device_id})['title'], 'Test event')
            response = reader.analytics('24h', 'LIVE')
            self.assertEqual(response['summary']['samples'], 0)
            self.assertEqual(response['device_id'], self.store.device_id)
        finally:
            reader.client.close()

    def test_background_worker_backfills_and_resumes(self):
        worker = CloudStore(self.db, uri=self.uri)
        try:
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline and not (worker.ok and worker.queued == 0):
                time.sleep(.05)
            self.assertTrue(worker.ok, worker.error)
            self.assertEqual(worker.queued, 0)
            self.assertEqual(worker.samples.count_documents({'device_id': worker.device_id}), 3)
            self.assertIsNotNone(worker.devices.find_one({'_id': worker.device_id})['heartbeat'])
        finally:
            worker.close()
        with connect(self.db) as conn:
            conn.execute("INSERT INTO events VALUES(1,110,'info','Offline event','Saved while worker stopped','LIVE')")
        restarted = CloudStore(self.db, uri=self.uri)
        try:
            deadline = time.monotonic() + 12
            while time.monotonic() < deadline and not (restarted.ok and restarted.queued == 0):
                time.sleep(.05)
            self.assertTrue(restarted.ok, restarted.error)
            self.assertEqual(restarted.events.count_documents({'device_id': restarted.device_id}), 1)
            self.assertEqual(restarted.samples.count_documents({'device_id': restarted.device_id}), 3)
        finally:
            restarted.close()
