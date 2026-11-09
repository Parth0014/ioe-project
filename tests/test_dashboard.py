import re
import unittest
from unittest.mock import patch

from cloud_dashboard import create_app
from werkzeug.security import generate_password_hash


class Reader:
    allowed = True
    failed = False

    def allow_login(self, identity):
        return self.allowed

    def analytics(self, range_name, mode):
        if self.failed:
            raise RuntimeError('mongodb://private-password@example')
        return {"mode": mode, "range": range_name}


class DashboardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = 'a-long-test-password'
        cls.password_hash = generate_password_hash(cls.password)

    def setUp(self):
        self.reader = Reader()
        self.app = create_app(self.reader, {
            'TESTING': True, 'SECRET_KEY': 'x'*40, 'DASHBOARD_PASSWORD_HASH': self.password_hash,
            'MONGODB_URI': 'mongodb://example', 'DEVICE_ID': 'test-device', 'SESSION_COOKIE_SECURE': False,
        })
        self.client = self.app.test_client()

    def login(self, password=None):
        page = self.client.get('/login')
        csrf = re.search(r'name="csrf" value="([^"]+)"', page.text)[1]
        return self.client.post('/login', data={'password': password or self.password, 'csrf': csrf})

    def test_denies_unauthenticated_data_and_controls(self):
        self.assertEqual(self.client.get('/api/analytics').status_code, 401)
        self.assertEqual(self.client.get('/').status_code, 302)
        self.login()
        for path in ('/api/state', '/api/dashboard', '/api/settings', '/api/calibrate-idle', '/api/export.csv'):
            self.assertEqual(self.client.get(path).status_code, 404)

    def test_login_csrf_password_and_logout(self):
        self.assertEqual(self.client.post('/login', data={'password': self.password}).status_code, 403)
        self.assertEqual(self.login('wrong').status_code, 401)
        self.assertEqual(self.login().status_code, 302)
        self.assertEqual(self.client.get('/api/analytics?mode=DEMO&range=7d').json, {'mode': 'DEMO', 'range': '7d'})
        page = self.client.get('/')
        self.assertEqual(page.status_code, 200)
        self.assertIn(b'class="app-header"', page.data)
        self.assertNotIn(b'id="mode"', page.data)
        self.assertNotIn(b'Demo data', page.data)
        csrf = re.search(r'name="csrf" value="([^"]+)"', page.text)[1]
        self.assertEqual(self.client.post('/logout', data={'csrf': csrf}).status_code, 302)
        self.assertEqual(self.client.get('/api/analytics').status_code, 401)

    def test_invalid_query_and_sanitized_database_error(self):
        self.login()
        self.assertEqual(self.client.get('/api/analytics?range=all').status_code, 400)
        self.assertEqual(self.client.get('/api/analytics?mode=other').status_code, 400)
        self.reader.failed = True
        response = self.client.get('/api/analytics')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private-password', response.text)
        self.assertEqual(response.headers['Cache-Control'], 'no-store')

    def test_rate_limit(self):
        self.reader.allowed = False
        self.assertEqual(self.login().status_code, 429)

    def test_fails_closed_without_configuration(self):
        with patch.dict('os.environ', {}, clear=True):
            app = create_app()
        self.assertEqual(app.test_client().get('/api/analytics').status_code, 503)
        self.assertEqual(app.test_client().get('/').status_code, 503)


if __name__ == '__main__': unittest.main()
