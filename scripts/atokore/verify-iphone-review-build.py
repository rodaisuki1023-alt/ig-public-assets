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
family_dir = root / "family"
for f in [root / "index.html", *root.rglob("*.js"), *root.rglob("*.json")]:
    value = f.read_text(encoding="utf-8")
    if family_dir not in f.parents:
        # The root app (and everything but the /family/ acceptance copy) stays family-disabled.
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
# Only the isolated /qa/ page is allowed to contact synthetic Auth/Storage.
qa = root / "qa" / "atokore-v50-auth-qa.html"
assert qa.is_file(), "guarded synthetic QA page missing"
qa_html = qa.read_text(encoding="utf-8")
assert "location.origin==='https://atokore-v50-owner-review-20261122.vercel.app'" in qa_html
assert "location.pathname==='/qa/atokore-v50-auth-qa.html'" in qa_html
assert "location.origin==='https://rodaisuki1023-alt.github.io'" not in qa_html
assert "https://vzyxurodowpjltwbgbyc.supabase.co" in qa_html
assert "sb_publishable_" in qa_html and "sb_secret_" not in qa_html
assert "service_role" not in qa_html
assert "example.invalid" in qa_html and "Auth sign-in" in qa_html
assert "COHORT='c0e4b6f7a9'" in qa_html, "new one-shot synthetic cohort required"
assert "COHORT='d59b5fa73f'" not in qa_html, "deleted cohort must not be reused"
assert "private, no-store, max-age=0" in qa_html, "synthetic JPEG upload must demand zero cache"


# /family/: the only family-enabled copy, for the two-iPhone acceptance test.
fam_html = (family_dir / "index.html").read_text(encoding="utf-8")
fam_cfg = (family_dir / "household-config-v37.js").read_text(encoding="utf-8")
assert "家族共有 受入テスト v50" in fam_html and "atkFamilyAcceptanceNotice" in fam_html
assert "atokorePreviewTrialV50" in fam_html and "atokorePreviewTrialV19" not in fam_html
assert "atokoreTrialV4" not in fam_html
assert 'content="共有テスト"' in fam_html
assert "location.origin === \"https://atokore-v50-owner-review-20261122.vercel.app\"" in fam_cfg
assert "location.pathname.indexOf(\"/family/\") === 0" in fam_cfg
assert fam_cfg.rstrip().endswith(": null;"), "off-host fallback must disable sharing"
assert "https://vzyxurodowpjltwbgbyc.supabase.co" in fam_cfg and "sb_publishable_" in fam_cfg
assert '"email": false' in fam_cfg
assert "family sync is intentionally disabled" in (family_dir / "family.js").read_text(encoding="utf-8")
assert (family_dir / "service-worker.js").is_file()
assert "'atokorePreviewProductPhotosV50'" in (family_dir / "product-photos-v30.js").read_text(encoding="utf-8")
assert json.loads((family_dir / "manifest.webmanifest").read_text(encoding="utf-8"))["scope"] == "./"
assert "window.ATOKORE_RECEIPT_EXPERIMENTAL===true" in fam_html, "receipt OCR stays held in the acceptance copy"
for pattern in [r'<script[^>]+src="([^"]+)"', r'<link[^>]+(?:href)="([^"]+)"']:
    for target in re.findall(pattern, fam_html):
        local = target.split("?", 1)[0].removeprefix("./")
        if not local or local.startswith(("http:", "https:", "data:", "#")):
            continue
        assert (family_dir / local).is_file(), f"missing family asset: {local}"

print("PASS: private review output is isolated, family-disabled, and asset-complete")
print("PASS: /family/ acceptance copy uses v50 storage, the trial backend's publishable key and an origin guard")
