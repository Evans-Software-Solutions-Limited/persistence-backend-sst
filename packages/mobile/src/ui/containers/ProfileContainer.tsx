import Constants from "expo-constants";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";
import type {
  ProfilePageRole,
  ProfilePageSubscription,
  ProfilePageData,
} from "@/domain/models/profilePage";
import { useAuth } from "@/ui/hooks/useAuth";
import { useAvatarUpload } from "@/ui/hooks/useAvatarUpload";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { ProfilePresenter } from "@/ui/presenters/ProfilePresenter";

/**
 * Container for the Profile tab. Owns:
 *  - cache-and-subscribe to `/profile/page` via `useProfilePage`
 *  - all navigation handlers for menu items + subscription
 *  - sign-out flow (re-entrant guarded via ref, same pattern as M0)
 *  - avatar picker + upload + remove via `useAvatarUpload` (M6 PR-3)
 *
 * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md
 */

const USER_ROLE_LABEL: Record<ProfilePageRole, string> = {
  user: "User",
  personal_trainer: "Personal Trainer",
  physiotherapist: "Physiotherapist",
  admin: "Admin",
};

function deriveAppVersion(): string {
  const fromExpo = Constants.expoConfig?.version;
  if (typeof fromExpo === "string" && fromExpo.length > 0) return fromExpo;
  const fromNative =
    Constants.nativeAppVersion ??
    (Constants as unknown as { nativeApplicationVersion?: string })
      .nativeApplicationVersion;
  if (typeof fromNative === "string" && fromNative.length > 0)
    return fromNative;
  return "—";
}

function deriveDisplayName(
  profile: ProfilePageData["profile"] | null,
  sessionEmail: string | null,
): string | null {
  if (profile?.fullName && profile.fullName.trim().length > 0) {
    return profile.fullName;
  }
  if (profile?.username && profile.username.trim().length > 0) {
    return profile.username;
  }
  return sessionEmail;
}

