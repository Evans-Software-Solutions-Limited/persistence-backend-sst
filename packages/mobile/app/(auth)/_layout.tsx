import { Stack } from "expo-router";
import { colorPalette } from "../../src/ui/theme";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colorPalette.neutral1000 },
      }}
    >
      <Stack.Screen name="sign-in" />
    </Stack>
  );
}
