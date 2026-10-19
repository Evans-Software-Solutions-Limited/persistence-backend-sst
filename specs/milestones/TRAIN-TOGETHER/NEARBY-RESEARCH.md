# Nearby: why the iPhone-to-iPhone connection fails, and where a stable one is

Status: research, 19 October 2026. Decision requested from Brad on PER-64.
Scope: the Nearby (no-internet) connection only. Online is out of scope.

## What the 19 October run showed

Two iPhones, host on Open nearby, guest scanning the QR. Guest: host found,
`connect_failed · nearby transport`. The request log was clean (all 200s), so
nothing server-side was involved. `connect_failed` is produced in exactly one
place: `Discoverer.requestConnection` returned an error after discovery had
already succeeded (`modules/together-nearby/ios/TogetherNearbyModule.swift`).
So the radios found each other and the Nearby SDK could not open a data link.

## What Nearby Connections can actually do on iOS

Read from the pinned SDK (`google/nearby` revision `8b96295`, 3 Oct 2026;
upstream `main` at 9 Oct adds nothing relevant to iOS BLE):

| Medium                                        | On iOS               | Notes                                                                                                                                                         |
| --------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wi-Fi LAN                                     | Yes                  | Bonjour over an infrastructure network both phones have joined. The one medium Google calls reliable on iOS.                                                  |
| BLE                                           | Yes, GATT socket     | Discovery plus a GATT "socket" for data (`ble_medium.mm`, 12 s internal connect timeout). L2CAP exists but is behind `kEnableBleL2cap = false`.               |
| AWDL (peer-to-peer Wi-Fi)                     | Implemented, **off** | `awdl.mm` is Network.framework with `includePeerToPeer = true`. Gated by `kEnableAwdl = false`; no public toggle in `GNCFlags` (only Wi-Fi Aware is exposed). |
| Wi-Fi Aware                                   | iOS 26 only          | Google: "not currently compatible with any in-market devices" (Sep 2025).                                                                                     |
| Bluetooth classic, Wi-Fi Direct, hotspot host | No                   | Compiled out or stubbed on Apple (upstream `4f4c36caa`, 6 Oct 2026).                                                                                          |

Our module requests `[.ble, .bluetooth, .wifiLAN]`. `.bluetooth` is a stub on
Apple, so with two iPhones that are not on the same Wi-Fi the only medium left
is **BLE GATT**. That is the path that failed.

What Google's maintainers say about that path (google/nearby #1619, #2447):

- "BLE is working pretty well between iOS devices, but there can be some
  discovery/connection issues with Android" (Feb 2024).
- "a recent iOS update has broken BLE GATT connections between iOS <-> Android"
  (Sep 2024); fixed only for Android 15+.
- "BLE isn't enabled by default for public builds quite yet" (May 2025);
  "I believe ble is enabled by default now" (Jan 2026), closed Mar 2026 without
  the maintainer verifying it.
- "Offline communication is currently only available between Android and
  Android" (Aug 2024). iOS/Android fully offline at speed "most likely won't be
  possible" unless Apple adds Wi-Fi Aware or Wi-Fi Direct (Feb 2024).
- BLE on iOS is for "quick sharing of small strings", described as "very slow".

Two faults of our own on top of that:

1. Both our deadlines are shorter than the SDK's. The Swift module arms a 10 s
   `deadline(id, peer, 10)` on connect and the JS session arms its own 10 s
   `connectDeadline`; the SDK's BLE connect alone allows 12 s before it gives
   up, and the UKEY2 handshake and the host's accept follow it. A slow but
   healthy BLE link is dropped by us as `read_timeout`.
