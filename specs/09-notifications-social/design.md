# 09 — Notifications & Social: Design

> **Spec rewritten from scratch on 2026-05-28.** Pairs with `requirements.md`.

---

## Architecture overview

Backend already shipped (PR #81). This spec adds the mobile frontend + an ongoing migration ownership for new notification types.

```
microservices/core/src/application/notifications/    ← already shipped per PR #81
├── handlers/
│   ├── register-device.ts
│   ├── list-notifications.ts
│   ├── mark-read.ts
│   ├── mark-all-read.ts
│   ├── get-preferences.ts
│   └── post-preferences.ts
└── services/
    └── merge-preferences.ts                    ← mergeNotificationPreferences (atomic JSONB ||)

packages/mobile/
├── app/(app)/
│   ├── (tabs)/
│   │   └── index.tsx                          ← <HomeHeader> with bell mount-point (06)
│   ├── notifications.tsx                       ← NEW route
│   └── profile/
│       └── notifications.tsx                   ← NEW route
└── src/
    ├── application/
    │   └── notifications/                     ← NEW domain layer
    │       ├── commands/
    │       │   ├── mark-read.command.ts
    │       │   ├── mark-all-read.command.ts
    │       │   └── update-preferences.command.ts
    │       └── queries/
    │           ├── list-notifications.query.ts
    │           ├── unread-count.query.ts
    │           └── preferences.query.ts
    ├── domain/
    │   ├── models/
    │   │   ├── notification.ts
    │   │   └── notification-preferences.ts
    │   └── ports/api.port.ts                  ← extensions
    ├── adapters/
    │   ├── api/notifications.adapter.ts
    │   ├── storage/notifications.sqlite.ts    ← cache (100-row LRU)
    │   └── notifications/expo-notifications.adapter.ts  ← push registration + listener
    └── ui/
        ├── containers/
        │   ├── NotificationsListContainer.tsx
        │   ├── NotificationPreferencesContainer.tsx
        │   └── HomeBellContainer.tsx          ← mounts inside HomeHeader from 06
        └── presenters/
            ├── NotificationsListPresenter.tsx
            ├── NotificationPreferencesPresenter.tsx
            ├── NotificationRowPresenter.tsx
            └── HomeBellPresenter.tsx
```

---

## Backend reference — already shipped (PR #81)

| Method | Path                              | Behaviour                                                                                                      |
| ------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------- | --- | --------------------------------------------------------- |
| POST   | `/devices/register`               | Body `{ token: string; platform: 'ios' \| 'android' }`. Idempotent upsert by `(user_id, platform)`.            |
| GET    | `/notifications?cursor=&limit=20` | List, ordered `created_at desc`. Returns `{ rows: Notification[]; nextCursor?: string; unreadCount: number }`. |
| PATCH  | `/notifications/:id`              | Mark read. Uses `COALESCE(read_at, NOW())` so sync-queue replay preserves original moment.                     |
| PATCH  | `/notifications/all`              | Mark all read.                                                                                                 |
| GET    | `/notifications/preferences`      | Returns the `profiles.notification_preferences` JSONB column.                                                  |
| POST   | `/notifications/preferences`      | Body is a partial preferences object. Merges via `mergeNotificationPreferences` (`notification_preferences     |     | $newPartial`). Returns the merged column via `RETURNING`. |

Spec for these endpoints is already in `09-notifications-social/design.md` (pre-rewrite) — the rewrite preserves the contract; PRs against the new spec must cite the existing handler files at `microservices/core/src/application/notifications/`.

**Notification table** (shipped):

```sql
notifications (
  id              uuid PK
  user_id         uuid FK profiles
  type            notification_type ENUM
  title           text
  body            text
  data            jsonb       -- includes deepLink + type-specific payload
  read_at         timestamptz NULL
  created_at      timestamptz default now()
)
```

---

## Frontend — domain models

```ts
type NotificationType =
  | "streak_milestone"
  | "streak_at_risk"
  | "freeze_token_applied"
  | "goal_milestone"
  | "goal_assigned_by_trainer"
  | "workout_assigned"
  | "workout_logged_on_behalf"
  | "measurement_logged_on_behalf"
  | "nutrition_target_set_by_trainer"
  | "nutrition_entry_logged_on_behalf" // M9.5+
  | "daily_nutrition_target_hit";

type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink: string;
  data: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
};

type NotificationPreferences = Partial<Record<NotificationType, boolean>>;
```

Source-of-truth enum: `_shared/cross-cuts.md § 5` table. Adding a new type means a coordinated update to both the cross-cuts table + this domain enum + a Drizzle migration extending the Postgres `notification_type` enum.

---

## Frontend — `<NotificationsListPresenter>`

```ts
type NotificationsListProps = {
  groups: {
    label: "Today" | "Yesterday" | "This Week" | "Older";
    notifications: Notification[];
  }[];
  unreadCount: number;
  isLoading: boolean;
  error: Error | null;
  onTap: (notif: Notification) => void;
  onMarkAllRead: () => void;
  onRefresh: () => Promise<void>;
  onLoadMore?: () => void; // pagination
};
```

Layout:

```tsx
<Stack flex={1} bg="$bg">
  <HeaderBar
    large
    title="Notifications"
    eyebrow={`${unreadCount} UNREAD`}
    trailing={
      <IconBtn
        icon={<IconCheck size={18} />}
        tone="ghost"
        onPress={onMarkAllRead}
      />
    }
  />
  <FlashList
    data={flattenedRowsWithSectionHeaders(groups)}
    renderItem={({ item }) =>
      item.type === "section" ? (
        <Section title={item.label} />
      ) : (
        <NotificationRowPresenter
          notification={item.notification}
          onPress={() => onTap(item.notification)}
        />
      )
    }
    refreshControl={
      <RefreshControl refreshing={isLoading} onRefresh={onRefresh} />
    }
    estimatedItemSize={64}
    onEndReached={onLoadMore}
    onEndReachedThreshold={0.5}
  />
</Stack>
```

---

## `<NotificationRowPresenter>` — spec-local composite

```ts
type NotificationRowProps = {
  notification: Notification;
  onPress: () => void;
};
```

Layout: 36×36 icon tile (tone derived from `type`) + title (`$display.h3`) + body (`$body.md`, 2 lines max with ellipsis) + relative time (`$mono` 11pt) + trailing chevron. Unread → `$primaryDim` background. Icon mapping:

```ts
function notificationIcon(type: NotificationType): { icon: ReactNode; tone: PillTone } {
  switch (type) {
    case 'streak_milestone':                return { icon: <IconFlame/>, tone: 'ember' };
    case 'streak_at_risk':                  return { icon: <IconBell/>, tone: 'gold' };       // <Pill> tone union has no 'warning' — gold matches the urgency-without-failure semantic
    case 'freeze_token_applied':            return { icon: <IconDroplet/>, tone: 'primary' };
    case 'goal_milestone':                  return { icon: <IconTarget/>, tone: 'primary' };
    case 'goal_assigned_by_trainer':        return { icon: <IconTarget/>, tone: 'trainer' };
    case 'workout_assigned':                return { icon: <IconDumbbell/>, tone: 'trainer' };
    case 'workout_logged_on_behalf':        return { icon: <IconDumbbell/>, tone: 'trainer' };
    case 'measurement_logged_on_behalf':    return { icon: <IconChart/>, tone: 'trainer' };
    case 'nutrition_target_set_by_trainer': return { icon: <IconApple/>, tone: 'trainer' };
    case 'nutrition_entry_logged_on_behalf':return { icon: <IconApple/>, tone: 'trainer' };
    case 'daily_nutrition_target_hit':      return { icon: <IconApple/>, tone: 'success' };
  }
}
```

Lives at `packages/mobile/src/ui/components/notifications/NotificationRow/`.

---

## Frontend — `<NotificationPreferencesPresenter>`

```ts
type NotificationPreferencesProps = {
  preferences: NotificationPreferences;
  onToggle: (type: NotificationType, enabled: boolean) => Promise<void>;
};
```

Layout: scrollable list of `<Section>`s by category. Each section contains `<DrawerRow>`s (from `01-design-system`) with a Switch in the trailing slot.

Category groupings:

```ts
const CATEGORIES: { title: string; types: NotificationType[] }[] = [
  {
    title: "Streaks & Achievements",
    types: ["streak_milestone", "streak_at_risk", "freeze_token_applied"],
  },
  { title: "Goals", types: ["goal_milestone", "goal_assigned_by_trainer"] },
  {
    title: "Trainer actions",
    types: [
      "workout_assigned",
      "workout_logged_on_behalf",
      "measurement_logged_on_behalf",
      "nutrition_target_set_by_trainer",
      "nutrition_entry_logged_on_behalf",
    ],
  },
  { title: "Nutrition", types: ["daily_nutrition_target_hit"] },
];

const DEFAULT_OPT_IN: NotificationPreferences = {
  streak_milestone: true,
  streak_at_risk: true,
  freeze_token_applied: true,
  goal_milestone: true,
  goal_assigned_by_trainer: true,
  workout_assigned: true,
  workout_logged_on_behalf: true,
  measurement_logged_on_behalf: true,
  nutrition_target_set_by_trainer: true,
  nutrition_entry_logged_on_behalf: true,
  daily_nutrition_target_hit: false, // noisy — opt-in off per cross-cuts § 5
};
```

Toggle handler:

```ts
const onToggle = async (type: NotificationType, enabled: boolean) => {
  // Optimistic local update
  setPreferences((prev) => ({ ...prev, [type]: enabled }));
  // POST partial-merge payload
  const merged = await updatePreferences({ [type]: enabled });
  // Server returns the full merged column via RETURNING
  setPreferences(merged);
};
```

---

## Frontend — `<HomeBellPresenter>` + container

Mounts inside `<HomeHeader>` (per `06-progress-goals` STORY-002). The Home spec exposes a `leading` slot for the bell:

```tsx
// inside HomePresenter
<HomeHeader
  date={date}
  user={user}
  bell={<HomeBellContainer />} // mounted here
  avatar={<Avatar onPress={openDrawer} />}
/>
```

`<HomeBellContainer>`:

```tsx
export function HomeBellContainer() {
  const { data: { unreadCount = 0 } = {} } = useGetUnreadCount();
  return (
    <HomeBellPresenter
      unreadCount={unreadCount}
      onPress={() => router.push("/(app)/notifications")}
    />
  );
}
```

`<HomeBellPresenter>`:

```tsx
function HomeBellPresenter({ unreadCount, onPress }) {
  return (
    <View position="relative">
      <IconBtn icon={<IconBell size={18} />} tone="ghost" onPress={onPress} />
      {unreadCount > 0 && (
        <View
          position="absolute"
          top={-2}
          right={-2}
          minWidth={16}
          h={16}
          px={4}
          borderRadius={8}
          bg="$ember"
          alignItems="center"
          justifyContent="center"
        >
          <Text variant="mono" size={9} weight={700} color="$bg">
            {unreadCount > 9 ? "9+" : String(unreadCount)}
          </Text>
        </View>
      )}
    </View>
  );
}
```

---

## Push notification listener

```ts
// adapters/notifications/expo-notifications.adapter.ts
import * as Notifications from "expo-notifications";
import { router } from "expo-router";

export async function registerDeviceToken(userId: string) {
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return null;

  const tokenResult = await Notifications.getDevicePushTokenAsync();
  const token = tokenResult.data;
  await api.post("/devices/register", {
    token,
    platform: Platform.OS as "ios" | "android",
  });
  return token;
}

export function setupListeners() {
  // Notification received while app is foregrounded
  const receivedSub = Notifications.addNotificationReceivedListener((notif) => {
    // Refresh unread count cache
    queryClient.invalidateQueries(["notifications", "unread-count"]);
    queryClient.invalidateQueries(["notifications", "list"]);
  });

  // Notification tapped (cold-start or background)
  const responseSub = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      const deepLink = response.notification.request.content.data?.deepLink as
        | string
        | undefined;
      if (deepLink) router.push(deepLink as any);
    },
  );

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}
```

Wired in `app/_layout.tsx`:

```tsx
useEffect(() => {
  if (!session) return;
  registerDeviceToken(session.userId).catch(console.error);
  const cleanup = setupListeners();
  return cleanup;
}, [session]);
```

---

## Offline behaviour

| Action                     | Behaviour                                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List notifications         | Reads from SQLite cache (100-row LRU). Background refetch + pull-to-refresh.                                                                                         |
| Mark read / Mark all read  | Optimistic local update + sync queue write. `markRead` mutation respects PR #81 sweep 2: server uses `COALESCE(read_at, NOW())` so replay preserves original moment. |
| Update preferences         | Optimistic. Queue. Server responds with merged column via `RETURNING` — local cache reset to that on flush.                                                          |
| Device-token registration  | Online-only. Retries on next foreground if it failed.                                                                                                                |
| Push receipt while offline | Push won't arrive (it's a server-side delivery channel). On next reconnect + foreground, GET refresh picks up the missed notifications.                              |

