# M7 — Notifications

## Why this milestone

The mobile foundation already supports **local notifications** (the M3 rest-timer "Rest complete" ping fires via `ExpoNotificationsAdapter`, permissions are prompted on app launch via `useNotificationPermissions`, and the Android default channel is registered). What's missing is the **server-driven push surface** and the **in-app notification centre**:

1. **No backend handlers** — `microservices/core/src/application/` has zero notification-related files. The legacy app's notifications were served by Supabase RLS-protected reads against the `notifications` table; in V2 those reads must become explicit SST endpoints.
2. **No mobile API surface** — `packages/mobile/src/domain/ports/api.port.ts` has zero `Notification` / `UserDevice` / `markRead` declarations.
3. **No notification list UI** — the bell-icon header + list screen + preferences screen don't exist in V2. Legacy `persistence-mobile` has all of them, ported 1:1 by this milestone.
4. **No device-token registration on sign-in** — `getDevicePushToken()` on `ExpoNotificationsAdapter` deliberately returns "Push tokens are not implemented in M3 — see milestone 09." (see [`packages/mobile/src/adapters/notifications/expo-notifications.adapter.ts:24-28`](../../../packages/mobile/src/adapters/notifications/expo-notifications.adapter.ts)). M7 closes that.
5. **No deep-link tap handling** — `Notifications.setNotificationHandler` exists for foreground display ([`app/_layout.tsx:29-36`](../../../packages/mobile/app/_layout.tsx)), but no `addNotificationResponseReceivedListener` wires taps to `router.push`.

The legacy Supabase project also carries a **Postgres trigger that calls a `send-push-notification` Edge Function** when a row is inserted into the `notifications` table (see [`supabase/migrations/010_trigger_push_notifications.sql`](../../../supabase/migrations/010_trigger_push_notifications.sql) + [`011_app_settings_for_push_notifications.sql`](../../../supabase/migrations/011_app_settings_for_push_notifications.sql)). The trigger reads `user_devices` for active device tokens, then POSTs to the Edge Function which fans out to Expo Push API. **This delivery path is owned by the legacy Supabase project, NOT this repo.** Authoring agents must NOT try to re-implement push fanout in SST — Brad's call: keep the existing Supabase trigger → Edge Function pipe as the canonical push sender. SST just owns reads + writes against the `notifications` and `user_devices` tables; the trigger fires when SST inserts a notification row (or the legacy backend does, for trainer-driven inserts).

## Parent spec

[`../../09-notifications-social/`](../../09-notifications-social/) — requirements (STORY-001 + STORY-002 + STORY-005 in scope; STORY-003 + STORY-004 deferred), design (notifications portion), tasks (Phases 2, 3, 5 partial, 6).

**Social half deferred.** Parent spec is `09-notifications-social` because the original Kiro split paired them. M7 ships **only** the notifications half. STORY-003 (friend requests), STORY-004 (shared-workouts feed), and the friendships portion of STORY-005 (friend-request items in the centre) are explicitly out of scope. Phases 7 + 8 of `tasks.md` stay untouched.

## Scope summary

### Backend (one PR)

