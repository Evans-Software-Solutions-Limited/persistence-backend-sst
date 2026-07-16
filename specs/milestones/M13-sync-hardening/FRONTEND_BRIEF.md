# M13 Frontend Brief — sync worker triggers, failed-mutation visibility, migration versioning

Four independent fixes, one PR (all land in `packages/mobile`). Do them as separate commits so
each is reviewable on its own.

## 1. Client side of the idempotency fix (pairs with BACKEND_BRIEF.md)

Wherever the "Finish workout" command builds the `/sessions/record` payload (likely
`packages/mobile/src/application/commands/complete-session.command.ts` or similar — confirm exact
file), include the local `active_sessions` row's id as `clientSessionId` in the request body. No
other client-side behavior change — this is a one-field payload addition to match what the backend
now expects.

## 2. Connectivity-restored + debounced flush

`useSyncWorker.tsx` currently flushes only on mount (when a session exists) and on `AppState` →
active — explicitly documented in its own comments as deferring a NetInfo-based trigger and a
debounced post-enqueue flush.

- Wire the existing `NetInfoPort` / `useOnlineStatus` (`src/adapters/netInfo/`,
  `src/ui/hooks/useOnlineStatus.ts`) into `useSyncWorker` so a transition from offline → online
  triggers `processSyncQueue` (reuse the same drain call already used for the mount/foreground
  triggers — don't duplicate the drain logic).
- Add a short debounce (a few hundred ms to a couple seconds — pick something that won't thrash if
  several mutations enqueue back-to-back) after `enqueueMutation` so a write attempts near-
  immediately when online, rather than waiting for the next mount/foreground/reconnect event.
- Guard against overlapping drains — `markMutationInFlight`'s row-conditional UPDATE already
  prevents double-POST of the same entry; confirm the new triggers go through the same guarded
  entry point and don't need additional locking.

## 3. Failed-mutation review UI

`sync_queue` entries that exceed `max_retries` (default 3, per `retry_count`/`max_retries` columns)
currently disappear from `getPendingMutations()` with no user-visible signal — they just sit in
`failed` state.

- Extend the existing pattern used for `blocked_entitlement` (`SyncBlockedBanner` /
  `SyncBlockedContainer`, M10.6) to a generic "some workouts/data failed to sync" case, rather than
  inventing a new UI pattern. Reuse container/presenter structure if it fits.
- User-facing actions should mirror what's already offered for blocked entries where sensible:
  retry now, or discard (with a clear warning that discarding a completed-session mutation loses
  that session's data locally too — confirm this against whatever the blocked-entry discard flow
  already does before diverging).
- Add a query/selector for "failed, retries exhausted" mutations (parallel to whatever powers
  `useBlockedSyncEntries`).

## 4. Versioned SQLite migration mechanism

Today, schema changes in `sqlite.adapter.ts` are hand-rolled: each change either adds a new
`CREATE TABLE IF NOT EXISTS` to the big `initialize()` block, or (for reshaping existing tables,
e.g. the M10.6 `sync_queue` CHECK-constraint rebuild) does a bespoke `sqlite_master.sql`
inspection + create-new/copy/drop/rename dance wrapped in `withTransactionSync`. This works today
but has no central registry of "what version is this device's DB at" — every future reshape needs
its own from-scratch detection logic.

- Add a `schema_version` table (single row, integer version) written once at `initialize()`.
- Introduce an ordered list of migration steps (plain functions, each idempotent / guarded — same
  spirit as the existing ones), run in sequence from the device's current version up to the latest,
  inside `initialize()`.
- You do **not** need to retroactively rewrite the M2 and M10.6 migrations that already shipped —
  bring the _mechanism_ in going forward; folding the historical ones in is a nice-to-have, not a
  requirement (existing devices already have those tables in their final shape; the mechanism just
  needs to handle the _next_ schema change correctly).
- Prove it works with a synthetic "add a column" or "add a table" migration in the test suite, not
  a real product change.

## Tests

- `useSyncWorker` test: simulate offline→online transition, assert `processSyncQueue` is invoked
  without requiring an `AppState` foreground event.
- Debounce test: enqueue two mutations in quick succession, assert the drain doesn't fire twice in
  the debounce window.
- Failed-mutation UI: container/presenter tests mirroring the existing blocked-sync test style
  (`useBlockedSyncEntries.test.tsx` and its container/presenter tests).
- Migration mechanism: test that a synthetic added migration step runs exactly once and is
  idempotent if `initialize()` is called again without a version bump.
- 90% coverage on changed files per repo standard.

## Explicitly not required

- No changes to the "local-first until Finish" active-session model.
- No changes to `cached_*` table read patterns (cache-first-with-background-refresh stays as is).
- No multi-device / realtime sync work.
