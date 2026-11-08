#!/usr/bin/env python3
"""Use the published persistent-key APK for a real cross-release update test."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

parser=argparse.ArgumentParser()
parser.add_argument('destination',type=pathlib.Path)
parser.add_argument('--wait-seconds',type=int,default=1200)
args=parser.parse_args()
base='https://github.com/acocalypso/magictester/releases/download/android-v0.1.3/'
name='MagicTester-android-v0.1.3-debug.apk'
deadline=time.monotonic()+args.wait_seconds
args.destination.parent.mkdir(parents=True,exist_ok=True)
partial=args.destination.with_suffix('.partial')
try:
    while True:
        try:
            release=json.loads(subprocess.check_output(['gh','api','repos/acocalypso/magictester/releases/tags/android-v0.1.3']))
            assets={asset['name']:asset for asset in release['assets']}
            checksum_asset=assets['SHA256SUMS']
            apk_asset=assets[name]
            checksums=subprocess.check_output(['gh','api','-H','Accept: application/octet-stream',checksum_asset['url']]).decode()
            expected={line.split()[1]:line.split()[0] for line in checksums.splitlines() if len(line.split())==2}[name]
            if apk_asset['size']>128*1024*1024:
                raise RuntimeError('Upgrade baseline exceeds 128 MiB')
            with partial.open('wb') as output:
                subprocess.run(['gh','api','-H','Accept: application/octet-stream',apk_asset['url']],stdout=output,check=True,timeout=600)
            if partial.stat().st_size>128*1024*1024:
                raise RuntimeError('Upgrade baseline exceeds 128 MiB')
            with partial.open('rb') as source:
                actual=hashlib.file_digest(source,'sha256').hexdigest()
            if actual!=expected:
                raise RuntimeError('Published upgrade baseline checksum does not match')
            break
        except (OSError,subprocess.SubprocessError,KeyError) as error:
            if time.monotonic()>=deadline:
                raise RuntimeError('The published Android 0.1.3 upgrade baseline is not available') from error
            print('Waiting for the published 0.1.3 upgrade baseline through the asset API...',flush=True)
            time.sleep(20)
    partial.replace(args.destination)
    (args.destination.parent/'upgrade-baseline.json').write_text(json.dumps({'tag':'android-v0.1.3','sha256':actual,'url':base+name,'downloadUrl':apk_asset['url']},indent=2))
    print('Using the published 0.1.3 APK as the upgrade baseline; SHA-256 verified.',flush=True)
finally:
    partial.unlink(missing_ok=True)
