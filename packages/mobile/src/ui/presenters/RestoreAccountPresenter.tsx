import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { color } from "@/ui/theme/tokens";

/**
 * Restore-account gate — pure presenter (Cluster 2b account-deletion
 * soft-delete brief).
 *
 * Reached only via `AuthGate` (app/_layout.tsx) redirecting a signed-in
 * user whose loaded profile carries a non-null `deletedAt` — i.e. an
 * account still inside its 30-day post-deletion grace period. No back
 * affordance: the user must either restore or sign out.
 */

export type RestoreAccountPresenterProps = {
  /** ISO timestamp the account is permanently purged on; null if unknown. */
  purgeAfter: string | null;
  isRestoring: boolean;
  onRestore: () => void;
  onSignOut: () => void;
};

function formatPurgeAfter(purgeAfter: string | null): string {
  if (!purgeAfter) return "in 30 days";
  const date = new Date(purgeAfter);
  if (Number.isNaN(date.getTime())) return "in 30 days";
  // Pinned to UTC — see the matching helper in PrivacySettingsContainer.tsx
  // for the rationale (stable calendar date regardless of device timezone).
  return date.toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function RestoreAccountPresenter({
  purgeAfter,
  isRestoring,
  onRestore,
  onSignOut,
}: RestoreAccountPresenterProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[styles.container, { paddingTop: insets.top + 32 }]}
      testID="restore-account-screen"
    >
      <View style={styles.card}>
        <Text style={styles.title}>Account scheduled for deletion</Text>
        <Text style={styles.body} testID="restore-account-purge-date">
          Your account is scheduled for deletion on{" "}
          {formatPurgeAfter(purgeAfter)}. Restore it to keep your workouts,
          nutrition logs, and progress.
        </Text>

        <TouchableOpacity
          style={[
            styles.button,
            styles.restoreButton,
            isRestoring && styles.buttonDisabled,
          ]}
          onPress={onRestore}
          disabled={isRestoring}
          activeOpacity={0.7}
          testID="restore-account-restore"
          accessibilityRole="button"
          accessibilityLabel="Restore my account"
        >
          {isRestoring ? (
            <ActivityIndicator color={color.$bg} />
          ) : (
            <Text style={styles.restoreButtonText}>Restore my account</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.signOutButton,
            isRestoring && styles.buttonDisabled,
          ]}
          onPress={onSignOut}
          disabled={isRestoring}
          activeOpacity={0.7}
          testID="restore-account-sign-out"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text style={styles.signOutButtonText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.$bg,
    padding: 24,
  },
  card: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 24,
    gap: 16,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    color: color.$text,
  },
  body: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
  },
  button: {
    borderRadius: 12,
    paddingVertical: 8 + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  restoreButton: {
    backgroundColor: color.$primary,
  },
  restoreButtonText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    color: color.$bg,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: color.$error,
  },
  signOutButtonText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    color: color.$error,
  },
});
