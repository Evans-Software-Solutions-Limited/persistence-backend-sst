import { useEffect } from "react";
import { Platform } from "react-native";
import {
  Slot,
  useGlobalSearchParams,
  useRouter,
  useSegments,
} from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import * as Notifications from "expo-notifications";
import { ErrorBoundary } from "../src/ui/components/ErrorBoundary";
import { captureBoundaryError, initSentry, Sentry } from "../src/lib/sentry";
import { AppProviders } from "../src/providers";
import { useActiveWorkoutRehydration } from "../src/ui/hooks/useActiveWorkoutRehydration";
import { useAuth } from "../src/ui/hooks/useAuth";
import { useProfilePage } from "../src/ui/hooks/useProfilePage";
import { usePendingInvite } from "../src/state/pending-invite";
import { usePasswordRecovery } from "../src/state/password-recovery";
import { useNotificationPermissions } from "../src/ui/hooks/useNotificationPermissions";
import { useReferenceListBootstrap } from "@/ui/hooks/useReferenceListBootstrap";
import { initAuthCallbackCapture } from "@/ui/hooks/useAuthCallbackUrl";
import { usePurchasesIdentity } from "../src/ui/hooks/usePurchasesIdentity";
import { usePushNotifications } from "../src/ui/hooks/usePushNotifications";
import { useUserModeEligibility } from "../src/ui/hooks/useUserModeEligibility";
import { useOptionalOnboarding } from "../src/ui/state/OnboardingProvider";
import { shouldAutoShowOnboarding } from "../src/ui/state/onboardingEligibility";
import { type Href } from "expo-router";

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

/**
 * Warms the muscle-group + equipment reference catalogue once per session, so the
 * exercise write path no longer depends on a read screen having been visited
 * first. Sibling to the other bootstraps; self-gates on a resolved userId.
 */
function ReferenceListBootstrap() {
  useReferenceListBootstrap();
  return null;
}

/**
 * Installs the auth-callback deep-link capture at the root so the OS-linking
 * listeners are live BEFORE a warm-start email-confirmation link can arrive —
 * otherwise `AuthCallbackContainer` mounts after the `url` event has already
 * fired and the confirmation screen spins forever (prod incident 2026-08-16).
 * Sibling to the other bootstraps; renders nothing.
 */
