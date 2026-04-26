import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Colors, Spacing, Typography } from "@/ui/theme/homeLegacyTheme";

/**
 * Greeting + tier row. Ported verbatim from
 * `persistence-mobile/components/home/GreetingSection/` — same JSX,
 * same StyleSheet, only the theme import swapped for the V2-backed
 * legacy compat shim.
 */

interface GreetingSectionProps {
  readonly userName: string;
  readonly subscriptionTier: string | null;
  readonly isFreeTier: boolean;
  readonly onUpgradePress?: () => void;
  readonly onManageSubscription?: () => void;
}

const tierDisplayNameMap: Record<string, string> = {
  free: "Free User",
  premium: "Premium User",
  individual_trainer_standard: "Individual Trainer Standard",
  individual_trainer_pro: "Individual Trainer Pro",
  small_business_standard: "Small Business Standard",
  small_business_pro: "Small Business Pro",
  medium_enterprise_standard: "Medium Enterprise Standard",
  medium_enterprise_pro: "Medium Enterprise Pro",
};

function getTimeBasedGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function GreetingSection({
  userName,
  subscriptionTier,
  isFreeTier,
  onUpgradePress,
  onManageSubscription,
}: GreetingSectionProps) {
  const greeting = getTimeBasedGreeting();
  const tierDisplayName =
    (subscriptionTier && tierDisplayNameMap[subscriptionTier]) || "Free User";

  return (
    <View style={styles.container} testID="greeting-section">
      <View style={styles.greetingContainer}>
        <View style={styles.greetingTextContainer}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Text style={styles.userName}>{userName}</Text>
          <View style={styles.tierContainer}>
            <Text style={styles.tierText}>
              {isFreeTier ? "Free Tier" : `${tierDisplayName}`}
            </Text>
            {isFreeTier
              ? onUpgradePress && (
                  <TouchableOpacity
                    onPress={onUpgradePress}
                    style={styles.upgradeLink}
                    testID="subscription-upgrade"
                  >
                    <Text style={styles.upgradeText}>Upgrade</Text>
                  </TouchableOpacity>
                )
              : onManageSubscription && (
                  <TouchableOpacity
                    onPress={onManageSubscription}
                    style={styles.upgradeLink}
                    testID="subscription-manage"
                  >
                    <Text style={styles.upgradeText}>Manage</Text>
                  </TouchableOpacity>
                )}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  greetingContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  greetingTextContainer: {
    flex: 1,
  },
  greeting: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginBottom: Spacing.xxs,
  },
  userName: {
    ...Typography.h2,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  tierContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  tierText: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  upgradeLink: {
    paddingVertical: Spacing.xxs,
  },
  upgradeText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
    textDecorationLine: "underline",
  },
});
