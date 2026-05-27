import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type {
  SubscriptionStatus,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  BorderRadius,
  Colors,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Compact tier chip — small visual indicator of the user's current
 * subscription tier + status. Used in Profile, settings, and any
 * future location that needs a one-line "what tier am I on" hint.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Mobile feature-gate model
 * Satisfies: requirements.md AC 10.3
 *
 * Pure presenter — pulls tier + paymentStatus from props, returns a
 * coloured pill with the tier label + optional status suffix.
 *
 * Variant palette (mirrors common SaaS conventions):
 *   - free             — neutral grey
 *   - basic            — blue
 *   - premium          — gold
 *   - any trainer tier — purple
 *
 * Status suffixes:
 *   - trialing  → " · Trial"
 *   - cancelled → " · Cancelled"
 *   - everything else → no suffix
 *
 * The `compact` prop strips horizontal padding + drops the font size
 * one step for use in tight rows (e.g. the Profile header next to a
 * username).
 */

export interface SubscriptionBadgeProps {
  tier: SubscriptionTierName;
  paymentStatus: SubscriptionStatus;
  compact?: boolean;
}

type Variant = "free" | "premium" | "trainer";

const TIER_DISPLAY_NAMES: Record<SubscriptionTierName, string> = {
  free: "Free",
  premium: "Premium",
  individual_trainer: "Trainer",
  small_business: "Business Trainer",
  medium_enterprise: "Enterprise Trainer",
};

function variantFor(tier: SubscriptionTierName): Variant {
  switch (tier) {
    case "free":
      return "free";
    case "premium":
      return "premium";
    default:
      // Every other tierName is a trainer / business / enterprise tier.
      // Treated uniformly under one palette.
      return "trainer";
  }
}

const VARIANT_STYLES: Record<Variant, { background: string; text: string }> = {
  free: {
    background: Colors.surface.secondary,
    text: Colors.text.secondary,
  },
  premium: {
    background: Colors.warning.DEFAULT,
    text: Colors.text.inverse,
  },
  trainer: {
    // Trainer palette: warning-dark stand-in for "purple-ish" — keeps
    // the chip distinct from free / premium without introducing a new
    // accent token outside M10.5 scope.
    background: "#7C3AED",
    text: Colors.text.inverse,
  },
};

function statusSuffix(status: SubscriptionStatus): string | null {
  switch (status) {
    case "trialing":
      return "Trial";
    case "cancelled":
      return "Cancelled";
    default:
      return null;
  }
}

export function SubscriptionBadge({
  tier,
  paymentStatus,
  compact = false,
}: SubscriptionBadgeProps) {
  const variant = variantFor(tier);
  const palette = VARIANT_STYLES[variant];
  const label = TIER_DISPLAY_NAMES[tier];
  const suffix = statusSuffix(paymentStatus);

  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: palette.background },
        compact && styles.badgeCompact,
      ]}
      testID={`subscription-badge-${tier}`}
    >
      <Text
        style={[
          styles.text,
          { color: palette.text },
          compact && styles.textCompact,
        ]}
      >
        {suffix ? `${label} · ${suffix}` : label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.full,
  },
  badgeCompact: {
    paddingHorizontal: Spacing.xs + 2,
    paddingVertical: 2,
  },
  text: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  textCompact: {
    fontSize: 11,
  },
});
