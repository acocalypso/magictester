# Desktop distribution notices

MagicTester and the included project engine/bridge source are GPL-3.0-only; see `LICENSE` and `engine/bridge/FORGE_LICENSE.txt`. Corresponding source is published at https://github.com/acocalypso/magictester under the release tag.

Avalonia and the SharpCompress streaming decoder are MIT-licensed. Microsoft .NET is MIT-licensed and includes third-party components under their upstream notices. Node.js is distributed under its included `tools/node/LICENSE`, which contains notices for its bundled components. npm dependency versions/licenses are recorded in `engine/package-lock.json` and their package folders.

`licenses/nuget` retains the resolved NuGet metadata, copyright declarations, license grants and component notices for the native UI and bundled .NET runtime. `packages.json` indexes those files. MIT grants for packages declaring the MIT expression include their metadata's original copyright holder; package-provided license and third-party files are also retained.

Eclipse Temurin/OpenJDK is distributed under GPLv2 with the Classpath Exception and additional component notices. The compiler-enabled jlink image and its module `legal` and `conf` notices are retained in `tools/java`; its source links and download checksum are available from the official Adoptium release identified in `runtime-manifest.json`.

Forge and card data are downloaded at first setup, not embedded in the desktop executable. Forge is GPL-3.0 and its accompanying notices remain in the installed data directory. Magic: The Gathering names/rules belong to Wizards of the Coast. This is an independent testing tool.
