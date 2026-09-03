import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import {
  PrivacySettingsPresenter,
  type PrivacyVisibility,
} from "@/ui/presenters/PrivacySettingsPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useDeleteAccountFlow } from "@/ui/hooks/useDeleteAccountFlow";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import {
  denyMetaAttributionConsent,
  getMetaAttributionConsent,
  grantMetaAttributionConsent,
  isMetaAttributionConfigured,
} from "@/application/analytics/metaAttribution";
import { updateProfileCommand } from "@/application/commands/update-profile.command";

/**
 * M12: Privacy Settings container.
 *
 * Wires the visibility picker to the V2 profile API: reads
 * `isProfilePublic` from the cached profile-page payload, writes via
 * `api.updateProfile({ isProfilePublic })`, and invalidates the profile
 * cache so the Profile tab re-fetches the new value on focus.
 *
 * PORT-GAP: legacy stored `profile_visibility` as a 3-state string
 * (private/friends/public). V2 has only the boolean. The container maps
 * private→false, public→true. See PrivacySettingsPresenter header for
 * the full gap note.
 */

export function PrivacySettingsContainer() {
  const router = useRouter();
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const profilePage = useProfilePage();

  const cachedIsPublic = profilePage.payload?.profile.isProfilePublic ?? null;
  const cachedShowTemplateWorkouts = profilePage.payload
    ? profilePage.payload.profile.showTemplateWorkouts !== false
    : null;
  const hydrated = cachedIsPublic !== null;

  const [isProfilePublic, setIsProfilePublic] = useState<boolean>(
    cachedIsPublic ?? false,
  );
  const [metaAttributionEnabled, setMetaAttributionEnabled] = useState(false);
  const [showTemplateWorkouts, setShowTemplateWorkouts] = useState(
    cachedShowTemplateWorkouts ?? true,
  );
  const templatePreferenceTouchedRef = useRef(false);

  useEffect(() => {
    void getMetaAttributionConsent().then((value) => {
      setMetaAttributionEnabled(value === "granted");
    });
  }, []);

  // Seed local state once the cached payload arrives. Same pattern as
  // EditProfileContainer — cache-first hydration so a user coming in
  // from the Profile tab never sees the spinner.
  useEffect(() => {
    if (cachedIsPublic !== null) {
      setIsProfilePublic(cachedIsPublic);
    }
  }, [cachedIsPublic]);

  useEffect(() => {
    if (
      cachedShowTemplateWorkouts !== null &&
      !templatePreferenceTouchedRef.current
    ) {
      setShowTemplateWorkouts(cachedShowTemplateWorkouts);
    }
  }, [cachedShowTemplateWorkouts]);

  const onSetShowTemplateWorkouts = useCallback(
    (enabled: boolean) => {
      if (!session?.userId || enabled === showTemplateWorkouts) return;

      templatePreferenceTouchedRef.current = true;
      setShowTemplateWorkouts(enabled);
      const result = updateProfileCommand(
        { storage, userId: session.userId },
        { showTemplateWorkouts: enabled },
      );
      if (!result.ok) {
        setShowTemplateWorkouts(!enabled);
        Alert.alert("Error", "Failed to update workout library settings");
        return;
      }

      // The app-level sync worker observes the enqueue and drains it through
      // its single-flight path. Starting a second inline drain here would let
      // rapid toggles claim separate rows concurrently and reorder intent.
    },
    [session?.userId, showTemplateWorkouts, storage],
  );

  const handleUpdateVisibility = useCallback(
    async (next: PrivacyVisibility) => {
      const nextIsPublic = next === "public";
      if (nextIsPublic === isProfilePublic) {
        // No-op — user tapped the row that's already selected. Skip the
        // round trip to avoid spurious cache invalidations.
        return;
      }
      // Optimistic update — flip the toggle immediately, revert on error.
      const prev = isProfilePublic;
      setIsProfilePublic(nextIsPublic);
      const result = await api.updateProfile({
        isProfilePublic: nextIsPublic,
      });
      if (!result.ok) {
        setIsProfilePublic(prev);
        Alert.alert("Error", "Failed to update privacy settings");
        return;
      }
      if (session?.userId) {
        storage.invalidateProfilePage(session.userId);
      }
    },
    [api, storage, session?.userId, isProfilePublic],
  );

  const onBack = useCallback(() => {
    router.back();
  }, [router]);

  const onOpenPrivacyPolicy = useCallback(() => {
    router.push("/(app)/profile/privacy" as never);
  }, [router]);

  const onOpenTerms = useCallback(() => {
    router.push("/(app)/profile/terms" as never);
  }, [router]);

  // App Store Guideline 5.1.1(v): in-app account deletion. The flow itself
  // lives in `useDeleteAccountFlow` because the Profile drawer offers the same
  // action — one implementation, two entry points.
  const onDeleteAccount = useDeleteAccountFlow();

  const onSetMetaAttributionEnabled = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const activated = await grantMetaAttributionConsent();
      setMetaAttributionEnabled(activated);
    } else {
      const revoked = await denyMetaAttributionConsent();
      setMetaAttributionEnabled(!revoked);
      if (!revoked) {
        Alert.alert(
          "Couldn't update advertising measurement",
          "We couldn't safely save that change. Please try again.",
        );
      }
    }
  }, []);

  return (
    <PrivacySettingsPresenter
      isLoading={!hydrated}
      isProfilePublic={isProfilePublic}
      onUpdateVisibility={handleUpdateVisibility}
      onBack={onBack}
      onOpenPrivacyPolicy={onOpenPrivacyPolicy}
      onOpenTerms={onOpenTerms}
      onDeleteAccount={onDeleteAccount}
      metaAttributionAvailable={isMetaAttributionConfigured()}
      metaAttributionEnabled={metaAttributionEnabled}
      onSetMetaAttributionEnabled={onSetMetaAttributionEnabled}
      showTemplateWorkouts={showTemplateWorkouts}
      onSetShowTemplateWorkouts={onSetShowTemplateWorkouts}
    />
  );
}
