# Desktop technology and documentation audit

Checked 7 November 2026 using Context7's public MCP endpoint, official .NET release metadata and NuGet's stable package feeds. Context7 was explicitly queried for native UI threading, self-contained publishing, redirected process IO, headless rendering and Avalonia 12 clipboard/textbox migrations.

- **C# / .NET 10 LTS**, SDK **10.0.403**, verified against the official 10.0 release metadata and its SHA-512 SDK archive digest. Self-contained publish includes the target runtime; ReadyToRun improves startup. Trimming is disabled to preserve platform/native interop reliability.
- **Avalonia 12.1.5**, with matching Desktop, Fluent theme and Headless versions. NuGet reports this as the current stable release. Context7's indexed Avalonia snapshots include 12.1.3; the actual package's reference API and compiler validate the 12.1.5 surface. The app uses `TextBox.PlaceholderText`, `IClipboard.SetValueAsync(DataFormat.Text, ...)`, asynchronous IO and `Dispatcher.UIThread.Post`.
- **Node 24.22.1 LTS** for the private worker and native SQLite module. It is bundled, not installed as a system service. SQLite uses WAL, full synchronous durability and transactional job planning.
- The independently included engine keeps the root application's pinned dependency versions: Cheerio 1.2.0, csv-parse 7.0.3, robots-parser 3.0.1, Zod 4.6.7, TypeScript 6.0.3 and Node 24 types 24.19.2. The desktop runtime does not import Fastify, Next.js, PostgreSQL, BullMQ or Redis.
- **Eclipse Temurin Java 21 JDK**, fetched from Adoptium's current stable 21 metadata and verified with its official SHA-256. A compiler-enabled runtime image is required because a newly published stable Forge version must compile the pinned bridge/overrides and run Java source-mode contracts before activation. The packager links all JDK modules, including the compiler, and omits build-only source/jmod archives and debug symbols.

The desktop workflow also uses the current official Node 24 action releases: checkout 7.0.1, setup-node 7.1.0, setup-dotnet 6.1.0, upload-artifact 7.0.2, download-artifact 8.0.2 and action-gh-release 3.0.4, verified against their release metadata and action manifests.

Context7 references:

- https://context7.com/avaloniaui/avalonia — dispatcher calls, Avalonia 12 text/clipboard APIs, real-font headless Skia rendering.
- https://context7.com/avaloniaui/avalonia-docs — desktop platform and UI architecture guidance.
- https://context7.com/dotnet/docs — self-contained publishing and asynchronous process IO guidance.

Official manifests used by the build:

- https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json
- https://api.nuget.org/v3-flatcontainer/avalonia/index.json
- https://nodejs.org/dist/v24.22.1/SHASUMS256.txt
- https://api.adoptium.net/v3/assets/latest/21/hotspot

Context7 snapshots can lag package releases; registry metadata determines exact available versions. Compiler and live protocol/render/engine checks verify the selected APIs rather than relying on snippets alone. Runtime checksums and source links are saved into each distribution's runtime manifest. Publishing updated self-contained releases is needed to incorporate future runtime security fixes.
