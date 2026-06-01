import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Avatar } from "@/ui/components/foundation";
import { Colors, Spacing, Typography } from "@/ui/theme/homeLegacyTheme";

/**
 * Greeting + tier row. Ported verbatim from
 * `persistence-mobile/components/home/GreetingSection/` — same JSX,
 * same StyleSheet, only the theme import swapped for the V2-backed
 * legacy compat shim.
 *
 * 08-profile-settings: the trailing slot (previously empty, the row is a
 * `space-between`) now holds the profile <Avatar> that opens the
 * ProfileDrawer. This is a TEMPORARY trigger on the legacy-ported Home —
 * the proper per-screen `<HeaderBar leading={<Avatar/>}>` pattern lands when
 * 06-progress-goals rebuilds Home. Until then this is the only way to reach
 * the drawer from Home.
 */

interface GreetingSectionProps {
  readonly userName: string;
  readonly subscriptionTier: string | null;
  readonly isFreeTier: boolean;
  readonly onUpgradePress?: () => void;
  readonly onManageSubscription?: () => void;
  /** Initials for the profile avatar (e.g. "BE"). Defaults to "–". */
  readonly avatarInitials?: string;
  /** Opens the ProfileDrawer. When omitted the avatar isn't rendered. */
  readonly onAvatarPress?: () => void;
}

const tierDisplayNameMap: Record<string, string> = {
  free: "Free",
  premium: "Premium",
  individual_trainer: "Individual Trainer",
  small_business: "Small Business Trainer",
  medium_enterprise: "Medium / Enterprise Trainer",
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
  avatarInitials = "–",
  onAvatarPress,
}: GreetingSectionProps) {
  const greeting = getTimeBasedGreeting();
  const tierDisplayName =
    (subscriptionTier && tierDisplayNameMap[subscriptionTier]) || "Free";

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
        {onAvatarPress ? (
          <Avatar
            initials={avatarInitials}
            tone="primary"
            onPress={onAvatarPress}
            accessibilityLabel="Open profile menu"
            testID="home-profile-avatar"
          />
        ) : null}
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
