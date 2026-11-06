import runpy
import sys
import json
import os
import socket
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from urllib.request import build_opener, ProxyHandler
from unittest.mock import patch


class EntrypointTests(unittest.TestCase):
    def test_python_app_starts_local_services(self):
        with patch('server.main') as start, patch.object(sys, 'argv', ['app.py', '--no-browser']):
            runpy.run_path(str(Path(__file__).resolve().parents[1] / 'app.py'), run_name='__main__')
        start.assert_called_once()

    def test_single_process_serves_dashboard_and_analytics_offline(self):
        root = Path(__file__).resolve().parents[1]
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        with tempfile.TemporaryDirectory() as directory:
            script = (
                "import server,sys,runpy; from pathlib import Path; "
                f"server.DB=Path({str(Path(directory)/'energy.sqlite3')!r}); "
                f"server.CONFIG=Path({str(Path(directory)/'config.json')!r}); "
                f"sys.argv=['app.py','--demo','--no-browser','--web-port',{str(port)!r}]; "
                "runpy.run_path('app.py',run_name='__main__')"
            )
            process = subprocess.Popen([sys.executable, '-c', script], cwd=root,
                                       env={**os.environ, 'MONGODB_URI': ''},
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            opener = build_opener(ProxyHandler({}))
            try:
                deadline = time.monotonic() + 10
                state = None
                while time.monotonic() < deadline:
                    if process.poll() is not None:
                        self.fail('Local entrypoint exited before serving the dashboard')
                    try:
                        with opener.open(f'http://127.0.0.1:{port}/api/dashboard', timeout=.5) as response:
                            state = json.load(response)
                        if state['latest']:
                            break
                    except OSError:
                        pass
                    time.sleep(.05)
                self.assertIsNotNone(state)
                self.assertEqual(state['mode'], 'DEMO')
                self.assertFalse(state['cloud']['enabled'])
                self.assertIsNotNone(state['latest'])
                for route in ('/', '/analytics', '/api/analytics?mode=DEMO'):
                    with opener.open(f'http://127.0.0.1:{port}{route}', timeout=2) as response:
                        self.assertEqual(response.status, 200)
            finally:
                process.terminate()
                process.wait(timeout=5)


if __name__ == '__main__': unittest.main()
