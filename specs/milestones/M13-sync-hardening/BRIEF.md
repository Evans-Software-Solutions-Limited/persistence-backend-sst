# M13 Sync Hardening — offline-queue correctness + visibility

> **Status: DRAFT, not yet triggered.** Written 2026-07-01 off a read-only architecture
> audit (mobile SQLite/sync layer + backend session-write path) done against an external
> research report on local-first sync tooling (PowerSync/ElectricSQL/CRDT). Hold for Brad's
> go-ahead before dispatching backend/frontend agents.

## Why this milestone exists

The audit's conclusion: **do not adopt PowerSync/ElectricSQL/CRDT.** The app's write-concurrency
profile (single-user, single-device, chunky "finish" commits) is exactly the low-concurrency case
where a managed sync engine (or CRDT) would be overkill — the existing custom `sync_queue` +
FIFO drain worker (`packages/mobile/src/application/commands/sync.command.ts`,
`packages/mobile/src/ui/hooks/useSyncWorker.tsx`) is architecturally the right shape. This
milestone does **not** replace that architecture — it closes two correctness/visibility gaps in
it (P0) and two reliability/maintainability gaps (P1) found during the audit. See
[[project_sync_architecture_audit]] in memory for the full audit.

**No UI redesign, no new sync engine, no schema modernization.** This is a hardening pass on the
existing local-first model. Legacy-fidelity rules from the top-level CLAUDE.md still apply to any
UI touched (the failed-sync review surface should mirror the existing `SyncBlockedBanner` pattern,
not invent a new one).

## Scope (P0 + P1 only — P2 items from the audit are explicitly out of scope here)

1. **P0 — `POST /sessions/record` is not replay-safe.** The repository's own docstring
   (`microservices/core/src/application/sessions/repositories/sessionRepository.ts`, around
   `recordSession`) admits a retried request creates a duplicate completed session + duplicate
   sets. An offline queue _will_ retry after an ambiguous network failure (200 sent, ack lost) —
   this is the single highest-risk item in the whole sync path. See BACKEND_BRIEF.md.

2. **P0 — permanently-failed sync mutations are silently stuck.** `sync_queue` entries that exceed
   `max_retries` (default 3) sit in `failed` state forever with no user-visible recovery path.
   Only the entitlement-blocked case (`SyncBlockedBanner` / `SyncBlockedContainer`, M10.6) has a
   review UI. A user can believe a workout logged and it never reaches the server. See
   FRONTEND_BRIEF.md.

3. **P1 — no connectivity-restored sync trigger.** The sync worker only flushes on app mount and
   on `AppState` → active (`useSyncWorker.tsx`, comment block explicitly deferring this). A
   `NetInfoPort` / `useOnlineStatus` already exists (wired to subscription UX banners) but is not
   wired to the worker. See FRONTEND_BRIEF.md.

4. **P1 — no debounced flush after enqueue.** Same deferred-scope note as #3 — bundle with it.

5. **P1 — no versioned SQLite migration mechanism.** Schema changes in
   `packages/mobile/src/adapters/storage/sqlite.adapter.ts` are hand-rolled `sqlite_master`
   sniffing per change (see the M2 `cached_workouts` drop-if-legacy-shape and the M10.6
   `sync_queue` CHECK-constraint rebuild for the pattern in use today). Not urgent at current
   scale, but should land before the next schema-touching milestone. See FRONTEND_BRIEF.md.

## Explicitly out of scope

- P2 items from the audit (no server-side max-limit cap on list endpoints; goals/habit-definition
  local caching; documenting the single-active-device model as a deliberate ADR) — punt to a
  follow-up, don't bundle in.
- Any multi-device realtime/push-based sync. Single-active-device remains the accepted model.
- Any change to the coarse-grained "whole session on Finish" write shape — that shape is correct
  for this app's concurrency profile and is not being revisited.
- PowerSync/ElectricSQL/CRDT evaluation — already closed by the audit; do not re-open unless the
  product actually grows a real-time multi-device or collaborative-editing use case.

## Sequencing

1. **Backend agent, PR 1:** idempotency fix for `/sessions/record` (item 1). Testable in isolation
   — no mobile changes required to verify server-side dedup. See BACKEND_BRIEF.md.
2. **Frontend agent, PR 2:** NetInfo-triggered + debounced flush (items 3+4), failed-mutation
   review UI (item 2), and the SQLite migration-versioning mechanism (item 5). These four are
   independent of each other technically but ship together since they're all in
   `packages/mobile`. See FRONTEND_BRIEF.md.

Both can develop in parallel; PR 2 does not depend on PR 1 landing first (the failed-mutation UI
should surface exhausted retries regardless of _why_ a mutation kept failing — the idempotency fix
just reduces how often it will).

## Definition of done

See SMOKE_TEST.md. Both PRs green on the full gate (`bun run prettier:check && typecheck && lint
&& build && test:unit`), 90% coverage on changed files, and:

- Duplicate-submit of `/sessions/record` with the same client-generated id is proven idempotent
  by a test (submit twice, assert exactly one session row + one set of nested rows).
- A simulated exhausted-retry mutation surfaces in a user-visible review UI (not just a debug log).
- Going offline → making a queued write → coming back online while the app stays foregrounded
  (no app-background/foreground cycle) triggers a flush within a few seconds, proven by a test on
  the `useSyncWorker` + `NetInfoPort` wiring.
- A schema_version table (or equivalent) exists and the existing ad hoc migrations (M2
  `cached_workouts`, M10.6 `sync_queue` rebuild) are expressible as ordered migrations under the
  new mechanism — doesn't require replaying history, just prove the mechanism forward from here.
