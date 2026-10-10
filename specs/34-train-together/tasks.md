# Train Together — tasks

## Current delivery — 1 October 2026

Brad approved AC15–20, including friend auto-admission and fully offline nearby
training. This checklist supersedes conflicting historical scope below; unchecked
items are not implemented merely because their requirements are approved.

- [x] Record approved decisions, merged PR #462 evidence and local/offline scope.
- [x] **F1 / PER-20/21:** four-seat atomic admission, accepted-friend auto-admission,
      all-member block checks, roster-scoped logging consent and bounded discovery;
      62 focused backend tests pass. This is implementation evidence, not live
      PostgreSQL contention or device proof.
- [x] **F2 / PER-20/22 (backend):** recipient-scoped PREV grants/read filtering/
      revocation, versioned retries and relevant-history projection; see
      [PREV consent contract](../milestones/TRAIN-TOGETHER/PREV-CONSENT.md).
      Mobile partner-cache purge remains part of F5.
- [x] **F3 / PER-20/22 (backend):** durable host finish-all/solo conversion,
      per-athlete closure outcomes, reviewed late sets and idempotent result/effect
      updates. PR #477 merged at `7531d26e`; mobile flows and live contention
      evidence remain open under F5/F6.
- [ ] **F4 / PER-20/22:** authenticated offline device credentials/admission,
      native local and Wi-Fi transport, server reconciliation and wire fixtures.
- [ ] **F4b / PER-64:** bounded training lobby and native transport
      slice under AC21–22: host/scan/request/approve, verified identity, journal
      dispatch/durable acknowledgements and reconnect. Prove nearby and same-LAN/
      hotspot paths without internet. Keep remote discovery friends/invite-based;
      do not expose the existing venue-public discovery as proof of proximity.
      Prepare native integration and tests; physical-device proof requires a
      compatible Brad-owned build. No native build authorization is implied.
- [x] **F4b1 / PER-64 (source foundation):** explicit Bonjour/NSD LAN adapter,
      mobile credential/roster verification, encrypted host-pinned connections,
      host admission and durable owner-command/peer-receipt reconnect. Expo
      autolinking detects both native targets; protocol and SQLite tests pass.
      Native compilation/device proof is pending. Nearby radio, hotspot-owner
      support, credential provisioning, discovery-to-host-pin UX and full shared
      workout integration remain open. See the milestone `LAN-BRIEF.md`.
- [x] **F4a / PER-64:** server-signed bounded device credentials, pair friendship
      evidence, signed four-person roster validation, and authenticated owner
      command reconciliation into a private reconstructed review candidate.
      This does not save workout history, activate cloud membership or implement
      native transport; see `OFFLINE-BACKEND.md` in the milestone folder.
- [x] **F5a / PER-64:** standalone account-scoped SQLite owner journal; nine real
      SQLite tests cover reopen, receipts, conflicts, rollback and account isolation.
      Now consumed by the LAN session adapter; not mounted in workout UI.
- [ ] **F5 / PER-22:** wire journal into mobile adapters and complete UI integration;
      distinguish local/peer/server save state and preserve own recovery.
- [ ] **F6 / PER-22:** four-device iOS/Android, poor/no-signal, Wi-Fi/hotspot,
      reconnect/restart/transport-switch and performance evidence, plus existing
      provider/PostgreSQL/moderation/pilot gates. Brad owns native builds.

## Backend execution — 21 September 2026

Brad explicitly expanded PR #462 to all Together backend work, covering PER-20,
PER-21 and the server portion of PER-22. The earlier proof-only restriction is
superseded. See [ADR](../milestones/TRAIN-TOGETHER/TRANSPORT-ADR.md) and
[evidence](../milestones/TRAIN-TOGETHER/RECOVERY-PROOF.md).

- [x] HTTP-authoritative transport and executable durable recovery proof.
- [x] Production session authorization, independent editing/results, real recording
      integration, durable effects, replay and conditional AWS infrastructure.
- [x] Social/place/block/report primitives and independent sanitized template copies.
- [x] Default-off rollout configuration, migration/rollback and provider requirements.
- [ ] Real multi-connection PostgreSQL and deployed AWS/provider evidence.
- [ ] Mobile journal/UI integration, owner-built runtime, two-phone faults/latency,
      moderation ownership and product pilot/release evidence.

E1/E7 retain external evidence gates; PER-22 remains incomplete until mobile and
integrated acceptance criteria pass. Historical draft tasks below are retained.

> Current execution contract: the 17 September amendment below supersedes conflicting draft decisions/statuses. Earlier text is retained as scope history. Brad authorized finalizing and merging briefs; individual defaults below are our selected working decisions, not claims of separate product approval. This documentation task does not implement the feature.

