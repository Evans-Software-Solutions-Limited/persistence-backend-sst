import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Current-plan status header. Ported 1:1 from legacy
 * `persistence-mobile/app/(auth)/subscription-selection.tsx` lines
 * 373–414 (the inline currentSubscriptionCard JSX).
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 1.5, 3.6, 3.7
 *
 * Pure presenter. Renders three variant states:
 *   1. "Current: <tier>" — vanilla active subscription.
 *   2. "Cancelled: <tier>" + "Your subscription will remain active
 *      until <date>. Click your plan card to reinstate." — when the
 *      sub is cancelled-but-active (reinstate-by-tap UX).
 *   3. Scheduled-change indicator below either — when a downgrade is
 *      scheduled for period-end.
 */

export interface CurrentSubscriptionStatusCardProps {
  currentTierDisplayName: string;
  isCancelledButActive: boolean;
  /** ISO date — only used when isCancelledButActive. */
  subscriptionEndsAt: string | null;
  scheduledChange: {
    nextTierDisplayName: string;
    effectiveAt: string;
    currentTierActiveUntil: string | null;
    currentTierDisplayName: string;
  } | null;
}

function formatDate(dateString: string | null | undefined): string | null {
  if (!dateString) return null;
  return new Date(dateString).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function CurrentSubscriptionStatusCard({
  currentTierDisplayName,
  isCancelledButActive,
  subscriptionEndsAt,
  scheduledChange,
}: CurrentSubscriptionStatusCardProps) {
  return (
    <View
      style={styles.currentSubscriptionCard}
      testID="current-subscription-status-card"
    >
      <View style={styles.currentSubscriptionHeader}>
        <Ionicons
          name={isCancelledButActive ? "alert-circle" : "checkmark-circle"}
          size={20}
          color={
            isCancelledButActive
              ? Colors.warning.DEFAULT
              : Colors.success.DEFAULT
          }
        />
        <View style={styles.currentSubscriptionContent}>
          <Text style={styles.currentSubscriptionText}>
            {isCancelledButActive ? "Cancelled" : "Current"}:{" "}
            {currentTierDisplayName}
          </Text>
          {isCancelledButActive && subscriptionEndsAt && (
            <Text style={styles.currentSubscriptionSubtext}>
              Your subscription will remain active until{" "}
              {formatDate(subscriptionEndsAt)}. Click your plan card to
              reinstate.
            </Text>
          )}
          {scheduledChange && (
            <View style={styles.scheduledChangeContainer}>
              <Ionicons
                name="time-outline"
                size={16}
                color={Colors.primary.DEFAULT}
              />
              <View style={styles.scheduledChangeContent}>
                <Text style={styles.scheduledChangeText}>
                  Scheduled: {scheduledChange.nextTierDisplayName} (effective{" "}
                  {formatDate(scheduledChange.effectiveAt)})
                </Text>
                {scheduledChange.currentTierActiveUntil && (
                  <Text style={styles.scheduledChangeSubtext}>
                    {scheduledChange.currentTierDisplayName} active until{" "}
                    {formatDate(scheduledChange.currentTierActiveUntil)}
                  </Text>
                )}
              </View>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  currentSubscriptionCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.md,
    ...Shadows.small,
  },
  currentSubscriptionHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  currentSubscriptionContent: {
    flex: 1,
    gap: Spacing.xs,
  },
  currentSubscriptionText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  currentSubscriptionSubtext: {
    fontSize: 13,
    color: Colors.text.secondary,
    lineHeight: 18,
  },
  scheduledChangeContainer: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  scheduledChangeContent: {
    flex: 1,
    gap: 2,
  },
  scheduledChangeText: {
    fontSize: 13,
    color: Colors.primary.DEFAULT,
    fontWeight: "600",
  },
  scheduledChangeSubtext: {
    fontSize: 12,
    color: Colors.text.secondary,
  },
});
