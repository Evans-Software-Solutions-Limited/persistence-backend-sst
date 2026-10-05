# Together Nearby and explicit Android hotspot-owner source

This is a transport for the existing signed-discovery, paid-credential and
end-to-end authenticated Together protocol. Google endpoint names, connection
acceptance and SDK verification codes confer no application identity or admission.
Nothing starts on import. The composition must select a transport explicitly;
there is no automatic LAN/Nearby/cloud switch.

## Owner build integration

The Expo config uses `plugin/withTogetherNearby.js`. At the owner-run CocoaPods
post-install, `link_nearby.rb` adds Google's `NearbyConnections` Swift package to
both the TogetherNearby pod target (compile) and application target (link), pinned
to `8b96295426de02266e59efb7b28d6846704c8c97`. It preserves existing project entries
and fails rather than silently creating an unavailable Swift stub. Android uses
`com.google.android.gms:play-services-nearby:19.5.0`. A compatible owner build must
resolve these dependencies; old binaries return a null JS adapter.

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

## Explicit Android hotspot-owner LAN

The existing LAN module additionally exposes `startHotspotHost` and
`startHotspotDiscovery`, wrapped by `togetherHotspotOwner`. This is opt-in for a
hotspot the user has already enabled; it does not create/control a hotspot.
Unlike normal Wi-Fi mode, it does not require a ConnectivityManager Wi-Fi Network.
NSD supplies opaque local endpoint observations; arbitrary IP/port input is still
impossible. A destination must be private/link-local and directly on the prefix
of an up, non-loopback, non-point-to-point interface. Outbound sockets bind to
that matching local address; their actual local/remote route is rechecked after
connect. Inbound sockets use their actual local address and interface prefix for
the same check. No interface name or private address alone establishes trust.
This validates a directly connected local route, not the OS's hotspot role.
Known cellular, VPN and other non-Wi-Fi Network addresses are excluded even when
private. Normal LAN mode retains its existing strict Wi-Fi Network binding and never
silently falls back to owner mode.

The public LocalOnlyHotspot API supplies network credentials and reservation
lifetime, not a usable ConnectivityManager Network. We deliberately do not create
a hotspot and claim that this establishes the transport. OEM NSD discovery and
routing on a manually enabled AP remain device checks.

## Evidence and remaining native gate

JS framing/bridge/plugin tests exercise bounds, ordering, cancellation and
explicit selection. The Ruby fixture generates and reloads real Xcode project
files to verify package pinning and idempotent linking; it never builds them.
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
