# Together LAN transport

Internal Expo local module for the same reachable Wi-Fi/hotspot path. `togetherLan`
is `null` on old binaries/Expo Go. Nothing starts on import, and the feature stays
disabled until the authenticated session adapter and device evidence are ready.
This module provides **untrusted transport only**: discovery, connection and
successful `send` never prove identity, admission or durable receipt. Use only
through the Together authenticated encrypted channel; never send workout payloads
or private keys directly.

## Wire and bounds

Bonjour/NSD service `_persist-tg._tcp`, TXT `lobby=<opaque UUID>`. Instance names
may be renamed by the OS without changing the lobby ID. No user/profile/workout
information is advertised. Endpoint IDs refer only to observations from the
current discovery run; APIs never accept an arbitrary IP/port.

Each frame is a four-byte unsigned big-endian UTF-8 byte length followed by that
many bytes. Both implementations reject zero, lengths above 65,536 and invalid
UTF-8 before delivering an event. Reads handle fragmentation. Per transport:
8 pending/connected peers and 64 observed endpoints; per peer: 16 queued writes
and 60 inbound frames/second. Writes preserve ordering. Connection/write deadlines
are 10 seconds; one absolute 30-second receive deadline spans a whole frame,
including a partial header/body. Authenticated upper layers must complete their
handshake promptly and send encrypted heartbeats before the idle deadline.
Android discovery resolution also times out after 10 seconds. `stop` unregisters
advertising/discovery, closes sockets, cancels timers and invalidates stale
callbacks; module destruction additionally shuts down Android executors.

## Network policy

Apple Network.framework requires Wi-Fi and disables peer-to-peer interfaces.
Android selects an existing `TRANSPORT_WIFI` Network without requiring Internet
capability, binds outbound sockets to it, and rejects off-link resolved addresses.
The dual-stack Android listener accepts only connections addressed to that Wi-Fi
network's own addresses from an on-link peer. Android 13+ advertisements bind to
that Network; older Android NSD may advertise the opaque service on other
interfaces, but those interfaces cannot deliver accepted application connections.
There is no cellular fallback or automatic local/cloud switch.

Android devices acting as the hotspot owner may not expose that interface as a
Wi-Fi Network; they currently fail with `wifi_unavailable`. Devices joined to a
hotspot can use the Wi-Fi path. iOS hotspot-owner behavior, AP client isolation,
IPv4/IPv6 interoperation and cross-platform service discovery require physical
proof. Unsupported topology must remain unavailable, not silently switch routes.

## Validation and release gate

JS bridge availability/forwarding and permission plugin merge/idempotency have
Jest coverage. Swift syntax can be parsed without producing an app. This is not
native compiler, framing/lifecycle or radio/device evidence. Kotlin/Swift runtime
coverage has not been measured. **No native app, EAS build or prebuild was run.**
Brad owns those builds. Before enabling: compile each native target, deny/regrant
local-network permission, discover/connect in both directions on offline Wi-Fi
and a separate phone hotspot, test fragmented/oversized/invalid UTF-8 frames,
slow reads/blocked writes, rapid start/stop, ninth connection, process death,
Wi-Fi loss and reconnect. Native integration and physical proof remain gates.

## Android local-network permission

The current owner build targets SDK 36. Android 17 devices retain implicit LAN access for that target; do not request or declare `ACCESS_LOCAL_NETWORK` yet. The config plugins add it when the explicit `expo-build-properties` target becomes 37+, and native code requests it only when both device and target are 37+. Keep SDK configuration in that plugin when upgrading. LAN/Wi-Fi and explicit hotspot-owner starts wait for permission; stop/destruction invalidates a delayed permission grant. Denial is reported without starting discovery/listening. This follows [Android local-network guidance](https://developer.android.com/privacy-and-security/local-network-permission). Test denial/regrant, cancellation during the prompt, and account switching on Brad’s owner-built binary; source-contract tests are not physical-device evidence.
