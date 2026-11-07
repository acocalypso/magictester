#!/usr/bin/env python3
"""Build the real Forge engine and pinned overrides for Android. No server code."""
import hashlib, json, os, pathlib, shutil, subprocess, tarfile, tempfile, urllib.request, zipfile, time
ROOT = pathlib.Path(__file__).resolve().parents[1]
BUILD = ROOT / 'engine' / 'build'
BUILD.mkdir(parents=True, exist_ok=True)
RELEASE = json.loads((ROOT/'engine/release.json').read_text())
PATCHES = json.loads((ROOT/'engine/patches.json').read_text())
VERSION = RELEASE['version']
def download(url, target):
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent':'MagicTester-Android/0.1'}), timeout=600) as response, open(target, 'wb') as out:
                shutil.copyfileobj(response, out, 1024*1024)
            return
        except Exception:
            if attempt == 2: raise
            time.sleep(2**attempt)
def digest(path):
    with open(path,'rb') as stream: return hashlib.file_digest(stream,'sha256').hexdigest()
local_home = os.environ.get('MAGICTESTER_ANDROID_FORGE_HOME')
if local_home and os.environ.get('CI'): raise RuntimeError('CI must verify the upstream Forge archive')
raw = BUILD/'upstream.jar'
data = BUILD/'data'
if data.exists(): shutil.rmtree(data)
data.mkdir()
ASSETS=ROOT/'app/src/main/assets'
ASSETS.mkdir(parents=True,exist_ok=True)
def wanted(name):
    return name.startswith('res/') and not name.startswith(('res/adventure/', 'res/skins/', 'res/fonts/', 'res/pics/', 'res/images/'))
if local_home:
    home=pathlib.Path(local_home)
    shutil.copyfile(home/RELEASE['jarName'], raw)
    for source in home.rglob('*'):
        relative=source.relative_to(home).as_posix()
        if source.is_file() and wanted(relative):
            dest=data/relative; dest.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(source,dest)
else:
    archive = BUILD/'forge.tar.bz2'
    if not archive.exists() or digest(archive) != RELEASE['archiveSha256']:
        download(RELEASE['archiveUrl'],archive)
    if digest(archive) != RELEASE['archiveSha256']: raise RuntimeError('Forge archive checksum mismatch')
    with tarfile.open(archive,'r:bz2') as source:
        for member in source:
            name=member.name.removeprefix('./')
            if not member.isfile() or not (name==RELEASE['jarName'] or wanted(name)): continue
            if '..' in pathlib.PurePosixPath(name).parts or name.startswith('/'): raise RuntimeError('Unsafe archive path')
            destination=raw if name==RELEASE['jarName'] else data/name
            destination.parent.mkdir(parents=True,exist_ok=True)
            with source.extractfile(member) as entry,open(destination,'wb') as out:shutil.copyfileobj(entry,out)
classes=BUILD/'classes'
if classes.exists(): shutil.rmtree(classes)
classes.mkdir()
patchdir=BUILD/'sources'; patchdir.mkdir(exist_ok=True)
inputs=list((ROOT/'engine/src/main/java').rglob('*.java'))
version_source=patchdir/'org/magictester/engine/EngineVersion.java'
version_source.parent.mkdir(parents=True,exist_ok=True)
version_source.write_text('package org.magictester.engine; public final class EngineVersion { public static final String VALUE = '+json.dumps(VERSION)+'; }')
inputs.append(version_source)
for patch in PATCHES:
    dest=patchdir/patch['path']; dest.parent.mkdir(parents=True,exist_ok=True)
    download(patch['url'],dest)
    if digest(dest)!=patch['sha256']:raise RuntimeError('Pinned source checksum mismatch: '+patch['path'])
    content=dest.read_text()
    for replacement in patch.get('replacements',[patch]):
        if content.count(replacement['find'])!=1:raise RuntimeError('Pinned patch no longer matches: '+patch['path'])
        content=content.replace(replacement['find'],replacement['replace'])
    dest.write_text(content); inputs.append(dest)
# Mobile Forge normally eagerly parses every card. This application only needs
# the cards in its decks; preserve Forge's own lazy reader on memory-limited ART.
fmodel=patchdir/'forge/model/FModel.java'; fmodel.parent.mkdir(parents=True,exist_ok=True)
download(f"https://raw.githubusercontent.com/Card-Forge/forge/{RELEASE['sourceCommit']}/forge-gui/src/main/java/forge/model/FModel.java",fmodel)
if digest(fmodel) != RELEASE["fModelSha256"]: raise RuntimeError("Pinned FModel source checksum mismatch")
content=fmodel.read_text(); find='final boolean loadCardsLazily = GuiBase.isMobile() ? false : getPreferences().getPrefBoolean(FPref.LOAD_CARD_SCRIPTS_LAZILY);'
if content.count(find)!=1:raise RuntimeError('Forge lazy-card adapter requires review')
content=content.replace(find,'final boolean loadCardsLazily = Boolean.getBoolean("magictester.lazyCards") || (!GuiBase.isMobile() && getPreferences().getPrefBoolean(FPref.LOAD_CARD_SCRIPTS_LAZILY));')
fmodel.write_text(content);inputs.append(fmodel)
java=pathlib.Path(os.environ.get('JAVA_HOME',''))/'bin/java'
java=str(java) if java.is_file() else 'java'
subprocess.run([java,'-Xmx1024m','-m','jdk.compiler/com.sun.tools.javac.Main','--release','17','-encoding','UTF-8','-cp',str(raw),'-d',str(classes),*[str(p) for p in inputs]],check=True)
overrides={p.relative_to(classes).as_posix():p for p in classes.rglob('*.class')}
with zipfile.ZipFile(raw) as original,zipfile.ZipFile(BUILD/'forge-engine.jar','w',compression=zipfile.ZIP_DEFLATED) as output:
    for name in sorted(original.namelist()):
        if name in overrides or name.endswith('/') or name.endswith('module-info.class') or name.startswith('META-INF/versions/') or name.upper().endswith(('.SF','.RSA','.DSA')):continue
        output.writestr(zipfile.ZipInfo(name,(1980,1,1,0,0,0)),original.read(name),compress_type=zipfile.ZIP_DEFLATED)
    for name,path in sorted(overrides.items()):output.writestr(zipfile.ZipInfo(name,(1980,1,1,0,0,0)),path.read_bytes(),compress_type=zipfile.ZIP_DEFLATED)
with zipfile.ZipFile(ASSETS/'forge-data.zip','w',compression=zipfile.ZIP_DEFLATED) as output:
    for path in sorted(data.rglob('*')):
        if path.is_file():output.writestr(zipfile.ZipInfo(path.relative_to(data).as_posix(),(1980,1,1,0,0,0)),path.read_bytes(),compress_type=zipfile.ZIP_STORED if path.suffix=='.zip' else zipfile.ZIP_DEFLATED)
manifest={**RELEASE,'dataUncompressedBytes':sum(p.stat().st_size for p in data.rglob('*') if p.is_file()),'engineJarSha256':digest(BUILD/'forge-engine.jar'),'dataSha256':digest(ASSETS/'forge-data.zip'),'adapter':'Android headless GUI; isolated process; lazy card reader','source':'https://github.com/acocalypso/magictester'}
(ASSETS/'engine-manifest.json').write_text(json.dumps(manifest,indent=2))
shutil.copyfile(ROOT/'LICENSE',ASSETS/'LICENSE.txt')
print('Prepared Android Forge', VERSION, 'data bytes', (ASSETS/'forge-data.zip').stat().st_size)
