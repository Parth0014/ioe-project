"""MongoDB Atlas store-and-forward. Local SQLite stays primary; Mongo gets a copy.
Set MONGODB_URI (and optionally MONGODB_DB) as environment variables - never hardcode."""
import os, queue, threading, time

class CloudStore:
    def __init__(self):
        self.uri = os.environ.get("MONGODB_URI")
        self.enabled = bool(self.uri)
        self.ok = False
        self.synced = 0
        self.q = queue.Queue(maxsize=20000)
        self.samples = self.events = None
        if self.enabled:
            threading.Thread(target=self._worker, daemon=True).start()

    def _connect(self):
        from pymongo import MongoClient, ASCENDING
        c = MongoClient(self.uri, serverSelectionTimeoutMS=4000)
        db = c[os.environ.get("MONGODB_DB", "energy_monitor")]
        db.samples.create_index([("ts", ASCENDING)])
        db.events.create_index([("ts", ASCENDING)])
        self.samples, self.events = db.samples, db.events
        c.admin.command("ping")
        self.ok = True

    def push(self, kind, doc):  # kind: "samples" | "events"
        if self.enabled:
            try: self.q.put_nowait((kind, doc))
            except queue.Full: pass

    def _worker(self):
        pending = []
        while True:
            try:
                if not self.ok: self._connect()
                while len(pending) < 50:
                    try: pending.append(self.q.get(timeout=2))
                    except queue.Empty: break
                for kind in ("samples", "events"):
                    docs = [d for k, d in pending if k == kind]
                    if docs: getattr(self, kind).insert_many(docs)
                self.synced += len(pending); pending = []
            except Exception as e:
                self.ok = False; print("Cloud sync retrying:", e); time.sleep(5)

    @property
    def queued(self): return self.q.qsize()

    def history(self, n=180, mode="LIVE"):
        rows = list(self.samples.find({"mode": mode}, {"_id": 0}).sort("ts", -1).limit(n))
        return rows[::-1]

    def recent_events(self, n=25, mode="LIVE"):
        return list(self.events.find({"mode": mode}, {"_id": 0}).sort("ts", -1).limit(n))
