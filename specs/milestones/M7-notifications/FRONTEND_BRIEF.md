# M7 — Frontend Agent Brief

You are implementing the frontend track of Milestone 7 — Notifications. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the React Native / Expo mobile app at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/packages/mobile/`. You are NOT touching the backend — that is the backend agent's responsibility. You may read backend code (especially `microservices/core/src/application/notifications/`) for wire-shape context but must not modify it.

## Authority

- Parent spec: [`../../09-notifications-social/`](../../09-notifications-social/) — requirements + design + tasks.
- Mobile architectural rules: [`../../_agent.md`](../../_agent.md) — hexagonal architecture, container/presenter split, ports & adapters, 90% coverage non-negotiable.
- Legacy reference app: `/Users/bradleysimms-evans/Documents/projects/personal/persistence-mobile/` — **behavioural source of truth**. Port flows + UI patterns 1:1. **Never copy architecture** (legacy is hook-heavy + direct Supabase; V2 is ports/adapters + SST API).
- M3 offline-first pattern (SQLite + sync queue + invalidate-dashboard): [`packages/mobile/src/adapters/storage/sqlite.adapter.ts`](../../../packages/mobile/src/adapters/storage/sqlite.adapter.ts) — the `cached_workouts` / `cached_dashboard` / `personal_records` blueprints. Mirror for `cached_notifications`.
- Existing notification adapter scaffolding (do NOT duplicate): see § Existing scaffolding below.
- M10.5 online-status hook (reuse, don't reinvent): `useOnlineStatus` at `packages/mobile/src/ui/hooks/useOnlineStatus.tsx`.

## Spec alignment — first commit on the branch

The parent spec needs updates BEFORE implementation. Backend agent's spec-update commits cover the endpoint contracts + preferences storage + push-delivery note. Mobile agent's spec-update commit covers the mobile-side architecture:

1. **`design.md` § Domain models** — reconcile `AppNotification` shape with the backend's wire format from `BACKEND_BRIEF.md` § 2. Update fields: `message: string | null` (not just `body`), `relatedEntityType`/`relatedEntityId`, `readAt: string | null`. `data` is `Record<string, unknown>` with a strongly-typed `deepLink?: string` field — DO NOT permit raw URL-string variants beyond the leading `/(app)/` or `/(auth)/` prefix.
2. **`design.md` § UI structure** — replace the existing component sketch with the concrete V2 paths in § 5 + § 6 below. Add `NotificationPreferencesContainer` + `NotificationPreferencesPresenter`. Drop the friendships components entirely (defer to a later milestone).
3. **`design.md` § Offline strategy (new section)** — document the `cached_notifications` SQLite table + reconcile-on-sync pattern (mirrors M3 `cached_workouts`). Preferences are online-only (small payload).
4. **`design.md` § Push Token Flow** — rewrite to match the V2 sequence: sign-in → `ExpoNotificationsAdapter.getDevicePushToken()` → `POST /devices/register` → idempotent via AsyncStorage flag. Drop the old `POST /notifications/register-token` placeholder.
5. **`design.md` § Deep Linking** — define the contract: `notifications.data.deepLink: string` is an Expo Router path. Mobile validates it starts with `/(app)/` or `/(auth)/` before calling `router.push`.
6. **`requirements.md`** — add ACs for the device-registration idempotency, deep-link cold + warm start, list pagination + pull-to-refresh, mark-read single + all, offline cached read, preferences toggle persistence. Map to SMOKE_TEST steps 1:1.
7. **`tasks.md`** — mark Phase 6 (UI — Notification Centre) as M7-scoped. Phase 7 (Friendships) + Phase 8 (Shared Workouts) stay deferred.

Every implementation commit cites the spec section it implements in the footer:

```
Implements: specs/09-notifications-social/design.md § UI structure > NotificationListContainer
Closes: specs/09-notifications-social/tasks.md § Phase 6 — items 3, 4, 5
Satisfies: specs/09-notifications-social/requirements.md AC 5.1, 5.3
```

## Port-1:1 discipline

The legacy app's notifications surface is proven and ratified by real users. **Match legacy 1:1 for layout, copy, navigation, interaction model, empty/error states, and timestamp formatting.** No `frontend-design` revamp during the port. Polish lands in M11.

Specifically:

- Match legacy copy verbatim (header text, CTAs, empty-state messaging, error strings).
- Match legacy notification-row layout (icon by type, title, body, relative timestamp like "2h", unread accent).
- Match legacy bell-icon badge styling (count cap at "99+" if used in legacy; otherwise match the cap).
- Match legacy preferences screen layout (section list of toggle switches grouped by category).
- Match legacy mark-as-read interaction (tap to read + deep-link OR explicit checkmark — verify which the legacy uses; one tap should both mark + navigate, not require two taps).
- Match the legacy timestamp format helper (likely uses `date-fns`'s `formatDistanceToNowStrict` or similar — port the same utility).

If something feels archaic (e.g. cramped row layout) → flag as a follow-up for M11; **do not refactor during M7**.

## Existing scaffolding (DO NOT duplicate)

Before writing a single line, audit what's already in place:

| Path                                                                                                       | What it is                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/mobile/src/domain/ports/notifications.port.ts`](../../../packages/mobile/src/domain/ports/notifications.port.ts) | `NotificationsPort` interface with `requestPermissions`, `getPermissionStatus`, `getDevicePushToken`, `scheduleLocalNotification`, `cancelLocalNotification`. **`getDevicePushToken` exists but `ExpoNotificationsAdapter` returns `fail("not implemented in M3 — see milestone 09")`** — M7 fills it in.                                                                                                                                |
| [`packages/mobile/src/adapters/notifications/expo-notifications.adapter.ts`](../../../packages/mobile/src/adapters/notifications/expo-notifications.adapter.ts) | Production adapter. Local notifications work end-to-end (M3 rest-timer uses it). `getDevicePushToken` is a stub returning `PUSH_NOT_IMPLEMENTED`. **M7 replaces the stub with `Notifications.getDevicePushTokenAsync({ projectId: Constants.expoConfig?.extra?.eas?.projectId })`** (the project ID lives in `app.json:103`).                                                                          |
| [`packages/mobile/src/adapters/notifications/stub.adapter.ts`](../../../packages/mobile/src/adapters/notifications/stub.adapter.ts) | No-op adapter for tests / contexts where the SDK isn't available. Already fully tested. M7 doesn't change it.                                                                                                                                                                                                                                                                                                                                |
| [`packages/mobile/src/ui/hooks/useNotificationPermissions.tsx`](../../../packages/mobile/src/ui/hooks/useNotificationPermissions.tsx) | Permission-prompt-on-app-load hook. Idempotent via AsyncStorage `notification_permission_requested` flag. Already wired in [`app/_layout.tsx`](../../../packages/mobile/app/_layout.tsx) via `<NotificationPermissionsBootstrap />`. **M7 does NOT touch this.**                                                                                                                                                                          |
| [`packages/mobile/app/_layout.tsx`](../../../packages/mobile/app/_layout.tsx) — `Notifications.setNotificationHandler` (lines 29-36)         | Foreground-display config (banner + list + sound, no badge). M7 does not change this — keep banners visible in-foreground.                                                                                                                                                                                                                                                                                                                  |
| [`packages/mobile/app/_layout.tsx`](../../../packages/mobile/app/_layout.tsx) — Android channel registration (lines 104-112) | `default` channel with MAX importance + vibration + light color. M7 does not change this.                                                                                                                                                                                                                                                                                                                                                  |
| [`packages/mobile/app.json:83-88`](../../../packages/mobile/app.json)                                            | `expo-notifications` plugin config (icon + color). No change.                                                                                                                                                                                                                                                                                                                                                                              |
| [`packages/mobile/src/ui/hooks/useOnlineStatus.tsx`](../../../packages/mobile/src/ui/hooks/useOnlineStatus.tsx) | M10.5's online-status hook. Reuse for the offline banner on the notifications list.                                                                                                                                                                                                                                                                                                                                                        |
| [`packages/mobile/src/adapters/storage/sqlite.adapter.ts`](../../../packages/mobile/src/adapters/storage/sqlite.adapter.ts) | SQLite adapter with `cached_dashboard`, `cached_workouts`, `cached_profile_page`, `personal_records`, `record_responses` cache tables. M7 adds `cached_notifications` following the same pattern.                                                                                                                                                                                                                                          |
| [`packages/mobile/src/application/commands/sync.command.ts`](../../../packages/mobile/src/application/commands/sync.command.ts) | Generic POST/PATCH/DELETE sync-queue replayer. M7's mark-read intents enqueue here.                                                                                                                                                                                                                                                                                                                                                       |

