#!/usr/bin/env python3
"""Use the first published persistent-key APK for a real cross-release update test."""
import argparse,hashlib,json,pathlib,time,urllib.error,urllib.request
parser=argparse.ArgumentParser();parser.add_argument('destination',type=pathlib.Path);parser.add_argument('--wait-seconds',type=int,default=1200);args=parser.parse_args()
base='https://github.com/acocalypso/magictester/releases/download/android-v0.1.3/'
name='MagicTester-android-v0.1.3-debug.apk';deadline=time.monotonic()+args.wait_seconds
while True:
    try:
        with urllib.request.urlopen(base+'SHA256SUMS',timeout=20) as source:checksums=source.read().decode()
        expected={line.split()[1]:line.split()[0] for line in checksums.splitlines() if len(line.split())==2}[name]
        break
    except (urllib.error.URLError,KeyError) as error:
        if isinstance(error,urllib.error.HTTPError) and error.code not in [404,429,500,502,503,504]:raise
        if time.monotonic()>=deadline:raise RuntimeError('The published Android 0.1.3 upgrade baseline is not available') from error
        print('Waiting for the tested 0.1.3 release before cross-release upgrade checks...',flush=True);time.sleep(20)
args.destination.parent.mkdir(parents=True,exist_ok=True);partial=args.destination.with_suffix('.partial')
try:
    with urllib.request.urlopen(base+name,timeout=60) as source,partial.open('wb') as output:
        size=0
        while True:
            data=source.read(1024*1024)
            if not data:break
            size+=len(data)
            if size>128*1024*1024:raise RuntimeError('Upgrade baseline exceeds 128 MiB')
            output.write(data)
    with partial.open('rb') as source:actual=hashlib.file_digest(source,'sha256').hexdigest()
    if actual!=expected:raise RuntimeError('Published upgrade baseline checksum does not match')
    partial.replace(args.destination)
    (args.destination.parent/'upgrade-baseline.json').write_text(json.dumps({'tag':'android-v0.1.3','sha256':actual,'url':base+name},indent=2))
    print('Using the published 0.1.3 APK as the upgrade baseline; SHA-256 verified.',flush=True)
finally:partial.unlink(missing_ok=True)
