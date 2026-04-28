# M2 — Smoke Test

End-to-end verification walkthrough for Milestone 2. Run against `bun run dev` (SST backend local) + the mobile app on a real iOS simulator, NOT against in-memory adapters. Both PRs must be merged (or staged on a shared `m2-workouts` base branch) before the full 11-step run. Partial runs against one PR at a time are acceptable for agent self-verification.

Every step maps to one or more acceptance criteria in `specs/04-workout-management/requirements.md` — the AC number is listed inline.

## Setup (one-time per environment)

1. `git checkout main` (or the milestone integration branch if either PR is still open).
2. Backend:
   ```
   bun install
   bun run sst dev --stage bradleysimms-evans  # wait for "Ready!" banner
   ```
3. Database: ensure Supabase dev DB is reachable. Confirm seed data exists for **two test users** (call them A and B):
   - A has at least 3 workouts with mixed visibility (≥1 private, ≥1 friends, ≥1 public).
   - A has at least 1 workout with a superset (≥2 exercises sharing a `superset_group`).
   - B has at least 1 workout assigned to A via `workout_assignments`.
   - A has a `subscriptions` row with `workoutLimit` set (e.g. 50).
4. Mobile:
   ```
   cd packages/mobile
   bun install
   LANG=en_US.UTF-8 npx expo run:ios  # native build (one-time pod install)
   ```
   Wait for the simulator to launch.
5. Confirm `.env` has `EXPO_PUBLIC_API_URL` pointing at the local SST Lambda URL.

## Walkthrough

### Step 1 — Workouts tab cold-renders three sections (STORY-001 ACs 1.1, 1.6)

- [ ] Sign in as user A (fresh install — no SQLite cache).
- [ ] Navigate to the Workouts tab.
- [ ] `PLogoDrawLoader` shows briefly, then three sections render: **Mine** / **Assigned** / **Default**.
- [ ] Each section shows the correct `WorkoutCard`s with name, exercise count, estimated duration, target-muscle icons, equipment icons.
- [ ] Inspect network logs: three parallel `GET /workouts?type=...` calls fired (mine / assigned / default).
- [ ] Inspect SQLite: three rows in `cached_workouts` (one per type), each with a JSON-serialized payload + `synced_at` timestamp.

### Step 2 — Quota indicator (STORY-001 AC 1.9)

- [ ] `WorkoutLimitIndicator` renders above (or below — match legacy) the Mine section.
- [ ] Indicator shows `<used> / <limit>` (e.g. "12 / 50") matching A's subscription.
- [ ] Inspect the `mine` network response: `meta.quota = { used: 12, limit: 50 }`.
- [ ] Tap the upgrade CTA — routes to `/coming-soon?feature=subscription` (M10 placeholder).
- [ ] If A has no `subscriptions` row, indicator is hidden entirely (not "0 / 0").

### Step 3 — Search filter (STORY-001 AC 1.5)

- [ ] Type a substring of one workout name into the search bar.
- [ ] Cards filter live across all three sections (case-insensitive).
- [ ] Sections that have no matches collapse / hide.
- [ ] Clear search — full list returns instantly (no extra network call).

### Step 4 — Pull-to-refresh (STORY-001 AC 1.8)

- [ ] Pull down on the scroll view — `RefreshControl` spinner appears.
- [ ] Three `GET /workouts` calls fire in parallel regardless of cache age.
- [ ] `synced_at` advances on all three `cached_workouts` rows.
- [ ] `meta.quota` on the `mine` response updates the indicator (create a workout via DB to bump count, refresh, see the count tick up).

### Step 5 — Workout detail popover (STORY-007 ACs 7.1–7.4)

