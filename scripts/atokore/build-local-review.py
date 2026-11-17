"""Build a *local-family-only* iPhone review bundle; never deploy automatically.

Usage: python3 -I scripts/atokore/build-local-review.py SOURCE_DIR DEST_DIR VERSION

This uses the exact trial storage-key rewriting of build-preview.py but also DISABLES
household Auth/sync before anything can run in a browser. The normal preview builder
is left completely unchanged.
"""
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
import sys


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit('usage: build-local-review.py SOURCE_DIR DEST_DIR VERSION')
    source, dest, version = (Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3])
    if not (version.isdecimal() and 1 <= int(version) <= 99):
        raise SystemExit('VERSION must be an integer 1..99')
    builder = Path(__file__).with_name('build-preview.py')
    spec = spec_from_file_location('atokore_trial_builder', builder)
    if not spec or not spec.loader:
        raise RuntimeError('preview builder unavailable')
    mod = module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.build(source, dest, version)

    # This is the pre-load gate checked at the top of household-sync-v37.js.
    # Unlike family.js (legacy disabled stub), this also disables the active
    # dedicated Supabase sharing backend, so no stored session can auto-sync.
    config = dest / 'household-config-v37.js'
    if not config.is_file():
        raise RuntimeError('household config missing; fail closed')
    config.write_text(
        '/* Local-only review: no Google sign-in or shared household API. */\n'
        'window.ATOKORE_HOUSEHOLD_CONFIG = null;\n',
        encoding='utf-8',
    )
    if 'const cfg=root.ATOKORE_HOUSEHOLD_CONFIG;' not in (
        dest / 'household-sync-v37.js'
    ).read_text(encoding='utf-8'):
        raise RuntimeError('family sync start-up gate changed; review required')

    index = dest / 'index.html'
    html = index.read_text(encoding='utf-8')
    marker = f'ベビー特化 試用版 v{version}'
    if marker not in html:
        raise RuntimeError('review label marker changed; abort')
    index.write_text(
        html.replace(marker, f'ベビー特化 ローカル確認用 v{version}・家族共有無効'),
        encoding='utf-8',
    )

    # Fail closed if the real trial backend URL survives the generated JS/HTML.
    # No network access or external credentials are needed to run this build.
    generated = '\n'.join(
        f.read_text(encoding='utf-8')
        for f in [index, *dest.glob('*.js')]
    )
    if 'vzyxurodowpjltwbgbyc.supabase.co' in generated:
        raise RuntimeError('family backend found in a local-only review build')

    print(f'created non-deployed local-only review build v{version} at {dest}')


if __name__ == '__main__':
    main()
