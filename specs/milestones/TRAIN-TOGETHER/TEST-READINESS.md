# Together integrated test handoff — 5 October 2026

Brad requested the remaining agreed peer-Together work in one PR, based on merged
#485 (`bc4c34f3`). This consolidates the earlier sequential slices. Production is
still disabled. This is a source/test handoff, not device or release sign-off.

## Source included

- Reviewed lobby/invitation flows, explicit paid-only admission, accepted-friend
  auto-admission after Join, stranger approval, four-person limits and host removal.
- Host plan sharing, independent own drafts, named partner views, nonnumeric plan
  progress, separate numeric/PREV/delegated-logging grants, revocation and private
  cache purge. Delegated edits carry the revision the editor actually saw.
- Durable own logging, original-key offline recovery, explicit review/acceptance,
  independent results and signed host finish-all/save-own or guest leave. Unsupported
  local edits remain in the personal checkpoint with explicit recovery omissions.
- Cloud invitation/friend sessions, pending/admitted own drafts, numeric consent,
  guest leave and removal; account-scoped retry, explicit authority and recovery.
- Person-code/QR friendship, block/report and independent sanitized template copies.
- Nearby radio and explicit Android hotspot-owner transport source, plus the existing
  authenticated same-network LAN path. No automatic cloud/transport handover.

Keep the [reviewed frontend](./FRONTEND_BRIEF.md) layouts/components. Lower-priced
subscriptions and coached classes are outside this PR.

## Brad-owned environment and build prerequisites

No agent should execute native, prebuild, EAS, mobile build or deployment workflows.
Brad supplies the compatible binary and authorizes the test-stage infrastructure.
Changing environment variables locally does not deploy the backend.

| Prerequisite           | Exact source contract                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mobile capability      | `EXPO_PUBLIC_TOGETHER_TEST=true` **and** `__DEV__ === true`. `togetherTestEnabled` rejects the flag in release bundles. A release/preview binary with `__DEV__` false will not show Together even with the flag.                                                                                                                                                                                       |
| API/auth environment   | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` must identify the same authorized test environment. Identity/cache databases are scoped by API environment and account. Follow `packages/mobile/.env.example`; do not paste credentials into this document.                                                                                                         |
| Backend test stage     | `TOGETHER_ENABLED=true` enables the gated Together services. Keep it false/unset in production. Keep `TOGETHER_DISCOVERY_ENABLED=false` for this friends/invitation and bounded-device test; the historical venue-directory switch is not required.                                                                                                                                                    |
| Token secret           | SST secret `TogetherTokenSecret` supplies `TOGETHER_TOKEN_SECRET`; configure a stable, server-only value of at least 32 characters through the normal secret-management process. Never put it in an `EXPO_PUBLIC_*` variable.                                                                                                                                                                          |
| Offline issuer         | SST secret `TogetherOfflineAuthority` supplies `TOGETHER_OFFLINE_AUTHORITY`. Its JSON shape is `{keyId, privateKey, publicKeys}`: matching Ed25519 private key and canonical SPKI PEM public-key map, at most 32 issuer keys, current `keyId` present. Preserve trusted old public keys during rotation. Missing/mismatched configuration fails closed. No key values belong in source or screenshots. |
| Infrastructure         | `infra/together.ts` derives `TOGETHER_WEBSOCKET_URL`, `TOGETHER_MANAGEMENT_ENDPOINT` and `TOGETHER_QUEUE_URL` from its gated resources. Use the normal stage database/auth configuration; do not invent local substitutes for the recovery queue/worker. `GeoapifyApiKey`/`GEOAPIFY_API_KEY` are not needed for bounded LAN/Nearby or invitation-only cloud testing.                                   |
| Database               | Apply outstanding migrations through the owner-controlled database workflow before testing against that stage. New files: `20261005120000_together_numbers_consent.sql` (numeric grants, removal marker and original-start timestamps) and `20261005130000_social_person_codes.sql` (server-only hashed person codes). Corresponding files exist under `supabase/rollbacks/`.                          |
| Merged schema baseline | Stage must already include `20260921211637_together_backend.sql`, `20260930160418_together_offline_recovery.sql`, `20261001120000_together_reviewed_results.sql` and `20261001133310_together_previous_consent.sql`, plus the repository's preceding migrations. Apply migration order, not a cherry-picked schema.                                                                                    |
| Test accounts          | Two, three and four distinct qualifying paid accounts; accepted-friend and stranger pairs; separate free/expired fixtures for refusal. Provision offline credentials while signed in and online before the warm-cache offline cases. Personal logging/recovery remains available when sharing cannot be authorized.                                                                                    |

Native setup is specified in the [Nearby module README](../../../packages/mobile/modules/together-nearby/README.md).
The configured plugin is `./modules/together-nearby/plugin/withTogetherNearby.js`.
Android uses `com.google.android.gms:play-services-nearby:19.5.0`; the owner-run
CocoaPods hook links `NearbyConnections` at commit
`8b96295426de02266e59efb7b28d6846704c8c97`. Old binaries may return no adapter.
Android hotspot-owner mode requires a **manually enabled** hotspot and explicit
transport selection; the app does not create or control the hotspot.

## Evidence boundary and known limits

Focused source tests use real signatures/encryption and SQLite with simulated
native delivery, plus API/database and UI fixtures. They cover account/lifecycle
races, admission, consent/revocation, removal, stale delegated edits and recovery.
These are not radio, network-route, permission-prompt or physical-device proof.
The final full-repository checks, visual comparison and local Inspector outcome
must be recorded in the PR; this document does not predeclare those gates passed.

Native Swift/Kotlin compilation, actual generated-project dependency resolution,
mixed-device connectivity, AP-owner NSD routing and battery behavior remain unproven
until Brad builds and executes [SMOKE_TEST.md](./SMOKE_TEST.md). Swift syntax and
project-file fixtures cannot establish SDK compatibility.

- Cloud capacity counts concurrent participants: removal/leave frees a seat, while
  the removed athlete keeps a private result and cannot rejoin that cloud session.
  LAN removal frees its current roster slot, but the removed athlete requires a
  fresh deliberate host approval to rejoin; an old invitation/friend proof alone
  is insufficient.
- The signed offline recovery plan is immutable. Adopt/append a shared template
  before promotion; replacing requires an empty draft. Preserve existing own sets.
  Do not relabel a slot after it has ever logged a set, including after removal of
  that set. Unsupported post-promotion edits pause sharing and remain locally
  recoverable; partial server acceptance must not retire the retained differences.
- “Projection received” acknowledges a shared view, not a full private journal,
  server save or completed result. Each athlete reviews and saves their own result.
- Numeric/PREV/logging grants are independent. On disconnection private caches are
  purged; reconnect cannot use a cached grant as proof of current authorization.
- Nearby SDK media selection is not proof that bytes traversed a particular hotspot.
  Android owner mode verifies a directly connected local route, not the OS AP role;
  OEM discovery/routing remains a physical-device check.