- [ ] Tap a `WorkoutCard` (one of A's own).
- [ ] `WorkoutPopover` modal opens; renders the full exercises list with `targetSets`, `targetRepsMin`–`targetRepsMax`, `restSeconds` per row.
- [ ] Supersets render visually grouped — connector lines, badge with group number, shared `targetSets` shown only on the lead row.
- [ ] Owner-only CTAs (Edit / Delete) are visible because A owns it.
- [ ] "Start Workout" CTA routes to `/coming-soon?feature=active-session` (M3 stub).
- [ ] Dismiss via swipe-down — popover closes; list still shows behind it.

### Step 6 — Create workout with nested exercises + superset (STORY-002 ACs 2.1–2.12, STORY-003 ACs 3.1–3.4)

- [ ] Tap `Create` in `QuickActions`.
- [ ] Modal stack opens at `/workouts/create`.
- [ ] Fill in name "Smoke Test Workout", description "from M2 smoke", duration 45.
- [ ] Tap "Add exercise" — `AddExercisePopover` bottom sheet opens.
- [ ] Search inside the picker; multi-select **3 exercises**.
- [ ] Tap "Add as superset" — all 3 land in the form sharing a single `supersetGroup` integer; visual grouping renders with connector lines + badge.
- [ ] Edit `targetSets` on the lead exercise — value propagates to the other two peers; their `targetSets` field is visually disabled (grey).
- [ ] Edit `restSeconds` on the lead — propagates similarly.
- [ ] Tap "Add exercise" again, multi-select 1 exercise, tap "Add as exercises" — it appears with `supersetGroup = null`.
- [ ] Submit. Inspect network: a **single** `POST /workouts` request fires with the full nested `exercises[]` array (4 entries, 3 sharing supersetGroup).
- [ ] Server returns `201 { data: ... }` with the saved workout including `id`s for each junction row.
- [ ] Modal dismisses; lands back on the Workouts tab; new card appears under Mine.
- [ ] `cached_workouts(user_id=A, type='mine')` payload now includes the new workout (optimistic write replaced with server response).

### Step 7 — Edit workout, full-replacement PATCH (STORY-004 ACs 4.1–4.8, STORY-003 AC 3.3)

- [ ] Tap Edit on the workout created in step 6.
- [ ] Modal opens at `/workouts/<id>/edit`; full-screen loader during initial fetch; form pre-populates.
- [ ] Ungroup the superset (lead row's overflow → "Ungroup superset"). All three peers now have `supersetGroup = null`.
- [ ] Remove one exercise; reorder is implicit by `sortOrder`.
- [ ] Submit. Inspect network: a **single** `PATCH /workouts/:id` with `exercises[]` (now 3 entries, no superset).
- [ ] Server returns `200 { data: ... }` with the new state.
- [ ] Open the popover again — exercises list matches the edit; supersets are gone.
- [ ] Inspect SQLite: `cached_workout_detail` and `cached_workouts(mine)` rows updated with the new payload.

### Step 8 — Delete workout (STORY-005 ACs 5.1–5.4)

- [ ] Tap Delete on the workout from step 6.
- [ ] Confirmation dialog shows the workout name.
- [ ] Confirm — `DELETE /workouts/:id` fires; returns 204.
- [ ] Card vanishes from the list; cached rows removed.
- [ ] Inspect DB: `workout_exercises` rows for that workoutId are gone (FK cascade); any `workout_sessions` rows referencing it now have `workout_id = NULL` (FK set null).

### Step 9 — Cold-start cache-first render (STORY-008 AC 8.4)

- [ ] Kill the app (fully terminate, not background).
- [ ] Relaunch.
- [ ] Workouts tab renders **instantly** from cache (no spinner, no blank placeholder).
- [ ] Background refresh fires ~100 ms after mount — three `GET /workouts` calls visible in network logs.
- [ ] If cache is ≥5 min old, refresh fires immediately.

### Step 10 — Offline path + sync queue (STORY-008 ACs 8.3, 8.4, 8.5)

- [ ] Toggle simulator airplane mode on (or kill the backend).
- [ ] Kill + relaunch the app.
- [ ] Workouts tab renders the cached payload with a "last synced" caption / timestamp.
- [ ] Tap Create, fill out a minimal workout, submit. The form returns immediately; new card appears under Mine **with a temp UUID**.
- [ ] Inspect SQLite: a new pending intent in the sync queue (`createWorkout` with the temp UUID).
- [ ] Toggle airplane mode off. The sync worker fires; `POST /workouts` succeeds; the temp UUID is replaced by the server-issued ID in `cached_workouts` and `cached_workout_detail`.
- [ ] Inspect network for any retries — none expected on a cold sync.
- [ ] Pull-to-refresh succeeds; stale indicator clears.

### Step 11 — Two-user data isolation (STORY-009 ACs 9.1–9.5)

- [ ] Sign out as A. Sign in as B.
- [ ] Workouts tab shows B's Mine list — A's private workouts are absent.
- [ ] Curl-test directly: `GET /workouts/:idOfAsPrivate` with B's JWT → 404.
- [ ] Curl-test: `PATCH /workouts/:idOfAsPrivate` with B's JWT → 404.
- [ ] Curl-test: `DELETE /workouts/:idOfAsPrivate` with B's JWT → 404.
- [ ] Make B and A friends in DB (`friendships` row with `status='accepted'`). Curl-test: `GET /workouts/:idOfAsFriendsVisible` with B's JWT → 200 with full payload.

## Pass criteria

All 11 steps tick-mark without manual intervention beyond the prescribed taps / reloads. Network requests, SQLite rows, and DB FK behaviour match expectations. No console warnings about envelope-unwrap mismatches or sync-queue intent collisions.

## Known-acceptable failures (not blockers)

- **Typed-routes warning** — adding `/workouts/create` and `/workouts/[id]/edit` may show TypeScript warnings until `.expo/types/router.d.ts` regenerates on the next `expo run:ios`.
- **Initial prebuild delay** — first `npx expo run:ios` after schema changes takes 2–5 minutes. Subsequent runs are fast.
- **Picker search stutter** — the M0 `ExerciseListContainer` does its own debounce; a tiny stutter at first keystroke is expected. M11 polish revisits.
- **Quota indicator brief flash** — on cold start, the indicator may render with stale quota for one frame before the refresh updates. Cosmetic only.
- **Coming-soon placeholder text** — feature-specific copy on the active-session and subscription stubs is throwaway; real screens land in M3 / M10.

## Rollback plan

If M2 smoke test fails repeatedly after good-faith debugging:

1. **Revert the frontend PR first.** Backend changes are additive (new fields on the existing endpoints); no other caller exists today besides mobile. Reverting the mobile PR returns the Workouts tab to `<ComingSoon />` without breaking other tabs.
2. **If the backend needs reverting**, `git revert` the commit range on `feat/m2-backend-workouts`. The reverted handlers continue to serve metadata-only requests; the mobile app would need its frontend revert paired (it expects the new fields).
3. **No data migration to roll back** — M2 has no SQL migrations.