**What's NOT there yet (M7 must add):**

- `notifications` model in `packages/mobile/src/domain/models/`.
- `ApiPort` methods for notifications + devices + preferences.
- `cached_notifications` SQLite table + `StoragePort` extensions.
- `NotificationListContainer` / `NotificationListPresenter` / `NotificationItem` component.
- `NotificationPreferencesContainer` / `NotificationPreferencesPresenter`.
- `NotificationBadge` component on the tabs header.
- `useDeviceTokenRegistration` hook.
- `useNotifications` + `useNotificationPreferences` query hooks.
- Deep-link tap handler at the app root.
- App route at `app/(app)/notifications.tsx` + `app/(app)/notification-preferences.tsx`.

## Scope — eight slices

Recommended commit order: domain → ports/adapters → SQLite → hooks → components → containers → screens + nav → device-token + deep-link wiring. Each slice ships tests.

### 1. Domain models

Spec: [`design.md` § Domain Models](../../09-notifications-social/design.md), satisfies STORY-001 + STORY-005 ACs.

Create `packages/mobile/src/domain/models/notification.ts`:

```typescript
export type NotificationType =
  | "workout_assigned"
  | "friend_request"
  | "pt_request"
  | "pt_accepted"
  | "physio_request"
  | "physio_accepted"
  | "workout_reminder"
  | "goal_milestone"
  | "trainer_feedback";

export type NotificationPreferences = Record<NotificationType, boolean>;

export interface AppNotification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string | null;
  data: NotificationData;
  isRead: boolean;
  readAt: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
}

export interface NotificationData {
  deepLink?: string;          // must start with /(app)/ or /(auth)/
  [k: string]: unknown;
}

export interface DeviceRegistrationInput {
  deviceToken: string;
  platform: "ios" | "android" | "web";
  deviceInfo?: DeviceInfo;
}

export interface DeviceInfo {
  deviceName?: string;
  osVersion?: string;
  appVersion?: string;
  modelName?: string;
}
```

