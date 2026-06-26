import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useDrawer } from "@/state/drawer";
import { useHealthSync } from "@/state/health-sync";
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
      achievementsCount={undefined}
      healthConnected={healthConnected}
      mode={mode}
      isTrainerEligible={isTrainerEligible}
      clientCount={undefined}
      isSigningOut={isSigningOut}
      onSwitchMode={(next) => switchMode(next)}
      onOpenProfile={() => pushFrom("/(app)/profile/edit")}
      onOpenAchievements={() =>
        pushFrom("/(app)/coming-soon?feature=achievements")
      }
      onOpenHealth={() => pushFrom("/(app)/profile/health")}
      onOpenSubscription={() => pushFrom("/(auth)/subscription-selection")}
      onOpenNotifications={() => pushFrom("/(app)/profile/notifications")}
      onOpenSettings={() => pushFrom("/(app)/profile/privacy-settings")}
      onSignOut={onSignOut}
    />
  );
}
