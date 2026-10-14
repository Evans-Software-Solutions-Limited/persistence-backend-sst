# Together Nearby source

This is a transport for the existing signed-discovery, paid-credential and
end-to-end authenticated Together protocol. Google endpoint names, connection
acceptance and SDK verification codes confer no application identity or admission.
Nothing starts on import. The composition must select a transport explicitly;
there is no automatic LAN/Nearby/cloud switch.

## Owner build integration

The podspec registers Google's `NearbyConnections` product using React Native's
`spm_dependency`, pinned to `8b96295426de02266e59efb7b28d6846704c8c97`.
React Native 0.83.4's `react_native_post_install` invokes its SPM manager, which
owns package registration and the CocoaPods target's Swift import paths. Expo's
config plugin only configures permissions; it no longer injects registration into
the Podfile. The podspec fails explicitly if the React Native helper is unavailable.
Android uses `com.google.android.gms:play-services-nearby:19.5.0`.

The previous custom hook has been removed entirely; this feature has not shipped.
For an existing local test project generated before this change, regenerate iOS
with the normal owner-controlled Expo workflow to remove the old Podfile hook and
manual app-target package reference, then install pods and retry the build. A clean
regeneration replaces the generated iOS directory: preserve any manual native
changes first. Fresh projects only need the normal Expo/CocoaPods setup.

No manual Add Package or Xcode search-path edits are needed. Static-link behavior,
transitive SDK module resolution and final application linking still require Brad's
native build; project fixtures do not establish them.

Nearby starts ask Android for the applicable runtime Bluetooth, location
(API 32 and earlier), Nearby Wi-Fi (33+), and local-network (37+) permissions.
Missing/denied permissions fail the operation. The plugin adds iOS Bluetooth and
local-network descriptions and the hashed Bonjour service. iOS uses Bluetooth/BLE
and Wi-Fi LAN media, excludes WebRTC and hotspot upgrades, and does not request
hotspot entitlements or location access. This is a proximity transport, not proof
that a chosen physical hotspot carried its bytes. The Google Android SDK chooses
its available media; no Internet capability check gates starting the session.

BYTES-only native payloads are capped at 32,768 bytes, 8 peers, 64 observed endpoints,
16 queued sends, 60 packets/second and 10 second connect/write deadlines; idle peers
close after 30 seconds. The JS framing adapter reconstructs existing 65,536 byte
frames in ordered <=4,096 character chunks, with a 10 second absolute assembly
deadline. It rejects extra fields, invalid order, oversized frames and unsupported
payload types. Framing/SDK send success is never a durable receipt.

## BoringSSL `sdallocx` and ReactNativeDependencies (fixed 14 October 2026)

The first two-phone TestFlight run killed the guest the moment it requested a
connection (crash 7D536D3B: `EXC_BAD_ACCESS (SIGKILL)`, `CODESIGNING 2 Invalid
Page`, triggering thread in `OPENSSL_realloc` → `OPENSSL_free` under
`UKey2Handshake::ForInitiator`, faulting address inside
`ReactNativeDependencies.framework` `__DATA`). Nearby's vendored BoringSSL
defines `sdallocx` as a weak fallback to `free()`; React Native's prebuilt
dependencies framework exports `_sdallocx` from `__DATA,__common` (folly's
jemalloc shim), and dyld's weak coalescing rebinds BoringSSL's call to that
data address. `TogetherNearbyModule.swift` defines `sdallocx` strongly via `@_cdecl` so the
reference is resolved at static link time and never reaches dyld. It has to be
in the module's own object: a separate C file in the static archive is never
pulled, because BoringSSL's object already satisfies the symbol (verified on a
simulator build, where the archive held both and the app still linked the weak
one). This is the
same mitigation swift-nio-ssl applied in apple/swift-nio-ssl#191 and the crash
reported in google/nearby#2195. `nm -m` on the built app must show
`(__TEXT,__text) external _sdallocx`, not `weak external`.

## Evidence and remaining native gate

JS framing/bridge/plugin tests exercise bounds, ordering, cancellation and
explicit selection. The Ruby fixture evaluates the actual podspec and runs the installed React Native
SPM manager against temporary Xcode projects, then reloads them to verify the pin,
product registration and generated import paths. It also covers preservation of unrelated registered dependencies. It never runs pod install or builds the app.
Swift syntax parsing is not SDK typechecking. Kotlin/Swift compilation, dependency
resolution in the actual generated project, permission prompts, mixed-platform
radio delivery, AP-owner NSD reachability, reconnect and battery behavior remain
unproven until Brad builds and runs the device matrix. No native app, prebuild,
EAS build, SDK package resolve or radio operation was run by this task.

Before testing: ordinary same-Wi-Fi, offline router, joined hotspot, explicit
Android owner, Nearby iOS-to-Android and both same-platform directions; deny and
regrant permissions; test 4 athletes, 8 pending native peers, fragmentation, max frames,
slow peers,background/account switch,radio loss and fresh reconnect. Verify no
cloud authority transition and that personal recovery continues when sharing
fails. Brad has authorized release-enabled source configuration; actual native
SDK compilation and physical release acceptance still require the owner-built
1.1.3 binary. No build or deployment is performed by this handoff.

Sources: [Swift SDK setup](https://developers.google.com/nearby/connections/swift/get-started),
[Swift discovery](https://developers.google.com/nearby/connections/swift/discover-devices),
[Android permissions](https://developers.google.com/nearby/connections/android/get-started),
[BYTES ordering](https://developers.google.com/nearby/connections/android/exchange-data),
[SDK releases](https://developers.google.com/android/guides/releases),
[local-only hotspot contract](https://developer.android.com/develop/connectivity/wifi/localonlyhotspot).

## Android local-network permission

The current owner build targets SDK 36. Android 17 devices retain implicit LAN access for that target; do not request or declare `ACCESS_LOCAL_NETWORK` yet. The config plugins add it when the explicit `expo-build-properties` target becomes 37+, and native code requests it only when both device and target are 37+. Keep SDK configuration in that plugin when upgrading. LAN/Wi-Fi and explicit hotspot-owner starts wait for permission; stop/destruction invalidates a delayed permission grant. Denial is reported without starting discovery/listening. This follows [Android local-network guidance](https://developer.android.com/privacy-and-security/local-network-permission). Test denial/regrant, cancellation during the prompt, and account switching on Brad’s owner-built binary; source-contract tests are not physical-device evidence.

Permission requirements are captured before the Android prompt. A destroyed React
context rejects the pending start; teardown uses the cached application-context
client and never constructs a new client from a destroyed activity. Permission
prompt/destruction behavior still requires physical-device validation.
