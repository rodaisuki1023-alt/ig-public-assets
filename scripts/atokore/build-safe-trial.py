"""Build the SAFE trial bundle for an isolated, authenticated, noindex trial; never deploys.

Usage: python3 -I scripts/atokore/build-safe-trial.py SOURCE_DIR DEST_DIR VERSION

On top of the normal trial build (build-preview.py: renamed storage keys, family.js disabled,
build SHA stamped) this:
  * sets the household config to null before anything runs: no Supabase URL or key is shipped,
    family sharing, cloud photos and sign-in are off,
  * keeps OCR hidden (the experimental receipt switch stays unset),
  * gives the bundle its own storage keys, photo database and service-worker caches
    (prefix atokoreSafeTrial / atokore-safe-trial-*), so it never shares data with another trial
    or the production app on the same origin,
  * adds a strict Content-Security-Policy (no outside requests: connect-src 'self') and robots
    noindex to the page, and the same as response headers for Netlify/Cloudflare (_headers) and
    Vercel (vercel.json), with X-Robots-Tag,
  * writes SAFE_TRIAL_MANIFEST.json (build, checks, SHA-256 of every file),
and fails closed if any connection setting, key-like string or old storage prefix survives.
"""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import hashlib
import json
import os
import re
import sys

CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; "
       "manifest-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'none'")
ROBOTS = 'noindex, nofollow, noarchive'
FORBIDDEN = [
    (re.compile(r'[a-z0-9]{20}\.supabase\.co'), 'Supabase project URL'),
    (re.compile(r'sb_(publishable|secret)_[A-Za-z0-9_-]{8,}'), 'Supabase key'),
    (re.compile(r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'), 'JWT-like string'),
    (re.compile(r'service_role["\']?\s*[:=]'), 'service role setting'),
    (re.compile(r'\batokorePreview'), 'shared trial storage prefix'),
    (re.compile(r'ATOKORE_RECEIPT_EXPERIMENTAL\s*=\s*true'), 'OCR switched on'),
]


def load_preview_builder():
    spec = spec_from_file_location('atokore_trial_builder', Path(__file__).with_name('build-preview.py'))
    if not spec or not spec.loader:
        raise RuntimeError('preview builder unavailable')
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit('usage: build-safe-trial.py SOURCE_DIR DEST_DIR VERSION')
    source, dest, version = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
    if not (version.isdecimal() and 1 <= int(version) <= 99):
        raise SystemExit('VERSION must be an integer 1..99')
    load_preview_builder().build(source, dest, version)

    # 1) No backend: the config is null before household-sync reads it (its start-up gate).
    if 'const cfg=root.ATOKORE_HOUSEHOLD_CONFIG;' not in (dest / 'household-sync-v37.js').read_text(encoding='utf-8'):
        raise RuntimeError('family sync start-up gate changed; review required')
    (dest / 'household-config-v37.js').write_text(
        '/* Safe trial: no sign-in, no family sharing, no cloud photos, no server. */\n'
        'window.ATOKORE_HOUSEHOLD_CONFIG = null;\n', encoding='utf-8')

    # 2) Its own storage, photo database and service-worker caches.
    files = [dest / 'index.html', *sorted(dest.glob('*.js'))]
    for f in files:
        text = f.read_text(encoding='utf-8')
        text = text.replace('atokorePreview', 'atokoreSafeTrial')
        if f.name == 'service-worker.js':
            text = text.replace("'atokore-shell:'", "'atokore-safe-trial-shell:'").replace("'atokore-ocr:'", "'atokore-safe-trial-ocr:'")
            if 'atokore-safe-trial-shell:' not in text:
                raise RuntimeError('service-worker cache prefix changed; review required')
        f.write_text(text, encoding='utf-8')

    # 3) Page: CSP and robots meta right after <head>; a visible label.
    index = dest / 'index.html'
    html = index.read_text(encoding='utf-8')
    if '<head>' not in html:
        raise RuntimeError('index.html has no <head>')
    html = re.sub(r'<meta name="robots"[^>]*>', '', html)
    html = html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + CSP + '">'
                        '<meta name="robots" content="' + ROBOTS + '">', 1)
    marker = f'ベビー特化 試用版 v{version}'
    if marker not in html:
        raise RuntimeError('trial label marker changed; abort')
    html = html.replace(marker, f'ベビー特化 安全な試用版 v{version}・合成データ用')
    index.write_text(html, encoding='utf-8')

    # 4) The same as response headers wherever it is later served (serving needs separate approval).
    headers = {'Content-Security-Policy': CSP + "; frame-ancestors 'none'", 'X-Robots-Tag': ROBOTS,
               'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
               'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'}
    (dest / '_headers').write_text('/*\n' + ''.join(f'  {k}: {v}\n' for k, v in headers.items()) +
                                   '/service-worker.js\n  Cache-Control: no-cache\n', encoding='utf-8')
    (dest / 'vercel.json').write_text(json.dumps({'headers': [
        {'source': '/(.*)', 'headers': [{'key': k, 'value': v} for k, v in headers.items()]},
        {'source': '/service-worker.js', 'headers': [{'key': 'Cache-Control', 'value': 'no-cache'}]}]},
        ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    # 5) Fail closed on anything that could connect, identify or leak.
    generated = {f: f.read_text(encoding='utf-8', errors='replace') for f in dest.rglob('*')
                 if f.is_file() and f.suffix in {'.js', '.html', '.json', '.css', '.webmanifest', ''}}
    for f, text in generated.items():
        for pattern, label in FORBIDDEN:
            if pattern.search(text):
                raise RuntimeError(f'{label} found in {f.relative_to(dest)}; safe build refused')
    if 'window.ATOKORE_HOUSEHOLD_CONFIG = null;' not in (dest / 'household-config-v37.js').read_text(encoding='utf-8'):
        raise RuntimeError('household config is not null')

    sha = re.sub(r'[^0-9a-f]', '', (os.environ.get('ATOKORE_BUILD_SHA') or os.environ.get('GITHUB_SHA') or '').lower())[:40]
    manifest = {'kind': 'atokore-safe-trial', 'version': int(version), 'source_commit': sha or None,
                'checks': {'household_config': 'null', 'family_sharing': 'off', 'cloud_photos': 'off', 'ocr': 'hidden',
                           'robots': ROBOTS, 'csp': CSP, 'storage_prefix': 'atokoreSafeTrial',
                           'sw_cache_prefix': 'atokore-safe-trial-shell:', 'forbidden_strings': 'none'},
                'files': {str(f.relative_to(dest)): hashlib.sha256(f.read_bytes()).hexdigest()
                          for f in sorted(dest.rglob('*')) if f.is_file()}}
    (dest / 'SAFE_TRIAL_MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'created non-deployed safe trial build v{version} at {dest}')


if __name__ == '__main__':
    main()
