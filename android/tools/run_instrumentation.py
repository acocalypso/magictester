#!/usr/bin/env python3
"""Run prebuilt APKs, fail reliably on instrumentation crashes, retain logcat."""
import pathlib, subprocess, sys, re
apk_dir=pathlib.Path(sys.argv[1])
output=pathlib.Path(sys.argv[2]);output.mkdir(parents=True,exist_ok=True)
try:
    for apk in sorted(apk_dir.rglob('*.apk'),key=lambda p: ('androidTest' in p.name,p.name)):
        if 'release' not in apk.name: subprocess.run(['adb','install','-r',str(apk)],check=True)
    result=subprocess.run(['adb','shell','am','instrument','-w','-r','-e','disableAnalytics','true','-e','timeout_msec','720000','com.acocalypso.magictester.test/androidx.test.runner.AndroidJUnitRunner'],capture_output=True,text=True,timeout=1500)
    print(result.stdout);print(result.stderr,file=sys.stderr)
    (output/'instrumentation.txt').write_text(result.stdout+result.stderr)
    if result.returncode or not re.search(r'OK \(\d+ tests?\)',result.stdout) or 'FAILURES!!!' in result.stdout:raise RuntimeError('Real Android acceptance failed; see instrumentation and logcat artifacts')
finally:
    with (output/'logcat.txt').open('w') as log:subprocess.run(['adb','logcat','-d'],stdout=log,stderr=subprocess.STDOUT)
    with (output/'acceptance-ui.png').open('wb') as image:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','cat','files/acceptance-ui.png'],stdout=image,stderr=subprocess.DEVNULL)
