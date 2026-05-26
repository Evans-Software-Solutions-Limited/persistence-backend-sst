# M4 — Smoke Test

End-to-end verification walkthrough for Milestone 4 — Progress. Run against `bun run dev` (SST backend local — or staging post-merge) + the mobile app on an iOS or Android simulator. Both PRs must be merged (or a shared milestone branch must include both) before running.

## Setup (one-time per environment)

1. `git checkout feat/m4-integration` (or the shared milestone branch if running pre-merge integration).

2. **Backend** (against local dev OR staging):

   ```
   bun install
   bun run dev   # local — wait for the "Ready!" banner
   ```

   OR test directly against staging at `https://api.staging.persistence.evans-software-solutions.com`.

3. **Database**: target Postgres (Supabase) has the M0–M3 schema. M4 introduces no schema changes (gap 4 deferred). Seed at least the following for the test user:
   - 3+ completed `workout_sessions` (status = `completed`, `completed_at` within the last 30 days).
   - Each session has 1–3 `session_exercises` with 3+ `exercise_sets` per exercise. Sets must include a mix of rep counts: at least one `reps = 1`, one `reps = 5`, one `reps = 10`, and one `reps = 7` (off-ladder rep — must NOT produce a 1RM PR).
   - At least one set per exercise should have `is_personal_record = true` (server's M3 detection writes this on session-complete).
   - 2+ `body_measurements` rows (varying `measured_at` over the last 60 days for the trend chart).
   - 2+ `user_goals` rows: one with `is_active = true`, one with `is_active = false`.
   - At least one `personal_records` row per `record_type` ∈ `{ '1rm', '3rm', '5rm', '10rm', 'max_weight', 'max_volume' }` for the user's main exercise.

4. **Mobile**:

   ```
   cd packages/mobile
   bun install
   bun run start
   ```

5. Confirm `.env` has `EXPO_PUBLIC_API_URL` pointing at the local SST port or staging URL.

## Walkthrough

### Step 1 — Progress tab renders (no `<ComingSoon />`)

- [ ] Sign in. Bottom tab bar visible.
- [ ] Tap Progress tab. Within 500ms, content renders from cache (or skeleton if cold cache).
- [ ] No `<ComingSoon />` placeholder anywhere on the screen.
- [ ] Sections visible (top → bottom): "Personal Records" (carousel), "Stats", "Measurements" (with chart + add CTA), "Goals", "Recent Activity".
- [ ] Each section enters with a staggered fade (same animation as M1 Home).

**Validates**: STORY-005 AC 5.12 parity (entry animation), STORY-002 + 001 + 003 + 004 layout.

### Step 2 — PR carousel renders with exact-rep-match records ONLY

- [ ] PR carousel shows up to 5 cards horizontally scrollable.
- [ ] Each card shows: exercise name, record-type badge (`1RM` / `3RM` / `5RM` / `10RM` / `Max Weight` / `Max Volume`), value (e.g. "82.50 kg"), achieved-at relative time (e.g. "3 days ago").
- [ ] **CRITICAL**: No card labelled "Estimated 1RM" or showing a value that wasn't directly lifted. E.g. the user's 55kg × 7-rep set (seeded in setup) must NOT produce a "1RM: 73.3 kg" card.
- [ ] Network logs: exactly one `GET /personal-records` (authed) fires on tab mount.

**Validates**: STORY-002 (PR display rule — Brad's exact-rep-match constraint).

### Step 3 — Stats row + last-30-days activity tile

- [ ] Stats row shows 4 tiles: workouts this week, workouts this month, current streak, PR count.
- [ ] Tile values match the dashboard cache (cross-check with Home tab — they should agree because Progress reads the dashboard cache slot for these values).
- [ ] "Recent Activity" section at the bottom lists the last 7 days of completed sessions, most recent first.

**Validates**: STORY-005 AC 5.3, STORY-007 AC 7.2 parity reused from M1.

### Step 4 — Add a body-fat measurement

- [ ] Tap "Add Measurement" CTA in the Measurements section header.
- [ ] Modal opens (`presentation: "modal"`, custom in-screen header).
- [ ] Form has fields: weight, body fat %, chest, waist, hips, left arm, right arm, left thigh, right thigh, notes.
- [ ] Enter body fat = `17.8`. Leave all other fields blank.
- [ ] Tap Save. Button disables briefly; toast "Measurement logged" appears; modal dismisses.
- [ ] Measurements list refreshes (no full-screen spinner; cache write-through) showing the new entry at the top dated today.
- [ ] Trend chart's body-fat line gains a new data point at today's x-coordinate (toggle the chart's metric to "Body fat %" if it defaults to weight).

**Validates**: STORY-001 AC 1.1–1.5, STORY-006 AC (cache write-through).

### Step 5 — Verify backend state

- [ ] Postgres: `SELECT * FROM body_measurements WHERE user_id = '<your-user-id>' ORDER BY measured_at DESC LIMIT 1` returns a row with `body_fat_percentage = '17.80'` (decimal-string-stored).
- [ ] Network logs (DevTools or `react-native-debugger`): exactly one `POST /measurements` with body `{ "bodyFatPercentage": 17.8 }`. Status 201.

**Validates**: backend chain end-to-end.

### Step 6 — Edit a measurement

- [ ] Scroll the measurement list, tap the measurement just logged.
- [ ] Edit modal opens, pre-filled with `bodyFatPercentage = 17.8`.
- [ ] Change to `18.2`. Tap Save.
- [ ] Network: `PATCH /measurements/:id` with body `{ "bodyFatPercentage": 18.2 }`. Status 200.
- [ ] Modal dismisses; list updates with the new value; chart redraws with the updated point.

**Validates**: STORY-001 AC 1.6 (newly added by this milestone's backend spec-update commit).

### Step 7 — Delete a measurement

- [ ] In the Edit modal of any measurement, tap "Delete" → confirmation modal → confirm.
- [ ] Network: `DELETE /measurements/:id`. Status 204.
- [ ] Modal dismisses; list updates without the deleted entry; chart redraws.

**Validates**: STORY-001 AC 1.7 (newly added by this milestone's backend spec-update commit).

### Step 8 — Wrong-user PATCH / DELETE (manual backend check)

- [ ] Note a measurement id you own.
- [ ] Sign out, sign in as a different user.
- [ ] Via curl with the second user's JWT: `PATCH /measurements/<the-id>` with `{ "bodyFatPercentage": 50 }` → returns 404.
- [ ] Same with DELETE → 404.

**Validates**: TOCTOU regression (M2 learning #14), backend ownership.

### Step 9 — Time-range toggle on the trend chart

- [ ] Default time range on the chart is `1m`. Note the x-axis coverage (last 30 days).
- [ ] Tap `1w` pill → chart redraws covering last 7 days. No stuck spinner.
- [ ] Tap `3m`, then `6m`, then `1y`, then `all`. Each redraws smoothly. The `all` range coverage starts from epoch (1970) or the user's earliest measurement, whichever is later.
- [ ] Cache check: tap `1m` then immediately `3m`; the screen should NOT do a network call for `1m`'s data (it's the active cache slot), but tapping `3m` triggers a background refresh because that cache slot is cold.

**Validates**: STORY-004 AC 4.5, STORY-006 AC (5-min TTL per-range cache slot).

### Step 10 — Records list filter

- [ ] From the PR carousel, tap "See all PRs" (or scroll the carousel's footer button).
- [ ] Records list opens. Grouped by exercise.
- [ ] Filter dropdown defaults to `all`. Switch to `1rm` → only `1rm` records show.
- [ ] Switch to `max_volume` → only `max_volume` records show.
- [ ] Switch back to `all`. Confirm no `Estimated 1RM` rows EVER (the foot-gun rule).

**Validates**: STORY-002 AC (PR list grouped by exercise), Brad's exact-rep-match rule.

### Step 11 — Goal list filter + mark complete

- [ ] From Progress, tap "Goals" section header / "See all" link.
- [ ] Goal list opens. Filter tabs: `Active` / `Completed` / `All`. Default `Active`.
- [ ] Confirm the seeded active goal is in the Active tab; the seeded inactive goal is in Completed.
- [ ] Tap the active goal's overflow → "Mark complete" → confirmation alert → confirm.
- [ ] Network: `PATCH /goals/:id` with body `{ "isActive": false }`. Status 200.
- [ ] Goal moves to Completed tab.
- [ ] Tap the now-completed goal's overflow → "Reactivate" → confirm.
- [ ] Network: `PATCH /goals/:id` with body `{ "isActive": true }`. Status 200.
- [ ] Goal moves back to Active tab.

**Validates**: STORY-003 AC ("Mark goal as completed"), spec gap-3 Option B (no 'abandoned' state in M4).

### Step 12 — Offline path: add then flush

- [ ] Enable airplane mode in the simulator.
- [ ] Open Progress tab. Cached data renders instantly (≤ 200ms).
- [ ] Tap Add Measurement → log weight = `78.5` → Save. Modal dismisses; measurement appears in the list (optimistic + write-through cache).
- [ ] Open sync-queue inspector (DevTools or `__sync_queue__` SQLite table) — one pending `createMeasurement` intent visible.
- [ ] Disable airplane mode. Watch the sync worker drain (within 5s).
- [ ] Sync queue entry transitions: `pending` → `in_flight` → `completed`.
- [ ] Network: `POST /measurements` with the offline-logged data fires once. Status 201.
- [ ] Local id is swapped from `local-<uuid>` to the server's UUID in the cached_measurements row.

**Validates**: STORY-006 AC (offline create + sync), offline-first contract.

### Step 13 — Offline path: pull-to-refresh

- [ ] With network on, on the Progress tab, pull down to refresh.
- [ ] Pull-to-refresh spinner appears. Network fires 4 parallel requests: `GET /progress/stats`, `GET /progress/history`, `GET /personal-records`, `GET /measurements`. Plus `GET /dashboard` (re-used cache slot).
- [ ] Spinner dismisses; chart + lists rerender.
- [ ] Cache slot's `synced_at` updates to now (verify via SQLite if needed).

**Validates**: STORY-005 AC 5.10 parity (pull-to-refresh bypasses TTL).

### Step 14 — Backgrounding + relaunch

- [ ] On the Progress tab, background the app (Cmd+H or device home button).
- [ ] Wait 30 seconds.
- [ ] Foreground the app. Progress tab still active.
- [ ] Cached data renders instantly (no skeleton). After ~500ms, background refresh fires (because >5min TTL OR on focus depending on policy) and any new data trickles in.

**Validates**: STORY-005 AC 5.9 parity (cache-first on cold start), STORY-006 AC (offline render on launch).

### Step 15 — Cross-screen consistency

- [ ] Complete a session via the active-session flow (M3 surface) that produces a new PR (e.g. a heavier set than the user's previous max_weight).
- [ ] Open Progress tab. PR carousel now includes the new PR (cache invalidated on session-complete via the existing `invalidateDashboard` + new `invalidateProgress` calls).
- [ ] Open Home tab. PR-of-the-week card shows the same new PR (dashboard cache also invalidated).
- [ ] Open Progress > "See all PRs". The new PR is in the list, grouped under its exercise.

**Validates**: cross-cache invalidation (M2 learning #3), STORY-002 freshness.

### Step 16 — Per-exercise strength chart (drill-in from a PR card)

- [ ] Tap a PR card in the carousel.
- [ ] Either: (a) push to `/(app)/exercises/<id>` exercise detail with a "Strength trend" section, or (b) push to a Progress strength sub-screen — depending on the legacy reference and the implementation agent's call documented in PR description.
- [ ] Network: `GET /progress/strength?exerciseId=<id>&from=...&to=...`. Status 200.
- [ ] Chart renders a line of `oneRepMax` (Epley) values over time. **This is the ONLY place an Epley value is rendered.** The trend-line chart legend should label the y-axis as "Estimated 1RM (kg)" or similar so the user understands this is a trend estimate, not a claim of a lifted weight.
- [ ] Compare visually against the PR carousel cards for the same exercise — they may diverge (PR cards = canonical exact-rep maxes; chart = Epley trend). The discrepancy is correct and intentional.

**Validates**: STORY-004 AC 4.2, the Epley-OK-for-chart-trend exception documented in [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md) § 3 + [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) § Hazards.

## Pass criteria

All 16 steps tick-mark without manual intervention beyond the prescribed taps. Backend logs match the documented network calls. Postgres rows match expectations. The PR display rule (steps 2, 10, 16) is upheld without exception — Epley appears ONLY on the strength trend chart, never on the PR carousel or Records list.

## Known-acceptable failures (not blockers)

- iOS Simulator may slow-render the SVG chart on first paint (~200–400ms). Subsequent re-renders are <50ms. Acceptable.
- Pull-to-refresh on Android shows the Material spinner; iOS shows the iOS-style refresh control. Visual difference is platform-native, not a bug.
- Network races: if a user mutates a measurement DURING a background refresh, the optimistic write may flicker briefly when the refreshed list lands (race between cache write + refresh write). Acceptable if it self-resolves within one frame. Persistent flicker is a bug.
- TypeScript route warnings from Expo Router on first launch after the new routes land — restart `expo start` to regenerate `.expo/types/router.d.ts`.

## Rollback plan

If M4 smoke test fails repeatedly after good-faith debugging:

1. **Revert the frontend PR first** — backend extensions are additive (new endpoints + optional body fields + new query params). Backend continues to serve M0–M3 callers correctly.
2. If the backend extensions themselves are broken, revert the backend PR — the existing M3 `GET /personal-records`, M1 `GET /dashboard`, and pre-M0 `/progress/*` + `/measurements` + `/goals` surfaces stay functional.
3. The mobile app pre-M4 has `<ComingSoon />` on Progress — so a frontend revert puts the user back to that placeholder. Not a user-experience regression beyond the milestone scope.

## Manual cleanup between runs

If you're running multiple smoke-test passes against the same user:

```sql
-- In Postgres (target stage):
DELETE FROM body_measurements WHERE user_id = '<your-test-user-id>' AND created_at > '<run-start-ts>';

-- If you marked goals complete during the test and want to reset:
UPDATE user_goals SET is_active = true WHERE user_id = '<your-test-user-id>';
```

Mobile-side: open the dev menu → "Clear app data" wipes SQLite + AsyncStorage. Reseed via sign-in.
