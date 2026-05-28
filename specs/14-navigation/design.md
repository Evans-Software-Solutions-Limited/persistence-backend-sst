# 14 — Navigation: Design

> **New spec, authored 2026-05-27.** Pairs with `requirements.md` (same date).

---

## Architecture overview

```
packages/mobile/
├── app/
│   ├── _layout.tsx                ← root: deep-link redirect map, AdapterProvider, useUserMode rehydration
│   ├── (app)/
│   │   ├── _layout.tsx            ← mounts <ProfileDrawer> (composition: 08-profile-settings) + <ActiveWorkoutOverlay> (composition: 05-active-session)
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx        ← <TabsLayout> — reads useUserMode, swaps tab spec, passes mode to <TabBar>
│   │   │   ├── index.tsx          ← Home (athlete) | Coach Home (coach) — content: 06 / 10
│   │   │   ├── train.tsx          ← <TrainHubContainer> with <Segmented>; content: 04
│   │   │   ├── fuel.tsx           ← <ComingSoon/> until 13 ships
│   │   │   ├── you.tsx            ← Progress/You; content: 06
│   │   │   ├── clients.tsx        ← <ComingSoon/> until 10 ships
│   │   │   └── programs.tsx       ← <ComingSoon/> until 10 ships
│   │   └── … (workouts/, session/, exercises/, profile/ subroutes unchanged in structure)
│   └── (auth)/                    ← unchanged
└── src/
    └── state/
        ├── user-mode.ts           ← useUserMode Zustand slice + AsyncStorage rehydration
        ├── drawer.ts              ← useDrawer Zustand slice
        └── __tests__/
```

Routes that used to exist (`(tabs)/progress.tsx`, `(tabs)/workouts.tsx`, `(tabs)/exercises.tsx`, `(tabs)/profile.tsx`) are deleted or repurposed. Their content moves under the new tabs (`you`, `train` segments, drawer) per the route-migration table below.

---

## Mode-state slice — `src/state/user-mode.ts`

```ts
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "persistence.userMode";
const VALID_MODES = ["athlete", "coach"] as const;
type UserMode = (typeof VALID_MODES)[number];

interface UserModeState {
  mode: UserMode;
  isTrainerEligible: boolean;
  switchTo: (next: UserMode) => Promise<void>;
  setEligibility: (eligible: boolean) => void;
  rehydrate: () => Promise<void>;
}

export const useUserMode = create<UserModeState>((set, get) => ({
  mode: "athlete",
  isTrainerEligible: false,

  switchTo: async (next) => {
    const { isTrainerEligible } = get();
    if (next === "coach" && !isTrainerEligible) {
      console.warn(
        "[user-mode] switchTo(coach) called when not eligible — ignored",
      );
      return;
    }
    set({ mode: next });
    await AsyncStorage.setItem(STORAGE_KEY, next);
  },

  setEligibility: (eligible) => {
    const { mode } = get();
    set({ isTrainerEligible: eligible });
    // Force fall-back to athlete if eligibility lost while in coach mode.
    if (!eligible && mode === "coach") {
      set({ mode: "athlete" });
      AsyncStorage.setItem(STORAGE_KEY, "athlete").catch(() => {});
    }
  },

  rehydrate: async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored && (VALID_MODES as readonly string[]).includes(stored)) {
        set({ mode: stored as UserMode });
      }
    } catch (err) {
      console.warn("[user-mode] rehydrate failed", err);
    }
  },
}));
```

### Eligibility wiring

`isTrainerEligible` is fed by the existing `useGetUserSubscription` hook. The integration sits in `app/_layout.tsx`:

```tsx
export default function RootLayout() {
  const subQuery = useGetUserSubscription();
  const setEligibility = useUserMode((s) => s.setEligibility);
  const rehydrate = useUserMode((s) => s.rehydrate);

  useEffect(() => {
    rehydrate();
  }, []);

  useEffect(() => {
    if (subQuery.data) {
      setEligibility(subQuery.data.isTrainerTier ?? false);
    }
  }, [subQuery.data?.isTrainerTier]);

  return <Stack>…</Stack>;
}
```

