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
    </Stack>
  );
}
