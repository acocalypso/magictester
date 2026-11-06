# Licensing and distribution

Forge release 2.0.15 is distributed under GNU GPL version 3. The exact inspected upstream license is preserved in `services/forge-runner/FORGE_LICENSE.txt`; source is https://github.com/Card-Forge/forge/tree/4ec5f1a2c32fa90ecb983a72b9eb47aa5c5d7676 .

MagicTester does not modify or link Forge classes. It downloads an upstream release into a separate runtime cache and invokes it as a Java subprocess through a separate runner. That boundary is an engineering choice, not a legal claim that copyleft obligations automatically disappear.

The repository's application code is licensed under GPL-3.0 (see the root LICENSE). The web/API/worker images do not contain the Forge application by default; the bootstrap service downloads it on the operator's machine. If you redistribute a runtime image/cache containing Forge or a modified build, preserve notices and license text and fulfill the applicable GPL source/corresponding-source requirements for what you convey. Keep the exact upstream source and any build scripts/patches available and trackable. A link alone should not be assumed to satisfy every distribution scenario. No custom Forge patches are currently included.

Java runtime/JDK images and packages have their own GPL with Classpath Exception and third-party notices. Redis, PostgreSQL, Node, Next.js and package dependencies retain their respective license requirements. Review a generated dependency inventory for the versions you distribute.

Scryfall metadata and Magic names/rules are third-party content. Respect Scryfall's current API guidance and Wizards' rights; the source-code license does not grant rights to that content. No card artwork is bundled. The project is independent of Wizards of the Coast; final public branding and notices require review before a public release.

This file records inspected components and implementation boundaries; it is not a legal opinion.
