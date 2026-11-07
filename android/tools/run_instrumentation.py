#!/usr/bin/env python3
"""Run prebuilt APKs, fail reliably on instrumentation crashes, retain logcat."""
import pathlib, subprocess, sys, re
apk_dir=pathlib.Path(sys.argv[1])
output=pathlib.Path(sys.argv[2]);output.mkdir(parents=True,exist_ok=True)
try:
    probe=apk_dir/'upgrade-probe.apk'
    if probe.is_file():
        subprocess.run(['adb','install',str(probe)],check=True)
        subprocess.run(['adb','shell','run-as','com.acocalypso.magictester','mkdir','-p','files'],check=True)
        subprocess.run(['adb','shell','run-as','com.acocalypso.magictester','sh','-c',"'echo retained-across-update > files/upgrade-probe.txt'"],check=True)
    for apk in sorted(apk_dir.rglob('*.apk'),key=lambda p: ('androidTest' in p.name,p.name)):
        if 'release' not in apk.name and apk.name!='upgrade-probe.apk': subprocess.run(['adb','install','-r',str(apk)],check=True)
    if probe.is_file():
        retained=subprocess.check_output(['adb','shell','run-as','com.acocalypso.magictester','cat','files/upgrade-probe.txt'],text=True).strip()
        if retained!='retained-across-update':raise RuntimeError('An in-place update lost private app data')
        (output/'upgrade-check.txt').write_text('PASS: older-version APK updated in place; private app data retained.\n')
        baseline=apk_dir/'upgrade-baseline.json'
        if baseline.is_file():(output/'upgrade-baseline.json').write_text(baseline.read_text())
    result=subprocess.run(['adb','shell','am','instrument','-w','-r','-e','disableAnalytics','true','-e','timeout_msec','720000','com.acocalypso.magictester.test/androidx.test.runner.AndroidJUnitRunner'],capture_output=True,text=True,timeout=1500)
    print(result.stdout);print(result.stderr,file=sys.stderr)
    (output/'instrumentation.txt').write_text(result.stdout+result.stderr)
    if result.returncode or not re.search(r'OK \(\d+ tests?\)',result.stdout) or 'FAILURES!!!' in result.stdout:raise RuntimeError('Real Android acceptance failed; see instrumentation and logcat artifacts')
finally:
    with (output/'logcat.txt').open('w') as log:subprocess.run(['adb','logcat','-d'],stdout=log,stderr=subprocess.STDOUT)
    with (output/'acceptance-ui.png').open('wb') as image:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','cat','files/acceptance-ui.png'],stdout=image,stderr=subprocess.DEVNULL)

    # Test fixtures only: retain the app's bounded engine/error logs when instrumentation fails.
    with (output/'engine-diagnostics.tar').open('wb') as logs:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','tar','-cf','-','files/diagnostics'],stdout=logs,stderr=subprocess.DEVNULL)
    with (output/'performance-settings.xml').open('wb') as settings:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','cat','shared_prefs/performance.xml'],stdout=settings,stderr=subprocess.DEVNULL)
