# M3 — Active Session — SMOKE TEST

End-to-end happy path + offline / recovery walkthrough that gates merge for both PRs in this milestone. Run on a real device (or simulator with a paired notification environment) against the staging API.

This is the review gate cited in [`BRIEF.md`](./BRIEF.md) § "Review gate" and [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) § Smoke. Backend-only changes still pass through this test in addition to the targeted backend smoke in [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) § Smoke.

## Pre-flight

- Local SST deployed against staging Neon DB (`bun run dev`).
- Mobile dev client running on a real device (notifications won't fire reliably on simulator). iOS preferred for the notifications path.
- Test account seeded with at least one workout template (e.g. "Push Day" with 3 exercises, each with a target of 3 sets).
- API token for the same account in your shell for the curl assertions.
- Wipe SQLite for a clean slate: tap **Profile → Developer → Reset local cache** (or delete app + reinstall).

## A — Happy path: template-based session

1. **Home tab → Your Workouts → tap Push Day card → tap Start Workout.**
   - **Expect:** modal slides up, lands on `ActiveSessionPresenter`, first exercise rendered, set 1 of 3 ready for input.
   - **Verify:** SQLite `active_sessions` row exists with `status = 'in_progress'`, three `session_exercises` rows ordered by `sort_order`.

2. **Set 1 — log weight 80, reps 8, RPE 7. Tap Mark Complete.**
   - **Expect:** rest timer auto-starts (90s default), countdown ring visible.
   - **Verify:** `exercise_sets` row inserted with `is_completed = 1`, `completed_at` populated.
   - **Verify:** no network call fired (DevTools Network tab — only the local SQLite write).

3. **Background the app. Wait until the rest timer should have completed (~90s).**
   - **Expect:** local notification fires "Rest complete — Bench Press, set 2 ready".
   - **Tap the notification.** App returns to the session, rest timer cleared, set 2 inputs focused.

4. **Quick-fill check.** The set-2 inputs should pre-populate with the same `weight: 80`, `reps: 8` from set 1 (or the user's PR cache if heavier).
   - **Verify:** `QuickFillSuggestion` shows "Last time: 80kg × 8".

5. **Log sets 2 and 3 for exercise 1. Swipe right to exercise 2.**
   - **Expect:** smooth horizontal page transition; exercise progress shows 1/3 → 2/3.

6. **Substitute exercise 2.** Tap the overflow menu → Substitute → pick a same-muscle-group alternative.
   - **Expect:** picker is a `pageSheet` modal (not a centered popover). Old exercise card flips to a "Substituted" state, new exercise card slides in.
   - **Verify:** in SQLite, the old `session_exercises` row has `is_substituted = 1`; a new row exists with the new `exercise_id` and `original_exercise_id` pointing to the old exercise.

7. **Log 3 sets on the substitute and 3 sets on exercise 3.**

8. **Tap Finish Workout → SessionSummary screen.**
   - **Expect:** duration shown (live timer paused at completion time), total volume = sum of `weight × reps` across all completed sets, exercises completed = 3 / 3, sets completed = 9 / 9 (or 9 / 9 if substitution wasn't double-counted; old substituted exercise's incomplete sets shouldn't count toward `total_sets`).
   - **Expect:** at least one PR detected client-side (assuming you logged a heavier weight than your previous best). PR list shows exercise + record type + value.

9. **Tap Save Workout.**
   - **Expect:** modal stack collapses, lands on home tab.
   - **Verify:** Recent Activity row shows the just-completed session at the top.
   - **Verify:** `__sync_queue__` table contains 1 × `createSession` + 3 × `createSessionExercise` (substitute counts as +1) + N × `createSessionSet` + 1 × `updateSession` intents in dependency order.

10. **Wait for sync.** Foregrounding triggers `useSyncWorker` → `processSyncQueue` drains the batch.
    - **Verify:** `__sync_queue__` is empty.
    - **Verify:** `curl $API/sessions?status=completed&limit=1` returns the session with all nested exercises and sets, `is_personal_record: true` on the winning set(s).
    - **Verify:** `curl $API/personal-records?exerciseId=$BENCH` returns the new server-canonical PR row with `value` matching the client's prediction.
    - **Verify:** focus the home tab → dashboard refreshes → `progress.workoutsThisMonth` increments.

## B — Offline path: log + complete with no network

1. **Enable airplane mode.**

2. **Workouts tab → tap Quick Start.**
   - **Expect:** session opens with empty exercise list, "+ Add exercise" CTA visible.

3. **Add 2 exercises from the picker.** Picker should still work — exercise library is cached from M0.

4. **Log 2 sets per exercise, complete each.**
   - **Verify:** every set persists to SQLite. UI shows "Offline" banner (existing M1 behavior).

5. **Tap Finish Workout → SessionSummary.**
   - **Expect:** summary still renders fully — duration, volume, completion counts, PR list (computed client-side from cached `personal_records`).
   - **Expect:** PR detection works even without server (client predictive is the whole point).

6. **Tap Save Workout.**
   - **Verify:** session lands in `__sync_queue__` as a full batch (createSession → … → updateSession). No immediate network attempt.

7. **Disable airplane mode.**
   - **Expect:** within ~5s, sync worker fires (existing AppState listener) and drains the queue.
   - **Verify:** server has the session; PR list reconciles with server's authoritative response.

## C — Recovery path: kill mid-session

1. **Start a Push Day session. Log 1 set on exercise 1.**

2. **Force-kill the app** (swipe up from app switcher).

3. **Relaunch.**
   - **Expect:** `(app)/_layout.tsx` mounts → `useResumeSession()` detects the in-progress session → top-level `<ResumePrompt>` overlays the home tab: "Continue Push Day?".
   - **Tap Continue.**
   - **Expect:** session screen restores **exactly** — same exercise, same logged set on exercise 1 with `is_completed = 1`, set 2 inputs empty. Session-duration timer resumes from `now() - startedAt` (so includes time-while-killed).

4. **Tap Discard on the resume prompt instead** (rerun this scenario from a fresh session).
   - **Expect:** `CancelSessionCommand` fires. Session marked `status: 'cancelled'`, queued for sync.
   - **Verify:** home tab no longer shows the resume prompt on next launch.
   - **Verify:** logged sets are preserved server-side (queryable but not counted in `progress.workoutsThisMonth`).

## D — Authorization edge case

1. **Sign in as User A.** Start a session. Note its `id`.

2. **Sign out → sign in as User B.**

3. **From User B's API token:**

   ```bash
   curl -i $API/sessions/$USER_A_SESSION_ID -H "Authorization: Bearer $USER_B_JWT"
   # expect: 404
   curl -i -XPATCH $API/sessions/$USER_A_SESSION_ID -d '{"status":"completed"}' -H "Authorization: Bearer $USER_B_JWT"
   # expect: 404
   curl -i -XPATCH $API/sessions/$USER_A_SESSION_ID/exercises/$EID/sets/$SETID -d '{"weightKg":999}' -H "Authorization: Bearer $USER_B_JWT"
   # expect: 404 — TOCTOU fix means this is a single round-trip, race-free
   curl -i -XDELETE $API/sessions/$USER_A_SESSION_ID/exercises/$EID/sets/$SETID -H "Authorization: Bearer $USER_B_JWT"
   # expect: 404
   ```

4. **As User A, complete the session.** Confirm the set values weren't tampered with.

## E — PR detection edge cases

1. **Log a heavier set than any prior PR for an exercise.**
   - Client predicts new PR on summary screen.
   - On flush, server confirms; `personal_records` row updates.
   - Home tab refresh shows the new PR (M4 surface — for M3, just confirm the row exists via curl).

2. **Log a lighter set than the prior PR.**
   - Client predicts NO PR.
   - On flush, server agrees (no upsert because of the `WHERE personal_records.value < EXCLUDED.value` clause).
   - `personal_records` row unchanged.

3. **Two clients in flight (replay scenario):** queue the same session-complete twice (e.g. by toggling airplane mode mid-flush).
   - Backend handler must be idempotent. The `ON CONFLICT … DO UPDATE WHERE … <` ensures replays don't degrade the PR.
   - **Verify:** running the curl smoke from § A.10 twice in a row returns the same `personal_records` rows, no duplicates.

## F — Quality-gate-driven checks

Run all of these and capture the output in the PR body for both branches:

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit
```

- Coverage ≥ 90% aggregate on `microservices/core` and `packages/mobile`.
- New files: confirm coverage isn't artificially inflated by re-export-only files (M2 learning #13c).
- Test runs include the wrong-user-403 path on `updateSet` and `deleteSet`.

## Sign-off

A milestone is "shipped" when:

- Both PRs merged to `main`.
- All sections A–F pass on at least one real device.
- Loom or screenshot reel covering A.1–A.10 + B.1–B.7 + C.1–C.4 attached to the frontend PR body.
- `tasks.md` checkboxes ticked from Phases 1–9.
- ROADMAP `M3 Active session` row updated to `shipped (yyyy-mm-dd)` with PR links.