When subscription cache is still resolving (`subQuery.data === undefined`), `isTrainerEligible` stays `false` — same conservative default as the current V2 `(tabs)/_layout.tsx`. Trainer users see their coach affordances appear once `useGetUserSubscription` resolves; this lag is acceptable per the M10.5 W2 brief precedent.

---

## Drawer-state slice — `src/state/drawer.ts`

```ts
import { create } from "zustand";

interface DrawerState {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

export const useDrawer = create<DrawerState>((set) => ({
  open: false,
  openDrawer: () => set({ open: true }),
  closeDrawer: () => set({ open: false }),
}));
```

No AsyncStorage. Cold-start always has the drawer closed.

---

## `<TabsLayout>` — mode-aware tab routing

```tsx
// app/(app)/(tabs)/_layout.tsx
import { Tabs } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUserMode } from "~/state/user-mode";
import { TabBar } from "~/ui/components/foundation";
import {
  IconHome,
  IconDumbbell,
  IconApple,
  IconChart,
  IconUsers,
  IconLayers,
} from "~/ui/components/icons";

const ATHLETE_TABS = [
  { id: "index", name: "index", label: "Home", icon: IconHome },
  { id: "train", name: "train", label: "Train", icon: IconDumbbell },
  { id: "fuel", name: "fuel", label: "Fuel", icon: IconApple },
  { id: "you", name: "you", label: "You", icon: IconChart },
] as const;

const COACH_TABS = [
  { id: "index", name: "index", label: "Home", icon: IconHome },
  { id: "clients", name: "clients", label: "Clients", icon: IconUsers },
  { id: "programs", name: "programs", label: "Programs", icon: IconLayers },
  { id: "you", name: "you", label: "You", icon: IconChart },
] as const;

export default function TabsLayout() {
  const mode = useUserMode((s) => s.mode);
  const insets = useSafeAreaInsets();
  const tabs = mode === "coach" ? COACH_TABS : ATHLETE_TABS;

  return (
    <Tabs
      screenOptions={{
        tabBar: (props) => (
          <TabBar
            tabs={tabs.map((t) => ({
              id: t.name,
              icon: t.icon,
              label: t.label,
            }))}
            active={props.state.routeNames[props.state.index]}
            onChange={(id) => props.navigation.navigate(id)}
            mode={mode}
          />
        ),
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ headerShown: false }}
        />
      ))}
      {/* Non-active mode routes still registered for deep-link compat */}
      {mode === "athlete" && (
        <Tabs.Screen name="clients" options={{ href: null }} />
      )}
      {mode === "athlete" && (
        <Tabs.Screen name="programs" options={{ href: null }} />
      )}
      {mode === "coach" && (
        <Tabs.Screen name="train" options={{ href: null }} />
      )}
      {mode === "coach" && <Tabs.Screen name="fuel" options={{ href: null }} />}
    </Tabs>
  );
}
```

The `<TabBar>` foundation primitive owns all visual concerns (glass blur, accent shift, COACH chrome dot, active pill animation). This layout owns only the routing tree.

### Route registration pattern

All six tab routes (`index`, `train`, `fuel`, `you`, `clients`, `programs`) stay registered as `<Tabs.Screen>` regardless of mode. The mode determines which are VISIBLE (`href: null` hides the icon while keeping the route navigable from deep links + programmatic `router.replace()`). This is the same pattern V2 uses today for the M10.5 W2 Clients tab gating, generalised.

---

## Route migration table

