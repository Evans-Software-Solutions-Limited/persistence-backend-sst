import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { Slot, useRouter, useSegments } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import { StripeProvider } from "@stripe/stripe-react-native";
import { ErrorBoundary } from "../src/ui/components/ErrorBoundary";
import { AppProviders } from "../src/providers";
import { useActiveWorkoutRehydration } from "../src/ui/hooks/useActiveWorkoutRehydration";
import { useAuth } from "../src/ui/hooks/useAuth";
import { useNotificationPermissions } from "../src/ui/hooks/useNotificationPermissions";
import { useUserModeEligibility } from "../src/ui/hooks/useUserModeEligibility";

/**
 * Foreground-display behaviour for local notifications fired by the
 * app (e.g. the rest timer's "Rest complete" alert). Without an
 * explicit handler, expo-notifications defaults to NOT showing
 * banners when the app is in the foreground — which is exactly when
 * the user is most likely to be staring at the screen waiting for
 * the timer to fire. Setting the handler at module load (above the
 * default export) is the legacy pattern from
 * persistence-mobile/app/_layout.tsx:25-53 and matches Expo's
 * documented setup.
 *
 * The handler still respects `Notifications.requestPermissionsAsync`
 * — if the user denied permission, the OS suppresses the banner
 * regardless of what we return here. The rest-timer's in-app
 * countdown remains visible as the fallback.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Mounts inside `AppProviders` and fires the local-notification
 * permission prompt as soon as the JS bundle is ready — regardless
 * of auth state. Brad's call: "The notification permissions should
 * be requested by the user on load of the application." Earliest-
 * possible-prompt feels native on iOS (every well-known app does it
 * at launch) and avoids the staging-build behaviour where the user
 * never sees the prompt at all unless they happen to navigate to
 * the home screen.
 *
 * The hook owns idempotency: an AsyncStorage flag + in-memory ref
 * mean the OS prompt only fires the very first launch of a fresh
 * install. Subsequent launches read the flag and no-op.
 *
 * Sibling to `AuthGate` rather than baked into it because
 * notifications and auth are independent concerns — keep the
 * coupling visible at the layout level.
 */
function NotificationPermissionsBootstrap() {
  useNotificationPermissions(true);
  return null;
}

/**
 * Bridges the subscription cache into the `useUserMode` slice +
 * rehydrates the persisted mode + runs the eligibility invariant
 * watchdog. Mounted as a sibling to `AuthGate` (same level as
 * `NotificationPermissionsBootstrap`) because mode-eligibility and auth
 * are independent concerns — keep the coupling visible at the layout
 * level. `useMySubscription` self-gates on a resolved `userId`, so this
 * no-ops until the user is signed in.
 *
 * Spec: specs/14-navigation/design.md § Eligibility wiring
 *       specs/14-navigation/requirements.md STORY-003 (AC 3.2, 3.3, 3.5)
 */
function UserModeBootstrap() {
  useUserModeEligibility();
  return null;
}

/**
 * Restores the `useActiveWorkout` UI-state slice on launch and reconciles it
 * against the SQLite session cache (the existence authority). Sibling to
 * `UserModeBootstrap` — self-gates on a resolved `userId`, so it no-ops until
 * signed in. Surfaces the >24h resume/discard prompt.
 *
 * Spec: specs/05-active-session/requirements.md STORY-007 (AC 7.2, 7.3)
 */
function ActiveWorkoutBootstrap() {
  useActiveWorkoutRehydration();
  return null;
}

function AuthGate() {
  const { session, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === "(auth)";
    const inAppGroup = segments[0] === "(app)";
    // M10: subscription-selection + success live under (auth) because
    // they're rendered post-sign-up before the user has reached the
    // app. AuthGate must NOT bounce signed-in users out of those
    // screens — otherwise the auth-flow Selection card never gets
    // its chance to appear before AuthGate redirects to home.
    const segmentName = (segments as readonly string[])[1];
    const inPostAuthSubscriptionFlow =
      inAuthGroup &&
      (segmentName === "subscription-selection" || segmentName === "success");

    if (session && !inAppGroup && !inPostAuthSubscriptionFlow) {
      // Signed in but not in app and not in the post-sign-up flow —
      // go to app. `/(app)/(tabs)` resolves to the tab navigator's
      // first tab (home).
      router.replace("/(app)/(tabs)");
    } else if (!session && !inAuthGroup) {
      // Not signed in and not on auth screen — go to sign-in
      router.replace("/(auth)/sign-in");
    }
  }, [session, isLoading, segments, router]);

  return <Slot />;
}

export default function RootLayout() {
  // Android 8+ requires an explicit notification channel for any
  // notification to render — without one, `scheduleNotificationAsync`
  // silently no-ops. Idempotent: calling `setNotificationChannelAsync`
  // with the same id on subsequent launches just updates the channel,
  // it doesn't error. Fire-and-forget inside an effect (rather than
  // at module load) so we don't fight the JS-thread cold-start.
  // Mirrors legacy `useRegisterPushNotifications.ts:30-37` minus the
  // push-token side (push tokens are an M7 feature).
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void Notifications.setNotificationChannelAsync("default", {
      name: "Default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#0C111A",
    });
  }, []);

  // M10 — Stripe publishable key from Expo's runtime config or env. The
  // SDK accepts an empty string and just silently no-ops Apple Pay; in
  // dev that surfaces as the inline "Apple Pay unavailable" state and
  // is harmless. Production / staging EAS builds inject the key via
  // `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`.
  //
  // `merchantIdentifier` MUST match the entry in `ios.entitlements`
  // (app.json line 20). Mismatch = silent Apple Pay sheet failure on
  // device. Mirrors legacy `persistence-mobile/app/_layout.tsx:95-97`
  // pattern.
  const stripePublishableKey =
    (Constants.expoConfig?.extra?.stripePublishableKey as string | undefined) ??
    process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ??
    "";

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
        <StripeProvider
          publishableKey={stripePublishableKey}
          merchantIdentifier="merchant.com.bradleyevans96.persistence"
        >
          <AppProviders>
            <NotificationPermissionsBootstrap />
            <UserModeBootstrap />
            <ActiveWorkoutBootstrap />
            <AuthGate />
          </AppProviders>
        </StripeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}
