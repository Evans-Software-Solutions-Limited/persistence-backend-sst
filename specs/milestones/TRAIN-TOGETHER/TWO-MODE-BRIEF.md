# Together connection modes — Nearby or Online, nothing else (PER-64 / PER-60)

Brad, 14 October 2026: "the connection is either offline or online, i don't
want to handle a mix." Two audiences: friends training in the same gym (some
on Wi-Fi, some on data, sometimes no internet at all) and a coach hosting a
remote class. The second is PER-61 and stays out of this release. This brief
collapses the first to two user-facing modes and finishes the online path.

## Why

Today a host chooses up to three things before anything is scanned:
connection (local or "Online · internet required"), local transport ("Same
Wi-Fi or hotspot", "Nearby phones", Android-only "This Android phone's
hotspot") and audience (Private, Training partners, Open nearby / Open on this
network). Online is offered only when the audience is Training partners. The
guest has no picker: the transport comes from the scanned link, default LAN,
and an iPhone scanning an Android hotspot-owner link fails because that
transport does not exist on iOS.

The local modes are not three things. LAN is Bonjour/NSD over the Wi-Fi
interface only, same subnet required, which client-isolated gym Wi-Fi often
blocks. Nearby is Google Nearby Connections on both platforms over Bluetooth,
BLE and Wi-Fi LAN, chosen automatically; it contains the LAN case and adds the
no-Wi-Fi case. Hotspot owner is Android only and fails the cross-platform rule.

Online is not peer-to-peer on the network: every message is HTTPS to the API
and the database, and partners learn of changes by re-fetching the session
every 5 s. The backend already deploys an API Gateway WebSocket that sends
`{"type":"sync_required"}` and a `POST /together/sessions/:id/realtime-ticket`
route, but the app never connects. Direct phone-to-phone online (WebRTC with
STUN/TURN) was excluded by `TRANSPORT-ADR.md` and is not reopened: for four
athletes logging a few sets a minute the server path is adequate once the
socket client exists, and connection quality is then each phone's own internet.

## Decisions (Brad, 14 October 2026)

1. Two modes: **Nearby** (no internet needed) and **Online** (internet
   required). No mixed session and no automatic handover between them.
2. Hotspot-owner mode is removed.
3. Online is available for Private (invitation link or QR) and Training
   partners. Open stays Nearby-only: an open online lobby would need the public
   directory that is out of scope.
4. The LAN transport stays in the codebase as the fallback behind the Nearby
   button, not as a user choice.

## Deliverables

### Slice 1 — mode collapse (mobile, no protocol change)

- `TogetherTransport` loses `"hotspot-owner"`; `createTogetherLobby` stops
  wiring `togetherHotspotOwner`; the Kotlin `startHotspotHost` /
  `startHotspotDiscovery` functions and their README section go.
- `TogetherStartContainer`, `TogetherLobbyContainer`, `WorkoutDetailContainer`
  (`TogetherConnectionChoice`) and `TogetherJoinContainer` show one choice:
  "Nearby · no internet needed" and "Online · internet required". No transport
  picker. Online is offered for Private and Training partners; choosing Open
  returns the connection to Nearby. `TogetherCloudContainer` hosts a Private
  online session without publishing friends visibility.
- Default local transport is `nearby` when the native module reports
  `available`, else `lan`. The link keeps `transport=` so an older guest still
  parses it; a guest that cannot honour the transport falls back to `lan`
  instead of throwing `transport-unavailable`.
- Audience copy: "Private · code or QR", "Training partners", "Open nearby".
  "Open on this network" is dropped.
- Status copy stops mentioning Wi-Fi: "Waiting for athletes nearby." /
  "Looking for this host nearby…" / "Keep the phones close together."
- Tests: container tests for each screen (one choice, online for every
  audience, guest fallback), controller test for the fallback, snapshot of the
  link format unchanged.

### Slice 2 — online realtime client (mobile)

- `cloudSession` requests a ticket (`POST …/realtime-ticket`, Idempotency-Key)
  after admission, opens the socket with it, and calls `refresh()` on
  `sync_required`. On socket error or close it reconnects with backoff and
  keeps the existing poll as the backstop, lengthened to 30–60 s while the
  socket is open and back to 5 s while it is not.
- The socket URL needs no app config: the ticket response already carries
  `endpoint` (`TOGETHER_WEBSOCKET_URL` on the server), and the connect route
  takes `?ticket=` (`handleTogetherSocket`).
- Acceptance from PER-64: online propagation p95 ≤ 2 s on staging; idle
  polling ≤ 2 requests per minute per device; the request log screen shows the
  difference.
- Tests: ticket requested once per admission, hint triggers one refresh, poll
  interval switches with socket state, reconnect after close.

### Slice 3 — backend tidy (core / infra)

- Nothing changes on the wire. Confirm `TOGETHER_ENABLED` keeps the socket on
  only once slice 2 ships; until then the socket API is idle cost and can be
  flagged off per stage.

## Status, 14 October 2026

Slices 1 and 2 are implemented together on `claude/per-64-two-mode-together`.
Slice 1 also removed the Kotlin hotspot-owner entry points and the LAN module's
`togetherHotspotOwner` export; the invitation link rejects
`transport=hotspot-owner`. The controller defaults to `nearby` when the module
reports available and falls back to `lan` when a link names a transport the
phone lacks. Slice 2's client requests one ticket per admission, refreshes on
`sync_required`, reconnects with 1 s to 30 s backoff and polls every 45 s while
the socket is open (5 s otherwise); a stage whose ticket route answers 503
keeps the 5 s poll and retries the ticket with the same backoff without
restarting the poll. Slice 3 is unchanged: staging and production keep
`TOGETHER_ENABLED` on, so the socket is live for this client.

## Acceptance

- Host and join screens offer exactly two modes on both platforms; no
  Android-only option exists anywhere in the UI or the link format.
- Two phones with no internet connect over Nearby; two phones on different
  networks connect Online with set changes visible within 2 s.
- Full mobile suite with the coverage gate, lint 0, typecheck; core unchanged.

## Open item, Brad's call before slice 1 is merged

Nearby on iOS has an open crash and no device proof (PER-22 / PER-64 P0). If
the two-phone run shows Nearby cannot be made reliable on iOS there is no
cross-platform alternative for the no-Wi-Fi case, and the local button would
have to stay on LAN with honest copy. Slice 1 is written so that flipping the
default back to `lan` is one line; the UX collapse itself does not depend on
the outcome.

## Out of scope, named

- Automatic handover between Nearby and Online, or a mixed session.
- Direct phone-to-phone online transport (WebRTC, STUN/TURN).
- Coached remote classes (PER-61) and anything above four athletes.
- The reviewed Together design itself: this is copy and option removal inside
  the existing screens, not a redesign. The remaining Together UX polish
  (PER-80) and the rest of the app's UX follow separately.
