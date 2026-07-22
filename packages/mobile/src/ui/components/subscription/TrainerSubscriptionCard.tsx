import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SubscriptionTier } from "@/domain/models/subscription";
import { color } from "@/ui/theme/tokens";

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
  /**
   * When true, the Pro column advertises "Contact Sales" instead of a price +
   * Subscribe button (used for business tiers whose annual plan is sold B2B,
   * not via IAP). Its press fires `onContactSales` instead of `onProPress`.
   */
  contactSalesMode?: boolean;
  onContactSales?: () => void;
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
  contactSalesMode = false,
  onContactSales,
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

  // Per-column yearly availability. A trainer tier whose `priceYearly`
  // is null on the catalog row can't be sold yearly — render an
  // explicit "Yearly not available" state instead of falling back to
  // £0 (Inspector Brad PR #71 medium-severity find — sweep #1; twin of
  // the SubscriptionCard fix).
  const standardYearlyUnavailable =
    billingCycle === "yearly" && standardTier?.priceYearly === null;
  const proYearlyUnavailable =
    billingCycle === "yearly" && proTier?.priceYearly === null;
  const standardPrice = standardTier
    ? billingCycle === "yearly"
      ? standardTier.priceYearly
      : standardTier.priceMonthly
    : null;
  const proPrice = proTier
    ? billingCycle === "yearly"
      ? proTier.priceYearly
      : proTier.priceMonthly
    : null;
  const standardMonthlyPrice = standardTier?.priceMonthly ?? 0;
  const proMonthlyPrice = proTier?.priceMonthly ?? 0;
  const standardYearlySavings =
    standardTier && standardTier.priceYearly !== null
      ? standardMonthlyPrice * 12 - standardTier.priceYearly
      : 0;
  const proYearlySavings =
    proTier && proTier.priceYearly !== null
      ? proMonthlyPrice * 12 - proTier.priceYearly
      : 0;

  return (
    <View style={styles.card} testID={`trainer-subscription-card-${baseName}`}>
      <View style={styles.header}>
        <Text style={styles.title}>{displayName}</Text>
      </View>

      <View style={styles.content}>
        <Text style={styles.sectionTitle}>Standard includes:</Text>
        <View style={styles.features}>
          <View style={styles.feature}>
            <Ionicons name="checkmark" size={18} color={color.$primary} />
            <Text style={styles.featureText}>{clientSlots} client slots</Text>
          </View>
          <View style={styles.feature}>
            <Ionicons name="checkmark" size={18} color={color.$primary} />
            <Text style={styles.featureText}>Analytics & reporting</Text>
          </View>
        </View>

        <View>
          <Text style={styles.proEnhancementTitle}>
            Enhance with pro to unlock:
          </Text>
          <View style={styles.proFeatures}>
            <View style={styles.proFeature}>
              <Ionicons name="checkmark" size={18} color={color.$primary} />
              <Text style={styles.proFeatureText}>AI supported reporting</Text>
            </View>
            <View style={styles.proFeature}>
              <Ionicons name="checkmark" size={18} color={color.$primary} />
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
                standardYearlyUnavailable && styles.pricingColumnDisabled,
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
                  {standardYearlyUnavailable ? (
                    <Text style={styles.priceUnavailable}>
                      Yearly not available
                    </Text>
                  ) : billingCycle === "yearly" && standardYearlySavings > 0 ? (
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
                  <Text style={styles.subscribeButtonText}>
                    {standardYearlyUnavailable
                      ? "Yearly not available"
                      : "Subscribe"}
                  </Text>
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
                !contactSalesMode &&
                  proYearlyUnavailable &&
                  styles.pricingColumnDisabled,
              ]}
              onPress={contactSalesMode ? onContactSales : onProPress}
              disabled={disabled}
              activeOpacity={0.7}
              testID={`trainer-card-${baseName}-pro`}
            >
              {showProTrialBanner &&
                !proYearlyUnavailable &&
                !contactSalesMode && (
                  <View style={styles.trialBannerColumn}>
                    <Text style={styles.trialBannerColumnText}>
                      {trialBannerText ?? "Free trial"}
                    </Text>
                  </View>
                )}

              <View style={styles.pricingContentCompact}>
                <View style={styles.pricingColumnLabelContainer}>
                  <Text style={styles.pricingColumnLabel}>Pro</Text>
                </View>
                <View style={styles.pricingContent}>
                  {contactSalesMode ? (
                    <Text style={styles.priceUnavailable}>
                      Annual plans handled by our team
                    </Text>
                  ) : proYearlyUnavailable ? (
                    <Text style={styles.priceUnavailable}>
                      Yearly not available
                    </Text>
                  ) : billingCycle === "yearly" && proYearlySavings > 0 ? (
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
                  <Text style={styles.subscribeButtonText}>
                    {contactSalesMode
                      ? "Contact Sales"
                      : proYearlyUnavailable
                        ? "Yearly not available"
                        : "Subscribe"}
                  </Text>
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
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 24,
    borderWidth: 2,
    borderColor: "transparent",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    overflow: "hidden",
    position: "relative",
  },
  header: {
    marginBottom: 8,
    marginTop: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: color.$text,
  },
  content: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$text2,
    marginBottom: 8,
  },
  features: {
    gap: 8,
    marginBottom: 16,
  },
  feature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  featureText: {
    fontSize: 14,
    color: color.$text2,
    flex: 1,
    lineHeight: 20,
  },
  proEnhancementTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$primary,
    marginBottom: 8,
  },
  proFeatures: {
    gap: 8,
  },
  proFeature: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  proFeatureText: {
    fontSize: 14,
    color: color.$primary,
    flex: 1,
    lineHeight: 20,
  },
  pricingSection: {
    marginTop: 16,
  },
  pricingColumnLabelContainer: {
    flex: 1,
    alignItems: "center",
  },
  pricingColumns: {
    flexDirection: "row",
    gap: 16,
  },
  pricingColumn: {
    flex: 1,
  },
  pricingColumnTouchable: {
    borderWidth: 2,
    borderColor: color.$surface3,
    borderRadius: 12,
    padding: 8,
    overflow: "hidden",
    position: "relative",
  },
  pricingColumnCurrent: {
    borderColor: color.$primary,
    backgroundColor: color.$primary + "10",
  },
  pricingColumnDisabled: {
    opacity: 0.55,
    borderColor: color.$surface3,
  },
  priceUnavailable: {
    fontSize: 13,
    fontWeight: "600",
    color: color.$text2,
    fontStyle: "italic",
    textAlign: "center",
  },
  trialBannerColumn: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: color.$primary,
    paddingVertical: 4 / 2,
    paddingHorizontal: 4,
    alignItems: "center",
    zIndex: 1,
  },
  trialBannerColumnText: {
    fontSize: 10,
    fontWeight: "700",
    color: color.$bg,
    textTransform: "uppercase",
  },
  pricingColumnLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: color.$text,
    textAlign: "center",
  },
  pricingContentCompact: {
    flex: 1,
    justifyContent: "flex-end",
    paddingTop: 16,
    gap: 4,
  },
  pricingContent: {
    alignItems: "center",
  },
  price: {
    fontSize: 18,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  priceStrikethrough: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$error,
    textDecorationLine: "line-through",
    textAlign: "center",
    marginBottom: 4 / 2,
  },
  subscribeButton: {
    backgroundColor: color.$primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$bg,
  },
  currentBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: color.$primary,
    marginTop: 16,
    textAlign: "center",
  },
});
