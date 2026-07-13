import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/subscriptionLegacyTheme";

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
      style={[styles.container, { paddingTop: insets.top + Spacing.xl }]}
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
            <ActivityIndicator color={Colors.text.inverse} />
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
    backgroundColor: Colors.background.primary,
    padding: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    gap: Spacing.md,
    ...Shadows.medium,
  },
  title: {
    ...Typography.h3,
    color: Colors.text.primary,
  },
  body: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  button: {
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm + 2,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  restoreButton: {
    backgroundColor: Colors.primary.DEFAULT,
  },
  restoreButtonText: {
    ...Typography.body1,
    fontWeight: "600",
    color: Colors.text.inverse,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: Colors.error.DEFAULT,
  },
  signOutButtonText: {
    ...Typography.body1,
    fontWeight: "600",
    color: Colors.error.DEFAULT,
  },
});
