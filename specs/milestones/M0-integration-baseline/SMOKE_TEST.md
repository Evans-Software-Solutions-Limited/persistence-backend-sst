# M0 — Smoke Test

End-to-end verification walkthrough for Milestone 0. Run against `bun run dev` (SST backend local) + the mobile app on a real simulator, NOT against in-memory adapters. Both PRs must be merged (or the shared milestone branch must include both) before running.

## Setup (one-time per environment)

1. `git checkout feat/m0-integration-baseline`
2. Backend:
   ```
   bun install
   bun run dev  # starts SST locally; wait for the "Ready!" banner
   ```
3. Database: ensure Neon dev DB is reachable. If starting fresh, run migrations (`bun run db:migrate` or equivalent — check `packages/db/package.json`).
4. Seed reference data: confirm `muscle_groups`, `equipment_types`, `categories` tables have rows. If empty, run the seed script; M0 depends on these.
5. Mobile:
   ```
   cd packages/mobile
   bun install
   bun run start
   ```
   Open in iOS simulator (or device).
6. Confirm `.env` has `EXPO_PUBLIC_API_URL` pointing at the local SST port (check the backend's `Ready!` line for the URL).

## Walkthrough

### Step 1 — First launch populates reference-list cache

- [ ] Fresh install (clear app data or use a new simulator)
- [ ] Sign in
- [ ] Navigate to **Exercises** tab
- [ ] Open filter modal (options icon, far left of the rail)
- [ ] Tap **Muscle Groups ›** section
- [ ] Confirm the list of muscles shows the backend catalog's display names (e.g. "Quadriceps" not "Quads" if that's what the backend returns)
- [ ] Verify network logs: `GET /exercises/muscle-groups` was called exactly once
- [ ] Close the app, reopen, navigate back to the filter modal → list renders instantly from cache, no additional network call (unless 24h elapsed)

### Step 2 — Hierarchical filter modal navigates cleanly

- [ ] From the section list, tap each of the three axes (Muscles, Equipment, Difficulty)
- [ ] Each sub-screen shows a searchable (muscles/equipment) or plain (difficulty) checklist
- [ ] Search on muscles: type "che" → list filters to "Chest" only
- [ ] Select "Chest" → tap Back → section list now shows "Muscle Groups — 1 selected"
- [ ] Navigate to Equipment, select "Barbell" → back
- [ ] Sticky bottom bar shows `Show N exercises` with live count reflecting both selections

### Step 3 — Apply filters, confirm server receives correct shape

- [ ] Tap **Apply** → modal dismisses → list shows only matching exercises
- [ ] Inspect network logs for the `GET /exercises` request
- [ ] Confirm the URL contains `muscleGroup=<uuid>` (not `muscleGroup=chest`) and `equipment=<uuid>` (not `equipment=barbell`)
- [ ] Server logs (backend terminal) show the query being executed with array semantics

### Step 4 — Multi-select OR semantics

- [ ] Reopen filter modal, add "Back" alongside "Chest" in Muscle Groups → apply
- [ ] List expands to show Chest OR Back exercises
- [ ] Network request: `muscleGroup=<chest-uuid>,<back-uuid>` comma-joined

### Step 5 — `createdBy` quick-filter

- [ ] Dismiss filter modal
- [ ] On the quick-filter rail, tap **My Exercises**
- [ ] List empties (no custom exercises yet)
- [ ] Server receives `createdBy=mine`; returns 0 results
- [ ] Tap **System** → list refills with seed exercises

### Step 6 — Create a custom exercise (write path)

- [ ] Trigger the dev creator hook (`+` button in the search bar → simple form, or the `create.tsx` placeholder with form fields)
- [ ] Fill: name "Test Lift", category "strength", difficulty "beginner", primary muscle "Chest", equipment "Barbell"
- [ ] Submit
- [ ] Confirm `POST /exercises` returns 201 with a real UUID
- [ ] Tap **My Exercises** quick-filter → "Test Lift" appears
- [ ] Postgres: `SELECT id, name, created_by, is_custom FROM exercises WHERE name = 'Test Lift'` returns the row with `is_custom = true` and `created_by` = your user's UUID

### Step 7 — Edit the custom exercise

- [ ] Via the dev hook or detail placeholder, PATCH the exercise to change name → "Test Lift Edited"
- [ ] Confirm 200 response
- [ ] List refresh shows updated name
- [ ] Sign out, sign in as a different user (if you have test accounts), try PATCH on the same exercise ID via curl → expect **404** (not 403)

### Step 8 — Delete the custom exercise

- [ ] Via dev hook: `DELETE /exercises/<id>` → 204
- [ ] List refresh: row gone
- [ ] Postgres: either row is gone (hard delete) or `deleted_at IS NOT NULL` (soft delete)

### Step 9 — Offline reference-list

- [ ] Put simulator into airplane mode
- [ ] Force-quit and reopen the app
- [ ] Navigate to Exercises → filter modal → Muscle Groups
- [ ] Cached list still renders (no network available; offline-first holds)

### Step 10 — Offline create, queued + flushed

- [ ] Still offline: create "Test Lift Offline" via dev hook
- [ ] Should appear in the list with a "sync pending" or similar indicator (or silently queued — check existing sync-queue UX)
- [ ] Turn airplane mode off
- [ ] Wait for sync (app foreground triggers flush)
- [ ] Confirm `POST /exercises` fires, Postgres row appears
- [ ] Sync-pending indicator clears; the local `local-*` ID is reconciled with the server UUID (check storage via dev logs or SQLite inspector)

### Step 11 — Sync-queue wire-format (regression check)

- [ ] In server logs during Step 10, confirm the `POST /exercises` body has `difficultyLevel`, `primaryMuscles`, `equipmentRequired` (API field names) — NOT `difficulty`, `primaryMuscleGroups`, `equipment` (domain field names). This verifies the sync-queue wire-format fix (`FRONTEND_BRIEF.md` §5).

## Pass criteria

All 11 steps tick-mark without manual intervention (beyond the prescribed taps / reloads). Network requests and Postgres rows match expectations. No console warnings about missing UUIDs in the reference-list mapper.

## Known-acceptable failures (not blockers)

- Typed-routes TypeScript might warn about `/(app)/exercises/filters/muscles` etc. until `.expo/types/router.d.ts` regenerates on first `expo start` after the route additions — force regen by restarting the dev server.
- Initial first-launch delay (~500 ms) while the reference-list cache fetches is expected and acceptable.

## Rollback plan

If M0 smoke test fails repeatedly after good-faith debugging:

1. Revert the frontend PR first (backend endpoints are additive and safe).
2. If the backend needs reverting too, the new handlers are tagged — `git revert` the range.
3. The Phase 4 Exercises screen pre-M0 stays functional against in-memory adapters (but will continue to mis-filter against real backend until M0 re-lands).
