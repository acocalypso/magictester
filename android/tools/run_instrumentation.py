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
    sdk=int(subprocess.check_output(['adb','shell','getprop','ro.build.version.sdk'],text=True).strip())
    if sdk>=33:subprocess.run(['adb','shell','pm','grant','com.acocalypso.magictester','android.permission.POST_NOTIFICATIONS'],check=True)
    reports=[]
    for label,selection,timeout in [('ui',['-e','class','com.acocalypso.magictester.WorkbenchUiTest'],180),('engine',['-e','notClass','com.acocalypso.magictester.WorkbenchUiTest'],1500)]:
        result=subprocess.run(['adb','shell','am','instrument','-w','-r','-e','disableAnalytics','true','-e','timeout_msec','720000',*selection,'com.acocalypso.magictester.test/androidx.test.runner.AndroidJUnitRunner'],capture_output=True,text=True,timeout=timeout)
        print(result.stdout,flush=True);print(result.stderr,file=sys.stderr,flush=True)
        report=result.stdout+result.stderr;reports.append(report)
        (output/f'instrumentation-{label}.txt').write_text(report)
        (output/'instrumentation.txt').write_text('\n'.join(reports))
        passed=re.search(r'OK \((\d+) tests?\)',result.stdout)
        if result.returncode or not passed or int(passed.group(1))==0 or 'FAILURES!!!' in result.stdout:raise RuntimeError(f'Real Android {label} acceptance failed; see instrumentation and logcat artifacts')

finally:
    with (output/'logcat.txt').open('w') as log:subprocess.run(['adb','logcat','-d'],stdout=log,stderr=subprocess.STDOUT)
    with (output/'acceptance-ui.png').open('wb') as image:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','cat','files/acceptance-ui.png'],stdout=image,stderr=subprocess.DEVNULL)

    with (output/'acceptance-back-failure.png').open('wb') as screenshot:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','cat','files/acceptance-back-failure.png'],stdout=screenshot,stderr=subprocess.DEVNULL)
    # Test fixtures only: retain the app's bounded engine/error logs when instrumentation fails.
    with (output/'engine-diagnostics.tar').open('wb') as logs:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','tar','-cf','-','files/diagnostics'],stdout=logs,stderr=subprocess.DEVNULL)
    with (output/'performance-settings.xml').open('wb') as settings:subprocess.run(['adb','exec-out','run-as','com.acocalypso.magictester','cat','shared_prefs/performance.xml'],stdout=settings,stderr=subprocess.DEVNULL)
