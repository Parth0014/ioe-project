"""Vercel serves public assets from its CDN; keep one editable source copy."""
from pathlib import Path
from shutil import copy2

ROOT = Path(__file__).resolve().parent
target = ROOT / "public" / "static"
target.mkdir(parents=True, exist_ok=True)
for name in ("analytics.css", "analytics.js"):
    copy2(ROOT / "static" / name, target / name)
print("Prepared GridScope cloud dashboard assets")
