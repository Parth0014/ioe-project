"""Hosted dashboard: authenticated, device-scoped reads, no sensor/control routes."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash

from analytics import mongo_analytics, parameters, report
from energy_math import Settings, tariff_details

ROOT = Path(__file__).resolve().parent


class MongoReader:
    def __init__(self, uri, database, device_id):
        from pymongo import MongoClient
        self.client = MongoClient(uri, serverSelectionTimeoutMS=4000, connectTimeoutMS=4000,
                                  socketTimeoutMS=25000, appname="GridScope-dashboard")
        self.db = self.client[database]
        self.device_id = device_id
        self.cache = {}
        self.lock = threading.Lock()
        self.auth_index_ready = False

    def allow_login(self, identity):
        # Shared across serverless instances; survives function restarts.
        from pymongo import ReturnDocument
        if not self.auth_index_ready:
            self.db.auth_attempts.create_index("expires_at", expireAfterSeconds=0)
            self.auth_index_ready = True
        window = int(time.time() // 600)
        key = hashlib.sha256(f"{identity}:{window}".encode()).hexdigest()
        record = self.db.auth_attempts.find_one_and_update({"_id": key}, {
            "$inc": {"count": 1}, "$setOnInsert": {"expires_at": datetime.now(timezone.utc) + timedelta(minutes=20)}
        }, upsert=True, return_document=ReturnDocument.AFTER)
        return record['count'] <= 15

    def analytics(self, range_name, mode):
        start, end, bucket = parameters(range_name, mode)
        key = (range_name, mode)
        with self.lock:
            cached = self.cache.get(key)
            if cached and end - cached[0] < 30:
                return cached[1]
            scope = {"device_id": self.device_id, "mode": mode}
            device = self.db.devices.find_one({"_id": self.device_id}, {"_id": 0}) or {}
            settings = Settings.parse(device.get("settings") or {})
            rate = settings.tariff_inr_per_kwh
            rows = mongo_analytics(self.db.samples, self.device_id, mode, start, end, bucket)
            previous = mongo_analytics(self.db.samples, self.device_id, mode, start-(end-start), start-0.000001, bucket)
            latest = self.db.samples.find_one(scope, {"_id": 0}, sort=[("ts", -1)])
            events = list(self.db.events.find(scope, {"_id": 0}).sort("ts", -1).limit(15))
            result = report(rows, previous, start, end, bucket, rate, source="mongodb", mode=mode,
                            device_id=self.device_id, device_name=device.get('name', 'GridScope gateway'),
                            latest=latest, events=events, tariff=tariff_details(rate),
                            cloud={"enabled": True, "ok": True, "heartbeat": device.get('heartbeat'), "durable": True},
                            generated_at=end)
            self.cache[key] = (end, result)
            return result


def create_app(repository=None, config=None):
    app = Flask(__name__, template_folder=str(ROOT / "templates"), static_folder=str(ROOT / "static"))
    app.config.update(
        SECRET_KEY=os.environ.get("GRIDSCOPE_SECRET_KEY", ""),
        DASHBOARD_PASSWORD_HASH=os.environ.get("GRIDSCOPE_PASSWORD_HASH", ""),
        MONGODB_URI=os.environ.get("MONGODB_URI", ""),
        MONGODB_DB=os.environ.get("MONGODB_DB", "energy_monitor"),
        DEVICE_ID=os.environ.get("GRIDSCOPE_DEVICE_ID", ""),
        SESSION_COOKIE_NAME="gridscope_session", SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("GRIDSCOPE_LOCAL_HTTP") != "1",
        SESSION_COOKIE_SAMESITE="Lax", PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        MAX_CONTENT_LENGTH=8192,
    )
    if config:
        app.config.update(config)
    configured = (len(app.config['SECRET_KEY']) >= 32 and bool(app.config['DASHBOARD_PASSWORD_HASH'])
                  and bool(app.config['MONGODB_URI']) and bool(app.config['DEVICE_ID']))
    reader = repository
    if configured and reader is None:
        try:
            reader = MongoReader(app.config['MONGODB_URI'], app.config['MONGODB_DB'], app.config['DEVICE_ID'])
        except Exception:
            configured = False

    def csrf_token():
        if 'csrf' not in session:
            session['csrf'] = secrets.token_urlsafe(32)
        return session['csrf']

    app.jinja_env.globals['csrf_token'] = csrf_token

    @app.before_request
    def protect():
        if request.endpoint in ('static', 'health'):
            return None
        if not configured:
            if request.path.startswith('/api/'):
                return jsonify(error="Cloud dashboard setup is incomplete. Configure the hosting environment variables."), 503
            return render_template('cloud_login.html', setup_required=True), 503
        if request.method == 'POST':
            supplied = request.form.get('csrf', '')
            if not supplied or not hmac.compare_digest(supplied, session.get('csrf', '')):
                return jsonify(error="Your session changed. Reload this page and try again."), 403
        if request.endpoint != 'login' and not session.get('authenticated'):
            if request.path.startswith('/api/'):
                return jsonify(error="Sign in to view energy data."), 401
            return redirect(url_for('login'))

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['X-Frame-Options'] = 'DENY'
        response.headers['Referrer-Policy'] = 'same-origin'
        response.headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        if app.config['SESSION_COOKIE_SECURE']:
            response.headers['Strict-Transport-Security'] = 'max-age=31536000'
        return response

    @app.get('/health')
    def health():
        return jsonify(service="gridscope-cloud", configured=bool(configured)), 200 if configured else 503

    @app.route('/login', methods=['GET', 'POST'])
    def login():
        error = None
        status = 200
        if request.method == 'POST':
            # Vercel supplies a trusted client address header; direct local runs use remote_addr.
            identity = request.headers.get('x-vercel-forwarded-for', request.remote_addr or 'unknown') if os.environ.get('VERCEL') else request.remote_addr or 'unknown'
            try:
                allowed = reader.allow_login(identity)
            except Exception:
                allowed = None
            if allowed is None:
                error, status = "Sign-in could not reach the database. Check cloud database access and try again.", 503
            elif not allowed:
                error, status = "Too many sign-in attempts. Try again in 10 minutes.", 429
            else:
                try:
                    valid = check_password_hash(app.config['DASHBOARD_PASSWORD_HASH'], request.form.get('password', ''))
                except ValueError:
                    valid = False
                if valid:
                    session.clear()
                    session['authenticated'] = True
                    session.permanent = True
                    csrf_token()
                    return redirect(url_for('home'))
                error, status = "That password did not match. Try again.", 401
        return render_template('cloud_login.html', error=error, setup_required=False), status

    @app.post('/logout')
    def logout():
        session.clear()
        return redirect(url_for('login'))

    @app.get('/')
    @app.get('/analytics')
    def home():
        return render_template('analytics.html', hosted=True, default_mode="LIVE")

    @app.get('/api/analytics')
    def analytics_api():
        range_name, mode = request.args.get('range', '24h'), request.args.get('mode', 'LIVE')
        try:
            parameters(range_name, mode)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        try:
            return jsonify(reader.analytics(range_name, mode))
        except Exception:
            return jsonify(error="Energy history could not be loaded. Check database access and retry. Your gateway continues saving locally."), 503

    return app


if __name__ == '__main__':
    import argparse
    from dotenv import load_dotenv
    from waitress import serve
    load_dotenv(ROOT / '.env')
    parser = argparse.ArgumentParser(description="GridScope hosted dashboard")
    parser.add_argument('--port', type=int, default=9000)
    args = parser.parse_args()
    serve(create_app(), host='127.0.0.1', port=args.port)
