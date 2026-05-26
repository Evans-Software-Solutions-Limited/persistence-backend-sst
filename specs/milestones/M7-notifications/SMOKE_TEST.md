# M7 — Smoke Test

End-to-end verification walkthrough for Milestone 7 — Notifications. Run against `bun run dev` (SST backend local — or staging) + the mobile app on a real iOS device (push notifications do not fire reliably in iOS Simulator without extra setup; Android emulator works for Google Play services-equipped emulators). Both PRs must be merged (or a shared milestone branch must include both) before running.

This is the review gate cited in [`BRIEF.md`](./BRIEF.md) § Success criteria and [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md) § Smoke / [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md). Each numbered step maps to acceptance criteria in `specs/09-notifications-social/requirements.md` (added by the spec-update commits at the head of each impl PR).

## Pre-flight

1. **Backend on a target stage:**

   ```bash
   bun install
   bun run dev          # local — wait for the "Ready!" banner
   ```

   OR test directly against staging at `https://api.staging.persistence.evans-software-solutions.com`.

2. **Mobile dev client on a real device:**

   ```bash
   cd packages/mobile
   bun install
   bun run start
   ```

   - iOS: open in a real device (TestFlight build OR `eas build --profile development --platform ios`). Simulator works for the in-app list + preferences UI but NOT for delivery of pushes.
   - Android: emulator OR real device. Both deliver pushes via FCM.
   - Confirm `.env` has `EXPO_PUBLIC_API_URL` pointing at the target stage.

3. **Push credentials pre-conditions** (Brad confirms before kicking off — frontend agent does NOT create these):
   - `eas credentials --platform ios --profile staging` shows an APNs Auth Key under project `255d542d-8dae-43c9-8d98-d9a3a325a470`.
   - `eas credentials --platform android --profile staging` shows FCM credentials.
   - `supabase functions list --project-ref dfeyebgdktfteqlacmru` shows `send-push-notification` deployed.
   - `app.settings.service_role_key` exists in the Supabase DB:
     ```sql
     SELECT key FROM app.settings WHERE key = 'service_role_key';
     -- expect one row; DO NOT log or display the value
     ```

4. **Database state**: ensure the target Postgres has the M7 migration applied — `profiles.notification_preferences JSONB NOT NULL DEFAULT '{}'`:

   ```sql
   SELECT column_name, data_type FROM information_schema.columns
   WHERE table_name = 'profiles' AND column_name = 'notification_preferences';
   -- expect one row, data_type = 'jsonb'
   ```

5. **Test user**: a fresh user (no `user_devices` rows; `notification_preferences = '{}'`; no `notifications` rows). Reset between runs via:

   ```sql
   DELETE FROM user_devices WHERE user_id = '<test-user-id>';
   DELETE FROM notifications WHERE user_id = '<test-user-id>';
   UPDATE profiles SET notification_preferences = '{}' WHERE id = '<test-user-id>';
   ```

6. **API token** for `curl` assertions:
   ```bash
   export API_BASE=https://api.staging.persistence.evans-software-solutions.com
   export JWT=<paste from mobile dev tools — Profile → Developer → Show JWT>
   export USER_ID=<paste the JWT.sub>
   ```

## Walkthrough

### Step 1 — Fresh sign-in registers the device token

- [ ] Clear app data / fresh install
- [ ] Sign in with the test user
- [ ] Within ~3s of the home screen rendering, `useDeviceTokenRegistration` fires
- [ ] Network logs: exactly one `POST /devices/register` with body `{ deviceToken: "ExponentPushToken[...]", platform: "ios"|"android", deviceInfo: { deviceName, osVersion, appVersion, modelName } }`
- [ ] Response 200: `{ data: { id: "<uuid>", registered: true } }`
- [ ] AsyncStorage flag set: `device_token_registered_<USER_ID> = "true"`
- [ ] Backend verification:
  ```bash
  curl -s "$API_BASE/notifications" -H "Authorization: Bearer $JWT" | jq '.unreadCount'
  # expect: 0
  ```
  ```sql
  SELECT id, platform, device_info, is_active FROM user_devices WHERE user_id = '<USER_ID>';
  -- expect: one row, is_active = true, device_info populated
  ```

