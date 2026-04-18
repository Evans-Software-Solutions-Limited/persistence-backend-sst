import { Stack } from "expo-router";
import { colorPalette } from "../../src/ui/theme";

export default function AppLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colorPalette.neutral1000 },
        headerTintColor: colorPalette.neutral0,
        headerTitleStyle: { fontWeight: "600" },
        contentStyle: { backgroundColor: colorPalette.neutral1000 },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Persistence" }} />
      <Stack.Screen
        name="exercises/index"
        options={{ title: "Exercises", headerShown: false }}
      />
      <Stack.Screen name="exercises/[id]" options={{ title: "Exercise" }} />
      <Stack.Screen
        name="exercises/create"
        options={{ title: "New exercise" }}
      />
    </Stack>
  );
}