Pure domain service `packages/mobile/src/domain/services/notificationService.ts`:

- `isValidDeepLink(deepLink: string | undefined): deepLink is string` — returns true only when `deepLink` starts with `/(app)/` or `/(auth)/`. Used by the tap-handler to reject untrusted paths.
- `getRelativeTimestamp(createdAt: string, now: Date): string` — port the legacy timestamp helper.
- `groupPreferencesByCategory(prefs: NotificationPreferences): Array<{ category: string; items: Array<{ type: NotificationType; enabled: boolean; label: string }> }>` — drives the preferences UI; categories are "Workouts", "Trainers", "Goals". Mirror legacy grouping.

100% unit-test coverage on this module.

### 2. `ApiPort` extensions

Spec: [`design.md` § ApiPort additions](../../09-notifications-social/design.md), satisfies STORY-001 + STORY-005 ACs.

Extend `packages/mobile/src/domain/ports/api.port.ts`:

```typescript
interface ApiPort {
  // existing...

  // M7 — Notifications
  getNotifications(filters?: {
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
  }): Promise<Result<{ data: AppNotification[]; unreadCount: number }, ApiError>>;

  markNotificationRead(id: string): Promise<Result<AppNotification, ApiError>>;

  markAllNotificationsRead(): Promise<Result<{ updated: number }, ApiError>>;

  getNotificationPreferences(): Promise<Result<NotificationPreferences, ApiError>>;

  setNotificationPreferences(prefs: NotificationPreferences): Promise<Result<NotificationPreferences, ApiError>>;

  // M7 — Devices
  registerDevice(input: DeviceRegistrationInput): Promise<Result<{ id: string; registered: true }, ApiError>>;
}
```

Implement in:

