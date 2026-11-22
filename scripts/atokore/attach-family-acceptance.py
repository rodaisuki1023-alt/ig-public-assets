"""Attach a family-sharing acceptance copy of the app at /family/ of the protected owner review.

Usage: python3 -I scripts/atokore/attach-family-acceptance.py SOURCE_DIR _local_review

Purpose: two real iPhones (A creates a household with Google, B joins as a guest) can check
invite, shared stock, offline +1 on both devices, photo sharing and removal of B. The app at
the site root stays family-disabled; this copy is separate in three ways:
  * storage keys use v50 (atokorePreview...V50), the root app uses v19, so nothing is shared;
  * its service worker is scoped to /family/ and the root worker ignores nested directories;
  * sharing is switched on only when the page runs on the protected Vercel host under /family/.
It uses the trial family backend (atokore-family-trial) with its public publishable key only,
exactly as the existing trial build does. Vercel Authentication (All Deployments) is the access
control; this script is not. It creates no accounts, households or photos.
"""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import json
import re
import sys

HOST = 'https://atokore-v50-owner-review-20261122.vercel.app'
PATH = '/family/'
VERSION = '50'
TRIAL_URL = 'https://vzyxurodowpjltwbgbyc.supabase.co'


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit('usage: attach-family-acceptance.py SOURCE_DIR _local_review')
    source, out = Path(sys.argv[1]), Path(sys.argv[2])
    if out.name != '_local_review' or not (out / 'index.html').is_file():
        raise SystemExit('refuse: output must be the built _local_review site')
    dest = out / 'family'

    builder = Path(__file__).with_name('build-preview.py')
    spec = spec_from_file_location('atokore_trial_builder', builder)
    if not spec or not spec.loader:
        raise RuntimeError('preview builder unavailable')
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.build(source, dest, VERSION)

    # The product-photo IndexedDB name is fixed in the source (not one of the builder's keys),
    # so the root review app and this copy on the same origin would read each other's photos.
    photos = dest / 'product-photos-v30.js'
    text = photos.read_text(encoding='utf-8')
    if text.count("'atokorePreviewProductPhotosV19'") != 1:
        raise RuntimeError('photo database name changed; review isolation')
    photos.write_text(text.replace("'atokorePreviewProductPhotosV19'", f"'atokorePreviewProductPhotosV{VERSION}'"), encoding='utf-8')

    # The tab title and version line are fixed in insights-v45.js; say which copy this is.
    insights = dest / 'insights-v45.js'
    text = insights.read_text(encoding='utf-8')
    for before, after in [("doc.title='あとこれ｜ベビー特化 試用版v19・機能更新v48'", "doc.title='あとこれ｜家族共有 受入テスト v50'"),
                          ("version.textContent='ベビー特化 試用版 v19", "version.textContent='家族共有 受入テスト v50（ベビー特化 試用版 v19ベース）")]:
        if text.count(before) != 1:
            raise RuntimeError('version label changed in insights-v45.js; review')
        text = text.replace(before, after)
    insights.write_text(text, encoding='utf-8')

    # Re-use the trial backend values already in the app instead of copying them here.
    src_config = (source / 'household-config-v37.js').read_text(encoding='utf-8')
    url = re.search(r"url:\s*'([^']+)'", src_config)
    key = re.search(r"anonKey:\s*'([^']+)'", src_config)
    if not url or url.group(1) != TRIAL_URL:
        raise RuntimeError('family backend is not the trial project; review required')
    if not key or not key.group(1).startswith('sb_publishable_'):
        raise RuntimeError('only a publishable key may be shipped to a browser')
    config = {'url': url.group(1), 'anonKey': key.group(1), 'google': True, 'guest': True, 'email': False}
    (dest / 'household-config-v37.js').write_text(
        '/* v50 two-iPhone family acceptance (synthetic data only).\n'
        ' * Sharing is enabled only on the protected owner-review host under /family/;\n'
        ' * anywhere else (a copy, another host, the site root) the app stays device-only. */\n'
        "window.ATOKORE_HOUSEHOLD_CONFIG = (location.origin === " + json.dumps(HOST) +
        " && location.pathname.indexOf(" + json.dumps(PATH) + ") === 0)\n"
        '  ? ' + json.dumps(config, ensure_ascii=False) + '\n'
        '  : null;\n',
        encoding='utf-8',
    )

    index = dest / 'index.html'
    html = index.read_text(encoding='utf-8')
    marker = f'ベビー特化 試用版 v{VERSION}'
    if marker not in html or '<body>' not in html:
        raise RuntimeError('review label or body marker changed; abort')
    html = html.replace(marker, f'家族共有 受入テスト v{VERSION}')
    banner = ('<div id="atkFamilyAcceptanceNotice" role="note" style="background:#FFF4D6;color:#5A3B00;'
              'font-size:13px;line-height:1.5;padding:8px 12px;border-bottom:1px solid #E9C46A">'
              '<strong>家族共有の受入テスト専用です。</strong>実際の家族の名前・在庫・写真は入力しないでください。'
              '架空の商品と合成画像だけを使います。</div>')
    title = '<meta name="apple-mobile-web-app-title" content="あとこれ">'
    if html.count(title) != 1:
        raise RuntimeError('home-screen title marker changed; abort')
    # A different home-screen name so the two installed apps are never confused on one iPhone.
    html = html.replace(title, '<meta name="apple-mobile-web-app-title" content="共有テスト">')
    index.write_text(html.replace('<body>', '<body>' + banner, 1), encoding='utf-8')

    manifest_path = dest / 'manifest.webmanifest'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    manifest['name'] = 'あとこれ 家族共有テスト'
    manifest['short_name'] = 'あとこれ共有テスト'
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'attached family acceptance app at {dest} (v{VERSION} storage, sharing only on {HOST}{PATH})')


if __name__ == '__main__':
    main()