| Legacy V2 path                   | New path                                                                             | Notes                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `app/(app)/(tabs)/index.tsx`     | `app/(app)/(tabs)/index.tsx`                                                         | Renders Home (athlete) or Coach Home (coach) — branch on `useUserMode().mode`. Containers in 06 / 10. |
| `app/(app)/(tabs)/progress.tsx`  | **DELETED** — content moves to `app/(app)/(tabs)/you.tsx`                            | Owned by `06-progress-goals`                                                                          |
| `app/(app)/(tabs)/workouts.tsx`  | **DELETED** — content moves under `app/(app)/(tabs)/train.tsx` Segmented `Workouts`  | Owned by `04-workout-management`                                                                      |
| `app/(app)/(tabs)/exercises.tsx` | **DELETED** — content moves under `app/(app)/(tabs)/train.tsx` Segmented `Exercises` | Owned by `04-workout-management`                                                                      |
| `app/(app)/(tabs)/profile.tsx`   | **DELETED** — content moves to `<ProfileDrawer>` mounted at `(app)/_layout.tsx`      | Owned by `08-profile-settings`                                                                        |
| `app/(app)/(tabs)/clients.tsx`   | `app/(app)/(tabs)/clients.tsx`                                                       | Coach-mode only. `<ComingSoon/>` until M8. Owned by `10-trainer-features`                             |
| (new)                            | `app/(app)/(tabs)/train.tsx`                                                         | `<TrainHubContainer>` with Segmented                                                                  |
| (new)                            | `app/(app)/(tabs)/fuel.tsx`                                                          | `<ComingSoon/>` until M9                                                                              |
| (new)                            | `app/(app)/(tabs)/you.tsx`                                                           | Renders Progress (athlete) or Coach You (coach). Containers in 06 / 10                                |
| (new)                            | `app/(app)/(tabs)/programs.tsx`                                                      | Coach-mode only. `<ComingSoon/>` until M8                                                             |

Sub-routes under `(app)/workouts/`, `(app)/exercises/`, `(app)/session/`, `(app)/profile/` keep their existing structure — they're push-nav targets from within the tabs, not tab roots themselves.

---

## `<TrainHubContainer>` — Segmented composition

```tsx
// packages/mobile/src/ui/containers/TrainHubContainer.tsx
import { Segmented, HeaderBar, IconBtn } from "~/ui/components/foundation";
import { IconSearch, IconPlus } from "~/ui/components/icons";
import { WorkoutsListContainer } from "./WorkoutsListContainer";
import { ExerciseListContainer } from "./ExerciseListContainer";
import { useSegment } from "~/ui/hooks/useTrainSegment";

export function TrainHubContainer() {
  const [segment, setSegment] = useSegment();
  return (
    <Stack>
      <HeaderBar
        large
        eyebrow="TRAIN"
        title={segment === "Workouts" ? "Workouts" : "Exercises"}
        trailing={
          segment === "Exercises" ? (
            <Btn
              variant="soft"
              tone="primary"
              size="sm"
              icon={<IconPlus size={14} />}
              onPress={() => router.push("/exercises/create")}
            >
              Create
            </Btn>
          ) : (
            <IconBtn
              icon={<IconSearch size={18} />}
              tone="ghost"
              onPress={openSearch}
            />
          )
        }
      />
      <Segmented
        options={["Workouts", "Exercises"]}
        value={segment}
        onChange={setSegment}
      />
      {segment === "Workouts" ? (
        <WorkoutsListContainer />
      ) : (
        <ExerciseListContainer />
      )}
    </Stack>
  );
}
```

`useTrainSegment` is a thin hook around AsyncStorage:

```ts
// packages/mobile/src/ui/hooks/useTrainSegment.ts
const KEY = "persistence.train.segment";

export function useTrainSegment(): [
  "Workouts" | "Exercises",
  (next: "Workouts" | "Exercises") => void,
] {
  const [segment, setSegment] = useState<"Workouts" | "Exercises">("Workouts");

  useEffect(() => {
    AsyncStorage.getItem(KEY).then((v) => {
      if (v === "Workouts" || v === "Exercises") setSegment(v);
    });
  }, []);

  const update = useCallback((next: "Workouts" | "Exercises") => {
    setSegment(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  return [segment, update];
}
```

The container's children (`WorkoutsListContainer`, `ExerciseListContainer`) are existing V2 containers that get re-pointed under the hub. Their internals are owned by `04-workout-management`.

---

## `<ProfileDrawer>` mount-point

