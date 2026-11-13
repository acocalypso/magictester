#!/usr/bin/env python3
"""Check shared AI contracts; optionally exercise pinned native Forge overrides."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--forge-jar', required=True, type=Path)
parser.add_argument('--java', default='java')
parser.add_argument('--native-home', type=Path)
parser.add_argument('--bridge-classes', type=Path)
parser.add_argument('--report', type=Path)
args = parser.parse_args()
if bool(args.native_home) != bool(args.bridge_classes):
    parser.error('--native-home and --bridge-classes must be supplied together')
root = Path(__file__).resolve().parents[1]
jar = args.forge_jar.resolve(strict=True)
with tempfile.TemporaryDirectory(prefix='magictester-ai-') as classes:
    sources = sorted((root / 'src/main/java').rglob('*.java'))
    sources += [root / 'tests/DecisionJournalContracts.java', root / 'tests/AiPolicyContracts.java', root / 'tests/CancellationContracts.java']
    dependencies = [str(jar)]
    if args.native_home:
        dependencies.insert(0, str(args.bridge_classes.resolve(strict=True)))
        sources += [root / 'tests/ForgeTraceContracts.java', root / 'tests/DamageTacticsContracts.java', root / 'tests/NativePolicyBridgeContracts.java', root / 'tests/ExpandedTacticsContracts.java', root / 'tests/NativeCancellationContracts.java', root / 'tests/StrategicContracts.java', root / 'tests/AdaptiveContracts.java']
    subprocess.run([args.java, '-m', 'jdk.compiler/com.sun.tools.javac.Main', '--release', '17',
                    '-cp', os.pathsep.join(dependencies), '-d', classes, *map(str, sources)], check=True)
    cp = os.pathsep.join([classes, *dependencies])
    for contract in ['DecisionJournalContracts', 'AiPolicyContracts', 'org.magictester.ai.CancellationContracts']:
        subprocess.run([args.java, '-cp', cp, contract], check=True, timeout=30)
    if args.native_home:
        home = str(args.native_home.resolve(strict=True))
        subprocess.run([args.java, '-Xmx512m', '-cp', cp, 'NativeCancellationContracts', home], check=True, timeout=120)
        subprocess.run([args.java, '-Xmx512m', '-cp', cp, 'ForgeTraceContracts', home], check=True, timeout=120)
        subprocess.run([args.java, '-Xmx512m', '-cp', cp, 'NativePolicyBridgeContracts', home], check=True, timeout=120)
        command = [args.java, '-Xmx512m', '-cp', cp, 'DamageTacticsContracts', home,
                   str(root / 'fixtures/damage-tactics-v2.json')]
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            command.append(str(args.report.resolve()))
        subprocess.run(command, check=True, timeout=120)

        expanded = [args.java, '-Xmx512m', '-cp', cp, 'ExpandedTacticsContracts', home, str(root / 'fixtures/expanded-v2.json')]
        if args.report:
            expanded.append(str(args.report.with_name(args.report.stem + '-expanded.json').resolve()))
        subprocess.run(expanded, check=True, timeout=180)
        strategic=[args.java, '-Xmx512m', '-cp', cp, 'StrategicContracts', home]
        if args.report:
            strategic.append(str(args.report.with_name(args.report.stem + '-strategic.json').resolve()))
        subprocess.run(strategic, check=True, timeout=120)
        adaptive=[args.java, '-Xmx512m', '-cp', cp, 'AdaptiveContracts', home, str(root / 'fixtures/league')]
        if args.report:
            adaptive.append(str(args.report.with_name(args.report.stem + '-adaptive.json').resolve()))
        subprocess.run(adaptive, check=True, timeout=180)
