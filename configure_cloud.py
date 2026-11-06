"""Private interactive setup. Credentials stay in the ignored .env file."""
import argparse
import getpass
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv, set_key
from werkzeug.security import generate_password_hash

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description='Configure or check GridScope cloud access without printing secrets')
    parser.add_argument('--check', action='store_true', help='Check Atlas access and show gateway ID; no credentials printed')
    args = parser.parse_args()
    load_dotenv(ROOT / '.env')
    if args.check:
        from pymongo import MongoClient
        uri = os.environ.get('MONGODB_URI')
        if not uri:
            raise SystemExit('MONGODB_URI is missing. Run configure_cloud.py first.')
        try:
            with MongoClient(uri, serverSelectionTimeoutMS=5000) as client:
                client.admin.command('ping')
            print('Atlas connection: PASS')
        except Exception:
            raise SystemExit('Atlas connection: FAIL. Check credentials, database permissions, DNS and Atlas network access.')
        return
    uri = getpass.getpass('MongoDB Atlas URI (hidden): ').strip()
    if not uri.startswith(('mongodb://', 'mongodb+srv://')):
        raise SystemExit('Use a mongodb:// or mongodb+srv:// connection URI.')
    password = getpass.getpass('Choose dashboard password (at least 16 characters, hidden): ')
    if len(password) < 16 or len(password) > 256:
        raise SystemExit('Use a password between 16 and 256 characters.')
    if password != getpass.getpass('Repeat dashboard password: '):
        raise SystemExit('Passwords did not match; configuration was not saved.')
    from server import DB, init_db
    from cloud import CloudStore
    init_db()
    store = CloudStore(DB, uri='', start_worker=False)
    path = ROOT / '.env'
    values = {'MONGODB_URI': uri, 'MONGODB_DB': os.environ.get('MONGODB_DB', 'energy_monitor'),
              'GRIDSCOPE_DEVICE_ID': store.device_id, 'GRIDSCOPE_DEVICE_NAME': os.environ.get('GRIDSCOPE_DEVICE_NAME', 'GridScope gateway'),
              'GRIDSCOPE_PASSWORD_HASH': generate_password_hash(password),
              'GRIDSCOPE_SECRET_KEY': secrets.token_urlsafe(48)}
    for key, value in values.items():
        set_key(path, key, value, quote_mode='always')
    store.close()
    print('Saved private configuration in .env. Password and URI were not printed.')
    print('Gateway ID:', values['GRIDSCOPE_DEVICE_ID'])
    print('Next: run configure_cloud.py --check, then start server.py.')
    print('For Vercel, add the values from .env in Project Settings > Environment Variables (without surrounding quotes).')


if __name__ == '__main__':
    main()