```tsx
// app/(app)/_layout.tsx
import { Stack } from "expo-router";
import { ProfileDrawerContainer } from "~/ui/containers/ProfileDrawerContainer";
import { ActiveWorkoutOverlay } from "~/ui/containers/ActiveWorkoutOverlay";
import { useDrawer } from "~/state/drawer";

export default function AppLayout() {
  const drawerOpen = useDrawer((s) => s.open);

  return (
    <>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        {/* push-nav routes */}
        <Stack.Screen
          name="workouts/[id]/index"
          options={{ presentation: "card" }}
        />
        … (existing sub-route stack entries preserved)
      </Stack>
      {drawerOpen && <ProfileDrawerContainer />}
      <ActiveWorkoutOverlay /> {/* owned by 05-active-session */}
    </>
  );
}
```

`<ProfileDrawerContainer>` is owned by `08-profile-settings`. The mount + state-driven visibility is owned here.

---

## Avatar trigger pattern

Every screen header uses `<HeaderBar leading={...}>` with an avatar that opens the drawer. The pattern that lives in screen specs:

```tsx
import { useDrawer } from "~/state/drawer";
import { useGetUserProfile } from "~/ui/hooks/useGetUserProfile";
import { Avatar, HeaderBar } from "~/ui/components/foundation";

const openDrawer = useDrawer((s) => s.openDrawer);
const profile = useGetUserProfile();

<HeaderBar
  large
  eyebrow="…"
  title="…"
  leading={
    <Avatar
      initials={profile.data?.initials ?? "–"}
      tone="primary"
      onPress={openDrawer}
      accessibilityLabel="Open profile menu"
    />
  }
/>;
```

Each screen's owning spec wires its header accordingly. This spec ensures the slot + hook exist; per-screen wiring is downstream work.

---

## Deep-link redirect map

```ts
// app/_layout.tsx
import { useEffect } from "react";
import { Linking } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useDrawer } from "~/state/drawer";

const LEGACY_REDIRECTS: Record<string, () => void> = {
  "/workouts": () => {
    AsyncStorage.setItem("persistence.train.segment", "Workouts").catch(
      () => {},
    );
    router.replace("/(app)/(tabs)/train");
  },
  "/exercises": () => {
    AsyncStorage.setItem("persistence.train.segment", "Exercises").catch(
      () => {},
    );
    router.replace("/(app)/(tabs)/train");
  },
  "/progress": () => router.replace("/(app)/(tabs)/you"),
  "/profile": () => {
    router.replace("/(app)/(tabs)/you");
    useDrawer.getState().openDrawer();
  },
};

useEffect(() => {
  const sub = Linking.addEventListener("url", ({ url }) => {
    const { pathname } = new URL(url);
    const handler = LEGACY_REDIRECTS[pathname];
    if (handler) handler();
  });
  return () => sub.remove();
}, []);
```

Lifespan: 6 months from the Phase 2 nav-restructure ship date. Phase 5 cleanup (`12-production-readiness`) removes the map.

---

## Tab bar safe-area + ActiveWorkoutBar interaction

Tab bar visual height: 60pt (per `<TabBar>` content) + `insets.bottom` padding.

When `useActiveWorkout().workout !== null && expanded === false`, the `<ActiveWorkoutBar>` (owned by `05-active-session`) floats at `bottom: tabBarHeight + 12`. The bar overlaps content but not the tab bar itself.

When the active-workout overlay is expanded, the tab bar is hidden (the overlay covers the entire screen). The overlay re-shows the tab bar on minimise.

---

## Mode-switch animation

When `switchTo('coach' | 'athlete')` fires:

1. The mode-switch button calls `closeDrawer()` then `switchTo(next)`.
2. The drawer closes via its standard 250ms slide-down.
3. `<TabBar>`'s accent shifts from `$primary` to `$accentTrainer` (or vice versa) via Reanimated 3 `withTiming` (200ms cubic-bezier `0.2, 0.7, 0.2, 1`) on the active-tab pill colour + label colour interpolations.
4. `<TabsLayout>` re-renders with the new tab spec; the new tabs cross-fade in over 200ms (foundation `<TabBar>` primitive handles the inner animation; the route swap is instant per Expo Router).
5. User lands on whichever tab was active (mapped: `index → index`, `train → clients`, `fuel → programs`, `you → you`) — the "translate me to the equivalent tab in the new mode" mapping is owned by this spec.

