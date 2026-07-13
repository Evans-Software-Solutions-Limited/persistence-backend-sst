import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import {
  PrivacySettingsPresenter,
  type PrivacyVisibility,
} from "@/ui/presenters/PrivacySettingsPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useProfilePage } from "@/ui/hooks/useProfilePage";

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

/** Formats the backend's `purgeAfter` ISO timestamp for the post-delete
 *  confirmation alert. Mirrors the `formatEndDate` pattern used across the
 *  subscription screens (e.g. `CancelSubscriptionModal.tsx`). */
function formatPurgeAfter(purgeAfter: string): string {
  const date = new Date(purgeAfter);
  if (Number.isNaN(date.getTime())) return "in 30 days";
  // Pinned to UTC (rather than the device's local zone) so the displayed
  // calendar date is stable regardless of timezone — purgeAfter is many
  // days out, so this trades a few hours of local precision for never
  // showing an off-by-one day near midnight.
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function PrivacySettingsContainer() {
  const router = useRouter();
  const { api, storage } = useAdapters();
  const { session, deleteAccount } = useAuth();
  const profilePage = useProfilePage();

  const cachedIsPublic = profilePage.payload?.profile.isProfilePublic ?? null;
  const hydrated = cachedIsPublic !== null;

  const [isProfilePublic, setIsProfilePublic] = useState<boolean>(
    cachedIsPublic ?? false,
  );

  // Seed local state once the cached payload arrives. Same pattern as
  // EditProfileContainer — cache-first hydration so a user coming in
  // from the Profile tab never sees the spinner.
  useEffect(() => {
    if (cachedIsPublic !== null) {
      setIsProfilePublic(cachedIsPublic);
    }
  }, [cachedIsPublic]);

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

  // App Store Guideline 5.1.1(v): in-app account deletion. Double-confirm —
  // Cluster 2b revised this from an immediate irreversible purge to a
  // 30-day soft-delete grace period: the account is deactivated now and
  // permanently removed after 30 days, but signing back in during that
  // window routes through the restore-account gate (AuthGate,
  // app/_layout.tsx) instead of losing the account. On success,
  // `deleteAccount` tears down the session and AuthGate routes to sign-in
  // (same as sign-out); on failure the user stays signed in and can retry
  // (the backend endpoint is idempotent).
  const onDeleteAccount = useCallback(() => {
    Alert.alert(
      "Delete Account?",
      "Your account will be scheduled for deletion. All your data — " +
        "profile, workouts, sessions, nutrition, measurements, and goals — " +
        "will be permanently removed after 30 days. You can restore your " +
        "account by signing in again within that window.\n\nIf you have an " +
        "active Apple subscription, cancel it separately in Settings → " +
        "Subscriptions.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Schedule deletion?",
              "Last chance — your account will be deactivated now and " +
                "permanently deleted in 30 days unless you sign back in " +
                "before then.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: async () => {
                    try {
                      const { purgeAfter } = await deleteAccount();
                      Alert.alert(
                        "Account scheduled for deletion",
                        "You've been signed out. Your account is " +
                          `permanently deleted on ${formatPurgeAfter(purgeAfter)} ` +
                          "unless you sign back in before then to restore it.",
                      );
                    } catch {
                      Alert.alert(
                        "Couldn't delete your account",
                        "Something went wrong. Please try again.",
                      );
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [deleteAccount]);

  return (
    <PrivacySettingsPresenter
      isLoading={!hydrated}
      isProfilePublic={isProfilePublic}
      onUpdateVisibility={handleUpdateVisibility}
      onBack={onBack}
      onOpenPrivacyPolicy={onOpenPrivacyPolicy}
      onOpenTerms={onOpenTerms}
      onDeleteAccount={onDeleteAccount}
    />
  );
}
