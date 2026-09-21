# Train Together — requirements

21 September 2026 execution update: Brad expanded PR #462 to include all Together
backend work across PER-20, PER-21 and the server portion of PER-22. E1–3/server
E7 implementation and local evidence are recorded in
[RECOVERY-PROOF](../milestones/TRAIN-TOGETHER/RECOVERY-PROOF.md). This supersedes
the earlier proof-only and discussion-only scope. No mobile implementation,
provider activation, two-phone latency proof or integrated release is implied.

> Current execution contract: the 17 September amendment below supersedes conflicting draft decisions/statuses. Earlier text is retained as scope history. Brad authorized finalizing and merging briefs; individual defaults below are our selected working decisions, not claims of separate product approval. This documentation task does not implement the feature.

15 September 2026 · Discussion draft; not signed off or authorized for implementation.

## Intent and scope history

The original 15 September brief proposed separate private-pair, friends, nearby and competition releases. Brad subsequently requested the whole feature together. The current proposal combines shared sessions, friends, venue/nearby discovery and reusable workout sharing in one coordinated release, delivered through internal engineering stages. Competition, participant limit and simultaneous editing remain discussion decisions.

## Acceptance criteria

- **AC1 — Eligibility:** Both participants require effective active Premium, Premium Plus or eligible coach membership. Server checks enforce this at creation, joining and privileged operations. Free/expired users cannot collaborate; expiry preserves recorded work and save/exit.
- **AC2 — Join and consent:** An athlete promotes a solo draft into a shared session, invites by expiring link/code/QR or publishes an explicitly chosen audience, and approves join requests. Joining explains logging authority and data visibility. Existing active drafts require an explicit finish/discard decision.
- **AC3 — Individual results:** Both phones display the shared plan and live progress. Sets retain athlete-specific load, repetitions and completion. Applying values to both is explicit. Each athlete receives exactly one personal history entry with their own statistics/PRs, including early departure or interrupted finalization.
- **AC4 — Reliability:** Duplicate/reordered commands, disconnects, app termination and stale writers cannot silently overwrite acknowledged work. UI distinguishes pending, stale and synchronized state. Target: foreground propagation within two seconds at p95 on a stable connection, to validate in the spike.
- **AC5 — Friends:** Request/accept/remove/block friendships; discover friends' explicitly joinable sessions. Blocking prevents invitations, discovery and joining. Session summaries reveal no live sets before approval.
- **AC6 — Nearby:** Athletes deliberately publish a time-limited session at a selected venue/area; others search by venue/area and request to join. Visibility defaults private. Exact device position is never public; manual selection works without location permission. GPS-assisted search remains a discussion choice.
- **AC7 — Reuse:** Share a reusable exercise plan with a friend, who explicitly saves an independent copy. Sharing excludes private session results and health data; later edits do not silently change the recipient's copy.
- **AC8 — Safety and regression:** Report/block controls apply throughout. Sharing grants no historic/health/coaching access. Solo offline start/save remains supported. Measure invites, eligible joins, completed/repeat pairs and reusable saves without relaxing eligibility.

## Decisions required before sign-off

Choose one nominated logger versus both-phone editing; two participants versus groups; competition included now or separately; manual venue search versus optional foreground GPS. Competition needs its own scoring, fairness and duplicate-prevention ACs before inclusion. Paid collaboration does not yet determine entitlement for friendship or template sharing.

## Research amendment — 15 September 2026 (proposed, not approved)

See [research evidence and validation protocol](./RESEARCH-2026-09-15.md). Direct adjacent live-sync products exist; novelty and retention benefits are not established. The intended value is fewer logging interruptions with accurate personal history. One integrated release remains the proposal; research/pilot stages are validation, not a return to staggered public releases.

- **AC9 — Individual pacing:** proposed extension to AC3: athletes may use different rest periods, skip/substitute an exercise and finish separately without mutating a partner's personal results. Specify how shared exercise order relates to personal substitutions before coding.
- **AC10 — Validation evidence:** before release, record baseline versus shared logging effort, unaided join success, repeat pair use, recovery failures and paid-eligibility abandonment separately. Use the research note's provisional thresholds for discussion; they are not industry benchmarks or evidence already collected. Unknowns and small-cohort limits remain visible.

Working name under discussion: Persistence Together; no naming approval or clearance implied. Customer interviews, prototypes, pilot results and account willingness-to-pay evidence have not yet been collected.

## Execution amendment — 17 September 2026

- **AC11 — Release contract:** Working label **Persistence Together**, action **Train together**. Exactly two athletes; shared live sessions, friendship, nearby discovery and independent plan reuse form one release. Competitive scoring stays a separate backlog. Research may revise defaults through a spec amendment.
- **AC12 — Authority:** Both phones edit their owner's execution. Each athlete separately grants/revokes partner logging. No default delegation; revocation invalidates queued partner writes. Host owns shared plan order; per-athlete substitutions, skipped sets, rest and finish do not alter the other athlete. Completed execution is immutable to partners.
- **AC13 — Access and exit:** Authenticated free users can manage friendships and browse summaries. Creating/joining live sessions and sharing/saving shared templates require effective active Premium, Premium Plus or eligible coach entitlement; joining cannot begin until both qualify. Expiry pauses collaboration, preserves acknowledged work and own pending-work recovery/finalization. Block immediately severs live cross-user access and grants neither party the other's data. No host presence required to recover or finalize one's own workout.
- **AC14 — Location and recovery:** Optional foreground GPS assists discovery; manual place selection is always available. No background tracking or public exact position. Leave, logout, device change and cancellation never silently discard pending commands: resolve acknowledged status, retain recoverable local work and explicitly explain device-local unsent data. Already uploaded work is recoverable on another authenticated device.

AC1–10 remain requirements except their explicitly unresolved choices are resolved by AC11–14. AC10 thresholds remain provisional research criteria, not collected evidence. Research evidence gates release validation; it does not prevent the independent technical spike.