function AuthCallbackCaptureBootstrap() {
  useEffect(() => {
    initAuthCallbackCapture();
  }, []);
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
  const params = useGlobalSearchParams<{
    code?: string;
    onboarding?: string;
  }>();
  // `AppProviders` owns this context in production. The optional read keeps
  // this routing component independently testable when AppProviders is mocked
  // as a pass-through; signed-out users cannot require onboarding anyway.
  const onboarding = useOptionalOnboarding();

  const deletedAt = profilePage.payload?.profile.deletedAt ?? null;
  const onboardingRoutingPending =
    session !== null && (onboarding?.isLoading ?? false);
  // `code` off the incoming invite deep link (/(app)/accept-invite?code=X).
  const inviteCode = typeof params.code === "string" ? params.code : null;

  useEffect(() => {
    if (isLoading) return;

    const rootSegment = (segments as readonly string[])[0];
    const inAuthGroup = rootSegment === "(auth)";
    const inAppGroup = rootSegment === "(app)";
    const inOnboardingGroup = rootSegment === "(onboarding)";
    // The auth-callback deep-link screen (`app/auth/callback.tsx`) is
    // ungrouped, so it's in neither group. It owns its own routing — the
    // container establishes the session (then the `session && !inAppGroup`
    // branch below enters the app) or bounces to sign-in on a bad link. Exempt
    // it from the signed-out redirect so a cold open from a confirmation link
    // doesn't bounce a *successful* confirm to sign-in in the window before
    // the container's async `setSessionFromTokens` has resolved.
    const onAuthCallback = rootSegment === "auth";
    // M10: subscription-selection + success live under (auth) because
    // they're rendered post-sign-up before the user has reached the
    // app. AuthGate must NOT bounce signed-in users out of those
    // screens — otherwise the auth-flow Selection card never gets
    // its chance to appear before AuthGate redirects to home.
    const segmentName = (segments as readonly string[])[1];
    const inPostAuthSubscriptionFlow =
      inAuthGroup &&
      (segmentName === "subscription-selection" || segmentName === "success");
    const inOnboardingPurchaseFlow =
      inPostAuthSubscriptionFlow && params.onboarding === "1";
    const inRestoreAccountScreen =
      inAppGroup && segmentName === "restore-account";
    const inAcceptInviteScreen = inAppGroup && segmentName === "accept-invite";
    // A recovery-link session must set a new password before reaching the
    // tabs. Whitelisted like the post-sign-up screens so AuthGate doesn't
    // bounce the signed-in user off set-new-password back to the app.
    const inSetNewPasswordScreen =
      inAuthGroup && segmentName === "set-new-password";

    // Soft-deleted (grace-period) gate: a signed-in user whose profile
    // carries a non-null `deletedAt` must restore (or sign out) before
    // reaching the normal tabs — checked ahead of the ordinary
    // session redirect so this wins over "signed in -> go to tabs".
    // Deliberately does NOT preserve the segments being left, mirroring
    // the existing sign-in/sign-out redirects below.
    if (session && deletedAt != null && !inRestoreAccountScreen) {
      // The restore-account gate pre-empts the recovery divert below, so clear
      // the recovery flag here too — otherwise a soft-deleted user who opened a
      // recovery link would leave `pending` armed and later trap a normal
      // sign-in on set-new-password (Inspector Brad 🟡). Recovery isn't
      // completed via this detour; a fresh reset link re-arms it cleanly.
      usePasswordRecovery.getState().clear();
      router.replace("/(app)/restore-account");
      return;
    }

    // Password recovery is an auth-security flow and must not wait for the
    // onboarding state request. The reset screen owns clearing the flag.
    if (
      session &&
      usePasswordRecovery.getState().pending &&
      !inSetNewPasswordScreen
    ) {
      router.replace("/(auth)/set-new-password");
      return;
    }

    // Invite consent must also be reachable without waiting for onboarding.
    // Peek rather than clear: the accept-invite screen owns the stash, and
    // repeated auth-state events must keep resolving to the same destination.
    const pendingInviteCode = usePendingInvite.getState().pendingCode;
    if (session && pendingInviteCode && !inAcceptInviteScreen) {
      router.replace(
        `/(app)/accept-invite?code=${encodeURIComponent(pendingInviteCode)}`,
      );
      return;
    }

    const onboardingState = onboarding?.state ?? null;
    const onboardingRequired =
      // A failed read with no offline mirror is unknown, not "never started".
      // Fail open to Home and retry on the next provider lifecycle.
      (onboardingState !== null || onboarding?.loadError == null) &&
      shouldAutoShowOnboarding({
        state: onboardingState,
      });
    if (
      session &&
      !(onboarding?.isLoading ?? false) &&
      onboardingRequired &&
      !inOnboardingGroup &&
      !inOnboardingPurchaseFlow &&
      !inSetNewPasswordScreen &&
      !inAcceptInviteScreen
    ) {
      const page = onboarding?.state?.currentPage ?? "welcome";
      router.replace(`/(onboarding)/${page}` as Href);
      return;
    }
    if (
      session &&
      inOnboardingGroup &&
      !(onboarding?.isLoading ?? false) &&
      onboarding?.state?.status !== "in_progress"
    ) {
      router.replace("/(app)/(tabs)");
      return;
    }

    if (
      session &&
      !inAppGroup &&
      !inOnboardingGroup &&
      !inPostAuthSubscriptionFlow &&
      !inSetNewPasswordScreen &&
      !onboardingRoutingPending
    ) {
      // Signed in but not in app and not in a whitelisted auth-flow screen.
      router.replace("/(app)/(tabs)");
    } else if (!session && !inAuthGroup && !onAuthCallback) {
      // Not signed in and not on an auth screen — go to sign-in. If they were
      // opening a coach invite deep link, stash the code first so it survives
      // sign-in/sign-up and is redeemed by the post-auth branch above.
      if (inAppGroup && segmentName === "accept-invite" && inviteCode) {
        usePendingInvite.getState().setPendingCode(inviteCode);
      }
      router.replace("/(auth)/sign-in");
    }
  }, [
    session,
    isLoading,
    segments,
    router,
    deletedAt,
    inviteCode,
    onboarding?.state,
    onboarding?.isLoading,
    onboarding?.loadError,
    onboardingRoutingPending,
    params.onboarding,
  ]);

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
        <AppProviders>
          <AuthCallbackCaptureBootstrap />
          <NotificationPermissionsBootstrap />
          <PushNotificationsBootstrap />
          <UserModeBootstrap />
          <ActiveWorkoutBootstrap />
          <PurchasesIdentityBootstrap />
          <ReferenceListBootstrap />
          <AuthGate />
        </AppProviders>
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
