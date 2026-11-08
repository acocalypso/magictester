#!/usr/bin/env python3
"""Fetch the pinned Forge asset via GitHub's API, retaining the mandatory checksum."""
import hashlib
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def fetch(pin, target):
    expected = pin['archiveSha256']
    if target.is_file() and digest(target) == expected:
        print('Using verified cached Forge archive', flush=True)
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    release = json.loads(subprocess.check_output([
        'gh', 'api', 'repos/Card-Forge/forge/releases/tags/' + quote(pin['tag'], safe='')
    ]))
    matches = [asset for asset in release['assets']
               if asset['browser_download_url'] == pin['archiveUrl']]
    if len(matches) != 1:
        raise RuntimeError('Pinned Forge archive was not found in its official release')
    asset = matches[0]
    partial = target.with_name(target.name + '.partial')
    try:
        for attempt in range(4):
            try:
                with partial.open('wb') as output:
                    subprocess.run(['gh', 'api', '-H', 'Accept: application/octet-stream',
                                    asset['url']], stdout=output, check=True, timeout=600)
                if digest(partial) != expected:
                    raise RuntimeError('Downloaded Forge archive does not match its pinned SHA-256')
                partial.replace(target)
                print('Downloaded and verified official Forge archive', flush=True)
                return
            except (OSError, RuntimeError, subprocess.SubprocessError) as error:
                if attempt == 3:
                    raise
                print(f'Forge asset API attempt {attempt + 1} failed: {error}; retrying', flush=True)
                time.sleep(2 ** attempt)
    finally:
        partial.unlink(missing_ok=True)


if __name__ == '__main__':
    fetch(json.loads((ROOT / 'engine/release.json').read_text()), ROOT / 'engine/build/forge.tar.bz2')
