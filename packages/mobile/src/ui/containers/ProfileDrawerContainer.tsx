import { router, usePathname } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const closeForNavigation = useDrawer((s) => s.closeForNavigation);
  const openDrawer = useDrawer((s) => s.openDrawer);
  const returnToDrawer = useDrawer((s) => s.returnToDrawer);
  const clearReturn = useDrawer((s) => s.clearReturn);
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

  // Re-open the drawer when the user navigates BACK to a tab after a
  // sub-page push (Option 3 UX pattern). Uses usePathname which is global
  // (works even though this component is a sibling of the Stack, not inside
  // it). We detect a TRANSITION from a non-tab path back to a tab path.
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    const prev = prevPathnameRef.current;
    prevPathnameRef.current = pathname;

    if (!returnToDrawer) return;

    // Tab paths look like "/" (index), "/train", "/fuel", "/you", "/clients",
    // "/programs". Sub-page paths look like "/profile/edit", "/coming-soon", etc.
    const isTabPath = (p: string) =>
      p === "/" ||
      p === "/train" ||
      p === "/fuel" ||
      p === "/you" ||
      p === "/clients" ||
      p === "/programs";

    const wasOnSubPage = !isTabPath(prev);
    const nowOnTab = isTabPath(pathname);

    if (wasOnSubPage && nowOnTab) {
      openDrawer();
      clearReturn();
    }
  }, [pathname, returnToDrawer, openDrawer, clearReturn]);

  // Close the drawer for navigation — sets returnToDrawer so the drawer
  // re-opens when the user navigates back to the tabs.
  const pushFrom = useCallback(
    (path: string) => {
      closeForNavigation();
      router.push(path as never);
    },
    [closeForNavigation],
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
