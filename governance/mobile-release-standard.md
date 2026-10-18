# Android mobile release standard

## SDK baseline

All Fuze family Trusted Web Activities must set `minSdkVersion` to integer `24` in
`android/twa-manifest.json`. The FuzeOne Android workflow must also verify or set API 24 in
the Bubblewrap-generated Gradle project before it builds an APK.

Bubblewrap may generate API 21 despite the manifest declaration. API 21 is incompatible with
`androidbrowserhelper:2.7.4`, causing Android manifest merging to fail. Do not suppress that
failure with `tools:overrideLibrary`; preserve the API-24 baseline instead.

## Enforcement

`scripts/check-mobile-release.mjs` rejects lower or invalid values before Bubblewrap runs.
FuzeOne manages that guard and the APK workflow for every repository whose manifest declares
`mobile.required: true` and the `android` target.
