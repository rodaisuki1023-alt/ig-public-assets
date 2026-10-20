"""Build a sandboxed Atokore trial from atokore-live-v125.

Usage: python3 build-preview.py SOURCE_DIR DEST_DIR VERSION

The trial shares an origin with the production app, so every storage key is renamed to a
trial-only key and family sync is replaced by a stub. The build fails if any production key
survives, or if a file referenced by index.html is missing. Used both by the Pages workflow and
by the local end-to-end tests, so the tested copy is built exactly like the published one.
"""
import re
import shutil
import sys
from pathlib import Path

PRODUCTION_KEYS = {
    'atokoreTrialV4': 'atokorePreviewTrialV{v}',
    'atokoreHistoryV1': 'atokorePreviewHistoryV{v}',
    'atokoreDisplayPrefsV1': 'atokorePreviewDisplayPrefsV{v}',
    'atokoreReceiptAliases': 'atokorePreviewReceiptAliasesV{v}',
    'atokorePwaInstallDismissedAt': 'atokorePreviewPwaInstallDismissedAtV{v}',
    'atokoreFamilySafeV2': 'atokorePreviewFamilySafeV{v}',
    'atokoreFamilySafeVersionV2': 'atokorePreviewFamilySafeVersionV{v}',
}


def build(source: Path, dest: Path, version: str) -> None:
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(source, dest)
    # Trials never join or modify a real family's shared data.
    (dest / 'family.js').write_text(f'/* v{version} preview only: family sync is intentionally disabled. */\n', encoding='utf-8')

    # Longest keys first so atokoreFamilySafeVersionV2 is not split by atokoreFamilySafeV2.
    pairs = sorted(PRODUCTION_KEYS.items(), key=lambda kv: -len(kv[0]))
    for path in [dest / 'index.html', *dest.glob('*.js')]:
        text = path.read_text(encoding='utf-8')
        for old, new in pairs:
            text = re.sub(rf'\b{old}\b', new.format(v=version), text)
        if path.name == 'index.html':
            text = text.replace('試用版 v12.5m', f'ベビー特化 試用版 v{version}')
        path.write_text(text, encoding='utf-8')

    built = ''.join(p.read_text(encoding='utf-8') for p in [dest / 'index.html', *dest.glob('*.js')])
    for old in PRODUCTION_KEYS:
        assert not re.search(rf'\b{old}\b', built), f'production storage key left in trial: {old}'
    index = (dest / 'index.html').read_text(encoding='utf-8')
    for ref in re.findall(r'<script[^>]+src="([^"]+)"', index) + re.findall(r'<link[^>]+href="([^"]+)"', index):
        name = ref.split('?', 1)[0].removeprefix('./')
        assert (dest / name).is_file(), f'missing trial resource: {name}'


if __name__ == '__main__':
    src, out, ver = sys.argv[1:4]
    build(Path(src), Path(out), ver)
    print(f'built trial v{ver} -> {out}')
