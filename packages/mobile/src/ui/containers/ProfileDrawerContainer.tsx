import { router } from "expo-router";
import { useCallback, useState } from "react";

import { useDrawer } from "@/state/drawer";
import { useUserMode } from "@/state/user-mode";
import { useAuth } from "@/ui/hooks/useAuth";
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
 *
 * Hooks are the REAL ones (the spec's original useGet* names were
 * aspirational — see design.md § A reality-map):
 *   useProfilePage / useMySubscription / useHealthData / useAuth().signOut /
 *   useModeSwitch. Achievements + trainer-client counts are stubbed (their
 *   hooks are owned by 06 / 10, not yet shipped).
 */
export function ProfileDrawerContainer() {
  const open = useDrawer((s) => s.open);
  const closeDrawer = useDrawer((s) => s.closeDrawer);
  const mode = useUserMode((s) => s.mode);
  const isTrainerEligible = useUserMode((s) => s.isTrainerEligible);
  const { switchMode } = useModeSwitch();

  const { payload } = useProfilePage();
  const profileData = payload?.profile;
  const { data: subscription } = useMySubscription();
  const health = useHealthData();
  const { signOut } = useAuth();

  const [isSigningOut, setIsSigningOut] = useState(false);

  const healthConnected =
    health.isAvailable &&
    (health.permissionStatus.steps === "granted" ||
      health.permissionStatus.bodyWeight === "granted");

  // Close the drawer first, then navigate — avoids the sheet's slide-down
  // animation racing the route push (design.md § Risks).
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
      // signOut clears session → AuthGate redirects to (auth)/sign-in.
      closeDrawer();
    } catch {
      // Surface nothing here — useAuth captures the error; the drawer
      // stays open so the user can retry.
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
      // TODO(06-progress-goals): wire useGetAchievements once it ships.
      achievementsCount={undefined}
      healthConnected={healthConnected}
      mode={mode}
      isTrainerEligible={isTrainerEligible}
      // TODO(10-trainer-features): wire useTrainerClients (M8) once it ships.
      clientCount={undefined}
      isSigningOut={isSigningOut}
      onSwitchMode={(next) => switchMode(next)}
      onOpenProfile={() => pushFrom("/(app)/profile/edit")}
      onOpenAchievements={() => pushFrom("/(app)/achievements")}
      onOpenHealth={() => pushFrom("/(app)/coming-soon?feature=health")}
      onOpenSubscription={() =>
        pushFrom("/(app)/coming-soon?feature=subscription")
      }
      onOpenNotifications={() =>
        pushFrom("/(app)/coming-soon?feature=notifications")
      }
      onOpenSettings={() => pushFrom("/(app)/profile/privacy")}
      onSignOut={onSignOut}
    />
  );
}
