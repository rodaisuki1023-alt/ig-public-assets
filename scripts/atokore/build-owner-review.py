"""Build the protected owner-review site in one fail-closed step (Vercel buildCommand <= 256 chars).

Usage: python3 -I scripts/atokore/build-owner-review.py
Steps, in order; any failure stops the build so the previous deployment stays live:
  1. family-disabled iPhone review app at the site root (v19 storage)
  2. guarded synthetic Auth/Storage HTTP QA page at /qa/
  3. family-sharing acceptance copy at /family/ (v50 storage, host-guarded)
The caller then runs verify-iphone-review-build.py on _local_review.
"""
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
STEPS = [
    ['build-local-review.py', 'atokore-live-v125', '_local_review', '19'],
    ['attach-synthetic-storage-qa.py', '_local_review'],
    ['attach-family-acceptance.py', 'atokore-live-v125', '_local_review'],
]


def main() -> None:
    if len(sys.argv) != 1:
        raise SystemExit('usage: build-owner-review.py')
    for script, *args in STEPS:
        subprocess.run([sys.executable, '-I', str(HERE / script), *args], check=True)
    print('built owner review: root (family-disabled), /qa/, /family/ (acceptance)')


if __name__ == '__main__':
    main()
