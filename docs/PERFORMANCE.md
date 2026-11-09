# Rendering and local preview checks

The room uses the fixed 45-degree camera, supplied living/dining composition, live zone
lighting, cached shadows and occluded cable flow. Optimizations target work done
per frame, rather than reducing measurement accuracy or removing the model.

## What changed

- Drawing-buffer density stays stable through lighting changes, never exceeds
  the display density, and is capped at 1.5 million pixels (800,000 on devices
  reporting low memory or few CPU cores). Antialiasing remains enabled.
- Each lamp uses one cached 512px spotlight shadow map instead of a 1024px
  six-direction point-light shadow. Furniture transforms are fixed after setup.
- Lighting settles over 240ms with fewer WebGL renders. Cable dots run in a
  small 30fps canvas; the WebGL image stays cached between changes.
- Pause, reduced motion, offscreen panels, debugging and background tabs stop
  continuous rendering. Background tabs also stop dashboard API polling.
- Large panels no longer fade/translate in front of a loading model. Demand
  bars animate scale rather than layout width. Unchanged charts, analytics
  rows and events retain their existing DOM.
- Live Server and VS Code watchers exclude the recording database, virtual
  environments, tool caches and generated output. Sensor writes should not
  repeatedly trigger a preview reload. Restart Live Server after changing its
  workspace settings.

At a 1440×900 viewport with a 1005×736 model panel on a DPR-1 browser, the
buffer fell from 2010×1472 to 1005×736: 75% fewer render pixels. The same
circuit switches used 4 WebGL renders instead of 8–9 in the observed run.
This measures rendering work, not a claim that every computer is 75% faster.

## Replacement room model

`static/room-model.js` adapts the geometry and colors from the supplied
`gridscope-rooms.html`: living room, dining room, tall walls, central doorway,
TV console, open bookcase, wood floors and low-poly plants. The TV and bookcase
are oriented toward the dashboard's existing fixed view. The source HTML's
orbit controls, perspective camera, CDN dependency and continuous WebGL loop
are not imported. Firmware, measurement logic and saved readings are unaffected.

Box, cylinder and foliage geometry is shared, repeated book materials are reused,
and static furniture is instanced by geometry/material. The observed replacement
uses 37 draw calls and 5,890 triangles versus the preceding model's 39 calls and
7,942 triangles, with zero idle WebGL renders while cable flow continues.
The same 512px cached lamp shadows, buffer budget and 30fps overlay remain.

## Analytics is local

`python app.py` serves `/analytics` and `/api/analytics` using SQLite. Atlas
uploading is optional. An unavailable cloud connection cannot block this page.

Opening `templates/index.html` in Live Server can preview the dashboard model,
but analytics always routes through the Python service so it can read SQLite.

## Checks

```powershell
python -m unittest discover -v
node --test tests/test_scene_timing.mjs tests/test_room_model.mjs
```

The MongoDB integration checks are opt-in against a disposable localhost
database; they are skipped when that database is not provided.

Browser checks under `tests/browser` use Playwright CLI `run-code --filename`.
Start `tests/browser_fixture.py` for isolated Python servers on 8876/8877. These
fixtures use temporary history and do not load the private `.env` or real SQLite data.
Screenshots and downloads go under ignored `output/playwright`.

The checks cover all four circuit states, rapid reversals, pause/resume, stale
readings after returning from a background tab, debugging, reduced motion,
retina phone framing, consistent analytics navigation, local SQLite analytics,
CSV export and refresh error recovery.

## Repository hygiene

Keep `.python` and `.venv-cloud` on this workstation: the working environment
depends on that Python runtime. They are ignored, not web assets, and do not get
loaded into the browser. `.env` and the real SQLite database are also ignored.
Tool caches, obsolete test snapshots, generated CDN copies and
the old environment pointing to a missing Python installation can be removed.
The optional hosted dashboard is retained separately from local startup.
