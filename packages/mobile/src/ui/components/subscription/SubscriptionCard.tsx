import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SubscriptionTier } from "@/domain/models/subscription";
import { color } from "@/ui/theme/tokens";

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
  // A tier without a configured yearly Stripe price can't be sold on the
  // yearly cycle. Compute an explicit unavailability flag so we don't
  // fall back to £0 — that path painted a fake-free card with a red
  // savings strikethrough and let the user tap into an Apple Pay sheet
  // for £0, only to error on the backend after the biometric tap
  // (Inspector Brad PR #71 medium-severity find — sweep #1).
  const yearlyUnavailable =
    billingCycle === "yearly" && tier.priceYearly === null;
  const price =
    billingCycle === "yearly" ? tier.priceYearly : tier.priceMonthly;
  const monthlyPrice = tier.priceMonthly || 0;
  const yearlySavings =
    tier.priceYearly !== null ? monthlyPrice * 12 - tier.priceYearly : 0;

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
          {yearlyUnavailable ? (
            <Text style={styles.priceUnavailable}>Yearly not available</Text>
          ) : (
            <>
              {billingCycle === "yearly" && yearlySavings > 0 && (
                <Text style={styles.priceStrikethrough}>
                  £{monthlyPrice * 12}/year
                </Text>
              )}
              <Text style={styles.price}>
                £{price}
                {billingCycle === "yearly" ? "/year" : "/month"}
              </Text>
            </>
          )}
        </View>
      </View>

      {features.length > 0 && (
        <View style={styles.content}>
          <Text style={styles.sectionTitle}>What&apos;s included:</Text>
          <View style={styles.features}>
            {features.map((feature, idx) => (
              <View key={idx} style={styles.feature}>
                <Ionicons name="checkmark" size={18} color={color.$primary} />
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
            yearlyUnavailable && styles.subscribeButtonDisabled,
          ]}
          onPress={onPress}
          disabled={disabled}
          activeOpacity={0.7}
          testID={`subscription-card-${tier.tierName}-subscribe`}
        >
          <Text style={styles.subscribeButtonText}>
            {yearlyUnavailable ? "Yearly not available" : "Subscribe"}
          </Text>
        </TouchableOpacity>
      </View>

      {isCurrent && <Text style={styles.currentBadge}>Current Plan</Text>}
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
    flex: 1,
    minHeight: 200,
  },
  cardSelected: {
    borderColor: color.$primary,
    backgroundColor: color.$primary + "10",
  },
  trialBanner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: color.$primary,
    paddingVertical: 4,
    paddingHorizontal: 16,
    alignItems: "center",
    zIndex: 1,
  },
  trialBannerText: {
    fontSize: 12,
    fontWeight: "700",
    color: color.$bg,
    textTransform: "uppercase",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    marginTop: 4,
  },
  titleContainer: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: color.$text,
  },
  clientSlots: {
    fontSize: 16,
    fontWeight: "600",
    color: color.$text2,
    marginTop: 4 / 2,
  },
  priceContainer: {
    alignItems: "flex-end",
  },
  price: {
    fontSize: 22,
    fontWeight: "700",
    color: color.$text,
  },
  priceStrikethrough: {
    fontSize: 16,
    fontWeight: "600",
    color: color.$error,
    textDecorationLine: "line-through",
    marginBottom: 4 / 2,
  },
  subscribeButtonContainer: {
    marginTop: "auto",
    paddingTop: 16,
  },
  subscribeButton: {
    backgroundColor: color.$primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonDisabled: {
    backgroundColor: color.$surface2,
    opacity: 0.6,
  },
  priceUnavailable: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$text2,
    fontStyle: "italic",
  },
  subscribeButtonCurrent: {
    backgroundColor: color.$primary + "CC",
    opacity: 0.8,
  },
  subscribeButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$bg,
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
  currentBadge: {
    fontSize: 12,
    fontWeight: "600",
    color: color.$primary,
    marginTop: 16,
    textAlign: "center",
  },
});