2. Discovered endpoints go stale. Bonjour caches a service for its TTL (about
   two minutes) after the advertiser is gone (google/nearby #2472), so a hub
   entry can be connectable in appearance only. This is a "ghost session"
   source, not the 19 Oct failure.

## Apple's position on peer-to-peer

Multipeer Connectivity is not an escape hatch. Apple DTS, on the developer
forums: "our longstanding advice has been to move to a new API and stop using
MultipeerConnectivity" (Oct 2025); "MultipeerConnectivity simply does not work
very well for most developers" (May 2026); it is "effectively deprecated"
(Sep 2025). The iOS 26 reports describe exactly our gym case: Wi-Fi on but not
joined to a network, invite accepted, both sides `.connecting`, then
`.notConnected`, retry up to 20 times; a DTS engineer read the logs as the
system tearing down the AWDL interface before the connection completes.

The API Apple actively promotes is **Network.framework with
`includePeerToPeer = true`**: `NWListener` advertising a Bonjour service,
`NWBrowser` finding it, `NWConnection` over TCP, with your own framing. That
uses AWDL (peer-to-peer Wi-Fi) between iPhones with no router, and Bonjour over
infrastructure Wi-Fi when both phones are on one. Quinn (DTS) also recommends
exposing a way to turn peer-to-peer off when infrastructure Wi-Fi is present,
because peer-to-peer can degrade it and makes faults harder to see.

## What we already have

`modules/together-lan/ios/TogetherLanModule.swift` **is** that API: an
`NWListener` for `_persist-tg._tcp`, an `NWBrowser`, `NWConnection`, our own
framing and authenticated handshake above it. It is deliberately infrastructure
only since #480 (1 Oct):

```swift
parameters.includePeerToPeer = false
parameters.requiredInterfaceType = .wifi
```

Nearby's own AWDL medium, had Google enabled it, would be this same code path
inside their library.

## Recommendation

Route by platform pair, not by one SDK:

1. **iPhone to iPhone: our LAN module over peer-to-peer Wi-Fi.** Set
   `includePeerToPeer = true`, replace `requiredInterfaceType = .wifi` with
   `prohibitedInterfaceTypes = [.cellular]` (a hard `.wifi` requirement may
   exclude the peer-to-peer interface; verify on device), keep
   `_persist-tg._tcp`. No
   router, no Nearby flag surgery, Apple's recommended API, and we own every
   timeout. Needs Wi-Fi switched on on both phones, not joined to anything.
   Risk: the iOS 26 AWDL timing reports above were against Multipeer; Apple
   offered the Network.framework sample as the control, so this is the thing
   to test first on Brad's two iPhones. If it holds, Nearby on iOS stops
   depending on Google's BLE path at all.
2. **Android to Android: Nearby Connections**, unchanged. Bluetooth classic,
   Wi-Fi Direct and hotspot upgrades are mature there.
3. **iPhone with Android, no shared Wi-Fi:** the only radio left is BLE GATT,
   which Google itself does not promise. Offer it with the deadlines raised to
   at least 20 s, or send that pair to Online with honest copy. Brad's call.
4. **Any pair on the same Wi-Fi:** Nearby over Wi-Fi LAN or our LAN module;
   both already work ("Wifi session seems to hold up", 17 and 19 Oct).
5. **Fix the deadlines regardless** (Swift 10 s and JS 10 s to a single value
   above the SDK's 12 s plus handshake), and treat a discovered endpoint older
   than the Bonjour TTL as unverified in the hub.

The user-facing mode stays "Nearby · no internet needed". What changes is which
transport the button chooses, decided from the roster's platforms, which the
invitation already carries.

## Sources

- google/nearby discussion #2447 (iOS medium support, maintainers 2023–2025)
- google/nearby issue #1619 (BLE on iOS, closed Mar 2026)
- google/nearby issue #2472 (stale Bonjour endpoints, TTL)
- google/nearby issue #2195 (the sdallocx crash we fixed in #501)
- Pinned SDK source: `connections/implementation/flags/nearby_connections_feature_flags.h`,
  `p2p_cluster_pcp_handler.cc`, `internal/platform/implementation/apple/{ble_medium,awdl}.mm`
- Apple Developer Forums thread 803339 (Multipeer flaky on iOS 26, DTS replies Oct 2025–May 2026)
- Apple Developer Forums thread 769043 (Quinn on replacing Multipeer with Network.framework, Nov 2024–Sep 2025)
- Apple sample "Building a custom peer-to-peer protocol" (WWDC22 session 110339)
