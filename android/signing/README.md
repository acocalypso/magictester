# Persistent debug signing

`magictester-debug.p12` is an intentionally public **development-only** key. Password: `android`; alias: `androiddebugkey`. It is checked in so debug APKs and test APKs keep the same identity across machines and releases. Never use this public key for a production release or to protect private signing credentials. Production release signing continues to require the separate repository secrets.

Do not regenerate this file. CI pins the certificate in `certificate.sha256` and tests an Android package update while retaining private app data. Replacing the key breaks installed-app updates.

Versions 0.1.0–0.1.2 used ephemeral CI keys. Their original private keys were not retained, so Android cannot update those installations to this certificate. Export each analysis JSON before uninstalling the old app. Starting with 0.1.3, Setup can import those exported analyses after a one-time reinstall. Later debug releases retain this identity and can update in place.
