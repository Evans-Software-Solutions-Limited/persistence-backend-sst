# M7 — Backend Agent Brief

You are implementing the backend track of Milestone 7 — Notifications. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the SST / Elysia backend at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/microservices/core/`. You are NOT touching the mobile app — that is the frontend agent's responsibility. You may read mobile code (especially `packages/mobile/src/domain/ports/api.port.ts` and `packages/mobile/src/adapters/notifications/`) for contract context but must not modify it.

## Authority

- Parent spec: [`../../09-notifications-social/`](../../09-notifications-social/) — requirements + design + tasks.
- Backend architectural rules: [`CLAUDE.md`](../../../CLAUDE.md) at repo root (SST v3 + Elysia + Neon + Drizzle + JWT auth + explicit ownership checks).
- Sessions module CLAUDE.md (model for shape + tests): [`microservices/core/src/application/sessions/CLAUDE.md`](../../../microservices/core/src/application/sessions/CLAUDE.md).
- Workflow discipline: [`../../_agent.md`](../../_agent.md) — spec-first, always.
- Existing schema for notifications + devices: [`packages/db/src/schema.ts`](../../../packages/db/src/schema.ts) lines 139-149 (enum), 804-820 (`notifications`), 845-867 (`user_devices`).
- Legacy SQL functions that V2 replaces with handlers: [`supabase/migrations/007_trainer_invitations_and_push_notifications.sql:521-628`](../../../supabase/migrations/007_trainer_invitations_and_push_notifications.sql) — `register_device_token` and `unregister_device_token`. These are the **wire-format authority** for the new handlers.
- Push trigger (do NOT touch): [`supabase/migrations/010_trigger_push_notifications.sql`](../../../supabase/migrations/010_trigger_push_notifications.sql) + [`011_app_settings_for_push_notifications.sql`](../../../supabase/migrations/011_app_settings_for_push_notifications.sql).

## Spec alignment — first commit on the branch

The parent spec needs updates BEFORE implementation. Author them as the first commit:

1. **`design.md` § Backend endpoints (new section)** — document the six endpoint contracts (request shapes, response shapes, status codes, ownership rules). Use the full shapes from § 1–6 below.
2. **`design.md` § Notification preferences (new section)** — commit Brad's preferred decision: JSONB column `profiles.notification_preferences` of type `Record<NotificationType, boolean>`, defaulting to all-true. Document the migration (one new column on `profiles`). If you discover a strong reason to prefer a separate `notification_preferences` table, surface in PR review BEFORE writing the migration.
3. **`design.md` § Push delivery (new section)** — short note: SST handlers do NOT send pushes directly; the legacy Supabase trigger on `notifications` INSERT calls the `send-push-notification` Edge Function which fans out to Expo Push API. SST inserting a row is sufficient to deliver. Cite the trigger migration file.
4. **`design.md` § Domain models** — reconcile `NotificationType` with the DB enum (`packages/db/src/schema.ts:139-149`). Use the DB enum as authority: `"workout_assigned" | "friend_request" | "pt_request" | "pt_accepted" | "physio_request" | "physio_accepted" | "workout_reminder" | "goal_milestone" | "trainer_feedback"`. Mobile mirrors this in its domain model.
5. **`design.md` § Deep Linking** — define `notifications.data.deepLink: string` as the single deep-link field (an Expo Router path starting with `/(app)/` or `/(auth)/`). Drop the `{ screen, id }` example shapes — those don't survive contact with typed routes.
6. **`requirements.md`** — add ACs for STORY-001 (device-token registration, idempotent) and STORY-005 (list, mark-read, mark-all-read, preferences, offline cached). Each AC maps 1:1 to a step in `SMOKE_TEST.md`.
7. **`tasks.md`** — mark Phase 5 (API endpoints) as M7-scoped. Note Phases 7 + 8 (friendships + shared workouts) remain deferred.

Every implementation commit cites the spec sections it implements in the footer:

```
Implements: specs/09-notifications-social/design.md § Backend endpoints > GET /notifications
Closes: specs/09-notifications-social/tasks.md § Phase 5 — API endpoints (item 1)
Satisfies: specs/09-notifications-social/requirements.md AC 5.1, 5.2
```

If you find the spec disagrees with this brief or with your implementation reality, **stop and update the spec first** as its own commit.

## Scope — six handlers + repository + tests

Recommended commit order: schema migration → repository → device register → list + filter → mark-read single → mark-all-read → preferences read/write. Each ships its own tests with 90% branch coverage on touched files.

### 0. Schema migration (additive)

Add JSONB column to `profiles`:

| Column                    | Type                                                   | Default                | Notes                                                                          |
| ------------------------- | ------------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------ |
| `notification_preferences` | `JSONB NOT NULL`                                       | `'{}'::JSONB`          | `Record<NotificationType, boolean>`. Empty object = "all enabled" (default-on). |

Migration file: `supabase/migrations/<timestamp>_m7_notification_preferences.sql`. Idempotent (`ADD COLUMN IF NOT EXISTS`). Update `packages/db/src/schema.ts` `profiles` table with the new column; regenerate Drizzle types via `bun run db:generate` if you have a script for it (otherwise hand-edit the type export).

**Trigger contract:** the existing M0/M3 triggers + the subscription trigger don't touch `profiles.notification_preferences`. Safe.

### 1. `POST /devices/register` — device-token upsert

Spec: [`design.md` § Backend endpoints > POST /devices/register](../../09-notifications-social/design.md), satisfies STORY-001 AC.

**Handler**: `microservices/core/src/application/devices/register/devicesRegisterHandler.ts`

**Behaviour**:

- Method: `POST`
- Path: `/devices/register`
- Auth: **required** (JWT, via `requireAuth` middleware).
- Body:
  ```typescript
  {
    deviceToken: string;   // Expo push token, opaque
    platform: "ios" | "android" | "web";
    deviceInfo?: {
      deviceName?: string;
      osVersion?: string;
      appVersion?: string;
      modelName?: string;
    };
  }
  ```
- Response 200: `{ data: { id: string, registered: true } }`
- Response 400: validation error (missing `deviceToken`, invalid `platform`)
- Response 401: missing / invalid JWT

**Repository**: `microservices/core/src/application/repositories/userDeviceRepository.ts` (new)

- `register(userId: string, input: RegisterDeviceInput): Promise<UserDevice>`
- One query: `INSERT INTO user_devices (...) ON CONFLICT (user_id, device_token) DO UPDATE SET platform = EXCLUDED.platform, device_info = EXCLUDED.device_info, is_active = true, last_used_at = NOW(), updated_at = NOW() RETURNING *`
- Mirrors the legacy `register_device_token` SQL function exactly. Wire format must match (`success`/`device_id` legacy keys → V2 `data.id` + `data.registered`).

**Service**: `microservices/core/src/application/repositories/userDeviceService.ts` — thin Elysia decorator that exposes `UserDeviceRepository`.

**Edge cases**:

- Same `(userId, deviceToken)` re-register → idempotent UPSERT → 200 with same `id`.
- Different `userId`, same `deviceToken` (e.g. shared device, fresh sign-in by another user) → new row (unique index is `(user_id, device_token)`). Acceptable — both users continue to receive their own pushes.
- Empty `deviceToken` → 400.
- Invalid `platform` → 400 via `t.Union([t.Literal("ios"), t.Literal("android"), t.Literal("web")])`.

**Tests**: create handler, idempotent re-register, wrong-user-403 (no cross-user write — userId from JWT, body doesn't carry userId), validation paths.

### 2. `GET /notifications` — list

Spec: [`design.md` § Backend endpoints > GET /notifications](../../09-notifications-social/design.md), satisfies STORY-005 AC.

**Handler**: `microservices/core/src/application/notifications/list/notificationsListHandler.ts`

**Behaviour**:

- Method: `GET`
- Path: `/notifications`
- Auth: required.
- Query params:
  ```typescript
  {
    limit?: number;       // default 50, max 100
    offset?: number;      // default 0
    unreadOnly?: boolean; // default false
  }
  ```
- Response: `{ data: AppNotification[], unreadCount: number }`
  - `unreadCount` is the total count of unread notifications for the user (NOT just within the returned page) — drives the bell-icon badge without a separate round-trip.

**Repository**: `microservices/core/src/application/repositories/notificationRepository.ts` (new)

- `list(userId: string, filters: { limit: number; offset: number; unreadOnly: boolean }): Promise<AppNotification[]>`
- `countUnread(userId: string): Promise<number>` — `SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = false`
- Ordering: `created_at DESC`
- Returns Drizzle's `$inferSelect` shape; handler maps to wire shape.

**Wire shape**:

```typescript
type AppNotification = {
  id: string;
  userId: string;
  type: NotificationType;   // the DB enum
  title: string;
  message: string | null;
  data: {
    deepLink?: string;       // optional — some notifications are read-only
    [k: string]: unknown;
  };
  isRead: boolean;
  readAt: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
};
```

**Edge cases**:

- Empty list → `{ data: [], unreadCount: 0 }` + 200.
- `limit > 100` → clamp to 100 (do NOT 400 — match the legacy app's tolerant pagination).
- `unreadOnly=true` → `WHERE is_read = false` AND'd into the user filter.

**Tests**: ownership (only own notifications returned), unread filter, pagination, unreadCount accuracy.

### 3. `PATCH /notifications/:id` — mark-read single

Spec: [`design.md` § Backend endpoints > PATCH /notifications/:id](../../09-notifications-social/design.md), satisfies STORY-005 AC.

**Handler**: `microservices/core/src/application/notifications/update/notificationsUpdateHandler.ts`

**Behaviour**:

- Method: `PATCH`
- Path: `/notifications/:id`
- Auth: required.
- Body: `{ isRead: true }` (only one allowed transition for M7 — mark as read. Unread re-flip is not in scope.)
- Response 200: `{ data: AppNotification }` (the updated row).
- Response 404: notification not found OR not owned by user (don't leak existence).

**Repository**:

- `markRead(userId: string, notificationId: string): Promise<AppNotification | null>`
- **Fold ownership into the mutation WHERE** (M2 learning #14):
  ```typescript
  return db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
    .returning();
  ```
- Returns `null` if zero rows updated (wrong user OR not found). Handler converts to 404.

**Edge cases**:

- Notification already `is_read = true` → idempotent: WHERE matches, UPDATE sets the same values, returns the row → 200. (Mark-read replays from the sync queue depend on this.)
- Wrong user → WHERE doesn't match → null → 404.
- Invalid UUID → 400 from Elysia validator.

**Tests**: wrong-user-404, idempotent re-mark, valid mark-read, validation.

### 4. `PATCH /notifications/all` — mark-all-read

Spec: [`design.md` § Backend endpoints > PATCH /notifications/all](../../09-notifications-social/design.md), satisfies STORY-005 AC.

**Handler**: `microservices/core/src/application/notifications/updateAll/notificationsUpdateAllHandler.ts`

**Behaviour**:

- Method: `PATCH`
- Path: `/notifications/all`
- Auth: required.
- Body: `{}` (empty)
- Response 200: `{ data: { updated: number } }` — count of rows newly marked read.

**Repository**:

- `markAllRead(userId: string): Promise<number>`
- One query: `UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = ? AND is_read = false RETURNING id`. Return the array length.

**Edge cases**:

- No unread notifications → returns `{ data: { updated: 0 } }` + 200.
- Idempotent — replay returns 0 on the second call (all already read).

**Path-collision note:** `/notifications/all` is registered AFTER `/notifications/:id` in `api.ts` — Elysia routes top-down; the literal `all` would otherwise match `:id`. Mirror the [exercises search-before-get](../../../microservices/core/src/api.ts) pattern: register `notificationsUpdateAllHandler` BEFORE `notificationsUpdateHandler`. Add an inline comment so the next reader doesn't reorder them.

Actually — re-check. Elysia matches by pattern specificity, but the safer route is to use `/notifications/all/read` or similar literal. **Decision:** keep `PATCH /notifications/all` as documented (matches the brief) and register the literal-path handler first; verify with a test that hits `PATCH /notifications/all` and asserts the all-read handler ran, not the single-row handler with `:id = "all"`.

**Tests**: mark-all-read happy path (updates only the user's unread rows), regression test for the path-collision case, zero-unread idempotency.

### 5. `GET /notifications/preferences` — read

Spec: [`design.md` § Backend endpoints > GET /notifications/preferences](../../09-notifications-social/design.md), satisfies STORY-001 AC.

**Handler**: `microservices/core/src/application/notifications/preferences/get/preferencesGetHandler.ts`

**Behaviour**:

- Method: `GET`
- Path: `/notifications/preferences`
- Auth: required.
- Response: `{ data: Record<NotificationType, boolean> }`

**Repository**: extend `profileRepository.ts` with:

- `getNotificationPreferences(userId: string): Promise<Record<NotificationType, boolean>>`
- `SELECT notification_preferences FROM profiles WHERE id = ?`
- If `null` or `{}` → return the default-all-true map: every key in `NotificationType` enum mapped to `true`.

**Default shape** (handler synthesises if column is empty):

```typescript
{
  workout_assigned: true,
  friend_request: true,
  pt_request: true,
  pt_accepted: true,
  physio_request: true,
  physio_accepted: true,
  workout_reminder: true,
  goal_milestone: true,
  trainer_feedback: true,
}
```

**Edge cases**:

- User row missing → 404 (shouldn't happen if JWT is valid + handle_new_user fired, but defend).
- Column is `{}` → return defaults.
- Column has stale keys (legacy values not in current enum) → drop them on the way out.

**Tests**: empty-column → defaults, populated map, stale-key drop, ownership.

### 6. `POST /notifications/preferences` — write

Spec: [`design.md` § Backend endpoints > POST /notifications/preferences](../../09-notifications-social/design.md), satisfies STORY-001 AC.

**Handler**: `microservices/core/src/application/notifications/preferences/set/preferencesSetHandler.ts`

**Behaviour**:

- Method: `POST` (not PUT/PATCH — matches the brief's wire format; full-replace semantics).
- Path: `/notifications/preferences`
- Auth: required.
- Body: `Record<NotificationType, boolean>` — full map, not partial.
- Response: `{ data: Record<NotificationType, boolean> }` (echoes the stored map after defaults are applied).

**Validation**:

- Reject unknown keys (not in `NotificationType` enum) → 400.
- Reject non-boolean values → 400.
- Empty body `{}` → 200; stored as `{}` → reads return defaults.

**Repository**: extend `profileRepository.ts` with:

- `setNotificationPreferences(userId: string, prefs: Record<NotificationType, boolean>): Promise<void>`
- `UPDATE profiles SET notification_preferences = ? WHERE id = ?`

**Trigger contract:** writing to `profiles.notification_preferences` does NOT fire `update_subscription_limits_trigger` — that trigger watches subscription columns only. Confirmed safe.

**Tests**: full-replace happy path, unknown-key rejection, non-boolean rejection, ownership.

## API registration (api.ts)

Register the seven new handlers in [`microservices/core/src/api.ts`](../../../microservices/core/src/api.ts) AFTER the existing authed handlers. Order:

```typescript
.use(notificationsListHandler)
.use(notificationsUpdateAllHandler)   // before :id literal
.use(notificationsUpdateHandler)
.use(preferencesGetHandler)
.use(preferencesSetHandler)
.use(devicesRegisterHandler)
```

Add a one-line comment above the block explaining the `all`-before-`:id` ordering.

## Quality gates

```bash
bun run prettier:check    # format
bun run typecheck          # TypeScript
bun run lint               # ESLint (zero errors; warnings tolerated if pre-existing)
bun run build              # all packages
bun --filter @persistence/core test:unit   # 90% branches non-negotiable on changed files
```

Total core test count after M7: target +30–50 tests from the post-M10.5 baseline.

## Files you will touch

```
microservices/core/src/api.ts                                                       # route registration
microservices/core/src/application/devices/register/
  devicesRegisterHandler.ts                                                          # new
  __tests__/devicesRegisterHandler.test.ts                                            # new
