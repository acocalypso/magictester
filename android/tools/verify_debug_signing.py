#!/usr/bin/env python3
"""Fail the release build if a debug APK's signing certificate changes."""
import pathlib,re,subprocess,sys
folder=pathlib.Path(sys.argv[1])
expected=(pathlib.Path(__file__).resolve().parents[1]/'signing/certificate.sha256').read_text().strip()
for name in ['app-debug.apk','app-debug-androidTest.apk','upgrade-probe.apk']:
    result=subprocess.check_output(['java','-jar',str(folder/'apksigner.jar'),'verify','--print-certs',str(folder/name)],text=True)
    actual=re.findall(r'Signer #\d+ certificate SHA-256 digest: ([0-9a-f]+)',result)
    if actual!=[expected]:raise RuntimeError(f'{name}: persistent debug signing certificate mismatch')
    print(f'{name}: verified persistent development certificate {expected}')
