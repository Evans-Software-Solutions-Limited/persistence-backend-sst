import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDrawer } from "@/state/drawer";
import { useHealthSync } from "@/state/health-sync";
import { useUserMode } from "@/state/user-mode";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGetAchievements } from "@/ui/hooks/useGetAchievements";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { useModeSwitch } from "@/ui/hooks/useModeSwitch";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { computeAge, initialsOf } from "@/shared/utils";
import { ProfileDrawerPresenter } from "@/ui/presenters/ProfileDrawerPresenter";

/**
 * <ProfileDrawerContainer> — wires the ProfileDrawer body to live data.
 *
 * Spec: specs/08-profile-settings/design.md § <ProfileDrawerContainer>
 *       + § Revised 2026-05-31 § G (authoritative plumbing — real hooks)
 *       specs/14-navigation/design.md § <ProfileDrawer> mount-point
 *
 * Mounted ALWAYS at (app)/_layout.tsx (14-navigation); the <BottomSheet>'s
 * `visible` prop (from useDrawer().open) drives the slide animation so a
 * parent-driven close animates DOWN rather than unmounting.
 */
export function ProfileDrawerContainer() {
  const open = useDrawer((s) => s.open);
  const closeDrawer = useDrawer((s) => s.closeDrawer);
  const mode = useUserMode((s) => s.mode);
  const isTrainerEligible = useUserMode((s) => s.isTrainerEligible);
  const { switchMode } = useModeSwitch();

  const {
    payload,
    error: profileFetchError,
    isRefreshing: isProfileRefreshing,
    isAutoRetrying: isProfileAutoRetrying,
    refresh: refreshProfile,
  } = useProfilePage();
  const profileData = payload?.profile;
  // Errored empty state (QA-9): the fetch failed and there's nothing cached to
  // show. `useProfilePage` auto-retries a bounded number of times; we only
  // surface the error once those are exhausted — `isAutoRetrying` stays true
  // through the backoff gaps (when `isRefreshing` momentarily drops), so the
  // loader holds continuously instead of flickering the error card in and out.
  const profileErrored =
    payload === null &&
    profileFetchError !== null &&
    !isProfileRefreshing &&
    !isProfileAutoRetrying;
  const { data: subscription, refetch: refetchSubscription } =
    useMySubscription();
  const health = useHealthData();
  const { signOut } = useAuth();
  // Cache-first count for the drawer row's Pill — same source the
  // Achievements screen itself reads (go-live: was hardcoded `undefined`,
  // which suppressed the count Pill entirely).
  const { data: achievementsData, refresh: refreshAchievements } =
    useGetAchievements();

  // The drawer is mounted permanently (sibling of the Stack), so its
  // subscription query + achievements read only fetch once at app launch. If
  // that cold-start fetch was slow or failed, opening the drawer would show no
  // subscription/coach-switch and a stale achievements count until a full app
  // restart. Re-validate both on the open transition (false→true) so the
  // drawer always reflects current state. `refetchSubscription` also re-settles
  // trainer eligibility (fed from the same query via useUserModeEligibility).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      void refetchSubscription();
      void refreshAchievements();
    }
    wasOpen.current = open;
  }, [open, refetchSubscription, refreshAchievements]);

  const [isSigningOut, setIsSigningOut] = useState(false);

  const healthConnected =
    health.isAvailable &&
    (health.permissionStatus.steps === "granted" ||
      health.permissionStatus.bodyWeight === "granted");

  // The drawer is mounted permanently (sibling of the Stack), so its own
  // useHealthData() instance only re-reads on mount / AppState='active' — it
  // wouldn't notice a grant made on the Health connect screen, leaving the
  // "connected" badge stale until the app next foregrounds. Subscribe to the
  // shared grant signal and force a fresh read when it bumps (same bridge
  // HomeContainer uses for the rings). Bypass is fine here: it fires only on
  // an actual grant, not on every render.
  const refreshHealth = health.refresh;
  const healthRevision = useHealthSync((s) => s.revision);
  const seenHealthRevisionRef = useRef(healthRevision);
  useEffect(() => {
    if (seenHealthRevisionRef.current === healthRevision) return;
    seenHealthRevisionRef.current = healthRevision;
    void refreshHealth();
  }, [healthRevision, refreshHealth]);

  // Close the drawer then navigate to the sub-page.
  const pushFrom = useCallback(
    (path: string) => {
      closeDrawer();
      router.push(path as never);
    },
    [closeDrawer],
  );

  const onSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      closeDrawer();
    } catch {
      // useAuth captures the error; the drawer stays open so the user can retry.
    } finally {
      setIsSigningOut(false);
    }
  }, [isSigningOut, signOut, closeDrawer]);

  return (
    <ProfileDrawerPresenter
      visible={open}
      onClose={closeDrawer}
      profile={
        profileData
          ? {
              name: profileData.fullName ?? "",
              email: profileData.email ?? "",
              initials: initialsOf(profileData.fullName),
              age: computeAge(profileData.dateOfBirth),
              weightKg: profileData.weightKg ?? undefined,
              weightUnit: profileData.weightUnit ?? "kg",
            }
          : undefined
      }
      subscription={
        subscription
          ? {
              tier: subscription.tierName,
              inTrial:
                subscription.trialEndsAt != null &&
                Date.parse(subscription.trialEndsAt) > Date.now(),
              expiresAt: subscription.expiresAt
                ? new Date(subscription.expiresAt)
                : undefined,
              planDescription:
                subscription.tierDescription ?? subscription.tierDisplayName,
            }
          : undefined
      }
      achievementsCount={achievementsData?.length}
      profileErrored={profileErrored}
      onRetryProfile={() => void refreshProfile()}
      healthConnected={healthConnected}
      mode={mode}
      isTrainerEligible={isTrainerEligible}
      clientCount={undefined}
      isSigningOut={isSigningOut}
      onSwitchMode={(next) => switchMode(next)}
      onOpenProfile={() => pushFrom("/(app)/profile/edit")}
      onOpenAchievements={() => pushFrom("/(app)/achievements")}
      onOpenHealth={() => pushFrom("/(app)/profile/health")}
      onOpenSubscription={() => pushFrom("/(auth)/subscription-selection")}
      onOpenNotifications={() => pushFrom("/(app)/profile/notifications")}
      onOpenSettings={() => pushFrom("/(app)/profile/privacy-settings")}
      onSignOut={onSignOut}
    />
  );
}
