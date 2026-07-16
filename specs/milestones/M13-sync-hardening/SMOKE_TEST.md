# M13 Smoke Test — sync hardening

Run once both PRs (backend idempotency fix + mobile sync-worker/UI/migration fixes) are merged to
the shared milestone branch.

## 1. Idempotency (backend, but exercised via mobile flow)

1. Start a workout session on a dev-build device, log a few sets, tap Finish.
2. Kill the app (or force airplane mode) immediately after tapping Finish, before confirming the
   success toast — simulating an ack that never reached the client.
3. Reopen the app / restore connectivity. The sync queue should retry the flush.
4. Query the backend: exactly one session row exists for that workout, with exactly the sets
   logged — not two, not zero.

## 2. Failed-mutation visibility

1. Force a mutation to fail repeatedly (e.g. point the dev client at an endpoint that 500s, or
   temporarily lower `max_retries` to 1 for the test run).
2. Confirm the mutation enters `failed` state after exhausting retries.
3. Confirm a review UI surfaces it (banner/screen — whatever M13 shipped) rather than it silently
   vanishing from view.
4. Exercise the retry action from that UI and confirm it re-attempts the sync.

## 3. Connectivity-restored flush

1. With the app foregrounded and no pending mutations, go offline (airplane mode).
2. Perform an action that enqueues a mutation (e.g. log a set on an active session).
3. Come back online **without** backgrounding/foregrounding the app.
4. Confirm the mutation flushes within a few seconds, without requiring an app switch.

## 4. Migration mechanism

1. Fresh install on a simulator/device with no existing local DB.
2. Confirm `initialize()` runs cleanly and a `schema_version` row exists at the latest version.
3. (Dev-only check) Confirm the synthetic migration added for this milestone's test suite is not
   present in the shipped schema — it should only exist in tests, not ship to production devices.

## Definition of done

All four flows pass manually on a dev build, in addition to the automated test suites specified in
BACKEND_BRIEF.md and FRONTEND_BRIEF.md. No regression in existing sync/session tests
(`sync.command.test.ts`, `useSyncWorker.test.tsx`, `useSync.test.tsx`, session repository tests).
