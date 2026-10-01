# Together: local transport and durable recovery

30 September 2026. Product behaviour is approved under AC15–20. This document
records implementation boundaries and an evaluated transport candidate; it does
not claim working native transport or close the device release gate.

## Required experiences

### Approved training lobby boundary — 1 October 2026

Use invite-only or open-for-join-requests visibility. An open local lobby is
discovered through nearby device transport; an open Wi-Fi lobby is discovered
on the same reachable LAN/hotspot, without requiring upstream internet. Remote
sessions use friends or explicit invitations, with no global public directory.
Venue selection in the existing cloud API does not enforce vicinity; keep venue
discovery disabled until aligned with AC21–22.

Discovery alone admits nobody. Bind lobby identity and admission to authenticated
devices; unknown peers request host approval, verified accepted friends may join
deliberately without another approval. Four seats include the host. Never expose
logs, history or bearer credentials in advertisements or pre-admission summaries.

The next implementation slice is an authenticated local lobby/transport vertical
slice: host/scan/request/approve, one durable command and acknowledgement across
two devices, reconnect without duplicate application, then four-device extension.
Expose a transport-independent interface to the journal and a single authority
per session. Define explicit local/cloud authority transitions before implementing
automatic switching. Device success remains unproven until Brad supplies a
compatible build and physical-device evidence is recorded.

- Nearby: start and continue without internet, including local Wi-Fi or a phone
  hotspot without upstream internet. The app must explain unavailable local
  permissions or unreachable peers without discarding the active workout.
- Remote: use the existing authenticated HTTP/replay and WebSocket wakeups when
  internet is available; continue personal logging during interruption.
- Keep each athlete's own execution durable, independent and recoverable. Never
  equate a socket send with receipt, or peer receipt with server acceptance.

## Native transport candidate

### 1 October implementation decision

The explicit Wi-Fi option uses a separate LAN adapter: iOS Network.framework
Bonjour/TCP and Android NSD/TCP. Nearby's Swift API exposes medium selection,
but Android's public builder does not expose an equivalent Wi-Fi-only selector.
Nearby radio remains a subsequent adapter, still required before first release.
See [LAN-BRIEF.md](./LAN-BRIEF.md) for the current implementation/evidence boundary.

The LAN module advertises only an opaque session UUID in Bonjour TXT. Native
frames are length-prefixed, bounded to 64 KiB, with peer/queue/rate/deadline limits.
Device credentials authenticate a pinned host/session and ephemeral X25519
exchange; HKDF-separated directional keys protect ChaCha20-Poly1305 messages.
Counters reject reordered/replayed frames. Reconnect creates a fresh channel;
SQLite command identities and receipts survive it. No credentials/signing seeds
or historical PREV values appear in advertisements. Private keys use SecureStore.

The source restricts transport to Wi-Fi. Android hotspot-owner mode can lack a
usable Wi-Fi Network and currently fails closed as unavailable; clients attached
to a hotspot use its Wi-Fi network. Hotspot-owner support and both platforms'
physical no-internet behaviour are unproven release gates, not shipped claims.
This slice carries direct owner commands over a host/guest connection; guest-to-
guest log projection, cloud transitions and full workout UI remain later wiring.
Trust-key/credential provisioning and discovery-to-host-pin UI are not mounted.

### Earlier candidate evaluation

Google Nearby Connections provides offline peer discovery and encrypted data
exchange using Bluetooth/Wi-Fi, with iOS and Android SDKs. Its star strategy fits
one coordinator and three other athletes. Evaluate it behind an Expo local module;
do not substitute Apple's platform-only peer API for a mixed iOS/Android contract.

This candidate must demonstrate the specifically requested same-Wi-Fi/hotspot
behaviour. Nearby's automatic choice of radio does not by itself prove a manually
selectable Wi-Fi path. If that acceptance fails, provide a separate authenticated
LAN adapter. Client-isolated gym Wi-Fi may block direct device traffic; report
that accurately and offer a tested local-radio/hotspot alternative.

Expo SDK 55 and React Native 0.83.4 are the current app baseline. No peer SDK is
currently installed. iOS requires Bluetooth/local-network permission descriptions
and Bonjour service configuration; Android requires SDK-appropriate permissions.
Audit data collection, SDK licensing, platform support and battery/background
behaviour before adding the dependency. Native code requires Brad's compatible
binary; agents must not initiate a native/EAS build.

