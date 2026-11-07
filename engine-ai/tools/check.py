#!/usr/bin/env python3
"""Run bounded decision-journal contracts against the installed Forge dependencies."""
import argparse
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--forge-jar', required=True, type=Path)
parser.add_argument('--java', default='java')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
jar = args.forge_jar.resolve(strict=True)
with tempfile.TemporaryDirectory(prefix='magictester-ai-') as classes:
    sources = sorted((root / 'src/main/java').rglob('*.java'))
    sources.append(root / 'tests/DecisionJournalContracts.java')
    subprocess.run([args.java, '-m', 'jdk.compiler/com.sun.tools.javac.Main', '--release', '17',
                    '-cp', str(jar), '-d', classes, *map(str, sources)], check=True)
    import os
    subprocess.run([args.java, '-cp', os.pathsep.join([classes, str(jar)]),
                    'DecisionJournalContracts'], check=True)
