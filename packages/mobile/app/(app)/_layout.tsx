import { Stack } from "expo-router";
import { ExerciseFiltersProvider } from "../../src/ui/hooks/useExerciseFilters";
import { colorPalette } from "../../src/ui/theme";

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
      </Stack>
    </ExerciseFiltersProvider>
  );
}
