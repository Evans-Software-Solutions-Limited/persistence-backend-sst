# PER-64 / PER-22 — verified network lobbies

Next slice after merged #483 (`8257b532`). Together remains disabled. Reuse
FRONTEND_BRIEF and approved AC21–22: invite-only or open on the same reachable
Wi-Fi/hotspot, explicit joining, four paid athletes, friend auto-admission and
stranger approval. No worldwide directory or cloud venue substitute.

## Contract and boundaries

Native Bonjour/NSD advertisements remain opaque session IDs. Browsing contacts
one discovered endpoint at a time with a random challenge, without sending the
visitor's account credentials. An open host signs a short-lived summary of its
verified account/device, session, workout name and current athlete count. Only
summaries verified against the visitor's provisioned issuer keys and challenge
reach the UI. Discovery labels and endpoint IDs never establish identity.

The count is explicitly a last-check value; admission rechecks capacity. Lost
or expired summaries disappear. Search again refreshes observations. A native
connection timeout stops this scan because the existing bridge cannot correlate
late connection events with endpoint IDs. Cancellation, sheet dismissal while
browsing, account changes and backgrounding stop discovery. Selection never
admits anyone; separate Join uses the existing encrypted host-pinned handshake.

Private is the default for each account's UI entry. An invite-only host discloses
no browse summary. Its signed code/QR contains a random bearer token; only its
hash is persisted in the immutable host policy. The token travels in the
already authenticated encrypted join request. Possession allows requesting a
seat, never free access or stranger auto-approval. Current blocks, valid paid
credentials, deliberate consent and the four-seat limit still apply. PREV and
logging permission remain separate. A shared invitation can be forwarded; it is
not a named-recipient restriction.

Open summaries are intentionally visible to devices on the reachable network.
Known pair denials filter a visitor's verified list, but a public summary cannot
hide its metadata from an anonymous blocked visitor. All blocks remain enforced
at authenticated admission. No workout sets, history, roster identities or
invitation token are disclosed by the probe.

## Reviewed UI

Reuse the prototype's Who can join radio-card treatment and existing join sheet,
code/QR card and separate consent screen. Private maps to code/QR only; approved
open network scope replaces the prototype's unbounded public/gym claim. The
network list extends these cards for the approved missing discovery state.
No separate training-partners directory or saved profile defaults is claimed.

Visual evidence uses the actual React presenters rendered with React Native Web
and simulated snapshots, compared with the sole reviewed Claude prototype.
`network-audience-preview.png`, `network-browse-preview.png` and
`reviewed-audience-reference.png` are under the task's local visualization
`together/` directory. This is presentation evidence, not native sheet geometry,
Bonjour/NSD operation or physical-device proof.

## Remaining release work

Nearby radio, Android hotspot-owner support, full workout promotion/logging,
PREV/delegation/cache purge, independent completion/reviewed recovery, profile
projection, local/cloud authority transitions and mixed-device/live-infrastructure
proof remain outstanding. Lower-priced subscriptions and coached classes remain
separate. No native, prebuild or EAS build, deployment or activation is authorized.

## Validation

Local Inspector full-diff re-review is clean. Its Android source review caught
normal EOF being reported as a peer error before disconnect; regressions now
preserve subsequent scanning and ignore old peers' late errors/send failures.
Stale listings use a search-again message rather than claiming credential expiry.

Final mobile: 557 suites / 7,386 tests passed. Focused runtime: 143 tests across
five suites; focused UI: 40 tests across two suites. All eight changed runtime/UI
files exceed 90% in statements, branches, functions and lines. Private-to-open
submission mutation fails the UI regression. Typecheck 9/9, lint 6/6, formatting
and whitespace pass; non-mobile tests 18/18 and build 12/12 reuse valid Turbo
cache. The existing full-suite forced-worker teardown warning remains; focused
new suites exit cleanly. Crypto and SQLite are real; LAN events are simulated.
