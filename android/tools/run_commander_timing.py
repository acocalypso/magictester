#!/usr/bin/env python3
"""Opt-in Android duration experiment. Preserve partial observations on failure."""
import pathlib, re, subprocess, sys
apks=pathlib.Path(sys.argv[1]);output=pathlib.Path(sys.argv[2]);output.mkdir(parents=True,exist_ok=True)
samples=int(sys.argv[3]);clock=int(sys.argv[4])
if not 1<=samples<=20 or not 300<=clock<=3600 or samples*(clock+240)>13000:raise ValueError('Timing budget exceeds the workflow limit')
try:
    for name in ('app-debug.apk','app-debug-androidTest.apk'):
        subprocess.run(['adb','install','-r',str(apks/name)],check=True)
    subprocess.run(['adb','shell','pm','grant','com.acocalypso.magictester','android.permission.POST_NOTIFICATIONS'],check=True)
    home=subprocess.check_output(['adb','shell','cmd','package','resolve-activity','--brief','-a','android.intent.action.MAIN','-c','android.intent.category.HOME'],text=True).strip().splitlines()
    launcher=home[-1].split('/')[0] if home else ''
    if launcher in ('com.android.launcher3','com.google.android.apps.nexuslauncher'):subprocess.run(['adb','shell','am','force-stop',launcher],check=True)
    with (output/'instrumentation.txt').open('w') as log:
        result=subprocess.run(['adb','shell','am','instrument','-w','-r','-e','disableAnalytics','true','-e','timeout_msec',str((samples*(clock+240)+300)*1000),'-e','commanderTiming','true','-e','timingSamples',str(samples),'-e','timingClockSeconds',str(clock),'-e','class','com.acocalypso.magictester.CommanderDurationTest','com.acocalypso.magictester.test/androidx.test.runner.AndroidJUnitRunner'],stdout=log,stderr=subprocess.STDOUT,timeout=samples*(clock+240)+600)
    report=(output/'instrumentation.txt').read_text();print(report[-12000:],flush=True)
    if result.returncode or not re.search(r'OK \(1 test\)',report) or 'FAILURES!!!' in report:raise RuntimeError('Commander timing experiment failed; inspect partial results and logs')
finally:
    for name,command in [
        ('commander-duration.json',['adb','exec-out','run-as','com.acocalypso.magictester','cat','files/commander-duration.json']),
        ('game-evidence.tar',['adb','exec-out','run-as','com.acocalypso.magictester','tar','-cf','-','files/commander-timing']),
        ('engine-diagnostics.tar',['adb','exec-out','run-as','com.acocalypso.magictester','tar','-cf','-','files/diagnostics']),
        ('logcat.txt',['adb','logcat','-d'])]:
        with (output/name).open('wb') as out:subprocess.run(command,stdout=out,stderr=subprocess.DEVNULL)
