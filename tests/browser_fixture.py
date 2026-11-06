"""Disposable UI verification servers. Never reads project .env or saved history."""
import math
import os
import sqlite3
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.pop('MONGODB_URI', None)
import server
from cloud_dashboard import MongoReader, create_app
from werkzeug.security import generate_password_hash
from werkzeug.serving import make_server


def main():
    with tempfile.TemporaryDirectory(prefix='gridscope-ui-') as directory:
        server.DB = Path(directory) / 'energy.sqlite3'
        server.CONFIG = Path(directory) / 'config.json'
        server.init_db()
        now = int(time.time())
        total = a = b = 0
        rows = []
        # Clearly labelled DEMO bursts, with intentional gaps between recordings.
        for hour in range(8*24):
            for second in range(20):
                ts = now-(8*24-hour)*3600+second
                watts = 50+hour%24*3+20*math.sin(hour*.6)
                total += watts/3600
                a += watts*.6/3600
                b += watts*.4/3600
                rows.append((ts, watts/230*1000, watts, watts*.6, watts*.4, total, a, b))
        rows.append((now, 200, 46, 27.6, 18.4, total, a, b))
        with server.db_connection() as conn:
            conn.executemany("INSERT INTO samples(timestamp,main_ma,main_w,branch_a_w,branch_b_w,wh_total,wh_a,wh_b,flags,data_mode) VALUES(?,?,?,?,?,?,?,?,'[]','DEMO')", rows)
            conn.execute("INSERT INTO events(timestamp,kind,title,details,data_mode) VALUES(?,'info','Demo recording saved','Simulated readings for UI verification only.','DEMO')", (now,))
        engine = server.EnergyEngine('DEMO')
        local = make_server('127.0.0.1', 8876, server.create_app(engine), threaded=True)
        threading.Thread(target=local.serve_forever, daemon=True).start()
        uri = os.environ.get('GRIDSCOPE_TEST_MONGO_URI')
        reader = None
        if uri:
            from urllib.parse import urlparse
            if urlparse(uri).hostname not in ('127.0.0.1', 'localhost'):
                raise RuntimeError('Fixture requires localhost MongoDB')
            engine.cloud.uri = uri
            engine.cloud.enabled = True
            engine.cloud.db_name = 'gridscope_browser_fixture'
            engine.cloud.client = None
            engine.cloud._connect()
            while engine.cloud.sync_collection('samples'): pass
            engine.cloud.sync_collection('events')
            engine.cloud.devices.update_one({'_id': engine.cloud.device_id}, {'$set': {'name': 'UI verification gateway', 'settings': dict(server.DEFAULTS), 'heartbeat': now}}, upsert=True)
            reader = MongoReader(uri, engine.cloud.db_name, engine.cloud.device_id)
        if reader is None:
            class LocalFixtureReader:
                def allow_login(self, identity): return True
                def analytics(self, range_name, mode): return engine.analytics(range_name, mode)
            reader = LocalFixtureReader()
        cloud = make_server('127.0.0.1', 8877, create_app(reader, {
            'SECRET_KEY':'test-only-session-secret-'*3,
            'DASHBOARD_PASSWORD_HASH': generate_password_hash('gridscope-browser-test'),
            'MONGODB_URI': uri or 'mongodb://fixture', 'DEVICE_ID':engine.cloud.device_id,
            'SESSION_COOKIE_SECURE':False,
        }), threaded=True)
        print('Test-only dashboard password: gridscope-browser-test', flush=True)
        print('Local fixture: http://127.0.0.1:8876/analytics · Hosted fixture: http://127.0.0.1:8877', flush=True)
        try:
            cloud.serve_forever()
        finally:
            local.shutdown()
            local.server_close()
            cloud.server_close()
            if uri:
                reader.client.close()
                engine.cloud.client.drop_database(engine.cloud.db_name)
            engine.cloud.close()


if __name__ == '__main__': main()