Discussion only. No implementation task is authorized or complete.

- [ ] **T1:** Resolve editing, group size, competition, supporting entitlements and GPS choices; update ACs/design, obtain sign-off, then prepare backend/frontend briefs and AC-mapped smoke test. (AC1–8; D1–6)
- [ ] **T2:** Spike protocol, transport and deployed-runtime compatibility; demonstrate authorization, reconnect and latency on two phones. (AC1–4; D2, D3, D5, D6)
- [ ] **T3:** Implement session persistence, paid gates, joins, consent, individual logging and independent finalization across backend/mobile. (AC1–4; D2, D3)
- [ ] **T4:** Implement friends, audience discovery, venues, expiry, reports and blocks. (AC5, AC6, AC8; D4, D5)
- [ ] **T5:** Implement sanitized reusable sharing and explicit independent copies. (AC7, AC8; D4)
- [ ] **T6:** Complete integrated UI, metrics, failure/regression tests and physical-device evidence; release all agreed scope together after owner-controlled build/release steps. (AC1–8; D3, D5, D6)

## Research gate added before T1 sign-off

- [ ] **T0.1:** Agree the behavioural interview/prototype protocol, proposed success thresholds and recruitment arrangements; collect evidence before finalizing product choices. No contacts sent yet. (AC2–7, AC9–10; D7; RESEARCH-2026-09-15.md)
- [ ] **T0.2:** Complete an authorized hands-on competitor comparison of joining, separate results, editing and disconnection; official feature claims alone are insufficient. (AC2–4, AC9; D2–3, D7)
- [ ] **T0.3:** Decide editing/substitution semantics, paid invitation journey and working name from evidence; amend requirements/design before execution briefs. (AC1–4, AC9–10; D2–4, D7)
- [ ] **T7:** After approved implementation and owner-controlled build, run the pair pilot and record raw counts, errors, effort and repeat use against the agreed criteria. (AC3–4, AC6, AC9–10; D6–7)

## Current execution checklist — 17 September

Earlier T0–T7 items remain historical and unchecked; use this superseding checklist. No implementation is complete.

- [ ] **E1** Protocol/transport/place-provider ADR, wire fixtures and recovery spike (AC1–4,12–14; D8–10).
- [x] **E2** Backend persistence, transactional command authorization/outbox, promotion and independent finalization (AC1–4,12–14; D8). Backend code/local proof in PR #462; live concurrency gate remains.
- [x] **E3** Shared place/social/report primitives; discovery, consent and template copy (AC5–8,11,13; D9). Backend code/local proof in PR #462; provider/moderation activation gates remain.
- [ ] **E4** Mobile ports, durable command journal, promotion/recovery UI and own/partner logging (AC2–4,9,12,14; D8–10).
- [ ] **E5** Friends/nearby/reuse, optional foreground permissions and manual fallback (AC5–8,11,13–14; D9).
- [ ] **E6** Research protocol/prototype and authorized recruitment; record actual evidence and limitations (AC9–10; D7).
- [ ] **E7** Contract/security/fault tests, two-phone smoke, product pilot, owner build and integrated release evidence (AC1–14; D6–10).

### PER-22 QR scanning follow-up

- Add bounded reversible compact local invitation encoding, preserving existing signed verification and old links.
- Share a responsive 256px QR renderer with 24px quiet zone across all session invitation surfaces.
- Verify payload reduction, signature-preserving admission, hostile inputs and display bounds; retain physical two-iPhone scanning acceptance.

### PER-22 TestFlight hub correction

- Simplify hub hierarchy, unify Join entry and improve whole-row workout/session selection.
- Remove hub discovery and partner polling; bind live browse cleanup to Join focus and pull indicator to explicit pull.
- Remove own-profile tile and reconcile accepted partner/request labels.
- Review actual empty/populated/accepted layouts at standard/narrow phone widths and test refresh/lifecycle/status regressions.

### 10 October staging correction (D15 / PER-22 / PR #490)

- [x] Type-aware legacy friend-request routing, push/inbox regression checks.
- [x] Partner safe area, matching workout headings/grid, visible athlete tabs/Sharing.
- [x] Signed initial activity and numeric execution before first set; PREV independent.
- [x] Styled root discard confirmation with account/workout/unmount guards.
- [x] One bounded authenticated foreground reconnect; lifecycle cancellation tests.
- [x] Ten-minute heartbeat simulation, focused coverage and phone-width layout evidence.
- [ ] Two-phone staging acceptance and exact 09:42 disconnect attribution.