If the active tab doesn't have a mapping (e.g. user was on `train` and switches to coach, `train` doesn't exist), default to `index` (Home).

---

## Testing strategy

### `useUserMode` slice (unit tests)

- Default state: `mode === 'athlete'`, `isTrainerEligible === false`.
- `switchTo('coach')` when `isTrainerEligible === true`: state updates, AsyncStorage written.
- `switchTo('coach')` when `isTrainerEligible === false`: no-op, warning logged.
- `setEligibility(false)` while `mode === 'coach'`: forces `mode → 'athlete'`.
- `rehydrate()` reads valid value from AsyncStorage → state updates; invalid/missing value → default `'athlete'` preserved.

### `useDrawer` slice (unit tests)

- Default `open: false`, `openDrawer()` sets `true`, `closeDrawer()` sets `false`.
- No persistence — restart simulation always cold-starts closed.

### `useTrainSegment` hook (unit tests)

- Initial render: AsyncStorage read; default `'Workouts'` if missing.
- `setSegment(next)`: state + AsyncStorage both updated.

### `<TabsLayout>` (component test)

- Mock `useUserMode` with `mode: 'athlete'` → 4 tabs render with `IconHome`, `IconDumbbell`, `IconApple`, `IconChart` icons.
- Mock with `mode: 'coach'` → 4 tabs render with `IconHome`, `IconUsers`, `IconLayers`, `IconChart`.
- Switch mock from athlete to coach → tab spec re-renders without crashing.

### Deep-link redirects (integration test)

- Fire each entry in `LEGACY_REDIRECTS`; assert `router.replace` called with the expected new path + AsyncStorage write for segment cases.

### Mode-switch flow (e2e — manual)

- Set up trainer-tier user in coach mode → drawer open → tap "Switch to Athlete" → drawer closes → tab bar accent fades cyan → tab spec swaps → land on Home.
- Set up athlete user → drawer open → mode-switch card NOT visible (because `isTrainerEligible === false`).

---

## Backend impact

**None.** This is mobile-only navigation work. No SST routes, no Drizzle migrations, no Supabase changes. All gating reads from the existing `useGetUserSubscription` hook.

---

## Risks + mitigations

| Risk                                                                                                                                                                    | Mitigation                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<TabBar>` primitive lands in `01-design-system` but doesn't render correctly inside Expo Router's `<Tabs>` (e.g. event handling mismatch)                              | Validate during Phase 1.3 T-1.3.10 (TabBar primitive PR) by integrating into a smoke-test layout. If blocking, the layout falls back to Expo Router's default tab bar styled to approximate the prototype until the primitive is fixed. |
| Drawer-state Zustand slice + Expo Router `<Stack>` overlay don't play nicely (z-index, gesture handler conflict)                                                        | `<ProfileDrawerContainer>` mounts INSIDE the `<Stack>` parent in `(app)/_layout.tsx` so it can overlay the tab tree while staying under modal-stack pushes. `@gorhom/bottom-sheet` v4 handles gesture conflicts internally.             |
| Mode-switch mid-screen causes navigation tree to swap while the user is on a screen that doesn't exist in the new mode (e.g. on Train → switch to Coach → no Train tab) | Mode-switch handler explicitly remaps the active tab via the table in `§ Mode-switch animation`. Default fallback: navigate to `index` (Home).                                                                                          |
| Deep-link redirect map shadows future legitimate `/workouts` route reuse                                                                                                | 6-month window per migration plan. After window, the map is deleted by Phase 5 cleanup.                                                                                                                                                 |
| Subscription cache resolution lag causes the user to see athlete tabs briefly when they're actually a trainer                                                           | Same as V2's current behaviour with `href: null`. Accepted per M10.5 W2 brief precedent. Tab spec stays athlete-only until `setEligibility(true)` resolves; user can manually `switchTo('coach')` once it does.                         |

---

_End of `14-navigation/design.md` · 2026-05-27_
