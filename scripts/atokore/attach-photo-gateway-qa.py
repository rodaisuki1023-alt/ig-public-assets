"""Attach ONLY the new one-shot photo gateway QA to an existing owner review build.

This script does not deploy, authorize access, or create users. The caller must
independently confirm Vercel Authentication protects ALL deployment URLs. It
intentionally refuses to overwrite any existing QA or change the app.
"""
from pathlib import Path
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: attach-photo-gateway-qa.py _local_review")
out = Path(sys.argv[1]).resolve()
assert out.name == "_local_review" and (out / "index.html").is_file()
source = Path(__file__).resolve().parents[2] / "tests/manual/atokore-v50-photo-gateway-qa.html"
html = source.read_text(encoding="utf-8")
for expected in (
    "location.origin==='https://atokore-v50-owner-review-20261122.vercel.app'",
    "location.pathname==='/qa/atokore-v50-photo-gateway-qa.html'",
    "COHORT='f8a63d1e92'",
    "NEW_BUCKET='atokore-private-photos-v2'",
    "https://vzyxurodowpjltwbgbyc.supabase.co",
    "QA started; do not repeat",
    "sb_publishable_",
    "example.invalid",
):
    assert expected in html, "missing scope guard: " + expected
assert not re.search(r"sb_secret_|service_role|atokore-product-photos|/auth/v1/signup|COHORT='(?:d59b5fa73f|c0e4b6f7a9)'", html)
assert html.count("<script>") == 1 and html.count("</script>") == 1
qa = out / "qa"
qa.mkdir(exist_ok=True)
assert qa.resolve().is_relative_to(out) and not qa.is_symlink(), "unsafe QA output"
target = qa / "atokore-v50-photo-gateway-qa.html"
with target.open("x", encoding="utf-8") as f:
    f.write(html)
assert target.read_text(encoding="utf-8") == html
print("PASS: new gateway QA attached, no prior cohort reused; NOT deployed")