**Validates**: STORY-001 (device registration) ACs.

### Step 2 — Sign-in idempotency (no duplicate registration)

- [ ] Force-quit + reopen the app while still signed in
- [ ] Sign out → sign in as the SAME user
- [ ] Within ~3s of home rendering, observe **zero** `POST /devices/register` calls (flag still set)
- [ ] Now sign out and clear `device_token_registered_<USER_ID>` (Profile → Developer → Reset device-registration flag, or `AsyncStorage.removeItem('device_token_registered_<USER_ID>')`)
- [ ] Sign in again → one `POST /devices/register` fires → backend returns the SAME `id` as Step 1 (UPSERT)
- [ ] SQL: `SELECT COUNT(*) FROM user_devices WHERE user_id = '<USER_ID>'` returns 1 (no duplicate row)

**Validates**: STORY-001 (idempotent registration via UPSERT) AC.

### Step 3 — Trigger a notification + receive a push

- [ ] Insert a test notification row directly:
  ```sql
  INSERT INTO notifications (user_id, type, title, message, data)
  VALUES (
    '<USER_ID>',
    'workout_assigned',
    'Push Day awaits',
    'Your trainer assigned a workout.',
    '{"deepLink": "/(app)/(tabs)/workouts"}'::jsonb
  );
  ```
- [ ] Within ~3s, the device receives a push banner with title "Push Day awaits", body "Your trainer assigned a workout."
- [ ] If app is in foreground: banner shows (the `setNotificationHandler` returns `shouldShowBanner: true`)
- [ ] If app is backgrounded: OS-level banner
- [ ] If app is force-quit: OS-level banner with sound (iOS) / vibration (Android)

**Verify the chain**:

- [ ] Postgres logs (or `select * from pg_net.http_requests` if accessible) show the `pg_net.http_post` call to the Edge Function
- [ ] Supabase Edge Function logs (`supabase functions logs send-push-notification --project-ref dfeyebgdktfteqlacmru`) show one invocation with the test payload
- [ ] No errors from Expo Push API in the Edge Function logs

**Validates**: STORY-001 (push delivery end-to-end) AC. NOT M7's own code — this is the regression check that the legacy push pipe still works against V2 device tokens.

### Step 4 — Tap the notification → deep-link routing (warm-start)

- [ ] App in foreground or background (NOT force-quit)
- [ ] Tap the banner from Step 3
- [ ] App opens / foregrounds → `useNotificationTapHandler` reads `response.notification.request.content.data.deepLink`
- [ ] `isValidDeepLink("/(app)/(tabs)/workouts")` → true → `router.push("/(app)/(tabs)/workouts")`
- [ ] Workouts tab visible. No error toasts, no nav bounces.

**Validates**: STORY-001 (deep-link tap warm-start) AC.

### Step 5 — Tap the notification → deep-link routing (cold-start)

- [ ] Repeat Step 3 to create another notification (use a different deep-link like `/(app)/(tabs)/profile`)
- [ ] Force-quit the app entirely (swipe up from app switcher / `adb shell am force-stop com.bradleyevans96.persistence`)
- [ ] Wait for the push banner to arrive on the lock screen
- [ ] Tap the banner from the locked / cold-started state
- [ ] App cold-launches → `useNotificationTapHandler` calls `Notifications.getLastNotificationResponseAsync` on mount → reads `data.deepLink` → `router.push("/(app)/(tabs)/profile")`
- [ ] Profile screen visible after the auth flow settles (auth gate may bounce through sign-in briefly if the session expired; otherwise direct)

**Validates**: STORY-001 (deep-link tap cold-start) AC.

