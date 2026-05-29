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
  // True once `setEligibility` has been called at least once — i.e. the
  // subscription cache has resolved. Gates the invariant watchdog so a
  // default-`false` `isTrainerEligible` (pre-network) can't be mistaken for
  // a confirmed-`false` (post-network) and demote a legitimate trainer.
  isEligibilityKnown: boolean;
  switchTo: (next: UserMode) => Promise<void>;
  setEligibility: (eligible: boolean) => void;
  rehydrate: () => Promise<void>;
}

export const useUserMode = create<UserModeState>((set, get) => ({
  mode: "athlete",
  isTrainerEligible: false,
  isEligibilityKnown: false,

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
    // `isEligibilityKnown: true` marks the subscription cache as resolved —
    // gates the invariant watchdog so it doesn't react to the default-false
    // before the network answer comes in.
    set({ isTrainerEligible: eligible, isEligibilityKnown: true });
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
        // Restore the persisted mode verbatim — DO NOT consult
        // isTrainerEligible here. On cold launch, AsyncStorage.getItem
        // (~ms) almost always resolves before useGetUserSubscription
        // (100–1000ms network), so `isTrainerEligible` is still the
        // default `false` regardless of the user's real subscription
        // status. Branching on it would demote legitimate trainers to
        // athlete + persist the demotion to disk (worse failure mode
        // than the original race). The invariant watchdog in RootLayout
        // handles eligibility enforcement once the network resolves.
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
  const mode = useUserMode((s) => s.mode);
  const isTrainerEligible = useUserMode((s) => s.isTrainerEligible);

  useEffect(() => {
    rehydrate();
  }, []);

  useEffect(() => {
    if (subQuery.data) {
      setEligibility(subQuery.data.isTrainerTier ?? false);
    }
  }, [subQuery.data?.isTrainerTier]);

  // Invariant watchdog: re-asserts the invariant once the network has
  // resolved. The `isEligibilityKnown` gate is critical — without it the
  // effect fires on mount with the default `isTrainerEligible: false` and
  // demotes legitimate trainers to athlete the instant rehydrate restores
  // their `coach` mode (the network-says-true answer hasn't arrived yet).
  // Idempotent — running repeatedly is a no-op when the invariant holds.
  // switchTo handles the disk write internally + only gates eligibility on
  // coach switches, so switchTo("athlete") is always safe.
  const isEligibilityKnown = useUserMode((s) => s.isEligibilityKnown);
  const switchTo = useUserMode((s) => s.switchTo);
  useEffect(() => {
    if (isEligibilityKnown && mode === "coach" && !isTrainerEligible) {
      switchTo("athlete");
    }
  }, [mode, isTrainerEligible, isEligibilityKnown, switchTo]);

  // <LegacyRedirects/> (defined below in § Deep-link redirect map) MUST be a
  // SIBLING of <Stack>, not a child. expo-router's <Stack> renders only
  // <Stack.Screen> children, so dropping <LegacyRedirects/> inside it would
  // silently not render and every cold-start legacy deep link would land on
  // the 404 instead of redirecting.
  return (
    <>
      <Stack>…</Stack>
      <LegacyRedirects />
    </>
  );
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
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Btn, HeaderBar, IconBtn, Segmented } from "~/ui/components/foundation";
import { IconPlus, IconSearch } from "~/ui/components/icons";
import { WorkoutsListContainer } from "./WorkoutsListContainer";
import { ExerciseListContainer } from "./ExerciseListContainer";
import { CreateExerciseSheetContainer } from "./CreateExerciseSheetContainer";
import { useTrainSegment } from "~/ui/hooks/useTrainSegment";
// `openSearch` referenced below at the search IconBtn is a placeholder —
// real handler wired in 04 STORY-007 (open the search sheet over Train > Exercises).

export function TrainHubContainer() {
  // Zustand selectors — see useTrainSegment definition below.
  const segment = useTrainSegment((s) => s.segment);
  const setSegment = useTrainSegment((s) => s.setSegment);
  const pendingCreate = useTrainSegment((s) => s.pendingCreate);
  const clearPendingCreate = useTrainSegment((s) => s.clearPendingCreate);

  // CreateExerciseSheet is mounted locally rather than navigated to —
  // 04-workout-management § Sheet mount-point deletes (app)/exercises/create.tsx
  // and replaces the full-screen route with this bottom-sheet pattern.
  const [createSheetOpen, setCreateSheetOpen] = useState(false);

  // Legacy /exercises/create deep-links surface here via the redirect map below
  // (Phase 2 → 6-month shim). The redirect calls
  // useTrainSegment.getState().setPendingCreate(true) — this effect reads + clears
  // the flag once the hub mounts.
  useEffect(() => {
    if (pendingCreate) {
      setCreateSheetOpen(true);
      clearPendingCreate();
    }
  }, [pendingCreate, clearPendingCreate]);

  // NOTE: <View> from react-native, not <Stack> from expo-router. expo-router
  // Stack is a navigator (only renders <Stack.Screen> children); using it as a
  // layout container here would discard the body.
  return (
    <View style={{ flex: 1 }}>
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
              onPress={() => setCreateSheetOpen(true)}
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
      <CreateExerciseSheetContainer
        visible={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
      />
      {/* Sheet rendered last so the modal layer sits above the body content. */}
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
    </View>
  );
}
```

`useTrainSegment` is a Zustand store — gives us `.getState()` for the deep-link redirect to set `pendingCreate` without subscribing, and idiomatic selector reads inside React components. Matches the V2 state-primitive pattern (`useUserMode`, `useDrawer`, the active-workout slice).

```ts
// packages/mobile/src/ui/hooks/useTrainSegment.ts
import { create } from "zustand";
import AsyncStorage from "@react-native-async-storage/async-storage";

type TrainSegment = "Workouts" | "Exercises";

type TrainSegmentState = {
  segment: TrainSegment;
  pendingCreate: boolean; // one-shot flag set by /exercises/create deep-link redirect
  hydrated: boolean;
  setSegment: (next: TrainSegment) => void;
  setPendingCreate: (next: boolean) => void;
  clearPendingCreate: () => void;
};

const KEY = "persistence.train.segment";

export const useTrainSegment = create<TrainSegmentState>((set) => ({
  segment: "Workouts",
  pendingCreate: false,
  hydrated: false,
  setSegment: (next) => {
    // Flip `hydrated: true` here so a late-resolving module-load hydration
    // can't clobber this write. Cold-launch deep links can fire setSegment
    // before AsyncStorage.getItem resolves; without this guard the late
    // .then() callback would overwrite the deep-link write with the prior
    // session's value.
    set({ segment: next, hydrated: true });
    AsyncStorage.setItem(KEY, next).catch(() => {});
  },
  setPendingCreate: (next) => set({ pendingCreate: next }),
  clearPendingCreate: () => set({ pendingCreate: false }),
}));

// Hydrate the persisted segment value on first import — but only if no
// setter has already written. Cold-launch deep-link redirects can fire
// setSegment before this resolves; without the guard the late disk-read
// would clobber the deep-link's segment write.
AsyncStorage.getItem(KEY)
  .then((v) => {
    if (useTrainSegment.getState().hydrated) return; // setSegment already won the race
    if (v === "Workouts" || v === "Exercises") {
      useTrainSegment.setState({ segment: v, hydrated: true });
    } else {
      useTrainSegment.setState({ hydrated: true });
    }
  })
  .catch(() => useTrainSegment.setState({ hydrated: true }));
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
      {/* ProfileDrawerContainer is ALWAYS mounted — its internal <BottomSheet>
          uses the `visible` prop (forwarded by the container, sourced from
          useDrawer((s) => s.open)) to drive its own 250ms slide-in/out
          animation. Conditionally mounting on `drawerOpen` would unmount the
          tree the instant the user dismisses, killing the slide-down exit. */}
      <ProfileDrawerContainer />
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
import { useTrainSegment } from "~/ui/hooks/useTrainSegment";

const LEGACY_REDIRECTS: Record<string, () => void> = {
  // Use useTrainSegment.getState().setSegment(...) — NOT a raw AsyncStorage write.
  // The setter updates BOTH the in-memory Zustand store AND disk in one call;
  // a raw AsyncStorage.setItem only takes effect on next cold launch, leaving
  // the in-memory `segment` stale. Tapping /workouts while the last segment
  // was "Exercises" would otherwise land the user on Train with Exercises
  // still visible. Same shape for all three Train-redirecting entries.
  "/workouts": () => {
    useTrainSegment.getState().setSegment("Workouts");
    router.replace("/(app)/(tabs)/train");
  },
  "/exercises": () => {
    useTrainSegment.getState().setSegment("Exercises");
    router.replace("/(app)/(tabs)/train");
  },
  // Promised by 04-workout-management § STORY-007 (full-screen
  // (app)/exercises/create.tsx removed; Train hub mounts the sheet instead).
  // Sets the segment to Exercises (in memory + on disk) + flags the
  // train-segment store with a one-shot `pendingCreate` boolean;
  // <TrainHubContainer>'s mount-time effect reads + clears the flag to open
  // <CreateExerciseSheetContainer>.
  "/exercises/create": () => {
    useTrainSegment.getState().setSegment("Exercises");
    useTrainSegment.getState().setPendingCreate(true);
    router.replace("/(app)/(tabs)/train");
  },
  "/progress": () => router.replace("/(app)/(tabs)/you"),
  "/profile": () => {
    router.replace("/(app)/(tabs)/you");
    useDrawer.getState().openDrawer();
  },
};

// React enforces Rules of Hooks at runtime — useEffect MUST live inside a
// function component, not at module top level. Extract the redirect handler
// into a no-render component and mount it from RootLayout.
export function LegacyRedirects() {
  useEffect(() => {
    const handle = (url: string) => {
      const { pathname } = new URL(url);
      const handler = LEGACY_REDIRECTS[pathname];
      if (handler) handler();
    };
    // Cold-launch deep link (app was closed; opened via push tap or shared URL).
    // Linking.getInitialURL returns the URL that started the app —
    // addEventListener does NOT fire for that one, only for URLs received while
    // running. Without this branch, push notifications that deep-link to
    // /workouts /exercises/create /profile / etc. on a cold start would land on
    // expo-router's 404 instead of the redirected destination.
    Linking.getInitialURL().then((url) => {
      if (url) handle(url);
    });
    // Hot URL events (foreground / background return).
    const sub = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => sub.remove();
  }, []);
  return null;
}
```

`<LegacyRedirects/>` is mounted once inside `RootLayout` as a sibling of `<Stack>` (see § Mode-state slice's `app/_layout.tsx` example above — the `return (<><Stack>…</Stack><LegacyRedirects/></>)` block). Both `LegacyRedirects` and `useUserMode.rehydrate()` run on first render of the root, both at root scope. `tasks.md` T-14.7.1 must call out the mount, not just the map definition.

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
