import os
import sqlite3
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

from cloud import CloudStore
from analytics import local_analytics


@contextmanager
def connect(path):
    conn = sqlite3.connect(path)
    try:
        with conn:
            yield conn
    finally:
        conn.close()


class CloudTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "test.sqlite3"
        with connect(self.db) as c:
            c.execute("CREATE TABLE samples(timestamp REAL PRIMARY KEY, main_ma REAL, main_w REAL, branch_a_w REAL, branch_b_w REAL, wh_total REAL, wh_a REAL, wh_b REAL, residual_ma REAL, flags TEXT, data_mode TEXT)")
            c.execute("CREATE TABLE events(id INTEGER PRIMARY KEY, timestamp REAL, kind TEXT, title TEXT, details TEXT, data_mode TEXT)")
            c.executemany("INSERT INTO samples VALUES(?,100,100,60,40,?,?,?,0,'[]','LIVE')", [(100, 0, 0, 0), (101, 1, .6, .4), (102, 2, 1.2, .8)])

    def tearDown(self):
        self.tmp.cleanup()

    def test_unconfigured_keeps_backlog(self):
        store = CloudStore(self.db, uri="", start_worker=False)
        self.assertFalse(store.enabled)
        self.assertEqual(store.queued, 3)

    def test_new_rows_survive_clock_rollback_and_vacuum(self):
        store = CloudStore(self.db, uri='mongodb://example', start_worker=False)
        store.acknowledge('samples', store.pending_batch('samples')[-1][0])
        with connect(self.db) as c:
            c.execute("INSERT INTO samples VALUES(90,100,100,60,40,3,1.8,1.2,0,'[]','LIVE')")
        with connect(self.db) as c:
            c.execute('VACUUM')
        self.assertEqual(store.pending_batch('samples')[0][2]['ts'], 90)
        self.assertEqual(store.queued, 1)

    def test_source_rollback_does_not_create_phantom_upload(self):
        store = CloudStore(self.db, uri='', start_worker=False)
        with connect(self.db) as c:
            c.execute("INSERT INTO events VALUES(1,100,'info','test','details','LIVE')")
            c.rollback()
        self.assertEqual(store.pending_batch('events'), [])

    def test_restart_replays_same_identity_until_acknowledged(self):
        a = CloudStore(self.db, uri="mongodb://example", start_worker=False)
        rows = a.pending_batch("samples")
        b = CloudStore(self.db, uri="mongodb://example", start_worker=False)
        self.assertEqual(rows, b.pending_batch("samples"))
        self.assertEqual(a.device_id, b.device_id)
        a.acknowledge("samples", rows[-1][0])
        self.assertEqual(b.pending_batch("samples"), [])
        other = CloudStore(self.db, uri="mongodb://other", start_worker=False)
        self.assertEqual(len(other.pending_batch("samples")), 3)

    def test_retry_after_partial_remote_write_is_idempotent(self):
        store = CloudStore(self.db, uri="mongodb://example", start_worker=False)
        class Collection:
            def __init__(self): self.docs = {}; self.fail = True
            def bulk_write(self, operations, **kwargs):
                for op in operations:
                    self.docs[op._filter['_id']] = op._doc['$set']
                    if self.fail:
                        self.fail = False
                        raise OSError("connection lost after first write")
        collection = Collection()
        store.samples = collection
        with self.assertRaises(OSError): store.sync_collection("samples")
        self.assertEqual(store.queued, 3)
        store.sync_collection("samples")
        self.assertEqual(len(collection.docs), 3)
        self.assertEqual(store.queued, 0)

    def test_analytics_uses_deltas_and_separates_modes(self):
        with connect(self.db) as c:
            c.execute("INSERT INTO samples VALUES(100.5,100,100,60,40,100,60,40,0,'[]','DEMO')")
            c.row_factory = sqlite3.Row
            result = local_analytics(c, "LIVE", 100, 103, 3600, 5.56)
        self.assertAlmostEqual(result[0]['energy_wh'], 2)
        self.assertAlmostEqual(result[0]['a_wh'], 1.2)
        self.assertEqual(result[0]['samples'], 3)

    def test_boundary_baseline_reset_and_gap(self):
        with connect(self.db) as c:
            c.execute("INSERT INTO samples VALUES(110,100,100,60,40,1,.6,.4,0,'[]','LIVE')")
            c.row_factory = sqlite3.Row
            rows = local_analytics(c, "LIVE", 101, 111, 3600, 5.56)
        self.assertEqual(rows[0]['energy_wh'], 2)
        self.assertEqual(rows[0]['resets'], 1)
        self.assertEqual(rows[0]['recorded_seconds'], 1)


if __name__ == '__main__': unittest.main()
