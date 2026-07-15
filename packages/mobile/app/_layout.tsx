import { useEffect } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import {
  Slot,
  useGlobalSearchParams,
  useRouter,
  useSegments,
} from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import { StripeProvider } from "@stripe/stripe-react-native";
import { ErrorBoundary } from "../src/ui/components/ErrorBoundary";
import { captureBoundaryError, initSentry, Sentry } from "../src/lib/sentry";
import { AppProviders } from "../src/providers";
import { useActiveWorkoutRehydration } from "../src/ui/hooks/useActiveWorkoutRehydration";
import { useAuth } from "../src/ui/hooks/useAuth";
import { useProfilePage } from "../src/ui/hooks/useProfilePage";
import { usePendingInvite } from "../src/state/pending-invite";
import { useNotificationPermissions } from "../src/ui/hooks/useNotificationPermissions";
import { usePurchasesIdentity } from "../src/ui/hooks/usePurchasesIdentity";
import { usePushNotifications } from "../src/ui/hooks/usePushNotifications";
import { useUserModeEligibility } from "../src/ui/hooks/useUserModeEligibility";

// Initialise Sentry at module load, before the app renders. No-op when
// `EXPO_PUBLIC_SENTRY_DSN` is unset (fail-safe — DSN-less builds run
// unchanged). Errors are PII-scrubbed by the beforeSend/beforeBreadcrumb hooks
// (see ../src/lib/sentry).
initSentry();

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
 * Registers the device push token after auth resolves + refreshes the
 * notifications cache when a push arrives while foregrounded (09.2).
 * Sibling to the other bootstraps — push delivery and auth are
 * independent concerns. Self-gates on a resolved `userId`, so it no-ops
 * until the user is signed in.
 *
 * Spec: specs/09-notifications-social/requirements.md STORY-004
 */
function PushNotificationsBootstrap() {
  usePushNotifications(true);
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

/**
 * Binds RevenueCat's App User ID to the Supabase user id after auth resolves
 * (and logs out on sign-out) — the load-bearing identity rule for the iOS IAP
 * rail (M12). No-ops on web / Android and until a userId resolves. Sibling to
 * the other bootstraps because purchase identity and auth are independent
 * concerns.
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverable 2
 */
function PurchasesIdentityBootstrap() {
  usePurchasesIdentity();
  return null;
}

function AuthGate() {
  const { session, isLoading } = useAuth();
  // Cluster 2b (account-deletion soft-delete): drives the redirect below
  // off the cached/refreshed profile-page payload. `useProfilePage` is
  // cache-first + self-refreshes once stale, so this naturally fires the
  // fetch on sign-in/bootstrap without any extra wiring here — see its
  // header comment (src/ui/hooks/useProfilePage.tsx) for the caveat that a
  // stale/absent cache can briefly show `deletedAt: null` before the
  // background refresh lands; the effect below re-runs and corrects course
  // as soon as the payload updates.
  const profilePage = useProfilePage();
  const segments = useSegments();
  const router = useRouter();
  const params = useGlobalSearchParams<{ code?: string }>();

  const deletedAt = profilePage.payload?.profile.deletedAt ?? null;
  // `code` off the incoming invite deep link (/(app)/accept-invite?code=X).
  const inviteCode = typeof params.code === "string" ? params.code : null;

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
    const inRestoreAccountScreen =
      inAppGroup && segmentName === "restore-account";

    // Soft-deleted (grace-period) gate: a signed-in user whose profile
    // carries a non-null `deletedAt` must restore (or sign out) before
    // reaching the normal tabs — checked ahead of the ordinary
    // session redirect so this wins over "signed in -> go to tabs".
    // Deliberately does NOT preserve the segments being left, mirroring
    // the existing sign-in/sign-out redirects below.
    if (session && deletedAt != null && !inRestoreAccountScreen) {
      router.replace("/(app)/restore-account");
      return;
    }

    if (session && !inAppGroup && !inPostAuthSubscriptionFlow) {
      // Signed in but not in app and not in the post-sign-up flow — go to app.
      // If a coach invite code was stashed before auth (unauthenticated athlete
      // opened /(app)/accept-invite?code=X — device-QA #2 follow-up), redeem it
      // now instead of landing on the tabs. PEEK (don't clear) — Supabase fires
      // several auth-state events in quick succession, so this effect can re-run
      // with `segments` still on (auth); a read-and-clear would return null on
      // the second run and clobber this redirect with the tabs one. The
      // accept-invite screen clears the stash on arrival, and both peeks resolve
      // to the same redirect (idempotent) until `segments` catch up.
      const pendingCode = usePendingInvite.getState().pendingCode;
      if (pendingCode) {
        router.replace(
          `/(app)/accept-invite?code=${encodeURIComponent(pendingCode)}`,
        );
      } else {
        router.replace("/(app)/(tabs)");
      }
    } else if (!session && !inAuthGroup) {
      // Not signed in and not on an auth screen — go to sign-in. If they were
      // opening a coach invite deep link, stash the code first so it survives
      // sign-in/sign-up and is redeemed by the post-auth branch above.
      if (inAppGroup && segmentName === "accept-invite" && inviteCode) {
        usePendingInvite.getState().setPendingCode(inviteCode);
      }
      router.replace("/(auth)/sign-in");
    }
  }, [session, isLoading, segments, router, deletedAt, inviteCode]);

  return <Slot />;
}

function RootLayout() {
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
      <ErrorBoundary
        onError={(error, errorInfo) =>
          captureBoundaryError(error, {
            componentStack: errorInfo.componentStack,
          })
        }
      >
        <StripeProvider
          publishableKey={stripePublishableKey}
          merchantIdentifier="merchant.com.bradleyevans96.persistence"
        >
          <AppProviders>
            <NotificationPermissionsBootstrap />
            <PushNotificationsBootstrap />
            <UserModeBootstrap />
            <ActiveWorkoutBootstrap />
            <PurchasesIdentityBootstrap />
            <AuthGate />
          </AppProviders>
        </StripeProvider>
      </ErrorBoundary>
    </GestureHandlerRootView>
  );
}

// `Sentry.wrap` instruments the root component (touch/navigation breadcrumbs,
// profiling) when Sentry is enabled, and is a transparent pass-through when
// it isn't — so wrapping is safe regardless of whether a DSN is set. This is
// the recommended single root wrap in place of wrapping each screen container
// individually (keeps the component tree — and the UI — unchanged).
export default Sentry.wrap(RootLayout);
