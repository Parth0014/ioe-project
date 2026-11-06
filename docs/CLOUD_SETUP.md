# GridScope cloud dashboard on Vercel

The laptop collects ESP8266 telemetry over USB serial, stores it in SQLite, and
uploads it to Atlas. Vercel serves the hosted dashboard and queries Atlas. USB
telemetry and local storage work without internet; Atlas uploads and hosted
access need internet on the laptop.

## 1. Configure the optional cloud copy

Install Python 3.10+ and run from the project directory:

```powershell
python -m pip install -r requirements.txt
python configure_cloud.py
python configure_cloud.py --check
python server.py
```

The setup command asks for your Atlas URI and a dashboard password using hidden
input. It saves the URI, password hash, random session secret and stable gateway
ID in `.env`, which is ignored by Git and Vercel uploads. It does not save the
plain password. Existing environment variables take priority over `.env`.
Do not paste the URI into chat, screenshots, tracked config, or a command line.
If Python is not on PATH, use the project environment's executable instead of
`python`, for example `.\.venv-cloud\Scripts\python.exe configure_cloud.py`.
The Windows launcher can reuse this environment and skips package installation
once its dependencies are available, so normal offline startup needs no package
index access.

Open `/analytics` on the local dashboard. Expand **Gateway details** for the
device ID and pending upload count. MongoDB must allow the laptop's network
address and the database user must be able to read/write `samples`, `events`
and `devices`, and create their indexes in the chosen database.

The collector creates these MongoDB collections:

| Collection | Contents |
| --- | --- |
| `samples` | Device-scoped readings, cumulative Wh and mode |
| `events` | Device-scoped gateway warnings and activity |
| `devices` | Gateway name, heartbeat and current settings |
| `auth_attempts` | Expiring hashed sign-in attempt keys (hosted app) |

New compound indexes use `device_id`, `mode`, and `ts`. MongoDB 5.0+ is required
for the window-based analytics query. Use your current supported Atlas version.

## 2. Deploy the cloud dashboard to Vercel

Import this repository into Vercel, use the repository root, and select the
**Flask** framework. No frontend install command or output-directory override is
needed. The explicit entrypoint is `app:app` in `pyproject.toml`; never point
hosting at the local `server.py`. The build command copies just the cloud CSS
and JavaScript to `public/static` for Vercel's CDN.

Add these **server environment variables** in Vercel Project Settings before
deploying. Copy their values privately from `.env`, omitting the surrounding
single quotes. Do not prefix them with `NEXT_PUBLIC_` or `VITE_`.

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Atlas URI; preferably a separate dashboard database user |
| `MONGODB_DB` | Same database as the laptop (`energy_monitor` by default) |
| `GRIDSCOPE_DEVICE_ID` | Exactly the laptop's stable gateway ID |
| `GRIDSCOPE_PASSWORD_HASH` | Generated password hash, including its dollar signs |
| `GRIDSCOPE_SECRET_KEY` | Generated secret, at least 32 characters |

Do not set `GRIDSCOPE_LOCAL_HTTP` on Vercel. HTTPS cookies are enabled by default.
Changing the session secret signs everyone out. Sessions expire after 12 hours.
Changing only the password does not revoke existing sessions; rotate the secret
as well when revoking access. This is one shared-owner password, not a multi-user
account system.

For least privilege, give the hosted database user `find` on `samples`, `events`
and `devices`, plus `find`, `insert`, `update` and `createIndex` on `auth_attempts`.
Sign-in rate limiting uses that collection so attempts are shared across Vercel
instances. Its TTL index expires records automatically. Keep the gateway's
write credential separate when you set up these roles. The hosted app has no
sensor control or settings routes and never writes energy readings.

Atlas network access must also permit the Vercel function's egress. Configure
an appropriate network access arrangement for your hosting plan; don't assume
the laptop's allowed IP also covers Vercel. A failed connection returns a safe
error and never exposes the connection URI.

Vercel's native Flask support, static-file convention and entrypoint settings:
https://vercel.com/docs/frameworks/backend/flask

## 3. Verify the real cloud path

1. Run the laptop collector with real sensor data. On local `/analytics`, check
   that the pending upload count falls to zero and a last-sync time appears.
2. In Atlas, verify that `samples`, `events` and `devices` use your gateway ID.
   An empty `events` collection is normal until the gateway records an event.
3. Open the Vercel URL. It must require sign-in before `/api/analytics` returns
   energy data. Sign in with the password you chose during setup.
4. Compare the same mode and period locally and in the cloud after uploads
   finish. Hosted reports cache for up to 30 seconds per function instance.
5. Disconnect internet while retaining the sensor connection. Local readings
   continue; pending uploads grow. Restart the collector if desired, reconnect,
   and confirm the backlog clears without creating duplicate documents.
6. Stop the collector. The cloud dashboard must mark saved readings stale and
   keep existing history visible. It must not continue increasing energy.

`/health` checks hosting configuration only; it is not proof of Atlas access or
live sensor readings. An actual signed-in analytics response verifies reads.

## Data integrity and analytics

SQLite remains authoritative locally. A transactional outbox records stable
source references; old SQLite rows are backfilled automatically. Checkpoints
advance only after MongoDB acknowledges a batch. Upserts use stable IDs, so a
partial write can safely retry. Uploads retry every five seconds after failure.
Checkpoints are scoped to the destination URI and database. Changing credentials
may replay old rows, but upserts avoid duplicates. Back up the entire SQLite file;
it includes the gateway identity, outbox and checkpoints. Do not reuse that file
on two simultaneously running collectors. Do not delete or rewrite historical
source rows externally; edits to acknowledged rows are not replicated.

Historical unscoped MongoDB documents from the old sync code are left untouched
and excluded. The new device-scoped copy is rebuilt from SQLite. No data is
automatically deleted from SQLite or Atlas. Monitor Atlas storage: continuous
one-second collection creates about 86,400 samples per day. Choose a retention
policy appropriate to your cluster after deciding how to archive history.

Ranges are rolling 24 hours, 7 days or 30 days; chart intervals align to IST.
The first and last intervals can be partial. Energy uses positive differences
of persisted Wh counters. The first available row is a baseline, not a claim
that its cumulative lifetime energy occurred in the selected interval. A reset
is flagged and its negative delta excluded. Deltas belong to the ending sample's
interval. Coverage sums saved-sample intervals of at most five seconds; gaps
remain unestimated. Coverage is a recording indicator, not sensor accuracy.

Peak is the highest saved sample; average is the arithmetic mean of saved power
samples. Comparisons use the preceding equally long period, and show its
coverage because unequal recording time can skew changes. Demo readings are
explicitly selectable and separate from live data. Cost uses the current
configured flat rate, not a complete household bill. Zone B is inferred.

The hosted analytics uses bounded MongoDB aggregation and a 30-second in-process
cache. Database operations have timeouts; large histories can require a larger
Atlas tier or later rollup work. Requests surface an error instead of presenting
partial results as a complete report.

## Preview and tests

```powershell
python -m pip install -r requirements-cloud.txt
$env:GRIDSCOPE_LOCAL_HTTP='1' # this terminal only, for local HTTP
python cloud_dashboard.py --port 9000
python -m unittest discover -s tests -v
```

The hosted app still requires the private environment settings. The local
collector's `/analytics` works without MongoDB or sign-in, on the existing
loopback-only server. Do not publicly expose the local collector/control server.