### Step 6 — Bell-icon badge shows unread count

- [ ] Insert 3 more notifications via SQL (use different types):
  ```sql
  INSERT INTO notifications (user_id, type, title, message, data) VALUES
    ('<USER_ID>', 'workout_reminder', 'Time to lift', 'Bench Day starts in 1h', '{"deepLink": "/(app)/(tabs)/workouts"}'::jsonb),
    ('<USER_ID>', 'goal_milestone', 'New PR!', 'You hit a personal record on Bench.', '{"deepLink": "/(app)/(tabs)/progress"}'::jsonb),
    ('<USER_ID>', 'trainer_feedback', 'Note from your PT', 'Great form on the squat today.', '{}'::jsonb);
  ```
- [ ] Within ~10s (pull-to-refresh on home if needed), the bell-icon in the tabs header shows badge count "4" (the 3 from this step + the unread one from Step 5 that may or may not have been auto-read on tap — adjust expected count based on Step 5's behaviour)
- [ ] Network logs: `GET /notifications` returns `unreadCount: 4` (or 3 if Step 5 marked-read on tap)

**Validates**: STORY-005 (unread badge count) AC.

### Step 7 — Open notifications list

- [ ] Tap the bell icon → `router.push("/(app)/notifications")`
- [ ] Notification list screen renders with the 4 (or 3) unread + however many read entries
- [ ] List ordered by `createdAt DESC` (newest first)
- [ ] Each unread row has the 3pt `$primary` left accent stripe + bold title
- [ ] Each row shows the type icon (dumbbell for workout_assigned, clock for workout_reminder, flag/trophy for goal_milestone, message for trainer_feedback)
- [ ] Relative timestamps render ("just now", "5m", "1h", etc.)
- [ ] Header shows "Mark all read" CTA (visible because `unreadCount > 0`)

**Validates**: STORY-005 (list rendering, ordering, icons, timestamp, accent) ACs.

### Step 8 — Mark single notification read

- [ ] Tap one notification row (say, the "Time to lift" workout reminder)
- [ ] Optimistic UI: row immediately re-renders as read (accent gone, title not bold)
- [ ] Network: `PATCH /notifications/<id>` body `{ "isRead": true }` → 200 with updated `AppNotification`
- [ ] Deep-link applied: `router.push("/(app)/(tabs)/workouts")` lands on the workouts tab
- [ ] Open Notifications list again — that row stays read, badge count decremented by 1
- [ ] SQL: `SELECT is_read, read_at FROM notifications WHERE id = '<that-id>'` → `is_read = true`, `read_at` populated

**Validates**: STORY-005 (mark-read single + deep-link from tap) ACs.

### Step 9 — Mark all read

- [ ] On the Notifications list, tap "Mark all read"
- [ ] Optimistic UI: all rows re-render as read in one frame
- [ ] Network: `PATCH /notifications/all` body `{}` → 200 with `{ data: { updated: <count> } }` (count = the previously-unread rows)
- [ ] Bell-icon badge clears to "0" / hidden
- [ ] Header "Mark all read" CTA hides (no unread remaining)
- [ ] SQL: `SELECT COUNT(*) FROM notifications WHERE user_id = '<USER_ID>' AND is_read = false` returns 0

**Validates**: STORY-005 (mark-all-read) AC.

### Step 10 — Toggle a preference

- [ ] Profile tab → tap "Notification preferences" → `router.push("/(app)/notification-preferences")`
- [ ] Preferences screen renders with toggle rows grouped by category (Workouts, Trainers, Goals)
- [ ] All toggles default to "on" (the user has empty `notification_preferences` → defaults apply)
- [ ] Toggle "Workout reminders" off
- [ ] Within ~500ms (debounced), network: `POST /notifications/preferences` body containing the full map with `workout_reminder: false`
- [ ] Response 200 echoes the stored map
- [ ] Small "Saved" indicator appears briefly
- [ ] Force-quit + reopen → toggle still off
- [ ] SQL: `SELECT notification_preferences FROM profiles WHERE id = '<USER_ID>'` → JSONB shows `workout_reminder: false` (plus any other explicit values you set)

**Validates**: STORY-001 (preferences persistence) AC.

### Step 11 — Open notifications list offline

- [ ] Airplane mode ON
- [ ] Navigate to the notifications list
- [ ] Cached list renders from SQLite immediately
- [ ] "You're offline" banner visible at the top (M10.5 component)
- [ ] No spinner / loading state stalls
- [ ] Existing read/unread state matches what was last synced

**Validates**: STORY-005 (offline cached read) AC.

### Step 12 — Mark-read while offline → sync on reconnect

- [ ] Still airplane-mode ON
- [ ] Tap an unread notification → optimistic UI marks read → row updates
- [ ] Deep-link still fires (router.push works offline)
- [ ] Network: no `PATCH /notifications/:id` (offline); mutation is enqueued in `sync_queue`
- [ ] SQL on mobile (Profile → Developer → Inspect SQLite, or via `expo-sqlite` dev console): `SELECT * FROM sync_queue WHERE entity_type LIKE '%notification%'` → one pending intent
- [ ] Airplane mode OFF
- [ ] Within ~5s, `useSyncWorker` drains the queue; `PATCH /notifications/<id>` fires → 200
- [ ] SQL on backend: `SELECT is_read FROM notifications WHERE id = '<that-id>'` → `true`
- [ ] `sync_queue` row removed

**Validates**: STORY-005 (offline mark-read replay) AC + M3 sync-queue regression.

### Step 13 — Wrong-user / ownership defence

- [ ] Sign in as a different user (User B) on a second device or after sign-out
- [ ] Get User B's JWT (`$JWT_B`)
- [ ] Try to mark-read User A's notification:
  ```bash
  curl -i -X PATCH "$API_BASE/notifications/<USER_A_NOTIFICATION_ID>" \
    -H "Authorization: Bearer $JWT_B" \
    -H "Content-Type: application/json" \
    -d '{"isRead": true}'
  # expect: 404
  ```
- [ ] List endpoint scoped to User B:
  ```bash
  curl -s "$API_BASE/notifications" -H "Authorization: Bearer $JWT_B" | jq '.data | length'
  # expect: 0 (or User B's own count, NOT including User A's)
  ```
- [ ] Mark-all for User B:
  ```bash
  curl -i -X PATCH "$API_BASE/notifications/all" \
    -H "Authorization: Bearer $JWT_B" \
    -d '{}'
  # expect: 200 with { data: { updated: 0 } } — does NOT touch User A's notifications
  ```
- [ ] Verify User A's notifications unchanged:
  ```sql
  SELECT COUNT(*) FROM notifications WHERE user_id = '<USER_A_ID>' AND is_read = false;
  -- expect: same as before User B's mark-all-read attempt
  ```

**Validates**: STORY-005 (ownership defence) AC + M2 learning #14 (TOCTOU fix on mark-read).

### Step 14 — Invalid deep-link is rejected (security)

- [ ] Insert a notification with a malicious-looking deep-link:
  ```sql
  INSERT INTO notifications (user_id, type, title, message, data) VALUES
    ('<USER_ID>', 'system', 'Bad deep-link test', 'Should not navigate.', '{"deepLink": "https://evil.example.com/phishing"}'::jsonb);
  ```
- [ ] Wait for the push, tap it
- [ ] App opens but does NOT navigate to the external URL
- [ ] No error toast — silent rejection. App lands on the default route (home or the screen the user was last on)
- [ ] Same test from the notifications list: tap the row → marks read, but does NOT navigate
- [ ] Same with a relative non-app path: `'data.deepLink' = "/random/path"` → does NOT navigate

**Validates**: STORY-001 (deep-link safety) AC + brief's `isValidDeepLink` guard.

### Step 15 — Pagination / large list

- [ ] Insert 150 notifications via SQL:
  ```sql
  INSERT INTO notifications (user_id, type, title, message, data)
  SELECT '<USER_ID>', 'system', 'Test ' || i, 'Body ' || i, '{}'::jsonb
  FROM generate_series(1, 150) i;
  ```
- [ ] Open notifications list
- [ ] First page renders ~50 items (server-side cap, may be 100 if legacy pagination differs)
- [ ] Scroll to bottom → either (a) infinite scroll fires `GET /notifications?offset=50` and appends, OR (b) list caps at the first page (matches legacy)
- [ ] No error states; smooth 60fps scroll (no `FlatList` jank)

**Validates**: STORY-005 (pagination matches legacy) AC.

## F — Quality-gate-driven checks

Run all of these on both branches and capture the output in the PR body:

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit
```

- Coverage ≥ 90% aggregate on `microservices/core` and `packages/mobile`.
- New files: confirm coverage isn't artificially inflated by re-export-only files (M2 learning #13c).
- Test runs include the wrong-user-404 path on `markNotificationRead` and the path-collision regression for `PATCH /notifications/all`.

## Pass criteria

Steps 1–15 tick-mark without manual intervention beyond the prescribed inserts + taps. Backend and Edge Function logs confirm the push chain fires end-to-end. SQL state matches expectations after every mutation step.

## Known-acceptable failures (not blockers)

- iOS Simulator does NOT deliver pushes reliably — Step 3 + 4 + 5 require a real iOS device or a Push-enabled simulator setup. If the smoke pass is on a simulator, mark Steps 3-5 as "deferred to real-device pass" and proceed; Brad does the device pass before sign-off.
- First-launch Apple Pay sandbox slowness is unrelated to M7 but may appear during the smoke pass if the user's first run after fresh install triggers any unrelated subscription flow.
- Expo Push delivery latency: typical 1-3s; bursts may delay to ~10s under load. Smoke test allows ~10s before flagging delivery as failed.
- Cold-start tap: on some Android OEM ROMs (e.g. Xiaomi), aggressive task-killing may prevent `getLastNotificationResponseAsync` from receiving the original tap response. Test on a stock Android image where possible.

## Rollback plan

If M7 smoke test fails repeatedly after good-faith debugging:

1. **Revert the frontend PR first** — backend endpoints are additive (new handlers + one new JSONB column). Backend continues to serve other features correctly. Mobile pre-M7 has no notification surface; reverting puts users back to "no bell, no inbox" — degraded but safe.
2. If the backend handlers themselves are broken, revert the backend PR. The Supabase push trigger continues to function for legacy-RPC-driven inserts (none today; M8 hasn't shipped yet). The new `profiles.notification_preferences` column is harmless on revert (column stays, no readers).
3. **Do NOT revert the schema migration** — leave the JSONB column in place. Rollbacks happen via forward migrations per [`supabase/README.md`](../../../supabase/README.md).

## Manual cleanup between runs

```sql
DELETE FROM user_devices WHERE user_id = '<test-user-id>';
DELETE FROM notifications WHERE user_id = '<test-user-id>';
UPDATE profiles SET notification_preferences = '{}' WHERE id = '<test-user-id>';
```

On mobile: `AsyncStorage.clear()` OR Profile → Developer → Reset local cache (if exposed in dev builds).

## Sign-off

A milestone is "shipped" when:

- Both PRs merged to `main`.
- All 15 steps + the F quality-gate block pass on at least one real device (iOS) + one Android device or emulator.
- Loom or screenshot reel covering Steps 1, 3, 4, 5, 6-9, 10, 11-12 attached to the frontend PR body.
- `specs/09-notifications-social/tasks.md` Phases 5 + 6 checkboxes ticked.
- ROADMAP `M7 Notifications` row updated to `shipped (yyyy-mm-dd)` with PR links.
