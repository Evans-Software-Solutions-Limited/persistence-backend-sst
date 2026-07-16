import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

/**
 * Single-line banner shown at the top of the Home tab when one or
 * more sync-queue entries are blocked by an entitlement verdict.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > UI
 * Satisfies: requirements.md AC 12.4
 *
 * Pure presenter — no hooks, no router. The container reads
 * `useBlockedSyncEntries()`, decides whether to mount, and wires
 * `onReview` to a `router.push('/(app)/sync-blocked')`.
 *
 * Hidden when `total === 0` to avoid layout flicker on first mount
 * (Inspector Brad pattern: a banner that briefly flashes is worse
 * than no banner at all).
 *
 * Visual: warning-tinted strip, lock-closed icon, total + upgrade-
 * target hint + tappable Review chip. Mirrors `OfflineBanner` style so
 * the two banners feel consistent when stacked.
 */
export interface SyncBlockedBannerProps {
  total: number;
  /**
   * Best-effort upgrade-target tier display label, e.g. "Premium".
   * Computed by the container from the entries' verdicts — usually
   * the most-common target. When two tracks are blocked the container
   * passes `null` and the banner falls back to a generic CTA.
   */
  upgradeTargetLabel: string | null;
  onReview: () => void;
}

export function SyncBlockedBanner({
  total,
  upgradeTargetLabel,
  onReview,
}: SyncBlockedBannerProps) {
  if (total <= 0) return null;

  const itemsLabel = total === 1 ? "1 item" : `${total} items`;
  const cta = upgradeTargetLabel
    ? `Upgrade to ${upgradeTargetLabel}`
    : "Upgrade your plan";

  return (
    <View style={styles.banner} testID="sync-blocked-banner">
      <Ionicons
        name="lock-closed"
        size={16}
        color={color.$warning}
        style={styles.icon}
      />
      <View style={styles.textWrap}>
        <Text style={styles.line} numberOfLines={1}>
          {itemsLabel} couldn&apos;t sync — {cta}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onReview}
        style={styles.reviewButton}
        activeOpacity={0.7}
        testID="sync-blocked-banner-review"
      >
        <Text style={styles.reviewText}>Review</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: color.$warning + "1A",
    borderWidth: 1,
    borderColor: color.$warning + "40",
    borderRadius: 12,
    marginHorizontal: 24,
    marginTop: 8,
  },
  icon: {
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  line: {
    fontSize: 13,
    fontWeight: "600",
    color: color.$warning,
  },
  reviewButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    backgroundColor: color.$warning + "33",
  },
  reviewText: {
    fontSize: 12,
    fontWeight: "700",
    color: color.$warning,
  },
});
