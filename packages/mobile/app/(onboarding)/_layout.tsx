import { Stack } from "expo-router";
import { colorPalette } from "@/ui/theme";

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        gestureEnabled: false,
        contentStyle: { backgroundColor: colorPalette.neutral1000 },
      }}
    />
  );
}
