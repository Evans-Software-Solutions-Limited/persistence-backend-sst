import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ErrorBoundary } from "../src/ui/components/ErrorBoundary";
import { AppProviders } from "../src/providers";
import { useAuth } from "../src/ui/hooks/useAuth";

function AuthGate() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inAppGroup = segments[0] === "(app)";

    if (session && !inAppGroup) {
      // Signed in but not in app (auth screen or root) — go to app.
      // `/(app)` alone isn't typed any more now that the app group has no
      // direct index (the home tab lives at `/(app)/(tabs)/index`).
      // `/(app)/(tabs)` resolves to the tab navigator's first tab (home).
      router.replace("/(app)/(tabs)");
    } else if (!session && !inAuthGroup) {
      // Not signed in and not on auth screen — go to sign-in
      router.replace("/(auth)/sign-in");
    }
  }, [session, isLoading, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  // `GestureHandlerRootView` is required by react-native-gesture-handler
  // for any descendant `<GestureDetector>` to recognise touches. Phase 3a
  // added the SemiCircleSlider (rating screen) which uses GestureDetector;
  // without this wrap the slider throws at mount on a real device. Mirrors
  // the legacy `persistence-mobile/app/_layout.tsx` setup (the wrap sits at
  // the root above every other provider so all descendants — modals, tabs,
  // slot — share the same gesture root).
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ErrorBoundary>
        <AppProviders>
          <AuthGate />
        </AppProviders>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
