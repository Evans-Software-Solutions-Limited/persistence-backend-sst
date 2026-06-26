import { Stack } from "expo-router";
import { colorPalette } from "../../src/ui/theme";

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colorPalette.neutral1000 },
        animation: "fade",
        animationDuration: 250,
      }}
    >
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="forgot-password" />
      {/*
        subscription-selection + success live under (auth) because they're
        also rendered in the post-sign-up flow before the user reaches the
        app. They're additionally reached cross-segment from the profile
        drawer (ProfileDrawerContainer.onOpenSubscription) for an existing
        signed-in user managing their plan — AuthGate (app/_layout.tsx
        §inPostAuthSubscriptionFlow) whitelists both so a signed-in user
        isn't bounced back to the tabs. Declared explicitly so the stack
        animation + back behaviour match the rest of the auth flow rather
        than relying on file-based routing fallback.
      */}
      <Stack.Screen name="subscription-selection" />
      <Stack.Screen name="success" />
    </Stack>
  );
}