export function ProfileContainer() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const profilePage = useProfilePage();

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // Ref-based guard mirroring M0: two taps in the same event-loop turn
  // would both pass a state-based guard because React batches the
  // setIsSigningOut(true) update. A ref mutates synchronously, so the
  // second tap returns immediately. Same pattern as
  // `ExerciseListContainer.triggerRefresh`.
  const isSigningOutRef = useRef(false);

  const handleSignOut = useCallback(async () => {
    if (isSigningOutRef.current) return;
    isSigningOutRef.current = true;
    setIsSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      // AuthGate in the root layout redirects to /(auth)/sign-in once
      // session flips to null; no manual navigation needed here.
    } catch (err) {
      setSignOutError(err instanceof Error ? err.message : "Sign out failed");
    } finally {
      setIsSigningOut(false);
      isSigningOutRef.current = false;
    }
  }, [signOut]);

  const promptSignOut = useCallback(() => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: () => {
          void handleSignOut();
        },
      },
    ]);
  }, [handleSignOut]);

  // Refresh on focus — mirrors HomeContainer. The hook's inFlightRef
  // dedupes same-user concurrent calls so the cost is at most one
  // GET /profile/page per focus.
  const refresh = profilePage.refresh;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const avatarUrl = profilePage.payload?.profile.avatarUrl ?? null;
  const avatarUpload = useAvatarUpload(avatarUrl);
  // After an upload/remove succeeds, the hook bumps `cacheKey` and clears
  // the storage cache. Refresh from the network so the view-model picks up
  // the updated `avatarUrl` (null after remove, new public URL after upload)
  // while the user is still on the screen — useFocusEffect only fires on
  // tab re-enter, which is too late if the user uploads then stays put.
  useEffect(() => {
    if (avatarUpload.cacheKey === 0) return;
    void profilePage.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarUpload.cacheKey, profilePage.refresh]);
  const onSelectProfilePicture = avatarUpload.showAvatarSheet;

  const onManageSubscription = useCallback(() => {
    Alert.alert(
      "Manage subscription",
      "Subscription management lights up in a later milestone.",
    );
  }, []);

  const onUpgradeSubscription = useCallback(() => {
    Alert.alert(
      "Upgrade coming soon",
      "Subscription upgrades light up in a later milestone.",
    );
  }, []);

  const onBecomeTrainer = useCallback(() => {
    Alert.alert("Become a trainer", "Trainer onboarding lights up in M8.");
  }, []);

  const onEditProfile = useCallback(() => {
    router.push("/(app)/profile/edit" as never);
  }, [router]);

  const onHealthData = useCallback(() => {
    router.push("/(app)/profile/health" as never);
  }, [router]);

  const onNotifications = useCallback(() => {
    router.push("/(app)/profile/notifications" as never);
  }, [router]);

  const onNotificationPreferences = useCallback(() => {
    router.push("/(app)/profile/notifications/preferences" as never);
  }, [router]);

  const onHelpCenter = useCallback(() => {
    router.push("/(app)/profile/help" as never);
  }, [router]);

  const onContactSupport = useCallback(() => {
    router.push("/(app)/profile/contact" as never);
  }, [router]);

  const onTermsOfService = useCallback(() => {
    router.push("/(app)/profile/terms" as never);
  }, [router]);

  const onPrivacyPolicy = useCallback(() => {
    router.push("/(app)/profile/privacy" as never);
  }, [router]);

  // View-model derivation: collapse cached payload + auth session into
  // the props the presenter consumes. Memoised so it doesn't churn on
  // unrelated re-renders (sign-out spinner toggling, error setting).
  const viewModel = useMemo(() => {
    const payload = profilePage.payload;
    const profile = payload?.profile ?? null;
    const subscription: ProfilePageSubscription | null =
      payload?.subscription ?? null;
    const isTrainer = subscription?.isTrainerTier ?? false;
    return {
      displayName: deriveDisplayName(profile, session?.email ?? null),
      email: profile?.email ?? session?.email ?? null,
      userRoleLabel: USER_ROLE_LABEL[profile?.role ?? "user"] ?? "User",
      subscription,
      isTrainer,
      workoutsCompleted: payload?.stats.workoutsCompleted ?? 0,
      recentAchievements: payload?.recentAchievements ?? [],
      activeTrainers: payload?.activeTrainers ?? [],
      pendingTrainerRequests: payload?.pendingTrainerRequests ?? [],
    };
  }, [profilePage.payload, session?.email]);

  // Initial loader only when cache is empty AND a refresh is in flight.
  // Once the cache has anything (even stale), render that immediately
  // and let the background refresh paint over it.
  const isInitialLoading =
    profilePage.payload === null && profilePage.isRefreshing;

  // Surface refresh failures as a non-blocking banner when we have
  // cached data to show under it. Suppress when there's no cache and
  // we're still loading — the loader speaks for itself. Sign-out
  // errors take precedence (more user-actionable).
  const refreshErrorMessage =
    profilePage.payload !== null && profilePage.error
      ? "Couldn't refresh — showing cached data."
      : null;
  const errorMessage = signOutError ?? refreshErrorMessage;

  return (
    <ProfilePresenter
      isInitialLoading={isInitialLoading}
      isRefreshing={profilePage.isRefreshing}
      errorMessage={errorMessage}
      displayName={viewModel.displayName}
      email={viewModel.email}
      avatarUrl={avatarUrl}
      avatarCacheKey={avatarUpload.cacheKey}
      isAvatarWorking={avatarUpload.isWorking}
      userRoleLabel={viewModel.userRoleLabel}
      subscription={viewModel.subscription}
      isTrainer={viewModel.isTrainer}
      workoutsCompleted={viewModel.workoutsCompleted}
      recentAchievements={viewModel.recentAchievements}
      activeTrainers={viewModel.activeTrainers}
      pendingTrainerRequests={viewModel.pendingTrainerRequests}
      appVersion={deriveAppVersion()}
      isSigningOut={isSigningOut}
      onRefresh={() => void refresh()}
      onSelectProfilePicture={onSelectProfilePicture}
      onManageSubscription={onManageSubscription}
      onUpgradeSubscription={onUpgradeSubscription}
      onBecomeTrainer={onBecomeTrainer}
      onEditProfile={onEditProfile}
      onHealthData={onHealthData}
      onNotifications={onNotifications}
      onNotificationPreferences={onNotificationPreferences}
      onSignOut={promptSignOut}
      onHelpCenter={onHelpCenter}
      onContactSupport={onContactSupport}
      onTermsOfService={onTermsOfService}
      onPrivacyPolicy={onPrivacyPolicy}
    />
  );
}
