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
 * Dual-column trainer-tier card (Standard / Pro). Ported 1:1 from
 * legacy `persistence-mobile/components/subscription/TrainerSubscriptionCard.tsx`.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 1.3, 6.2, 6.3, 6.4
 *
 * Pure presenter. Three baseName families:
 *   - individual_trainer  → "Individual Trainer"
 *   - small_business      → "Small Business"
 *   - medium_enterprise   → "Medium to Enterprise"
 *
 * The display label is derived from whichever of (standardTier, proTier)
 * is non-null — legacy parity.
 */

export interface TrainerSubscriptionCardProps {
  standardTier: SubscriptionTier | null;
  proTier: SubscriptionTier | null;
  billingCycle: "monthly" | "yearly";
  isStandardCurrent: boolean;
  isProCurrent: boolean;
  showProTrialBanner?: boolean;
  trialBannerText?: string;
  onStandardPress: () => void;
  onProPress: () => void;
  disabled?: boolean;
}

export function TrainerSubscriptionCard({
  standardTier,
  proTier,
  billingCycle,
  isStandardCurrent,
  isProCurrent,
  showProTrialBanner = false,
  trialBannerText,
  onStandardPress,
  onProPress,
  disabled = false,
}: TrainerSubscriptionCardProps) {
  if (!standardTier && !proTier) {
    return null;
  }

  const clientSlots =
    standardTier?.trainerClientLimit ?? proTier?.trainerClientLimit ?? 0;
  const baseName = standardTier?.tierName ?? proTier?.tierName ?? "";
  const displayName = baseName.includes("individual_trainer")
    ? "Individual Trainer"
    : baseName.includes("small_business")
      ? "Small Business"
      : "Medium to Enterprise";

  const standardPrice = standardTier
    ? billingCycle === "yearly"
      ? (standardTier.priceYearly ?? 0)
      : standardTier.priceMonthly
    : null;
  const proPrice = proTier
    ? billingCycle === "yearly"
      ? (proTier.priceYearly ?? 0)
      : proTier.priceMonthly
    : null;
  const standardMonthlyPrice = standardTier?.priceMonthly ?? 0;
  const proMonthlyPrice = proTier?.priceMonthly ?? 0;
  const standardYearlySavings =
    standardMonthlyPrice * 12 - (standardTier?.priceYearly ?? 0);
  const proYearlySavings = proMonthlyPrice * 12 - (proTier?.priceYearly ?? 0);

  return (
    <View
      style={styles.card}
      testID={`trainer-subscription-card-${baseName}`}
    >
      <View style={styles.header}>
        <Text style={styles.title}>{displayName}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Standard includes:</Text>
        <View style={styles.features}>
          <View style={styles.feature}>
            <Ionicons
              name="checkmark"
              size={18}
              color={Colors.primary.DEFAULT}
            />
            <Text style={styles.featureText}>{clientSlots} client slots</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons
              name="checkmark"
              size={18}
              color={Colors.primary.DEFAULT}
            />
            <Text style={styles.featureText}>Analytics & reporting</Text>
          </View>
        </View>

        <View>
          <Text style={styles.proEnhancementTitle}>
            Enhance with pro to unlock:
          </Text>
          <View style={styles.proFeatures}>
            <View style={styles.proFeature}>
              <Ionicons
                name="checkmark"
                size={18}
                color={Colors.primary.DEFAULT}
              />
              <Text style={styles.proFeatureText}>AI supported reporting</Text>
            </View>
            <View style={styles.proFeature}>
              <Ionicons
                name="checkmark"
                size={18}
                color={Colors.primary.DEFAULT}
              />
              <Text style={styles.proFeatureText}>
                Client access to Reps buddy
              </Text>
            </View>
          </View>
        </View>
      </View>

      <View style={styles.pricingSection}>
        <View style={styles.pricingColumns}>
          {standardTier && (
            <TouchableOpacity
              style={[
                styles.pricingColumn,
                styles.pricingColumnTouchable,
                isStandardCurrent && styles.pricingColumnCurrent,
              ]}
              onPress={onStandardPress}
              disabled={disabled}
              activeOpacity={0.7}
              testID={`trainer-card-${baseName}-standard`}
            >
              <View style={styles.pricingContentCompact}>
                <View style={styles.pricingColumnLabelContainer}>
                  <Text style={styles.pricingColumnLabel}>Standard</Text>
                </View>
                <View style={styles.pricingContent}>
                  {billingCycle === "yearly" && standardYearlySavings > 0 ? (
                    <>
                      <Text style={styles.priceStrikethrough}>
                        £{standardMonthlyPrice * 12}/year
                      </Text>
                      <Text style={styles.price}>£{standardPrice}/year</Text>
                    </>
                  ) : (
                    <Text style={styles.price}>£{standardPrice}/month</Text>
                  )}
                </View>
                <View style={styles.subscribeButton}>
                  <Text style={styles.subscribeButtonText}>Subscribe</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {proTier && (
            <TouchableOpacity
              style={[
                styles.pricingColumn,
                styles.pricingColumnTouchable,
                isProCurrent && styles.pricingColumnCurrent,
              ]}
              onPress={onProPress}
              disabled={disabled}
              activeOpacity={0.7}
              testID={`trainer-card-${baseName}-pro`}
            >
              {showProTrialBanner && (
                <View style={styles.trialBannerColumn}>
                  <Text style={styles.trialBannerColumnText}>
                    {trialBannerText ?? "14-day free trial"}
                  </Text>
                </View>
              )}

              <View style={styles.pricingContentCompact}>
                <View style={styles.pricingColumnLabelContainer}>
                  <Text style={styles.pricingColumnLabel}>Pro</Text>
                </View>
                <View style={styles.pricingContent}>
                  {billingCycle === "yearly" && proYearlySavings > 0 ? (
                    <>
                      <Text style={styles.priceStrikethrough}>
                        £{proMonthlyPrice * 12}/year
                      </Text>
                      <Text style={styles.price}>£{proPrice}/year</Text>
                    </>
                  ) : (
                    <Text style={styles.price}>£{proPrice}/month</Text>
                  )}
                </View>
                <View style={styles.subscribeButton}>
                  <Text style={styles.subscribeButtonText}>Subscribe</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {(isStandardCurrent || isProCurrent) && (
        <Text style={styles.currentBadge}>Current Plan</Text>
      )}
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
  },
  header: {
    marginBottom: Spacing.sm,
    marginTop: Spacing.xs,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: Colors.text.primary,
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
    marginBottom: Spacing.md,
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
  proEnhancementTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.primary.DEFAULT,
    marginBottom: Spacing.sm,
  },
  proFeatures: {
    gap: Spacing.sm,
  },
  proFeature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Spacing.sm,
  },
  proFeatureText: {
    fontSize: 14,
    color: Colors.primary.DEFAULT,
    flex: 1,
    lineHeight: 20,
  },
  pricingSection: {
    marginTop: Spacing.md,
  },
  pricingColumnLabelContainer: {
    flex: 1,
    alignItems: "center",
  },
  pricingColumns: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  pricingColumn: {
    flex: 1,
  },
  pricingColumnTouchable: {
    borderWidth: 2,
    borderColor: Colors.surface.border,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    overflow: "hidden",
    position: "relative",
  },
  pricingColumnCurrent: {
    borderColor: Colors.primary.DEFAULT,
    backgroundColor: Colors.primary.DEFAULT + "10",
  },
  trialBannerColumn: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.xs / 2,
    paddingHorizontal: Spacing.xs,
    alignItems: "center",
    zIndex: 1,
  },
  trialBannerColumnText: {
    fontSize: 10,
    fontWeight: "700",
    color: Colors.text.inverse,
    textTransform: "uppercase",
  },
  pricingColumnLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.primary,
    textAlign: "center",
  },
  pricingContentCompact: {
    flex: 1,
    justifyContent: "flex-end",
    paddingTop: Spacing.md,
    gap: Spacing.xs,
  },
  pricingContent: {
    alignItems: "center",
  },
  price: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text.primary,
    textAlign: "center",
  },
  priceStrikethrough: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.error.DEFAULT,
    textDecorationLine: "line-through",
    textAlign: "center",
    marginBottom: Spacing.xs / 2,
  },
  subscribeButton: {
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.inverse,
  },
  currentBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary.DEFAULT,
    marginTop: Spacing.md,
    textAlign: "center",
  },
});
