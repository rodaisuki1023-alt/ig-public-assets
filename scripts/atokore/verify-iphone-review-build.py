"""Fail-closed guard for owner-only, local-only iPhone acceptance preview.
This guard is not access control. Vercel Authentication must be enabled on
ALL deployment URLs in the project's settings before sharing a URL.
"""
from pathlib import Path
import json
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: verify-iphone-review-build.py OUTPUT_DIR")
root = Path(sys.argv[1]).resolve()
assert root.is_dir(), "review output missing"
assert root.name == "_local_review", "refuse to serve production/trial output"
html = (root / "index.html").read_text(encoding="utf-8")
config = (root / "household-config-v37.js").read_text(encoding="utf-8")
family = (root / "family.js").read_text(encoding="utf-8")
sync = (root / "household-sync-v37.js").read_text(encoding="utf-8")
assert "ローカル確認用 v19・家族共有無効" in html
assert config.strip().endswith("window.ATOKORE_HOUSEHOLD_CONFIG = null;")
assert "family sync is intentionally disabled" in family
assert "const cfg=root.ATOKORE_HOUSEHOLD_CONFIG;" in sync
assert "atokorePreviewTrialV19" in html
assert "atokoreTrialV4" not in html
for f in [root / "index.html", *root.rglob("*.js"), *root.rglob("*.json")]:
    value = f.read_text(encoding="utf-8")
    assert "vzyxurodowpjltwbgbyc.supabase.co" not in value, str(f)
    assert "sb_secret_" not in value, str(f)
    assert "service_role" not in value, str(f)
for pattern in [r'<script[^>]+src="([^"]+)"', r'<link[^>]+(?:href)="([^"]+)"']:
    for target in re.findall(pattern, html):
        local = target.split("?", 1)[0].removeprefix("./")
        if not local or local.startswith(("http:", "https:", "data:", "#")):
            continue
        assert (root / local).is_file(), f"missing asset: {local}"
manifest = json.loads((root / "manifest.webmanifest").read_text(encoding="utf-8"))
assert manifest["display"] == "standalone"
assert manifest["start_url"].startswith("./")
assert (root / "service-worker.js").is_file()
print("PASS: private review output is isolated, family-disabled, and asset-complete")
