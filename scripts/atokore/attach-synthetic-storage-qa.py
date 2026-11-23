"""Attach an isolated synthetic Supabase HTTP QA page to a protected Vercel owner review.

This is NOT part of the main family-disabled app. It is a one-shot harness at
/qa/atokore-v50-auth-qa.html. The harness signs in with A/B/C synthetic
accounts only; it cannot create Auth users or touch real family content.
All Deployments must be protected by Vercel Authentication BEFORE deploy.
"""
from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit("usage: attach-synthetic-storage-qa.py _local_review")

out = Path(sys.argv[1])
assert out.name == "_local_review" and (out / "index.html").is_file(), "refuse non-review output"
src = Path("tests/manual/atokore-v50-auth-qa.html")
assert src.is_file(), "synthetic QA source missing"
html = src.read_text(encoding="utf-8")
old = ("location.origin==='https://rodaisuki1023-alt.github.io' &&\n"
       " location.pathname==='/ig-public-assets/tests/manual/atokore-v50-auth-qa.html'")
new = ("location.origin==='https://atokore-v50-owner-review-20261122.vercel.app' &&\n"
       " location.pathname==='/qa/atokore-v50-auth-qa.html'")
assert html.count(old) == 1, "source origin guard changed; stop and review"
html = html.replace(old, new)
old_notice = "このQAは承認された自社管理のGitHub Pagesでのみ実行できます。"
assert html.count(old_notice) == 1, "safety notice changed"
html = html.replace(old_notice, "このQAはVercel認証で保護されたオーナー専用URLのみで実行できます。")

# The previous cohort was fully deleted after owner approval. Rotate identifiers
# only in the DEPLOYED protected QA copy; keep original source unit fixtures intact.
# Never re-enable the previously used cohort or erase its one-shot run marker.
old_cohort = "COHORT='d59b5fa73f'"
new_cohort = "COHORT='c0e4b6f7a9'"
assert html.count(old_cohort) == 1, "old QA cohort source changed: refuse to deploy"
html = html.replace(old_cohort, new_cohort)
old_cache = "var headers={'apikey':KEY,'cache-control':'no-cache'};"
new_cache = ("var headers={'apikey':KEY,"
             "'cache-control':contentType==='image/jpeg'&&method==='POST'?"
             "'private, no-store, max-age=0':'no-cache'};")
assert html.count(old_cache) == 1, "old synthetic upload header changed"
html = html.replace(old_cache, new_cache)
assert "COHORT='d59b5fa73f'" not in html
assert "COHORT='c0e4b6f7a9'" in html
assert "private, no-store, max-age=0" in html

assert "sb_publishable_" in html and "service_role" not in html and "sb_secret_" not in html
assert "https://vzyxurodowpjltwbgbyc.supabase.co" in html
assert "auth.signUp" not in html and "example.invalid" in html
qa_dir = out / "qa"
qa_dir.mkdir(exist_ok=True)
target = qa_dir / "atokore-v50-auth-qa.html"
target.write_text(html, encoding="utf-8")
print("PASS: isolated new-cohort synthetic Auth/Storage QA page attached; NO accounts created")
