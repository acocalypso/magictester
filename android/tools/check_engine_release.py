#!/usr/bin/env python3
"""Fail clearly when the verified Android engine pin needs a compatibility update."""
import json, pathlib, urllib.request
pin=json.loads((pathlib.Path(__file__).resolve().parents[1]/'engine/release.json').read_text())
request=urllib.request.Request('https://api.github.com/repos/Card-Forge/forge/releases/latest',headers={'User-Agent':'MagicTester Android engine audit','Accept':'application/vnd.github+json'})
with urllib.request.urlopen(request,timeout=30) as response:latest=json.load(response)
if latest.get('draft') or latest.get('prerelease'):raise RuntimeError('Latest endpoint returned a non-stable release')
if latest['tag_name'] != pin['tag']:raise RuntimeError(f"Forge {latest['tag_name']} is now stable; Android pins {pin['tag']}. Review the engine/source checksums and patches, then pass Android acceptance and publish an app update.")
print('Android engine pin matches latest stable Forge:',pin['version'])
