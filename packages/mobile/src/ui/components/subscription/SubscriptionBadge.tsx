import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type {
  SubscriptionStatus,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { color } from "@/ui/theme/tokens";

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
  premium_plus: "Premium+",
  individual_trainer: "Start Up Coach",
  start_up_coach_plus: "Start Up Coach +",
  coach: "Coach",
  coach_pro: "Coach Pro",
};

function variantFor(tier: SubscriptionTierName): Variant {
  switch (tier) {
    case "free":
      return "free";
    case "premium":
    case "premium_plus":
      // premium_plus (M19-P0) shares the premium palette — it's a
      // consumer tier, not a trainer one.
      return "premium";
    default:
      // Every other tierName is a coach tier. Organisation tiers are not part
      // of the mobile subscription domain or purchase experience.
      return "trainer";
  }
}

const VARIANT_STYLES: Record<Variant, { background: string; text: string }> = {
  free: {
    background: color.$surface2,
    text: color.$text2,
  },
  premium: {
    background: color.$warning,
    text: color.$bg,
  },
  trainer: {
    // Trainer palette: warning-dark stand-in for "purple-ish" — keeps
    // the chip distinct from free / premium without introducing a new
    // accent token outside M10.5 scope.
    background: "#7C3AED",
    text: color.$bg,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 9999,
  },
  badgeCompact: {
    paddingHorizontal: 4 + 2,
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