- `packages/mobile/src/adapters/api/sst-api.adapter.ts` — thin envelope wrappers over `requestEnvelope<T>`. Unwrap `{ data }`. Map 4xx/5xx to `ApiError` via the existing error mapper (which already handles 402 from M10.5; M7 doesn't introduce new error kinds).
- `packages/mobile/src/adapters/api/__tests__/in-memory-api.adapter.ts` — maintain an internal `notificationsByUser: Map<string, AppNotification[]>` + `devicesByUser: Map<string, UserDevice[]>` + `prefsByUser: Map<string, NotificationPreferences>`. Mirrors the SST adapter's wire shape exactly.

Test coverage: 90% on touched files. Mock the network at the `requestEnvelope` boundary. Verify offline → `ApiError.kind: 'network'`.

### 3. SQLite cache — `cached_notifications`

Spec: [`design.md` § Offline strategy](../../09-notifications-social/design.md), satisfies STORY-005 (offline) AC.

Extend `packages/mobile/src/adapters/storage/sqlite.adapter.ts` with:

```sql
CREATE TABLE IF NOT EXISTS cached_notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  data TEXT NOT NULL,            -- JSON-encoded
  is_read INTEGER NOT NULL,      -- 0 or 1
  read_at TEXT,
  related_entity_type TEXT,
  related_entity_id TEXT,
  created_at TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cached_notifications_user_created_at
  ON cached_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS cached_notifications_user_unread
  ON cached_notifications(user_id, is_read);
```

Extend `StoragePort` (`packages/mobile/src/domain/ports/storage.port.ts`):

```typescript
interface StoragePort {
  // existing...

  cacheNotifications(userId: string, notifications: AppNotification[]): Promise<void>;
  getCachedNotifications(userId: string, filters?: { unreadOnly?: boolean; limit?: number }): Promise<AppNotification[]>;
  getCachedUnreadCount(userId: string): Promise<number>;
  markCachedNotificationRead(userId: string, id: string): Promise<void>;
  markAllCachedNotificationsRead(userId: string): Promise<void>;
}
```

Mirror in `packages/mobile/src/adapters/storage/__tests__/in-memory-storage.adapter.ts`.

**Reconciliation semantics:**

- `cacheNotifications` upserts by `id` (last-write-wins per row). Does NOT delete server-removed rows — the server is the source of truth for the list, the cache is an opportunistic read.
- After every successful `GET /notifications`, the container calls `cacheNotifications` with the full response.
- Mark-read writes to cache immediately for optimistic UI + enqueues the network mutation.

**No conflict resolution beyond last-write-wins.** Notifications are append-mostly + read-state — the server-side `markRead` handler is idempotent (mark-read replays are safe), so racy mark-read across devices converges naturally.

### 4. Query hooks (cache-and-subscribe pattern OR Tanstack — match what other lists use)

Spec: [`design.md` § Subscription state (mobile)](../../09-notifications-social/design.md) extended to notifications.

Audit first: does the existing `useNotifications` / similar list-hook live alongside the bespoke cache-and-subscribe (`useWorkouts`, `useDashboard`) pattern or use Tanstack (`useMySubscription`)? **Match the dominant list pattern.** Most likely answer: the bespoke pattern (SQLite-backed, `rereadCache` + `refresh` API surface) because of the offline-first requirement.

Create:

- `packages/mobile/src/ui/hooks/useNotifications.tsx` — wraps `storage.getCachedNotifications` for reads + `api.getNotifications` for the network refresh. Calls `processSyncQueue` BEFORE the GET to drain pending mark-reads (M2 learning #1). Exposes `notifications`, `unreadCount`, `isLoading`, `error`, `refresh`, `rereadCache`.
- `packages/mobile/src/ui/hooks/useNotificationPreferences.tsx` — Tanstack-style or bespoke, doesn't matter (small payload). Cache key `['notification-preferences', userId]`. Mutations invalidate the key.
- `packages/mobile/src/ui/hooks/useMarkNotificationRead.tsx` — mutation hook. Optimistic UI: writes to cache via `storage.markCachedNotificationRead` synchronously, then enqueues the mark-read intent for the sync queue, then triggers `rereadCache`.
- `packages/mobile/src/ui/hooks/useMarkAllNotificationsRead.tsx` — same shape; bulk cache + bulk enqueue + `rereadCache`.
- `packages/mobile/src/ui/hooks/useDeviceTokenRegistration.tsx` — fires on first authed render after sign-in. AsyncStorage flag `device_token_registered_<userId>` prevents re-registration. See § 8 for the full flow.

Tests: 90% coverage. Cover offline path (network fails → cached list returned), mark-read replay-after-online, idempotent re-registration.

### 5. Components

Spec: [`design.md` § UI structure](../../09-notifications-social/design.md), satisfies STORY-005 ACs.

Create at `packages/mobile/src/ui/components/notifications/`:

| Path                              | Legacy reference (read for behaviour, not architecture)                   | Behaviour                                                                                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NotificationItem.tsx`            | `persistence-mobile/components/notifications/NotificationItem.tsx`         | Pure presenter. Props: `notification`, `onPress`. Renders: type icon (mapped from `NotificationType`), title (bold if unread), message, relative timestamp ("2h"). Left-accent stripe (3pt `$primary`) for unread. Tap fires `onPress(notification)`.                  |
| `NotificationBadge.tsx`           | `persistence-mobile/components/notifications/NotificationBadge.tsx`        | Pure presenter. Props: `count`, `onPress`. Renders a bell icon with a red dot + count overlay if `count > 0`. Caps at "99+" if legacy does. Tap fires `onPress`.                                                                                                       |
| `NotificationPreferenceRow.tsx`   | `persistence-mobile/components/notifications/PreferenceRow.tsx` (or similar) | Pure presenter. Props: `label`, `enabled`, `onToggle`. Renders a row with a label + a `Switch`. Match legacy spacing + Tamagui patterns.                                                                                                                              |
| `EmptyNotifications.tsx`          | (likely inline in legacy list)                                              | Empty-state component. Title "No notifications" + description "You're all caught up." Left-aligned per M0 idiom.                                                                                                                                                       |

Each component has a co-located `__tests__` directory with rendering + interaction tests. Snapshot tests for unread / read / empty states.

**Icon mapping** — match legacy. Per `NotificationType`:

| Type                | Icon (matches legacy)                                  |
| ------------------- | ------------------------------------------------------ |
| `workout_assigned`  | dumbbell                                               |
| `workout_reminder`  | clock / alarm                                          |
| `friend_request`    | user-plus                                              |
| `pt_request`        | user-check                                             |
| `pt_accepted`       | user-check (filled)                                    |
| `physio_request`    | stethoscope / first-aid                                |
| `physio_accepted`   | stethoscope (filled)                                   |
| `goal_milestone`    | flag / trophy                                          |
| `trainer_feedback`  | message-square / comment                               |

Verify each against the legacy `NotificationItem.tsx` icon map; the table above is a starting point.

### 6. Containers + presenters + screens

Spec: [`design.md` § UI structure > Container responsibilities](../../09-notifications-social/design.md), satisfies STORY-001 + STORY-005 ACs.

#### Notifications list

`packages/mobile/src/ui/containers/NotificationListContainer.tsx`:

- Uses `useNotifications()`, `useMarkNotificationRead()`, `useMarkAllNotificationsRead()`, `useOnlineStatus()`, `useRouter()`.
- Handles `onItemPress(notification)`:
  - Synchronously mark-read (optimistic) via `markNotificationRead.mutate(notification.id)`.
  - If `notification.data.deepLink` passes `isValidDeepLink()` → `router.push(notification.data.deepLink)`. Otherwise no navigation (the read still happens).
- Handles `onMarkAllPress` → `markAllNotificationsRead.mutate()`.
- Handles `onRefresh` (pull-to-refresh) → `refresh()`.
- Handles `onEndReached` (infinite scroll) — if legacy paginates, port; if legacy loads all → match legacy. For now assume legacy doesn't infinite-scroll; render all returned (capped server-side at 100).
- `useFocusEffect(rereadCache)` to pick up mark-reads from other tabs.

`packages/mobile/src/ui/presenters/NotificationListPresenter.tsx`:

- Pure props: `notifications`, `unreadCount`, `isLoading`, `isOffline`, `error`, `onItemPress`, `onMarkAllPress`, `onRefresh`.
- Renders:
  - Header (back button + title "Notifications" + "Mark all read" CTA when `unreadCount > 0`).
  - Offline banner (when `isOffline`) — same component used on subscription screens.
  - List via `FlatList`. Uses `React.memo(NotificationItem)` + `useCallback(renderItem)` (M0 idiom).
  - Empty state when no notifications.
  - Loading state (skeletons, not spinners — M0 idiom).
  - Error state (legacy copy verbatim).

#### Notification preferences

`packages/mobile/src/ui/containers/NotificationPreferencesContainer.tsx`:

- Uses `useNotificationPreferences()` for the read.
- Local state for the in-flight map (optimistic).
- `onToggle(type)` → updates local state → debounced `setNotificationPreferences.mutate(localState)` (500ms — avoid POST-per-tap).
- Use the `groupPreferencesByCategory` domain service to drive the section list.

`packages/mobile/src/ui/presenters/NotificationPreferencesPresenter.tsx`:

- Pure props: `groupedPrefs`, `isLoading`, `isSaving`, `error`, `onToggle`.
- Renders:
  - Header (back button + title "Notification Preferences").
  - Sectioned list of `NotificationPreferenceRow` components grouped by category.
  - Save-status indicator (small "Saved" badge after debounced write).

#### Routes (Expo Router screens — thin wrappers)

- `packages/mobile/app/(app)/notifications.tsx` — `<NotificationListContainer />`.
- `packages/mobile/app/(app)/notification-preferences.tsx` — `<NotificationPreferencesContainer />`.

Register in `packages/mobile/app/(app)/_layout.tsx` if needed (default behaviour is fine for stacked routes).

#### Tab header bell-icon badge

Mount `<NotificationBadge count={unreadCount} onPress={() => router.push('/(app)/notifications')} />` in the tabs layout header.

- File: `packages/mobile/app/(app)/(tabs)/_layout.tsx` (or equivalent). Add via `headerRight` on each tab OR globally via `screenOptions`.
- The `unreadCount` comes from a singleton `useUnreadCount()` hook that lives at the layout level (don't re-fetch per tab focus — match the legacy pattern where the badge is computed off the cached list).

#### Profile entry to preferences

Profile screen (M6) adds a "Notification preferences" row that pushes to `/(app)/notification-preferences`. Touch `ProfileContainer` minimally — one new row in the settings list.

Container + presenter tests: 90% coverage. Container integration tests use `InMemoryApiAdapter` + `InMemoryStorageAdapter`.

### 7. Deep-link tap handling

Spec: [`design.md` § Deep Linking](../../09-notifications-social/design.md), satisfies STORY-001 (tap to deep link) AC.

Create `packages/mobile/src/ui/hooks/useNotificationTapHandler.tsx`:

- Mounted at the app root (sibling to `<NotificationPermissionsBootstrap />` in `app/_layout.tsx`).
- Uses `Notifications.addNotificationResponseReceivedListener` for warm-start (app foregrounded or backgrounded but running).
- Uses `Notifications.getLastNotificationResponseAsync` on mount for cold-start (app launched from a notification tap).
- Reads `response.notification.request.content.data.deepLink`. Validates via `isValidDeepLink()`. If valid, calls `router.push(deepLink)`. If invalid, no-op (just lets the app open normally).
- Cleans up the listener on unmount.

Mount: add `<NotificationTapHandler />` inside `AppProviders` in `app/_layout.tsx`, BEFORE `<AuthGate />` so the handler is alive before any auth-driven route changes.

**Important:** the tap handler runs regardless of auth state. If the deep link targets `/(app)/...` and the user isn't signed in, `AuthGate` will redirect to sign-in; after sign-in, the route doesn't auto-resume. For M7 that's acceptable behaviour — match legacy. M11 polish may add a "redirect after sign-in" queue.

Tests: mock `Notifications` module. Cover cold-start, warm-start, invalid deep-link (no nav), null data (no nav).

### 8. Device-token registration on sign-in

Spec: [`design.md` § Push Token Flow](../../09-notifications-social/design.md), satisfies STORY-001 (register device token) AC.

Create `packages/mobile/src/ui/hooks/useDeviceTokenRegistration.tsx`:

- Mounted inside `AuthGate` only when `session` is truthy. Receives `userId` from `useAuth()`.
- AsyncStorage flag `device_token_registered_<userId>` is the idempotency guard. If `true`, no-op.
- Flow:
  1. Check `getPermissionStatus()` → if not `"granted"`, skip (legacy assumption: no permission = no token to register).
  2. Call `notifications.getDevicePushToken()` → Result.
  3. If `ok`, call `api.registerDevice({ deviceToken, platform: Platform.OS, deviceInfo: ... })` where `deviceInfo` is populated from `expo-device`:
     - `deviceName: Device.deviceName` (if available)
     - `osVersion: Device.osVersion`
     - `appVersion: Constants.expoConfig?.version`
     - `modelName: Device.modelName`
  4. On success, set `device_token_registered_<userId> = "true"` in AsyncStorage.
  5. On failure (network or 4xx), log + leave the flag unset → retried next launch.
- Effect deps: `[userId, notifications, api]`.
- `useRef` guard for in-flight calls (mirror the `useNotificationPermissions` pattern).

`expo-device` dependency check: confirm in `package.json`. If absent, add (it's a small transitive dep usually pulled in by `expo-constants`).

Tests: 90% coverage. Cover already-registered (flag set → no-op), first registration (flag unset → registers → sets flag), permission denied (no-op), network failure (flag stays unset for retry).

**Replace the `getDevicePushToken` stub** in `packages/mobile/src/adapters/notifications/expo-notifications.adapter.ts`:

```typescript
async getDevicePushToken(): Promise<Result<string, NotificationError>> {
  try {
    const projectId =
      (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
      Constants.easConfig?.projectId;
    if (!projectId) {
      return fail({
        kind: "notification",
        code: "token_failed",
        message: "Missing EAS project ID — cannot request push token",
      });
    }
    const tokenResult = await Notifications.getDevicePushTokenAsync({ projectId });
    return ok(tokenResult.data);
  } catch (err) {
    return fail({
      kind: "notification",
      code: "token_failed",
      message: err instanceof Error ? err.message : "Push token request failed",
    });
  }
}
```

Update the existing adapter test to assert this happy path + the missing-project-id error path.

**Note on `getDevicePushTokenAsync` vs `getExpoPushTokenAsync`:** Expo's `getDevicePushTokenAsync` returns the raw native token (APNs for iOS, FCM for Android). `getExpoPushTokenAsync` returns the Expo Push token (an opaque string usable with Expo's Push Service). The legacy app uses `getExpoPushTokenAsync` because the Edge Function calls Expo Push API. **Match legacy — use `getExpoPushTokenAsync`.** Update the code above to call `getExpoPushTokenAsync({ projectId })` and adjust the device row's `platform` to remain `ios`/`android` (Expo Push handles the per-platform fanout). Confirm against the legacy `persistence-mobile/hooks/useRegisterPushNotifications.ts` or equivalent file — the legacy app's choice is the binding contract.

### Wire `useDeviceTokenRegistration` + tap handler into the app root

In `packages/mobile/app/_layout.tsx`:

```tsx
function NotificationsBootstrap() {
  useNotificationPermissions(true);
  useNotificationTapHandler();
  return null;
}

function AuthedNotificationsBootstrap() {
  useDeviceTokenRegistration();
  return null;
}
```

Mount `<NotificationsBootstrap />` outside `AuthGate` (runs always) and `<AuthedNotificationsBootstrap />` inside `AuthGate`'s authed branch (only when signed in). The existing `<NotificationPermissionsBootstrap />` can be folded into the unified `NotificationsBootstrap`.

## Push-key migration plan (NOT in this PR — pre-conditions only)

Brad's manual one-time setup is documented in [`BRIEF.md`](./BRIEF.md) § Push-credentials migration plan. The frontend agent does NOT touch credentials. Before running SMOKE_TEST:

1. Confirm `eas credentials --platform ios` shows an APNs Auth Key under Expo project `255d542d-8dae-43c9-8d98-d9a3a325a470`.
2. Confirm `eas credentials --platform android` shows FCM credentials.
3. Confirm the `send-push-notification` Edge Function is deployed in the legacy Supabase project.
4. Confirm `app.settings.service_role_key` is set in the Supabase DB.

If any are missing, surface in PR review BEFORE running the smoke test. **Do NOT create or commit any key material in this PR.**

## Quality gates

```bash
bun run prettier:check    # format
bun run typecheck          # TypeScript strict
bun run lint               # ESLint (zero errors; warnings tolerated if pre-existing)
bun run build              # all packages
bun --filter @persistence/mobile test:unit   # 90% global aggregate non-negotiable
```

Total mobile test count after M7: target +80–110 tests from current baseline.

## Files you will touch

```
packages/mobile/package.json                                                         # add expo-device if missing (transitive likely; verify)
packages/mobile/app/_layout.tsx                                                       # fold tap handler + device-reg into bootstrap
packages/mobile/app/(app)/notifications.tsx                                           # new screen wrapper
packages/mobile/app/(app)/notification-preferences.tsx                                # new screen wrapper
packages/mobile/app/(app)/(tabs)/_layout.tsx                                          # bell-icon badge in header
packages/mobile/src/domain/
  models/notification.ts                                                              # new
  models/__tests__/notification.test.ts                                                # new
  services/notificationService.ts                                                     # new
  services/__tests__/notificationService.test.ts                                       # new
  ports/api.port.ts                                                                   # extend with 6 methods
packages/mobile/src/adapters/
  api/sst-api.adapter.ts                                                              # extend
  api/__tests__/sst-api.adapter.test.ts                                                # extend
  api/__tests__/in-memory-api.adapter.ts                                               # extend
  notifications/expo-notifications.adapter.ts                                         # replace getDevicePushToken stub
  notifications/__tests__/expo-notifications.adapter.test.ts                          # extend
  storage/sqlite.adapter.ts                                                            # add cached_notifications + StoragePort methods
  storage/__tests__/sqlite.adapter.test.ts                                              # extend
  storage/__tests__/in-memory-storage.adapter.ts                                         # extend
packages/mobile/src/ui/
  hooks/useNotifications.tsx                                                            # new
  hooks/useNotificationPreferences.tsx                                                  # new
  hooks/useMarkNotificationRead.tsx                                                     # new
  hooks/useMarkAllNotificationsRead.tsx                                                 # new
  hooks/useUnreadCount.tsx                                                              # new
  hooks/useDeviceTokenRegistration.tsx                                                  # new
  hooks/useNotificationTapHandler.tsx                                                   # new
  hooks/__tests__/*.test.tsx                                                             # new
  components/notifications/NotificationItem.tsx                                          # new
  components/notifications/NotificationBadge.tsx                                         # new
  components/notifications/NotificationPreferenceRow.tsx                                 # new
  components/notifications/EmptyNotifications.tsx                                        # new
  components/notifications/__tests__/*.test.tsx                                          # new
  containers/NotificationListContainer.tsx                                              # new
  containers/NotificationPreferencesContainer.tsx                                       # new
  containers/__tests__/*.test.tsx                                                        # new
  presenters/NotificationListPresenter.tsx                                              # new
  presenters/NotificationPreferencesPresenter.tsx                                       # new
  presenters/__tests__/*.test.tsx                                                        # new
  containers/ProfileContainer.tsx                                                       # extend with notification-preferences nav row
```

## Files you will NOT touch

- Anything under `microservices/` — backend agent's territory.
- The push trigger / Edge Function — out of repo + out of scope.
- `app.settings.service_role_key` row in Supabase — DO NOT query or reference.
- `infra/` — no SST changes.
- `packages/db/src/schema.ts` — backend agent owns the preferences-column addition.
- The existing `useNotificationPermissions` and the rest-timer surface — both M3-shipped, M7 leaves them as-is.

## Legacy reference paths

Read each in legacy `persistence-mobile/`. Port flows + UI patterns 1:1; don't copy architecture.

| Legacy file (approximate path — verify on opening)                                       | What it tells you                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/(tabs)/profile.tsx` or `app/notifications.tsx`                                       | Notification list screen layout — header, list, mark-all CTA placement, empty state.                                                                                                                                                                          |
| `components/notifications/NotificationItem.tsx`                                          | Single-row layout, icon mapping per `NotificationType`, timestamp format, unread accent.                                                                                                                                                                       |
| `components/notifications/NotificationBadge.tsx` (or similar)                            | Bell-icon + count overlay styling; cap behaviour ("99+" vs raw).                                                                                                                                                                                              |
| `app/notification-preferences.tsx` or `app/settings/notifications.tsx`                   | Preferences screen — section list grouping, toggle styling, save indicator.                                                                                                                                                                                   |
| `hooks/useRegisterPushNotifications.ts`                                                  | Push-token registration flow — which Expo API call (`getDevicePushTokenAsync` vs `getExpoPushTokenAsync`), idempotency, retries, error handling. **Authoritative for M7's device-registration shape.**                                                       |
| `hooks/api/useGetNotifications.ts`                                                       | The legacy notifications query — pagination, refresh behaviour, cache key.                                                                                                                                                                                    |
| `hooks/api/usePostMarkNotificationRead.ts`                                                | Mark-read mutation shape — does legacy do single + all separately, or share an endpoint?                                                                                                                                                                       |
| `hooks/api/usePostNotificationPreferences.ts` or `useGetNotificationPreferences.ts`       | Preferences read/write — confirms the full-replace POST shape M7 ships.                                                                                                                                                                                       |
| `lib/supabase/queries/notificationQueries.ts` (or similar)                                | Direct Supabase queries (replaced by V2 ApiPort methods) — useful for validation rules and edge-case handling.                                                                                                                                                |
| `utils/dateFormatters.ts` or `utils/timestampHelpers.ts`                                  | Relative timestamp helper — port the same formula.                                                                                                                                                                                                            |
| `app/_layout.tsx`                                                                        | Where legacy mounts the tap handler + permission prompt + token registration. Confirms wiring order.                                                                                                                                                            |
| `eas.json` / `app.json`                                                                  | Confirm the Expo project ID + bundle ID + notification plugin config match V2's `app.json`. If a config differs (e.g. legacy uses a different `expo-notifications` icon), note in PR — don't change V2 silently.                                              |

**Crucial:** while reading legacy, list explicitly in PR description which files were referenced, with line ranges. Brad reviews against these in the smoke pass.

## Inspector Brad expectations

Substantive sweep findings will concentrate on:

- Deep-link validation bypass (untrusted `data.deepLink` strings) — every `router.push` call from a notification must pass `isValidDeepLink`.
- Cold-start tap handling — `getLastNotificationResponseAsync` MUST be called on mount in addition to `addNotificationResponseReceivedListener`. Easy to miss.
- Device-token idempotency — AsyncStorage flag must be keyed per `userId` so a sign-out + sign-in-as-different-user re-registers. The flag MUST NOT live on a session-scoped storage that survives across users.
- Mark-read sync-queue replays — the backend's mark-read handler is idempotent; the mobile must not retry mismatched payloads (e.g. trying to mark-read a notification id the server already deleted) infinitely. Cap retries via the existing sync-queue policy.
- Bell-icon badge count drift — `unreadCount` from server + cached count from SQLite must reconcile. Don't let the badge show "0" when the cache says 3.
- Trigger contract — confirm `profiles.notification_preferences` writes do not invalidate other caches (subscription, profile-page) — they shouldn't, but verify in the test for the mutation hook.
- `expo-device` permission / privacy — `deviceInfo` includes model + OS; check legacy's `Info.plist` / `AndroidManifest` doesn't already require an extra entitlement we'd need to mirror.

TRACE before patching. Same protocol as backend. State the exact code reading + reproduction sequence in commit messages.

## When you finish

- Tests pass with 90% global aggregate.
- `gh pr create` against `main` with the M7 reference and SMOKE_TEST link in the description.
- Wait for Brad to fire `@inspector-brad` — do not pre-empt.
- After fixes land, surface a `(finding, severity, patch)` summary table.

## Frontend-design polish — DEFERRED to M11

Port 1:1 in M7. Brad will run `/frontend-design` over the notifications surface in M11 polish. Do not pre-empt that pass in M7.
