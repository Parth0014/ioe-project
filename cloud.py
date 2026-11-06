"""Restart-safe SQLite to MongoDB replication. SQLite is the durable outbox."""
from __future__ import annotations
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path


class CloudStore:
    def __init__(self, db_path, *, uri=None, start_worker=True):
        self.db_path = Path(db_path)
        self.uri = os.environ.get("MONGODB_URI", "") if uri is None else uri
        self.db_name = os.environ.get("MONGODB_DB", "energy_monitor")
        self.enabled = bool(self.uri)
        self.ok = False
        self.synced = 0
        self.last_success = None
        self.error = ""
        self.client = self.samples = self.events = self.devices = None
        self.settings = {}
        self._stop = threading.Event()
        self.destination = hashlib.sha256((self.uri + "\0" + self.db_name).encode()).hexdigest()
        with self.connection() as conn:
            conn.execute("CREATE TABLE IF NOT EXISTS cloud_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            conn.execute("CREATE TABLE IF NOT EXISTS cloud_cursors(destination TEXT, kind TEXT, row_id INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(destination,kind))")
            # Stable sequence survives VACUUM and clock corrections; inserts into
            # the source table and outbox are committed in the same transaction.
            conn.execute("CREATE TABLE IF NOT EXISTS cloud_outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, source_key REAL NOT NULL, UNIQUE(kind,source_key))")
            conn.execute("CREATE INDEX IF NOT EXISTS cloud_outbox_kind_id ON cloud_outbox(kind,id)")
            conn.execute("CREATE TRIGGER IF NOT EXISTS cloud_sample_insert AFTER INSERT ON samples BEGIN INSERT OR IGNORE INTO cloud_outbox(kind,source_key) VALUES('samples',NEW.timestamp); END")
            conn.execute("CREATE TRIGGER IF NOT EXISTS cloud_event_insert AFTER INSERT ON events BEGIN INSERT OR IGNORE INTO cloud_outbox(kind,source_key) VALUES('events',NEW.id); END")
            if not conn.execute("SELECT 1 FROM cloud_meta WHERE key='backfill_seeded'").fetchone():
                conn.execute("INSERT OR IGNORE INTO cloud_outbox(kind,source_key) SELECT 'samples',timestamp FROM samples ORDER BY timestamp")
                conn.execute("INSERT OR IGNORE INTO cloud_outbox(kind,source_key) SELECT 'events',id FROM events ORDER BY id")
                conn.execute("INSERT INTO cloud_meta VALUES('backfill_seeded','1')")
            conn.execute("INSERT OR IGNORE INTO cloud_meta VALUES('device_id', ?)", (str(uuid.uuid4()),))
            self.device_id = conn.execute("SELECT value FROM cloud_meta WHERE key='device_id'").fetchone()[0]
        self.thread = None
        if self.enabled and start_worker:
            self.thread = threading.Thread(target=self._worker, daemon=True, name="mongodb-sync")
            self.thread.start()

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def pending_batch(self, kind, limit=200):
        if kind not in ("samples", "events"):
            raise ValueError("Unknown collection")
        with self.connection() as conn:
            cursor = conn.execute("SELECT row_id FROM cloud_cursors WHERE destination=? AND kind=?", (self.destination, kind)).fetchone()
            key = 'timestamp' if kind == 'samples' else 'id'
            rows = conn.execute(f"SELECT o.id AS local_id,s.* FROM cloud_outbox o JOIN {kind} s ON s.{key}=o.source_key WHERE o.kind=? AND o.id>? ORDER BY o.id LIMIT ?", (kind, cursor[0] if cursor else 0, limit)).fetchall()
        result = []
        for row in rows:
            r = dict(row)
            identity = f"{self.device_id}:{kind}:{r['local_id']}"
            doc = {"device_id": self.device_id, "ts": r['timestamp'], "mode": r['data_mode']}
            if kind == "samples":
                doc.update(main_ma=r['main_ma'], main_w=r['main_w'], a_w=r['branch_a_w'], b_w=r['branch_b_w'],
                           wh_total=r['wh_total'], wh_a=r['wh_a'], wh_b=r['wh_b'], residual_ma=r['residual_ma'],
                           flags=json.loads(r['flags'] or '[]'))
            else:
                doc.update(kind=r['kind'], title=r['title'], details=r['details'])
            result.append((r['local_id'], identity, doc))
        return result

    def acknowledge(self, kind, row_id):
        with self.connection() as conn:
            conn.execute("INSERT INTO cloud_cursors VALUES(?,?,?) ON CONFLICT(destination,kind) DO UPDATE SET row_id=MAX(row_id,excluded.row_id)", (self.destination, kind, row_id))

    def _connect(self):
        from pymongo import MongoClient
        if self.client is None:
            self.client = MongoClient(self.uri, serverSelectionTimeoutMS=4000, connectTimeoutMS=4000, socketTimeoutMS=10000, appname="GridScope-gateway")
        db = self.client[self.db_name]
        self.client.admin.command("ping")
        for name in ("samples", "events"):
            db[name].create_index([("device_id", 1), ("mode", 1), ("ts", 1)])
        self.samples, self.events, self.devices = db.samples, db.events, db.devices

    def sync_collection(self, kind):
        from pymongo import UpdateOne
        batch = self.pending_batch(kind)
        if not batch:
            return 0
        result = getattr(self, kind).bulk_write([UpdateOne({"_id": identity}, {"$set": doc}, upsert=True) for _, identity, doc in batch], ordered=False)
        if result is not None and not result.acknowledged:
            raise RuntimeError("MongoDB writes require acknowledgement")
        self.acknowledge(kind, batch[-1][0])
        self.synced += len(batch)
        return len(batch)

    def _worker(self):
        while not self._stop.is_set():
            try:
                if not self.ok:
                    self._connect()
                count = sum(self.sync_collection(kind) for kind in ("samples", "events"))
                self.devices.update_one({"_id": self.device_id}, {"$set": {
                    "name": os.environ.get("GRIDSCOPE_DEVICE_NAME", "GridScope gateway")[:100],
                    "heartbeat": time.time(), "settings": self.settings, "schema_version": 1,
                }}, upsert=True)
                self.ok = True
                self.error = ""
                self.last_success = time.time()
                if count >= 200:
                    continue
                self._stop.wait(5)
            except Exception:
                self.ok = False
                self.error = "Cloud unavailable. Saved readings will retry automatically; check database access and the gateway internet connection."
                self._stop.wait(5)

    @property
    def queued(self):
        with self.connection() as conn:
            return sum(conn.execute("SELECT COUNT(*) FROM cloud_outbox WHERE kind=? AND id>COALESCE((SELECT row_id FROM cloud_cursors WHERE destination=? AND kind=?),0)", (kind, self.destination, kind)).fetchone()[0] for kind in ("samples", "events"))

    def status(self):
        return {"enabled": self.enabled, "ok": self.ok, "queued": self.queued, "synced": self.synced,
                "device_id": self.device_id, "last_success": self.last_success, "error": self.error, "durable": True}

    def close(self):
        self._stop.set()
        if self.thread:
            self.thread.join(timeout=15)
        if self.client:
            self.client.close()