Primary sources checked 30 September:

- [Nearby overview](https://developers.google.com/nearby/connections/overview)
- [Connection strategies](https://developers.google.com/nearby/connections/strategies)
- [iOS setup](https://developers.google.com/nearby/connections/swift/get-started)
- [Connection verification](https://developers.google.com/nearby/connections/swift/manage-connections)
- [Expo native modules](https://docs.expo.dev/modules/get-started/)

## Identity, consent and authority

Discovery advertises opaque ephemeral identifiers, never workout/history data.
Cryptographically bind the connection to the signed-in account/device. A display
name, claimed user UUID, unverified endpoint or mere possession of a session name
must not grant access. The SDK's connection verification is required unless an
equivalent authenticated device handshake provides that verification.

Friend auto-admission removes product approval, not identity verification or the
guest's deliberate consent. Offline friendship/eligibility must use authenticated
cached evidence with documented freshness bounds. A server change cannot be
learned instantly without a network: never promise immediate cross-device
revocation while disconnected. Locally observed blocks, revoked grants and
recipient changes apply immediately. Unknown or unverifiable trust must not
silently count as an accepted friendship.

Offline credential issuance, expiry/renewal, device-key storage, remote-revocation
reconciliation and import authorization require a reviewed wire contract before
native payload exchange. Preserve personal logging/recovery when collaboration
authorization cannot be established. Do not expose server bearer tokens to peers.

The coordinator serializes membership, four-seat admission, plan revisions and
explicit closure. It cannot invent another athlete's personal data or consent.
Do not elect competing hosts on a network partition. During coordinator loss,
devices continue their own durable logs and show shared state as unavailable;
rejoin the same session or explicitly leave to continue solo. A remote/cloud
adapter and local adapter must never independently allocate the same session's
membership or closure revision.

## Journal and acknowledgement contract

Persist each personal operation and its stable command ID before dispatch or a
local-save acknowledgement. Scope identity by account, session, athlete and
execution; retries retain the original ID and content. Record operation payload,
expected personal version, consent generation, transport receipts and outcome
transactionally. Same ID with different content is a conflict, not a retry.

Receivers verify authorization then persist before acknowledging. Replay may
repeat or arrive out of order: missing revisions trigger bounded replay/snapshot,
never a blind last-write-wins update. Acknowledgements are bound to the peer,
execution and command content. A peer receipt never permits deleting an owner's
only unsynced copy. Switching local/cloud paths reuses the same journal IDs.

UI states must distinguish saved on this phone, received by participants and
synced to the server; show pending/conflict/recovery separately. Sign-out isolates
accounts and partner-cache revocation does not erase the athlete's own journal.
Do not automatically upload a device's old account data under a new account.

## Completion and cloud reconciliation

Persist explicit host closure independently of transport delivery. A nonhost
finishes only themselves. Host finish-all closes sharing but cannot claim unknown
offline sets were saved. Host save-own closes sharing and preserves remaining
personal executions for solo continuation. Empty execution produces no history.

On reconnection, an athlete reviews late personal sets before amending their
same stable result; never create a second workout to recover them. Reconciliation
must update historical sets and recompute dependent PR/volume/streak effects
idempotently. Delegated writes require valid recorded consent; revoked or ambiguous
writes must surface for recovery instead of being silently applied. Completed
results cannot be altered by partners. Current server finish freezes execution,
so this requires a new owner-only reconciliation API and migration/receipt design.

## Evidence required before activation

Test four participants (including mixed iOS/Android), airplane mode with local
radios enabled, Wi-Fi/hotspot with no internet, denied permissions, isolated LAN,
host crash, participant restart, lost acknowledgement, replay storms, full seats,
blocked pairs, revoked logging/history grants, empty results and host completion
while a device has unsent sets. Persist/reopen actual SQLite journals. Exercise
simultaneous local/cloud reconnect without duplicate admissions/results.

Measure at least 100 commands per tested transport under recorded conditions,
retaining the p95 <=2 seconds target for connected peer delivery. Separately
measure eventual cloud synchronization; no latency promise applies while the
destination is unreachable. Zero acknowledged data loss is required.

Neither SDK documentation nor simulated tests replace owner-built physical-device
proof. Keep activation off until native transport, server reconciliation, mobile
UI and existing infrastructure/moderation/pilot gates are satisfied.
