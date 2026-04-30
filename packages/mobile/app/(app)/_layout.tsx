import { Stack } from "expo-router";
import { ExerciseFiltersProvider } from "../../src/ui/hooks/useExerciseFilters";
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
          name="workouts/[id]/edit"
          options={{
            title: "Edit workout",
            presentation: "modal",
            headerShown: false,
          }}
        />
      </Stack>
    </ExerciseFiltersProvider>
  );
}
