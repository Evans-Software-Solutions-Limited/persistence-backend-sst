# PER-64 — authenticated LAN foundation

Based on merged PR #478 (`22d99b6e`). Implements the next part of the approved
offline design. Together remains disabled; no UI or native build is included.

## This slice

- Explicit same-network transport: Bonjour on iOS, NSD on Android, bounded TCP
  frames. Advertisements contain only opaque lobby identifiers. Discovery is
  neither authentication nor an exact-distance assertion.
- Server-issued Ed25519 offline credentials and existing signed admission wire
  format verified on mobile. Account/device seeds live in SecureStore. Trusted
  authority keys must come from the authenticated server, never a discovered peer.
- Pinned host/session, signed ephemeral X25519 handshake, HKDF-separated keys and
  authenticated encryption with replay protection. Reconnect establishes new keys.
- Host-authoritative four-seat admission: deliberate signed consent; valid friend
  proof bypasses extra approval, strangers require approval. Invite-only restricts
  requests to a host-selected allow-list. No PREV or delegated logging grant.
- Durable account-scoped roster chain and peer command inbox. Commit before a
  peer receipt; retain immutable owner commands across disconnect/restart. A peer
  receipt never means server acceptance or completed workout history.

## Boundaries and evidence

Native Nearby radio needs a separate adapter: Android's public Nearby API cannot
select Wi-Fi-only while iOS can. Both paths remain first-release requirements.
App container/presenter wiring reuses the sole reviewed Claude design linked in
FRONTEND_BRIEF.md; this PR does not replace it. Credential fetching/cache and full
active-workout/recovery presentation follow this portable transport slice.

Automated evidence must cover cross-runtime server signature vectors, tampering,
wrong host/session, expired credentials, admission, four-seat limits, disk failure,
lost receipts, immutable duplicate retries and reopening SQLite. Native source and
configuration review cannot establish radio/network/device behaviour. Brad owns
compatible native builds. iOS/Android no-internet Wi-Fi/hotspot, denied permission,
client isolation, app restart and four-device fault tests remain release gates.
No automatic cloud switch, host election, closure recovery or feature activation.
