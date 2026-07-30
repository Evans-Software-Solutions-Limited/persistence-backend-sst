import { useCallback } from "react";
import { Alert } from "react-native";

import { useAuth } from "@/ui/hooks/useAuth";

/** Formats the backend's `purgeAfter` ISO timestamp for the post-delete
 *  confirmation alert. Mirrors the `formatEndDate` pattern used across the
 *  subscription screens (e.g. `CancelSubscriptionModal.tsx`). */
export function formatPurgeAfter(purgeAfter: string): string {
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

/**
 * App Store Guideline 5.1.1(v): in-app account deletion.
 *
 * Extracted from `PrivacySettingsContainer` so the Profile drawer's
 * "Delete account" row and the Privacy screen's button run byte-identical
 * logic. Two entry points, one flow — a divergence here is a compliance bug,
 * not a UI inconsistency, so there is deliberately only one implementation.
 *
 * Double-confirms, then soft-deletes: the account is deactivated now and
 * permanently removed after 30 days. Signing back in during that window routes
 * through the restore-account gate (`AuthGate`, `app/_layout.tsx`) rather than
 * losing the account. This grace period is why the copy states plainly that the
 * account IS being deleted and names the permanent-deletion date — App Review
 * rejects flows that read as a deactivation.
 *
 * On success `deleteAccount` tears down the session and AuthGate routes to
 * sign-in (same as sign-out); on failure the user stays signed in and can retry
 * (the backend endpoint is idempotent).
 */
export function useDeleteAccountFlow(): () => void {
  const { deleteAccount } = useAuth();

  return useCallback(() => {
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
}
