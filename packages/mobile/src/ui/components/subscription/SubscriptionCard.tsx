import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SubscriptionTier } from "@/domain/models/subscription";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Single-column user-tier card. Ported 1:1 from legacy
 * `persistence-mobile/components/subscription/SubscriptionCard.tsx`
 * (line refs preserved).
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 1.5, 1.7, 7.5
 *
 * Pure presenter — no hooks, no side effects. All state arrives via
 * props; tap is delegated to the container via `onPress`.
 */

export interface SubscriptionCardProps {
  tier: SubscriptionTier;
  billingCycle: "monthly" | "yearly";
  isCurrent: boolean;
  showTrialBanner?: boolean;
  trialBannerText?: string;
  onPress: () => void;
  disabled?: boolean;
  getFeaturesList: (tier: SubscriptionTier, isTrainer: boolean) => string[];
  isTrainer?: boolean;
}

export function SubscriptionCard({
  tier,
  billingCycle,
  isCurrent,
  showTrialBanner = false,
  trialBannerText,
  onPress,
  disabled = false,
  getFeaturesList,
  isTrainer = false,
}: SubscriptionCardProps) {
  const price =
    billingCycle === "yearly" ? (tier.priceYearly ?? 0) : tier.priceMonthly;
  const monthlyPrice = tier.priceMonthly || 0;
  const yearlySavings = monthlyPrice * 12 - (tier.priceYearly ?? 0);

  const features = getFeaturesList(tier, isTrainer);

  // Trainer tiers show client slots prominently above the price grid
  // (legacy parity).
  const clientSlots = tier.trainerClientLimit;

  return (
    <View
      style={[styles.card, isCurrent && styles.cardSelected]}
      testID={`subscription-card-${tier.tierName}`}
    >
      {showTrialBanner && (
        <View style={styles.trialBanner}>
          <Text style={styles.trialBannerText}>
            {trialBannerText ?? "Free trial"}
          </Text>
        </View>
      )}

      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={styles.title}>{tier.displayName}</Text>
          {isTrainer && clientSlots !== null && clientSlots !== undefined && (
            <Text style={styles.clientSlots}>{clientSlots} client slots</Text>
          )}
        </View>
        <View style={styles.priceContainer}>
          {billingCycle === "yearly" && yearlySavings > 0 && (
            <Text style={styles.priceStrikethrough}>
              £{monthlyPrice * 12}/year
            </Text>
          )}
          <Text style={styles.price}>
            £{price}
            {billingCycle === "yearly" ? "/year" : "/month"}
          </Text>
        </View>
      </View>

      {features.length > 0 && (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>What&apos;s included:</Text>
          <View style={styles.features}>
            {features.map((feature, idx) => (
              <View key={idx} style={styles.feature}>
                <Ionicons
                  name="checkmark"
                  size={18}
                  color={Colors.primary.DEFAULT}
                />
                <Text style={styles.featureText}>{feature}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      <View style={styles.subscribeButtonContainer}>
        <TouchableOpacity
          style={[
            styles.subscribeButton,
            isCurrent && styles.subscribeButtonCurrent,
          ]}
          onPress={onPress}
          disabled={disabled}
          activeOpacity={0.7}
          testID={`subscription-card-${tier.tierName}-subscribe`}
        >
          <Text style={styles.subscribeButtonText}>Subscribe</Text>
        </TouchableOpacity>
      </View>

      {isCurrent && <Text style={styles.currentBadge}>Current Plan</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    borderWidth: 2,
    borderColor: "transparent",
    ...Shadows.medium,
    overflow: "hidden",
    position: "relative",
    flex: 1,
    minHeight: 200,
  },
  cardSelected: {
    borderColor: Colors.primary.DEFAULT,
    backgroundColor: Colors.primary.DEFAULT + "10",
  },
  trialBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
    alignItems: "center",
    zIndex: 1,
  },
  trialBannerText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.text.inverse,
    textTransform: "uppercase",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  clientSlots: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.secondary,
    marginTop: Spacing.xs / 2,
  },
  priceContainer: {
    alignItems: "flex-end",
  },
  price: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  priceStrikethrough: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.error.DEFAULT,
    textDecorationLine: "line-through",
    marginBottom: Spacing.xs / 2,
  },
  subscribeButtonContainer: {
    marginTop: "auto",
    paddingTop: Spacing.md,
  },
  subscribeButton: {
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonCurrent: {
    backgroundColor: Colors.primary.DEFAULT + "CC",
    opacity: 0.8,
  },
  subscribeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.inverse,
  },
  content: {
    marginTop: Spacing.sm,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  features: {
    gap: Spacing.sm,
  },
  feature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  featureText: {
    fontSize: 14,
    color: Colors.text.secondary,
    flex: 1,
    lineHeight: 20,
  },
  currentBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary.DEFAULT,
    marginTop: Spacing.md,
    textAlign: "center",
  },
});