- **`POST /devices/register`** — authed, body `{ deviceToken, platform, deviceInfo? }`. Upserts on `(userId, deviceToken)` per the existing schema's unique index (see [`packages/db/src/schema.ts:865`](../../../packages/db/src/schema.ts)). Mirrors the legacy `register_device_token` SQL function (see [`supabase/migrations/007_trainer_invitations_and_push_notifications.sql:521-580`](../../../supabase/migrations/007_trainer_invitations_and_push_notifications.sql)) but as an explicit SST handler with JWT-scoped `userId`.
- **`GET /notifications`** — authed list. Returns the user's notifications ordered by `created_at DESC`. Supports `?limit` + `?offset` + `?unreadOnly=true` query params.
- **`PATCH /notifications/:id`** — authed, body `{ isRead: true }`. Single-notification mark-read. Ownership folded into the mutation WHERE (M2 learning #14).
- **`PATCH /notifications/all`** — authed mark-all-read for the current user. Body `{}` (no params). Returns `{ data: { updated: <count> } }`.
- **`GET /notifications/preferences`** — authed. Returns the user's preference map.
- **`POST /notifications/preferences`** — authed. Body is the preference map; upserts.

The existing `notifications` + `user_devices` tables are reused as-is. The `notification_preferences` storage requires either a new table (additive migration) OR a JSONB column on `profiles.notification_preferences`. **Spec gap — see § Parent-spec gaps below; backend agent decides on the spec-update commit.**

### Frontend (one PR)

- **`NotificationsContainer` + `NotificationListPresenter`** — list screen at `app/(app)/notifications.tsx`, pull-to-refresh, infinite scroll, mark-read on tap with deep-link routing, "Mark all read" header CTA, unread badge.
- **`NotificationPreferencesContainer` + `NotificationPreferencesPresenter`** — toggle switches per `NotificationType`, persisted via `POST /notifications/preferences`. Reachable from Profile.
- **`useDeviceTokenRegistration` hook** — fires on first authed render after sign-in. Reads `notifications.getDevicePushToken()`, POSTs to `/devices/register`, idempotent via local `device_token_registered` flag.
- **Deep-link tap handler** — `Notifications.addNotificationResponseReceivedListener` mounted at the app root reads `notification.request.content.data.deepLink` and calls `router.push(deepLink)`. Cold-start vs warm-start both covered (Expo's `getLastNotificationResponseAsync` for cold-start).
- **SQLite cache** — `cached_notifications` table mirrors the M3 offline-first pattern. Opening the notifications list while offline shows the cached list with a "You're offline" banner (reuses M10.5 `useOnlineStatus`).
- **Preferences are online-only.** Small payload, low frequency; no SQLite mirror.
- **Bell-icon header badge** — visible from the home/tabs header, count = unread notifications. Tappable → notifications list.
- **`ExpoNotificationsAdapter.getDevicePushToken`** — replace the stub error with the real `Notifications.getDevicePushTokenAsync()` call. **The Expo project ID is already wired** (`app.json:103`: `255d542d-8dae-43c9-8d98-d9a3a325a470`); Expo's APNs + FCM credentials live in the Expo / EAS-managed credentials store under that project ID. Do NOT add APNs `.p8` files or FCM `google-services.json` to the repo. See § Push-credentials migration plan below.

## Success criteria (review gate)

Done when **all** of these pass against `bun run dev` + staging:

1. Fresh install + sign-in → `useDeviceTokenRegistration` fires once → `POST /devices/register` 201 → `user_devices` row exists for the user. Sign out → sign in again → no duplicate row (UPSERT keyed on `(user_id, device_token)`).
2. Trigger a notification creation (insert a `notifications` row via SQL against the test user) → within ~3s the legacy Supabase `notification_push_trigger` fires → `send-push-notification` Edge Function reaches Expo Push API → device receives the banner. (Edge Function + trigger NOT changed by M7 — this is the regression check.)
3. Tap the notification banner → app cold-launches (or returns to foreground) → reads `data.deepLink` (e.g. `/(app)/(tabs)/profile`) → `router.push` lands correctly.
4. Bell icon in the tabs header shows unread badge count (1). Tap → notifications list. Notification row visible, marked unread (left accent + bold text).
5. Tap the row → `PATCH /notifications/:id { isRead: true }` → row re-renders as read → deep-link routing applied (matches step 3's data shape).
6. Send 5 more notifications. List shows them ordered DESC. Tap "Mark all read" → `PATCH /notifications/all` → all rows render as read → badge count clears.
7. Open Profile → Notification Preferences → toggle `workout_reminder` off → `POST /notifications/preferences` → re-open → switch persists.
8. Airplane mode → open notifications list → cached list still renders with "You're offline" banner.
9. Mark-read while offline → mutation enqueued in `sync_queue` → flushes on reconnect → server reflects the read state.
10. Per-PR quality gates (prettier / typecheck / lint / build / test, ≥90% coverage on changed files).

## Agent briefs

Two parallel agent tracks. Each reads its own brief plus the parent spec and the referenced legacy/code files.

- **Backend:** [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md)
- **Frontend:** [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md)
- **Smoke test:** [`SMOKE_TEST.md`](./SMOKE_TEST.md)

Each PR lives on its own branch off fresh `main`:

- Backend: `feat/m7-backend-notifications`
- Frontend: `feat/m7-mobile-notifications`

The frontend depends on the backend endpoints existing. Either:

1. **Backend merges first** (preferred). Frontend rebases onto main, points `InMemoryApiAdapter` mocks at the real wire format already in tests, ships.
2. **Frontend develops against `InMemoryApiAdapter` fixtures** matching the agreed wire shape (see § Cross-cutting below) while backend is in review. Smoke test gates on backend being merged.

## Explicit non-goals for M7

- **No social features.** STORY-003 (friend requests) + STORY-004 (shared-workouts feed) + the friendships portion of STORY-005 stay deferred — the parent spec marks them as out of scope for M7 in [`tasks.md` § Current state](../../09-notifications-social/tasks.md). Implementing them is a separate, post-launch milestone.
- **No new push-delivery infrastructure.** The legacy Supabase trigger → Edge Function → Expo Push API chain stays as-is. M7 does not move push fanout to SST or rebuild the Edge Function. If a notification needs to fire from a new code path, the path inserts a row into `notifications` and the trigger does the rest. Brad's call.
- **No rest-timer changes.** M3 local notifications continue to work via `ExpoNotificationsAdapter.scheduleLocalNotification`. M7 leaves that surface untouched.
- **No new APNs cert / FCM key creation.** Expo's managed credentials under project ID `255d542d-8dae-43c9-8d98-d9a3a325a470` are already configured for the legacy app and continue serving the V2 build because the bundle ID + package name + Expo project ID are preserved (see [`packages/mobile/CONFIG_REQUIREMENTS.md`](../../../packages/mobile/CONFIG_REQUIREMENTS.md) § App Identity).
- **No notification analytics / read-receipt telemetry.** Mark-read is local + server state only; no event tracking.
- **No rich notifications (images, actions, custom layouts).** Banner + body + tap = full surface for M7. Notification actions (e.g. "Accept friend request" inline) defer to the social milestone.
- **No in-app toast/inbox unification.** The notifications list is the only inbox. In-app transient toasts (e.g. PR confetti) stay separate.
- **No backend-driven push from M7's own code.** No SST handler inserts a `notifications` row this milestone — the existing legacy paths (e.g. PT-acceptance flow, workout-assignment from a trainer) keep doing it from the Supabase side. M8 will move trainer-side inserts onto SST.

## Parent-spec gaps that impl PRs MUST close FIRST

Per [`specs/_agent.md`](../../_agent.md) § Spec-first discipline, the parent spec must cover everything the milestone implements. The current `specs/09-notifications-social/{requirements,design,tasks}.md` does NOT yet cover:

1. **Endpoint contracts.** `design.md` mentions only `POST /notifications/register-token` (with a placeholder shape) and a vague "in-app notification centre". The six concrete endpoints M7 ships (`GET /notifications`, `PATCH /notifications/:id`, `PATCH /notifications/all`, `GET /notifications/preferences`, `POST /notifications/preferences`, `POST /devices/register`) need full wire-format documentation in `design.md` § Backend endpoints. Backend agent's first commit on the milestone branch adds this section.
2. **Notification preferences storage.** `design.md` says nothing about where the preferences map lives. Options:
   - **(A) New `notification_preferences` table** — `(user_id, notification_type, enabled)` with composite PK. Idempotent migration. Cleaner long-term.
   - **(B) JSONB column `profiles.notification_preferences`** — `{ workout_reminder: true, friend_request: false, ... }`. Fewer migrations, simpler.
   - Backend agent picks one + commits the decision to `design.md` § Notification preferences before writing the handlers. Brad's preference: **(B) JSONB on `profiles`** because it avoids a migration on a public repo + matches the legacy app's pattern of stuffing user prefs on the profile row. Confirm in the spec-update commit; if the backend agent finds a reason to prefer (A), surface in PR review.
3. **`NotificationType` parity.** `design.md`'s `NotificationType` union is `"friend_request" | "friend_accepted" | "personal_record" | "trainer_assignment" | "workout_reminder" | "system"`. The actual `notification_type` enum in the DB is `"workout_assigned" | "friend_request" | "pt_request" | "pt_accepted" | "physio_request" | "physio_accepted" | "workout_reminder" | "goal_milestone" | "trainer_feedback"` ([`packages/db/src/schema.ts:139-149`](../../../packages/db/src/schema.ts)). The spec must reconcile — keep the DB enum as authority; update `design.md` to use it; the mobile `NotificationType` mirrors the DB enum. Backend agent commits the reconciliation.
4. **Deep-link payload shape.** `design.md` § Deep Linking shows `{ screen, id }` examples but no schema. Define a single field `deepLink: string` (an absolute Expo Router path like `/(app)/(tabs)/profile` or `/(app)/session?sessionId=abc`) on `notifications.data` JSONB. Mobile agent's first commit adds this convention to `design.md`. **No legacy free-form keys**; one field, type-safe.
5. **Acceptance criteria for STORY-001 + STORY-005.** Existing ACs are sparse. Each impl PR adds ACs that the SMOKE_TEST steps map to. STORY-001 needs ACs covering device-token registration (idempotent, on sign-in, retried on re-auth), tap-to-deep-link (cold + warm), preferences (toggle persists). STORY-005 needs ACs covering list pagination, pull-to-refresh, mark-read-single + mark-all-read, unread badge count, offline cached read.

Backend + frontend agents author the spec-update commits in parallel on their respective branches. If the two agents disagree on shape (preferences storage, deep-link field), they coordinate via PR comments before either lands an implementation commit.

## Push-credentials migration plan (NO secret values in files)

**Brad's hard rule:** persistence-backend-sst is a PUBLIC repo since 2026-05-14 ([`memory/feedback_repo_is_public.md`](/Users/bradleysimms-evans/.claude/projects/-Users-bradleysimms-evans-Documents-projects-personal-persistence-backend-sst/memory/feedback_repo_is_public.md)). **Never commit secret values to any file in this repo** — APNs `.p8` keys, FCM server keys, Supabase service-role keys, Stripe restricted keys, etc. Use SST Secret bindings or Expo / EAS managed credentials.

### What already exists (do NOT recreate)

| Asset                                | Where it lives                                                                                                                                | Visibility                                                                                                                                                                                              |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Expo project ID**                  | [`packages/mobile/app.json:103`](../../../packages/mobile/app.json) — `255d542d-8dae-43c9-8d98-d9a3a325a470`                                  | Public (it's a UUID, not a secret). Identifies the Expo project under which APNs + FCM credentials are stored.                                                                                          |
| **iOS bundle ID**                    | [`packages/mobile/app.json:14`](../../../packages/mobile/app.json) — `com.bradleyevans96.persistence`                                         | Public.                                                                                                                                                                                                 |
| **Android package**                  | [`packages/mobile/app.json:32`](../../../packages/mobile/app.json) — `com.bradleyevans96.persistence`                                         | Public.                                                                                                                                                                                                 |
| **APNs auth key (`.p8`)**            | Expo's managed credentials store, under project `255d542d-8dae-43c9-8d98-d9a3a325a470`                                                        | **Secret — managed by Expo. Do not download or commit.** Confirm presence via `eas credentials --platform ios --profile production` (Brad runs this once outside the agent; agent does not need keys).  |
| **FCM server key / service account** | Expo's managed credentials store                                                                                                              | **Secret — managed by Expo. Do not download or commit.** Confirm presence via `eas credentials --platform android --profile production`.                                                                |
| **Apple Team ID**                    | [`packages/mobile/eas.json:51,57`](../../../packages/mobile/eas.json) — `U9S9BFTM4V`                                                          | Public-ish (it's in App Store Connect already).                                                                                                                                                         |
| **App Store Connect App ID**         | [`packages/mobile/eas.json:50,56`](../../../packages/mobile/eas.json) — `6755091280`                                                          | Public.                                                                                                                                                                                                 |
| **Expo Push Service**                | Expo SaaS — accessed via the project ID at runtime; no per-app API key needed by mobile clients                                               | Mobile uses `Notifications.getDevicePushTokenAsync()` which talks directly to Expo Push under the configured project ID.                                                                                |
| **`send-push-notification` Edge Function** | Legacy Supabase project (`dfeyebgdktfteqlacmru`). Triggered by [`supabase/migrations/010_trigger_push_notifications.sql`](../../../supabase/migrations/010_trigger_push_notifications.sql). | Function source is NOT in this repo (lives in the legacy `persistence-mobile` repo's `supabase/functions/` folder OR was deployed via Supabase Studio). Frontend agent verifies it's still deployed.   |
| **Supabase service-role key**        | `app.settings` table in the Supabase DB, key `service_role_key` ([`supabase/migrations/011_app_settings_for_push_notifications.sql:20-26`](../../../supabase/migrations/011_app_settings_for_push_notifications.sql)) | **Secret — already configured in the DB by Brad. Do not query, log, or commit. The push trigger reads it; nothing else should.**                                                                        |

### What M7 needs (and where it lives)

| Asset                                                                          | Required action                                                                                                                                                                                                                                            | Where it lives                                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **`EXPO_PUBLIC_EAS_PROJECT_ID`** env var (only if `getDevicePushTokenAsync` needs it explicitly) | The Expo SDK reads the project ID from `app.json` automatically; no separate env var needed in most setups. If the runtime errors with "Project ID not found", expose it as `Constants.expoConfig?.extra?.eas?.projectId` (already there per app.json:101–105). | `app.json` + `Constants` — public, no secret.                                           |
| **`expo-notifications` runtime configuration**                                 | Already present in [`app.json:83-88`](../../../packages/mobile/app.json) under `"plugins"`. Icon + color preserved from legacy. No change.                                                                                                                  | `app.json` — no change needed.                                                          |
| **iOS push entitlement (`aps-environment`)**                                   | Confirm via `eas credentials` that the production provisioning profile carries the `aps-environment: production` entitlement. Brad does this once outside the agent; if absent, EAS will refuse the build with a clear error.                              | Apple Developer Portal + Expo managed credentials.                                      |
| **Android Notification Channel**                                               | Already registered at app launch ([`app/_layout.tsx:104-112`](../../../packages/mobile/app/_layout.tsx)) — `default` channel, MAX importance. No change.                                                                                                    | Code — no secret.                                                                       |
| **`useDeviceTokenRegistration` idempotency flag**                              | AsyncStorage key `device_token_registered_<userId>`. Documented in `FRONTEND_BRIEF.md`. No secret.                                                                                                                                                          | Mobile AsyncStorage at runtime.                                                         |

**Brad's manual one-time setup** (outside agent scope, document only):

1. Run `eas credentials --platform ios --profile staging` and `--platform ios --profile production`; confirm an "APNs Auth Key" is configured under project `255d542d-8dae-43c9-8d98-d9a3a325a470`. If missing, upload from the existing legacy `.p8` (download from Apple Developer Portal — the same one the legacy app uses).
2. Same for Android: `eas credentials --platform android` confirms FCM credentials.
3. Confirm the `send-push-notification` Edge Function is deployed in the legacy Supabase project — `supabase functions list --project-ref dfeyebgdktfteqlacmru` should show it. If it's missing, redeploy from the legacy `persistence-mobile/supabase/functions/send-push-notification` source.
4. Confirm the `app.settings.service_role_key` row exists in the Supabase DB (the push trigger needs it to call the Edge Function).

These are pre-conditions to running the SMOKE_TEST end-to-end. If any are missing, surface in PR review — DO NOT attempt to create them from the agent.

## Cross-cutting (carry into both briefs)

- **Wire-format contract.** The six endpoint shapes documented in `BACKEND_BRIEF.md` are the load-bearing contract. The frontend's `InMemoryApiAdapter` test fixtures mirror them exactly. If shapes need to drift mid-implementation, surface a spec update FIRST, then mirror in both tracks.
- **Ownership in mutation WHERE (M2 learning #14).** `PATCH /notifications/:id` and `PATCH /notifications/all` fold `userId` into the WHERE — single round-trip, race-free, 404 from the same code path.
- **No JWT spoofing.** Every handler reads `userId` from `getUser(ctx).sub` (the validated Supabase JWT), never from the request body.
- **Legacy push trigger stays.** The Supabase `notification_push_trigger` ([`supabase/migrations/010_trigger_push_notifications.sql`](../../../supabase/migrations/010_trigger_push_notifications.sql)) fires on every INSERT into `notifications`. SST handlers that insert into `notifications` (none in M7's scope — M8 will be first) get push delivery "for free" because the trigger runs at the DB layer regardless of insertion path. Note this in `design.md` § Push delivery.
- **`device_info` JSONB shape.** Standardise on `{ deviceName?: string, osVersion?: string, appVersion?: string, modelName?: string }`. Mobile populates from `expo-device` if available; missing keys are fine.
- **Deep-link safety.** Mobile validates `data.deepLink` is a relative path starting with `/(app)/` or `/(auth)/` before calling `router.push`. Reject absolute URLs (`http://…`) — they're not used and would be a vector for an attacker who controls a row in `notifications`.
- **Offline mark-read.** Mark-read mutations go through the existing M3 sync-queue surface (`processSyncQueue`). The intent kind is `markNotificationRead` (single) and `markAllNotificationsRead` (bulk). Both replay idempotently — the backend's mark-read handler is a no-op if `is_read = true` already.
- **No secret values in any committed file.** Every reference to APNs / FCM / service-role keys names the secret, points at where it lives (Expo credentials, Supabase `app.settings`, EAS secrets), and never embeds the value. Re-read this rule before each commit.
- **Spec-first discipline.** If either agent finds the parent spec disagrees with the brief, the spec wins. Flag in PR review; update the spec first; then implement.
