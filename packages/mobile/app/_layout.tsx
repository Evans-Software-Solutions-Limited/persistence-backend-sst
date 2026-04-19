import { useEffect } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
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
  return (
    <ErrorBoundary>
      <AppProviders>
        <AuthGate />
      </AppProviders>
    </ErrorBoundary>
  );
}