---

## SQLite cache schema

```sql
CREATE TABLE IF NOT EXISTS cached_notifications (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  deep_link       TEXT NOT NULL,
  data_json       TEXT NOT NULL,
  read_at         TEXT,                -- ISO string or null
  created_at      TEXT NOT NULL
);
CREATE INDEX cached_notifications_created_idx ON cached_notifications (created_at DESC);
```

LRU enforcement: after every write, prune rows beyond row 100 (`ORDER BY created_at DESC LIMIT 100, -1`).

---

## Backend — enum-extension contract

When a downstream spec emits a NEW notification type, the migration lands HERE (per locked decision #10):

```sql
-- microservices/core/migrations/YYYYMMDDHHMMSS_add_notification_type_X.sql
ALTER TYPE notification_type ADD VALUE 'new_type_name';
```

Required companion changes:

1. Append row to `_shared/cross-cuts.md § 5` table with default opt-in + deep link.
2. Append entry to this spec's `NotificationType` union + `CATEGORIES` constant + `notificationIcon` switch.
3. Open a single PR titled `chore(notifications): register {new_type_name} event type` containing all three.

---

## Testing strategy

### Unit tests

- `<NotificationRowPresenter>` — every notification type renders the correct icon/tone.
- `<NotificationPreferencesPresenter>` — toggle invocation + optimistic UI + post-flush sync.
- `<HomeBellPresenter>` — badge count visibility, `9+` overflow, hidden when zero.
- `mergeNotificationPreferences` semantics (already covered by PR #81 tests; reference here).

### Integration tests

- Cold-start with seeded SQLite → list renders offline → reconnect → background refresh updates rows.
- Tap notification → mark-read fires + deep-link navigates.
- Preferences toggle offline → queue → reconnect → assert server merge + cache reset.
- Push receipt simulation (`Notifications.scheduleNotificationAsync` test) → tap → deep-link dispatch.

### Coverage

90% per `_agent.md`.

---

## Risks + mitigations

| Risk                                                                                                    | Mitigation                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Push permission denial blocks all notifications                                                         | Preferences screen surfaces "Notifications are off in iOS Settings — tap to open Settings" banner when `Notifications.getPermissionsAsync().granted === false`. |
| Unread count drifts from server (stale local cache)                                                     | `useGetUnreadCount` uses staleTime: 30s — refreshes on focus + on receive listener. Server-wins on every refresh.                                               |
| Adding a notification type to one location but not all three (cross-cuts table, this spec, migration)   | Locked decision #10 enforces a single PR shipping all three. PR review check.                                                                                   |
| Deep-link routes change in `14-navigation` (redirect map) — old notifications still reference old paths | `14-navigation` redirect map (preserved for 6 months) handles this transparently.                                                                               |
| Push payload bloat — `data` JSONB can grow over time                                                    | Keep `data` to type-specific identifiers + the deepLink. Heavy content (rendered text) lives in `title` + `body`.                                               |

---

_End of `09-notifications-social/design.md` · 2026-05-28 (rewritten from scratch)_
