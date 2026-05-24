import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { EntitlementFeature } from "@/domain/models/entitlement";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Paywall card rendered by the feature-gate flow.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Mobile feature-gate model
 * Satisfies: requirements.md AC 10.2
 *
 * Pure presenter — no hooks, no side effects, no router access. The
 * container (typically via `useFeatureGate`) wires `onUpgrade` to push
 * to `/(auth)/subscription-selection` with the target tier pre-applied.
 *
 * Renders a vertical card:
 *   1. Lock icon + feature display name + "X-only feature" subtitle.
 *   2. Current tier line ("Currently on Free plan").
 *   3. Upgrade tier preview (display name + monthly price) — collapsed
 *      to a "Contact support" affordance when `upgradeTo === null`
 *      (already at the top tier; the gate is genuinely a "you can't
 *      go higher" message).
 *   4. Primary CTA — "Upgrade to <tier>" → `onUpgrade`. Hidden when
 *      `upgradeTo === null`.
 *   5. Secondary CTA — "Not now" → `onDismiss`. Optional; hidden when
 *      `onDismiss` is omitted (e.g. when rendered as a screen-replacing
 *      gate with nowhere to dismiss to).
 *
 * Style mirrors `SubscriptionCard` / `CurrentSubscriptionStatusCard` —
 * legacy theme tokens, dark surface, primary-coloured CTA. No
 * /frontend-design polish per the brief; M11 takes that pass.
 */

export interface FeatureGatePromptProps {
  feature: EntitlementFeature;
  featureDisplayName: string;
  currentTier: SubscriptionTierName;
  upgradeTo: SubscriptionTierName | null;
  upgradePriceMonthly: number | null;
  onUpgrade: () => void;
  onDismiss?: () => void;
}

const TIER_DISPLAY_NAMES: Record<SubscriptionTierName, string> = {
  free: "Free",
  basic: "Basic",
  premium: "Premium",
  individual_trainer_standard: "Individual Trainer (Standard)",
  individual_trainer_pro: "Individual Trainer (Pro)",
  small_business_standard: "Small Business (Standard)",
  small_business_pro: "Small Business (Pro)",
  medium_enterprise_standard: "Medium Enterprise (Standard)",
  medium_enterprise_pro: "Medium Enterprise (Pro)",
};

function formatTier(tier: SubscriptionTierName): string {
  return TIER_DISPLAY_NAMES[tier];
}

function formatPrice(priceMonthly: number | null): string | null {
  if (priceMonthly === null) return null;
  // Match the legacy SubscriptionCard format — pound prefix, no decimal
  // padding ("£14.99/month" not "£14.99000/month").
  return `£${priceMonthly}/month`;
}

export function FeatureGatePrompt({
  feature,
  featureDisplayName,
  currentTier,
  upgradeTo,
  upgradePriceMonthly,
  onUpgrade,
  onDismiss,
}: FeatureGatePromptProps) {
  const upgradeLabel = upgradeTo ? formatTier(upgradeTo) : null;
  const priceLabel = formatPrice(upgradePriceMonthly);
  const hasUpgradePath = upgradeTo !== null;

  return (
    <View style={styles.card} testID={`feature-gate-prompt-${feature}`}>
      <View style={styles.iconWrapper}>
        <Ionicons
          name="lock-closed"
          size={28}
          color={Colors.primary.DEFAULT}
        />
      </View>

      <Text style={styles.title}>{featureDisplayName}</Text>
      <Text style={styles.subtitle}>
        This feature isn&apos;t included in your current plan.
      </Text>

      <View style={styles.currentTierRow}>
        <Text style={styles.currentTierLabel}>Currently on</Text>
        <Text style={styles.currentTierValue}>{formatTier(currentTier)}</Text>
      </View>

      {hasUpgradePath ? (
        <View
          style={styles.upgradePreview}
          testID="feature-gate-upgrade-preview"
        >
          <View style={styles.upgradePreviewHeader}>
            <Text style={styles.upgradePreviewName}>{upgradeLabel}</Text>
            {priceLabel && (
              <Text style={styles.upgradePreviewPrice}>{priceLabel}</Text>
            )}
          </View>
          <Text style={styles.upgradePreviewBlurb}>
            Unlock {featureDisplayName.toLowerCase()} and more.
          </Text>
        </View>
      ) : (
        <View style={styles.supportRow} testID="feature-gate-contact-support">
          <Ionicons
            name="help-circle-outline"
            size={20}
            color={Colors.text.secondary}
          />
          <Text style={styles.supportText}>
            You&apos;re already on our top tier. Contact support for help.
          </Text>
        </View>
      )}

      <View style={styles.ctaRow}>
        {hasUpgradePath && (
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={onUpgrade}
            activeOpacity={0.7}
            testID="feature-gate-upgrade"
          >
            <Text style={styles.primaryButtonText}>
              Upgrade to {upgradeLabel}
            </Text>
          </TouchableOpacity>
        )}

        {onDismiss && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={onDismiss}
            activeOpacity={0.7}
            testID="feature-gate-dismiss"
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadows.medium,
    alignItems: "stretch",
    gap: Spacing.md,
  },
  iconWrapper: {
    alignItems: "center",
    paddingTop: Spacing.xs,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text.primary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: Colors.text.secondary,
    textAlign: "center",
    lineHeight: 20,
  },
  currentTierRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: Spacing.xs,
  },
  currentTierLabel: {
    fontSize: 13,
    color: Colors.text.secondary,
  },
  currentTierValue: {
    fontSize: 13,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  upgradePreview: {
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  upgradePreviewHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  upgradePreviewName: {
    fontSize: 16,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  upgradePreviewPrice: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.primary.DEFAULT,
  },
  upgradePreviewBlurb: {
    fontSize: 13,
    color: Colors.text.secondary,
    lineHeight: 18,
  },
  supportRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  supportText: {
    fontSize: 13,
    color: Colors.text.secondary,
    flexShrink: 1,
  },
  ctaRow: {
    gap: Spacing.sm,
  },
  primaryButton: {
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text.inverse,
  },
  secondaryButton: {
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
});
