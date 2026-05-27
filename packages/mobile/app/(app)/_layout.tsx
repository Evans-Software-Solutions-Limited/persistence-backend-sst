import { Stack } from "expo-router";
import { ActiveSessionBanner } from "../../src/ui/components/session/ActiveSessionBanner";
import { ExerciseFiltersProvider } from "../../src/ui/hooks/useExerciseFilters";
import { useAutoRetryOnUpgrade } from "../../src/ui/hooks/useAutoRetryOnUpgrade";
import { useSyncWorker } from "../../src/ui/hooks/useSyncWorker";
import { colorPalette } from "../../src/ui/theme";

/**
 * Routing structure — please preserve when refactoring:
 *
 *   app/(app)/
 *   ├── _layout.tsx                      <-- this file (Stack)
 *   ├── (tabs)/
 *   │   ├── _layout.tsx                  Tabs navigator (Home / Progress / …)
 *   │   ├── exercises.tsx                Exercises TAB (browse + filter rail)
 *   │   └── …
 *   └── exercises/
 *       ├── [id].tsx                     Detail — pushes OVER the tab bar
 *       ├── create.tsx                   Creator — pushes OVER the tab bar
 *       └── filters.tsx                  Modal — presented OVER the tab bar
 *
 * The exercises stack screens live as SIBLINGS of the `(tabs)` group, not
 * nested inside it. This is Expo Router's standard "push over tabs" pattern:
 * the Stack here matches `exercises/[id]`, `exercises/create`, and
 * `exercises/filters` as direct children before descending into `(tabs)`,
 * so `router.push("/(app)/exercises/filters")` resolves correctly despite
 * the tab also being named `exercises`.
 *
 * If you ever move the detail/create/filters files INTO `(tabs)/exercises/`
 * they will render inside the tab bar instead of pushing over it — not what
 * we want. Keep them here.
 */
export default function AppLayout() {
  // Drain the sync queue on launch + on every foreground transition.
  // Mounted at the authenticated layout root so it runs for the entire
  // signed-in surface and unmounts cleanly on sign-out (auth boundary
  // unmounts this tree).
  useSyncWorker();
  // M10.6: on a tier upgrade that satisfies blocked entries' verdict,
  // unblock them and flush. Runs alongside the sync worker — they
  // don't interact directly, but `useAutoRetryOnUpgrade` triggers its
  // own `processSyncQueue` call so freshly-unblocked entries land
  // without waiting for the next foreground tick.
  useAutoRetryOnUpgrade();

  return (
    <ExerciseFiltersProvider>
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colorPalette.neutral1000 },
          headerTintColor: colorPalette.neutral0,
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: colorPalette.neutral1000 },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="exercises/[id]" options={{ title: "Exercise" }} />
        <Stack.Screen
          name="exercises/create"
          options={{ title: "New exercise" }}
        />
        <Stack.Screen
          name="exercises/filters"
          options={{
            title: "Filters",
            presentation: "modal",
          }}
        />
        <Stack.Screen
          name="workouts/create"
          options={{
            title: "New workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="workouts/[id]/index"
          options={{
            title: "Workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="workouts/[id]/edit"
          options={{
            title: "Edit workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="session/index"
          options={{
            title: "Active session",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="session/rate"
          options={{
            title: "Rate workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
        <Stack.Screen
          name="session/summary"
          options={{
            title: "Session summary",
            presentation: "modal",
            headerShown: false,
          }}
        />
        {/*
          M10.6 sync-blocked review screen. Pushes over the tabs (not
          modal) so the back affordance returns to the Home tab where
          the banner is mounted, preserving the user's mental thread.
        */}
        <Stack.Screen
          name="sync-blocked"
          options={{ title: "Blocked by your plan" }}
        />
      </Stack>
      <ActiveSessionBanner />
    </ExerciseFiltersProvider>
  );
}