microservices/core/src/application/notifications/list/
  notificationsListHandler.ts                                                        # new
  __tests__/notificationsListHandler.test.ts                                          # new
microservices/core/src/application/notifications/update/
  notificationsUpdateHandler.ts                                                      # new
  __tests__/notificationsUpdateHandler.test.ts                                        # new
microservices/core/src/application/notifications/updateAll/
  notificationsUpdateAllHandler.ts                                                   # new
  __tests__/notificationsUpdateAllHandler.test.ts                                     # new
microservices/core/src/application/notifications/preferences/get/
  preferencesGetHandler.ts                                                           # new
  __tests__/preferencesGetHandler.test.ts                                             # new
microservices/core/src/application/notifications/preferences/set/
  preferencesSetHandler.ts                                                           # new
  __tests__/preferencesSetHandler.test.ts                                             # new
microservices/core/src/application/repositories/
  notificationRepository.ts                                                           # new
  userDeviceRepository.ts                                                              # new
  userDeviceService.ts                                                                  # new (or extend existing)
  profileRepository.ts                                                                  # extend with notification preferences
  __tests__/notificationRepository.test.ts                                              # new
  __tests__/userDeviceRepository.test.ts                                                # new
  __tests__/profileRepository.test.ts                                                   # extend
packages/db/src/schema.ts                                                             # add profiles.notification_preferences
supabase/migrations/<timestamp>_m7_notification_preferences.sql                       # new
```

## Files you will NOT touch

- Anything under `packages/mobile/` — frontend agent's territory.
- The Stripe / subscription handlers (`microservices/core/src/application/{stripe,subscriptions}/*`) — out of scope.
- The legacy push trigger ([`supabase/migrations/010_trigger_push_notifications.sql`](../../../supabase/migrations/010_trigger_push_notifications.sql) + `011_*`) — DO NOT MODIFY. The trigger is the push-delivery contract; changing it risks breaking deliveries from non-SST insertion paths (the legacy Supabase RPC routes that M8 will move on later).
- `app.settings.service_role_key` row in Supabase — **DO NOT query, log, or reference this key in any code path**. The push trigger reads it; nothing in SST should.
- `infra/` — no SST changes; environment variables already wired.

## Push delivery — context for the implementation reader

M7's backend handlers do NOT send push notifications themselves. The flow is:

1. A row is INSERTed into the `notifications` table (today: legacy Supabase RPCs from the trainer flow + auto-generated workout reminders. M7 doesn't add insertion sites — that's M8's job).
2. The Postgres trigger `notification_push_trigger` ([`supabase/migrations/010_trigger_push_notifications.sql`](../../../supabase/migrations/010_trigger_push_notifications.sql)) fires AFTER INSERT.
3. The trigger function `trigger_push_notification` looks up active `user_devices` rows for the recipient.
4. If at least one device is registered, the function calls the `send-push-notification` Supabase Edge Function via `pg_net.http_post`, passing `(user_id, title, message, data, notification_type)`.
5. The Edge Function (deployed in the legacy Supabase project at `dfeyebgdktfteqlacmru`) reads the user's devices, formats Expo Push messages, and POSTs to `https://exp.host/--/api/v2/push/send`.
6. Expo Push fans out to APNs (iOS) + FCM (Android), using the credentials stored under Expo project `255d542d-8dae-43c9-8d98-d9a3a325a470`.

This pipeline is operational today for the legacy app. M7's backend ensures `user_devices` rows are written from SST when the V2 app signs in — closing the loop so V2 device tokens land in the same table the trigger reads.

If a SMOKE_TEST step fails at "no push received":

- Check the `user_devices` row exists (`SELECT * FROM user_devices WHERE user_id = ?`) — backend bug.
- Check `app.settings.service_role_key` is set — Brad's one-time setup.
- Check the Edge Function is deployed — `supabase functions list --project-ref dfeyebgdktfteqlacmru`.
- Check the trigger fired — Postgres logs / `pg_net` response inspection.

Surface as a PR-review note if the test fails; do NOT attempt to reimplement push fanout in SST.

## Inspector Brad expectations

Substantive sweep findings will concentrate on:

- TOCTOU on `PATCH /notifications/:id` (ownership in mutation WHERE — M2 learning #14).
- The `all`-before-`:id` route ordering regression test.
- `notification_preferences` default-shape synthesis (empty column vs missing key vs stale key).
- Trigger contract: `profiles.notification_preferences` writes don't fire any cross-cutting trigger.
- Wrong-user 404 on every mutation (regression check for cross-user write paths).

TRACE before patching. State the exact code reading + reproduction sequence in commit messages.

## When you finish

- Tests pass with 90% branch coverage on touched files.
- `gh pr create` against `main` with the M7 reference and SMOKE_TEST link in the description.
- Wait for Brad to fire `@inspector-brad` — do not pre-empt.
- After fixes land, surface a `(finding, severity, patch)` summary table.
